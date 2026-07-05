import * as crypto from 'node:crypto';

// Midtrans's documented webhook signature: sha512(order_id + status_code +
// gross_amount + ServerKey). This - not the client-side Snap onSuccess
// callback - is the only thing that can be trusted to mean a payment
// actually settled, since it's signed with a key only this server and
// Midtrans know.
export function verifyMidtransSignature(params: {
  orderId: string;
  statusCode: string;
  grossAmount: string;
  signatureKey: string;
  serverKey: string;
}): boolean {
  const { orderId, statusCode, grossAmount, signatureKey, serverKey } = params;
  const expected = crypto
    .createHash('sha512')
    .update(orderId + statusCode + grossAmount + serverKey)
    .digest('hex');

  // Both sides are always the same fixed length (128 hex chars), so a
  // constant-time comparison is possible and worthwhile here.
  const expectedBuffer = Buffer.from(expected, 'hex');
  const actualBuffer = Buffer.from(signatureKey, 'hex');
  if (expectedBuffer.length !== actualBuffer.length) return false;

  return crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}
