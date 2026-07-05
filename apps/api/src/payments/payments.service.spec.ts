import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PremiumCreditStatus } from '@speedora/database';
import { PREMIUM_TRANSCRIPTION_PRICE_IDR } from '@speedora/shared';
import type { PrismaService } from '../prisma/prisma.service';
import type { MidtransWebhookDto } from './dto/midtrans-webhook.dto';
import { verifyMidtransSignature } from './midtrans-signature.util';

const mockCreateTransaction = jest.fn();
const mockSnap = jest.fn().mockImplementation(() => ({ createTransaction: mockCreateTransaction }));
jest.mock('midtrans-client', () => ({ Snap: mockSnap }));

jest.mock('./midtrans-signature.util', () => ({
  verifyMidtransSignature: jest.fn(),
}));

import { MidtransNotConfiguredError, PaymentsService } from './payments.service';

describe('PaymentsService', () => {
  const originalEnv = process.env;
  let service: PaymentsService;
  let prisma: {
    premiumCredit: {
      create: jest.Mock;
      findFirst: jest.Mock;
      findUnique: jest.Mock;
      updateMany: jest.Mock;
    };
  };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = {
      ...originalEnv,
      MIDTRANS_SERVER_KEY: 'SB-Mid-server-test',
      MIDTRANS_CLIENT_KEY: 'SB-Mid-client-test',
    };
    prisma = {
      premiumCredit: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        updateMany: jest.fn(),
      },
    };
    service = new PaymentsService(prisma as unknown as PrismaService);
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('createPremiumCheckout', () => {
    it('creates a PENDING PremiumCredit row, then a matching Midtrans Snap transaction', async () => {
      prisma.premiumCredit.create.mockResolvedValue({});
      mockCreateTransaction.mockResolvedValue({
        token: 'snap-token-1',
        redirect_url: 'https://app.sandbox.midtrans.com/snap/v1/redirect/snap-token-1',
      });

      const result = await service.createPremiumCheckout({ id: 'user-1', email: 'a@b.com' });

      expect(prisma.premiumCredit.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          amount: PREMIUM_TRANSCRIPTION_PRICE_IDR,
          midtransOrderId: expect.stringMatching(/^premium-/),
          status: PremiumCreditStatus.PENDING,
        },
      });
      expect(mockCreateTransaction).toHaveBeenCalledWith({
        transaction_details: {
          order_id: expect.stringMatching(/^premium-/),
          gross_amount: PREMIUM_TRANSCRIPTION_PRICE_IDR,
        },
      });
      expect(result).toEqual({
        snapToken: 'snap-token-1',
        redirectUrl: 'https://app.sandbox.midtrans.com/snap/v1/redirect/snap-token-1',
      });
    });

    it('throws MidtransNotConfiguredError instead of calling Midtrans when server/client key is unset', async () => {
      delete process.env.MIDTRANS_SERVER_KEY;

      await expect(
        service.createPremiumCheckout({ id: 'user-1', email: 'a@b.com' }),
      ).rejects.toThrow(MidtransNotConfiguredError);
      expect(prisma.premiumCredit.create).not.toHaveBeenCalled();
      expect(mockCreateTransaction).not.toHaveBeenCalled();
    });
  });

  describe('getAvailability', () => {
    it('reports available when a PAID, unspent (videoId null) credit exists', async () => {
      prisma.premiumCredit.findFirst.mockResolvedValue({ id: 'credit-1' });

      const result = await service.getAvailability('user-1');

      expect(prisma.premiumCredit.findFirst).toHaveBeenCalledWith({
        where: { userId: 'user-1', status: PremiumCreditStatus.PAID, videoId: null },
        select: { id: true },
      });
      expect(result).toEqual({ available: true });
    });

    it('reports unavailable when no such credit exists', async () => {
      prisma.premiumCredit.findFirst.mockResolvedValue(null);

      expect(await service.getAvailability('user-1')).toEqual({ available: false });
    });
  });

  describe('handleWebhook', () => {
    const baseDto: MidtransWebhookDto = {
      order_id: 'premium-abc',
      status_code: '200',
      gross_amount: '10000.00',
      signature_key: 'sig',
      transaction_status: 'settlement',
    };

    it('rejects an invalid signature without touching the database', async () => {
      (verifyMidtransSignature as jest.Mock).mockReturnValue(false);

      await expect(service.handleWebhook(baseDto)).rejects.toThrow(BadRequestException);
      expect(prisma.premiumCredit.findUnique).not.toHaveBeenCalled();
    });

    it('throws NotFoundException for an order_id that has no matching PremiumCredit', async () => {
      (verifyMidtransSignature as jest.Mock).mockReturnValue(true);
      prisma.premiumCredit.findUnique.mockResolvedValue(null);

      await expect(service.handleWebhook(baseDto)).rejects.toThrow(NotFoundException);
    });

    it('claims PENDING -> PAID atomically on settlement', async () => {
      (verifyMidtransSignature as jest.Mock).mockReturnValue(true);
      prisma.premiumCredit.findUnique.mockResolvedValue({ id: 'credit-1' });
      prisma.premiumCredit.updateMany.mockResolvedValue({ count: 1 });

      await service.handleWebhook({ ...baseDto, transaction_status: 'settlement' });

      expect(prisma.premiumCredit.updateMany).toHaveBeenCalledWith({
        where: { id: 'credit-1', status: PremiumCreditStatus.PENDING },
        data: { status: PremiumCreditStatus.PAID },
      });
    });

    it('maps a capture with fraud_status accept to PAID', async () => {
      (verifyMidtransSignature as jest.Mock).mockReturnValue(true);
      prisma.premiumCredit.findUnique.mockResolvedValue({ id: 'credit-1' });
      prisma.premiumCredit.updateMany.mockResolvedValue({ count: 1 });

      await service.handleWebhook({
        ...baseDto,
        transaction_status: 'capture',
        fraud_status: 'accept',
      });

      expect(prisma.premiumCredit.updateMany).toHaveBeenCalledWith({
        where: { id: 'credit-1', status: PremiumCreditStatus.PENDING },
        data: { status: PremiumCreditStatus.PAID },
      });
    });

    it('maps a capture with fraud_status challenge/deny to FAILED', async () => {
      (verifyMidtransSignature as jest.Mock).mockReturnValue(true);
      prisma.premiumCredit.findUnique.mockResolvedValue({ id: 'credit-1' });
      prisma.premiumCredit.updateMany.mockResolvedValue({ count: 1 });

      await service.handleWebhook({
        ...baseDto,
        transaction_status: 'capture',
        fraud_status: 'challenge',
      });

      expect(prisma.premiumCredit.updateMany).toHaveBeenCalledWith({
        where: { id: 'credit-1', status: PremiumCreditStatus.PENDING },
        data: { status: PremiumCreditStatus.FAILED },
      });
    });

    it.each(['deny', 'cancel', 'failure'])(
      'maps transaction_status %s to FAILED',
      async (status) => {
        (verifyMidtransSignature as jest.Mock).mockReturnValue(true);
        prisma.premiumCredit.findUnique.mockResolvedValue({ id: 'credit-1' });
        prisma.premiumCredit.updateMany.mockResolvedValue({ count: 1 });

        await service.handleWebhook({ ...baseDto, transaction_status: status });

        expect(prisma.premiumCredit.updateMany).toHaveBeenCalledWith({
          where: { id: 'credit-1', status: PremiumCreditStatus.PENDING },
          data: { status: PremiumCreditStatus.FAILED },
        });
      },
    );

    it('maps expire to EXPIRED', async () => {
      (verifyMidtransSignature as jest.Mock).mockReturnValue(true);
      prisma.premiumCredit.findUnique.mockResolvedValue({ id: 'credit-1' });
      prisma.premiumCredit.updateMany.mockResolvedValue({ count: 1 });

      await service.handleWebhook({ ...baseDto, transaction_status: 'expire' });

      expect(prisma.premiumCredit.updateMany).toHaveBeenCalledWith({
        where: { id: 'credit-1', status: PremiumCreditStatus.PENDING },
        data: { status: PremiumCreditStatus.EXPIRED },
      });
    });

    it('leaves the credit untouched (no update at all) while transaction_status is pending', async () => {
      (verifyMidtransSignature as jest.Mock).mockReturnValue(true);
      prisma.premiumCredit.findUnique.mockResolvedValue({ id: 'credit-1' });

      await service.handleWebhook({ ...baseDto, transaction_status: 'pending' });

      expect(prisma.premiumCredit.updateMany).not.toHaveBeenCalled();
    });

    it('throws MidtransNotConfiguredError when MIDTRANS_SERVER_KEY is unset', async () => {
      delete process.env.MIDTRANS_SERVER_KEY;

      await expect(service.handleWebhook(baseDto)).rejects.toThrow(MidtransNotConfiguredError);
    });
  });

  describe('consumeCredit', () => {
    it('atomically claims an available credit for the given video', async () => {
      prisma.premiumCredit.findFirst.mockResolvedValue({ id: 'credit-1' });
      prisma.premiumCredit.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.consumeCredit('user-1', 'video-1');

      expect(prisma.premiumCredit.findFirst).toHaveBeenCalledWith({
        where: { userId: 'user-1', status: PremiumCreditStatus.PAID, videoId: null },
      });
      expect(prisma.premiumCredit.updateMany).toHaveBeenCalledWith({
        where: { id: 'credit-1', videoId: null },
        data: { videoId: 'video-1' },
      });
      expect(result).toBe(true);
    });

    it('returns false without attempting an update when no credit is available', async () => {
      prisma.premiumCredit.findFirst.mockResolvedValue(null);

      expect(await service.consumeCredit('user-1', 'video-1')).toBe(false);
      expect(prisma.premiumCredit.updateMany).not.toHaveBeenCalled();
    });

    it('returns false if the credit was claimed by a concurrent request first (race)', async () => {
      prisma.premiumCredit.findFirst.mockResolvedValue({ id: 'credit-1' });
      prisma.premiumCredit.updateMany.mockResolvedValue({ count: 0 });

      expect(await service.consumeCredit('user-1', 'video-1')).toBe(false);
    });
  });
});
