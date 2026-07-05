import { IsOptional, IsString } from 'class-validator';

// Field names match Midtrans's own notification body verbatim (snake_case)
// rather than being renamed to camelCase - this DTO exists purely to
// validate shape before PaymentsService reads it, not to translate an
// external contract into an internal one.
export class MidtransWebhookDto {
  @IsString()
  order_id!: string;

  @IsString()
  status_code!: string;

  @IsString()
  gross_amount!: string;

  @IsString()
  signature_key!: string;

  @IsString()
  transaction_status!: string;

  @IsOptional()
  @IsString()
  fraud_status?: string;
}
