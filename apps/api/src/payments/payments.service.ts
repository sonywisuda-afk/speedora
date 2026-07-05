import * as crypto from 'node:crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PremiumCreditStatus } from '@speedora/database';
import {
  PREMIUM_TRANSCRIPTION_PRICE_IDR,
  type PremiumCheckoutResult,
  type PremiumCreditAvailability,
} from '@speedora/shared';
import { Snap } from 'midtrans-client';
import type { SafeUser } from '../auth/auth.service';
import { PrismaService } from '../prisma/prisma.service';
import type { MidtransWebhookDto } from './dto/midtrans-webhook.dto';
import { verifyMidtransSignature } from './midtrans-signature.util';

export class MidtransNotConfiguredError extends Error {}

@Injectable()
export class PaymentsService {
  constructor(private readonly prisma: PrismaService) {}

  // Lazy, per-call construction (not a singleton built at module init) -
  // same "read env at first use, not at import time" posture as every
  // other optional integration in this app (e.g. social/*-oauth.client.ts),
  // so a server started before MIDTRANS_* was set doesn't need a restart.
  private requireSnapClient(): Snap {
    const serverKey = process.env.MIDTRANS_SERVER_KEY;
    const clientKey = process.env.MIDTRANS_CLIENT_KEY;
    if (!serverKey || !clientKey) {
      throw new MidtransNotConfiguredError('Midtrans payment integration is not configured');
    }
    return new Snap({
      isProduction: process.env.MIDTRANS_IS_PRODUCTION === 'true',
      serverKey,
      clientKey,
    });
  }

  // Creates the PremiumCredit row (status PENDING) and a matching Midtrans
  // Snap transaction for it - the row exists before the Snap API call
  // returns so the webhook (which can in principle arrive before this
  // method's own response does) always has something to update.
  async createPremiumCheckout(user: SafeUser): Promise<PremiumCheckoutResult> {
    const snap = this.requireSnapClient();
    const orderId = `premium-${crypto.randomUUID()}`;

    await this.prisma.premiumCredit.create({
      data: {
        userId: user.id,
        amount: PREMIUM_TRANSCRIPTION_PRICE_IDR,
        midtransOrderId: orderId,
        status: PremiumCreditStatus.PENDING,
      },
    });

    const transaction = await snap.createTransaction({
      transaction_details: { order_id: orderId, gross_amount: PREMIUM_TRANSCRIPTION_PRICE_IDR },
    });

    return { snapToken: transaction.token, redirectUrl: transaction.redirect_url };
  }

  // Whether the user has at least one paid, unspent premium credit right
  // now - polled by apps/web after Snap checkout, before letting the user
  // proceed with an OPENAI-provider upload/import.
  async getAvailability(userId: string): Promise<PremiumCreditAvailability> {
    const credit = await this.prisma.premiumCredit.findFirst({
      where: { userId, status: PremiumCreditStatus.PAID, videoId: null },
      select: { id: true },
    });
    return { available: credit !== null };
  }

  // The only trustworthy source of "did this payment actually succeed" -
  // Snap's client-side onSuccess callback (apps/web) fires from the buyer's
  // own browser and can't be trusted alone (closed tab, spoofed callback, a
  // network blip that never reaches this server). This server-to-server
  // notification, with its signature verified below, is what actually
  // flips PENDING -> PAID/FAILED/EXPIRED.
  async handleWebhook(dto: MidtransWebhookDto): Promise<void> {
    const serverKey = process.env.MIDTRANS_SERVER_KEY;
    if (!serverKey) {
      throw new MidtransNotConfiguredError('Midtrans payment integration is not configured');
    }

    const isValid = verifyMidtransSignature({
      orderId: dto.order_id,
      statusCode: dto.status_code,
      grossAmount: dto.gross_amount,
      signatureKey: dto.signature_key,
      serverKey,
    });
    if (!isValid) {
      throw new BadRequestException('Invalid Midtrans signature');
    }

    const credit = await this.prisma.premiumCredit.findUnique({
      where: { midtransOrderId: dto.order_id },
    });
    if (!credit) {
      throw new NotFoundException(`Unknown Midtrans order ${dto.order_id}`);
    }

    const nextStatus = resolveMidtransStatus(dto.transaction_status, dto.fraud_status);
    if (!nextStatus) return; // still pending ('pending' or an unrecognized status) - nothing to change yet

    // Claimed atomically off PENDING, not a plain update - Midtrans resends
    // the same notification more than once in practice, and a credit that's
    // already PAID may already have been spent (videoId set); this must
    // never re-flip or downgrade a credit that's already settled or spent.
    await this.prisma.premiumCredit.updateMany({
      where: { id: credit.id, status: PremiumCreditStatus.PENDING },
      data: { status: nextStatus },
    });
  }

  // Atomically claims one paid, unspent credit for the given video - called
  // by VideosService when a video is created with transcriptionProvider
  // OPENAI. Returns false (caller should reject with 400) if none is
  // available.
  async consumeCredit(userId: string, videoId: string): Promise<boolean> {
    const credit = await this.prisma.premiumCredit.findFirst({
      where: { userId, status: PremiumCreditStatus.PAID, videoId: null },
    });
    if (!credit) return false;

    // The `videoId: null` guard in WHERE (not just matching by id) is what
    // makes this atomic - if two requests raced for the same credit, only
    // the update that still sees it unclaimed succeeds.
    const claimed = await this.prisma.premiumCredit.updateMany({
      where: { id: credit.id, videoId: null },
      data: { videoId },
    });
    return claimed.count === 1;
  }
}

function resolveMidtransStatus(
  transactionStatus: string,
  fraudStatus: string | undefined,
): PremiumCreditStatus | null {
  if (transactionStatus === 'capture') {
    return fraudStatus === 'accept' ? PremiumCreditStatus.PAID : PremiumCreditStatus.FAILED;
  }
  if (transactionStatus === 'settlement') {
    return PremiumCreditStatus.PAID;
  }
  if (['deny', 'cancel', 'failure'].includes(transactionStatus)) {
    return PremiumCreditStatus.FAILED;
  }
  if (transactionStatus === 'expire') {
    return PremiumCreditStatus.EXPIRED;
  }
  return null;
}
