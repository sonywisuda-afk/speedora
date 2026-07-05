import * as crypto from 'node:crypto';
import { verifyMidtransSignature } from './midtrans-signature.util';

function sign(orderId: string, statusCode: string, grossAmount: string, serverKey: string) {
  return crypto
    .createHash('sha512')
    .update(orderId + statusCode + grossAmount + serverKey)
    .digest('hex');
}

describe('verifyMidtransSignature', () => {
  it('accepts a signature computed the same way Midtrans documents', () => {
    const serverKey = 'SB-Mid-server-abc123';
    const signatureKey = sign('order-1', '200', '10000.00', serverKey);

    expect(
      verifyMidtransSignature({
        orderId: 'order-1',
        statusCode: '200',
        grossAmount: '10000.00',
        signatureKey,
        serverKey,
      }),
    ).toBe(true);
  });

  it('rejects a signature computed with the wrong server key', () => {
    const signatureKey = sign('order-1', '200', '10000.00', 'wrong-key');

    expect(
      verifyMidtransSignature({
        orderId: 'order-1',
        statusCode: '200',
        grossAmount: '10000.00',
        signatureKey,
        serverKey: 'SB-Mid-server-abc123',
      }),
    ).toBe(false);
  });

  it('rejects a signature computed against a tampered field (order_id)', () => {
    const serverKey = 'SB-Mid-server-abc123';
    const signatureKey = sign('order-1', '200', '10000.00', serverKey);

    expect(
      verifyMidtransSignature({
        orderId: 'order-2', // tampered relative to what was signed
        statusCode: '200',
        grossAmount: '10000.00',
        signatureKey,
        serverKey,
      }),
    ).toBe(false);
  });

  it('rejects a malformed (non-hex or wrong-length) signature without throwing', () => {
    expect(
      verifyMidtransSignature({
        orderId: 'order-1',
        statusCode: '200',
        grossAmount: '10000.00',
        signatureKey: 'not-a-real-signature',
        serverKey: 'SB-Mid-server-abc123',
      }),
    ).toBe(false);
  });
});
