import { ServiceUnavailableException } from '@nestjs/common';
import type { MidtransWebhookDto } from './dto/midtrans-webhook.dto';
import { PaymentsController } from './payments.controller';
import { MidtransNotConfiguredError, type PaymentsService } from './payments.service';

describe('PaymentsController', () => {
  let controller: PaymentsController;
  let payments: {
    createPremiumCheckout: jest.Mock;
    getAvailability: jest.Mock;
    handleWebhook: jest.Mock;
  };
  const user = { id: 'user-1', email: 'a@example.com' };

  beforeEach(() => {
    payments = {
      createPremiumCheckout: jest.fn(),
      getAvailability: jest.fn(),
      handleWebhook: jest.fn(),
    };
    controller = new PaymentsController(payments as unknown as PaymentsService);
  });

  describe('checkout', () => {
    it('returns the checkout result from PaymentsService', async () => {
      payments.createPremiumCheckout.mockResolvedValue({
        snapToken: 'token-1',
        redirectUrl: 'https://example.com/redirect',
      });

      const result = await controller.checkout(user);

      expect(payments.createPremiumCheckout).toHaveBeenCalledWith(user);
      expect(result).toEqual({ snapToken: 'token-1', redirectUrl: 'https://example.com/redirect' });
    });

    it('maps MidtransNotConfiguredError to a 503', async () => {
      payments.createPremiumCheckout.mockRejectedValue(
        new MidtransNotConfiguredError('not configured'),
      );

      await expect(controller.checkout(user)).rejects.toThrow(ServiceUnavailableException);
    });
  });

  describe('status', () => {
    it('returns availability from PaymentsService', async () => {
      payments.getAvailability.mockResolvedValue({ available: true });

      expect(await controller.status(user)).toEqual({ available: true });
      expect(payments.getAvailability).toHaveBeenCalledWith('user-1');
    });
  });

  describe('webhook', () => {
    const dto: MidtransWebhookDto = {
      order_id: 'premium-abc',
      status_code: '200',
      gross_amount: '10000.00',
      signature_key: 'sig',
      transaction_status: 'settlement',
    };

    it('acknowledges once PaymentsService has handled the notification', async () => {
      payments.handleWebhook.mockResolvedValue(undefined);

      expect(await controller.webhook(dto)).toEqual({ received: true });
      expect(payments.handleWebhook).toHaveBeenCalledWith(dto);
    });

    it('maps MidtransNotConfiguredError to a 503', async () => {
      payments.handleWebhook.mockRejectedValue(new MidtransNotConfiguredError('not configured'));

      await expect(controller.webhook(dto)).rejects.toThrow(ServiceUnavailableException);
    });

    it('propagates other errors (e.g. invalid signature) unchanged', async () => {
      const error = new Error('boom');
      payments.handleWebhook.mockRejectedValue(error);

      await expect(controller.webhook(dto)).rejects.toThrow(error);
    });
  });
});
