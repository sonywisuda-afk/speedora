import { randomBytes } from 'node:crypto';
import { decryptToken, encryptToken } from './token-encryption';

describe('token-encryption', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('hex') };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('round-trips a token through encryptToken/decryptToken', () => {
    const plaintext = 'ya29.some-real-looking-access-token';

    const encrypted = decryptToken(encryptToken(plaintext));

    expect(encrypted).toBe(plaintext);
  });

  it('produces a different ciphertext each time (random IV) for the same plaintext', () => {
    const a = encryptToken('same-token');
    const b = encryptToken('same-token');

    expect(a).not.toBe(b);
    expect(decryptToken(a)).toBe('same-token');
    expect(decryptToken(b)).toBe('same-token');
  });

  it('stores as "<iv>:<authTag>:<ciphertext>" hex triples', () => {
    const encrypted = encryptToken('hello');
    const parts = encrypted.split(':');

    expect(parts).toHaveLength(3);
    expect(parts.every((p) => /^[0-9a-f]+$/.test(p))).toBe(true);
  });

  it('round-trips an empty-string plaintext (e.g. a platform with no refresh token issued)', () => {
    const encrypted = encryptToken('');

    expect(encrypted.split(':')).toHaveLength(3);
    expect(decryptToken(encrypted)).toBe('');
  });

  it('throws when TOKEN_ENCRYPTION_KEY is not configured', () => {
    delete process.env.TOKEN_ENCRYPTION_KEY;

    expect(() => encryptToken('x')).toThrow(/TOKEN_ENCRYPTION_KEY is not configured/);
  });

  it('throws when TOKEN_ENCRYPTION_KEY is not a 32-byte key', () => {
    process.env.TOKEN_ENCRYPTION_KEY = 'too-short';

    expect(() => encryptToken('x')).toThrow(/32-byte/);
  });

  it('throws decrypting a malformed stored token', () => {
    expect(() => decryptToken('not-the-right-format')).toThrow(/Malformed encrypted token/);
  });

  it('fails to decrypt (auth tag mismatch) if the ciphertext was tampered with', () => {
    const encrypted = encryptToken('hello');
    const [iv, authTag, ciphertext] = encrypted.split(':');
    const tampered = `${iv}:${authTag}:${ciphertext.slice(0, -2)}00`;

    expect(() => decryptToken(tampered)).toThrow();
  });
});
