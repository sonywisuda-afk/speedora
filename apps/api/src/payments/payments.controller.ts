import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import type { SafeUser } from '../auth/auth.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { MidtransWebhookDto } from './dto/midtrans-webhook.dto';
import { MidtransNotConfiguredError, PaymentsService } from './payments.service';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post('premium-transcription/checkout')
  @UseGuards(JwtAuthGuard)
  async checkout(@CurrentUser() user: SafeUser) {
    try {
      return await this.payments.createPremiumCheckout(user);
    } catch (error) {
      if (error instanceof MidtransNotConfiguredError) {
        throw new ServiceUnavailableException(error.message);
      }
      throw error;
    }
  }

  @Get('premium-transcription/status')
  @UseGuards(JwtAuthGuard)
  status(@CurrentUser() user: SafeUser) {
    return this.payments.getAvailability(user.id);
  }

  // Deliberately NOT behind JwtAuthGuard - this is a server-to-server call
  // from Midtrans, not a browser request with a session cookie. Trust comes
  // entirely from the signature check inside handleWebhook(), same posture
  // as the OAuth callback routes in social.controller.ts being unguarded
  // for an equivalent reason (identity/trust comes from something other
  // than the session cookie).
  @Post('webhook/midtrans')
  @HttpCode(200)
  async webhook(@Body() dto: MidtransWebhookDto) {
    try {
      await this.payments.handleWebhook(dto);
    } catch (error) {
      if (error instanceof MidtransNotConfiguredError) {
        throw new ServiceUnavailableException(error.message);
      }
      throw error;
    }
    return { received: true };
  }
}
