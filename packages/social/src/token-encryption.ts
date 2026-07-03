import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH_BYTES = 12; // recommended IV length for GCM

// TOKEN_ENCRYPTION_KEY is optional at boot in both apps/api and
// apps/worker (see each app's env validation/docs) - neither app has to
// stop working for everyone who hasn't set up Fase 6a's Google OAuth
// credentials yet. It's read (and validated) lazily here, at the point a
// token actually needs encrypting/decrypting, rather than silently
// falling back to some hardcoded key - there is no safe default for an
// encryption key.
function getKey(): Buffer {
  const hex = process.env.TOKEN_ENCRYPTION_KEY;
  if (!hex) {
    throw new Error(
      'TOKEN_ENCRYPTION_KEY is not configured - required to connect or publish to a social account. ' +
        'Generate one with: openssl rand -hex 32',
    );
  }
  const key = Buffer.from(hex, 'hex');
  if (key.length !== 32) {
    throw new Error('TOKEN_ENCRYPTION_KEY must be a 32-byte (64 hex character) key');
  }
  return key;
}

// Stored as "<iv>:<authTag>:<ciphertext>", all hex - see SocialAccount's
// accessToken/refreshToken columns.
export function encryptToken(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${ciphertext.toString('hex')}`;
}

export function decryptToken(stored: string): string {
  const [ivHex, authTagHex, ciphertextHex] = stored.split(':');
  if (!ivHex || !authTagHex || !ciphertextHex) {
    throw new Error('Malformed encrypted token');
  }
  const decipher = createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextHex, 'hex')),
    decipher.final(),
  ]);
  return plaintext.toString('utf8');
}
