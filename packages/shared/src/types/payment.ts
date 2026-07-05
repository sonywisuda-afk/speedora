// Mirrors PremiumCreditStatus in packages/database's Prisma schema. See
// CLAUDE.md's Premium Transcription section - one credit buys exactly one
// video's OpenAI Whisper transcription (pay-per-use, not a subscription).
export enum PremiumCreditStatus {
  PENDING = 'PENDING',
  PAID = 'PAID',
  FAILED = 'FAILED',
  EXPIRED = 'EXPIRED',
}

// Rupiah, whole units - Midtrans's IDR gross_amount has no subunit. Kept in
// packages/shared (not just apps/api) so apps/web can display the price
// without hardcoding it a second time.
export const PREMIUM_TRANSCRIPTION_PRICE_IDR = 10_000;

// POST /payments/premium-transcription/checkout response - what apps/web
// needs to open the Midtrans Snap popup.
export interface PremiumCheckoutResult {
  snapToken: string;
  redirectUrl: string;
}

// GET /payments/premium-transcription/status response - lets apps/web skip
// straight to upload/import if the user already has an unused paid credit
// (e.g. they refreshed the page after paying), rather than always creating a
// fresh Midtrans transaction.
export interface PremiumCreditAvailability {
  available: boolean;
}
