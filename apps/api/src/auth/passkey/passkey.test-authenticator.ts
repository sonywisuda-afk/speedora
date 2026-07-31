import * as crypto from 'node:crypto';
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';

// Test-only synthetic WebAuthn authenticator - builds a real, CBOR/COSE-valid
// 'none'-attestation RegistrationResponseJSON that @simplewebauthn/server's
// verifyRegistrationResponse() will genuinely accept (rpIdHash/flags/
// clientDataJSON challenge+origin all real and consistent), without a
// browser or physical authenticator. This is the standard technique for
// testing a WebAuthn relying-party integration without end-to-end browser
// automation (which claude-in-chrome cannot drive here - no real biometric
// prompt or CDP virtual authenticator available) - see passkey.service.ts's
// header comment on why real-browser verification isn't attempted for
// Sprint 1. Exercising this against the REAL (unmocked) verifyRegistrationResponse
// proves the actual CBOR/COSE parsing and challenge/origin/rpID checks all
// work, not just our own glue code around a mocked library call.
//
// Only implements attestation format 'none' (no signature over the
// attestation statement to fake) - exactly what generateRegistrationOptions'
// attestationType: 'none' (passkey.service.ts) requests.

function cborHead(majorType: number, value: number): Buffer {
  const mt = majorType << 5;
  if (value < 24) return Buffer.from([mt | value]);
  if (value < 0x100) return Buffer.from([mt | 24, value]);
  if (value < 0x10000) {
    const b = Buffer.alloc(3);
    b[0] = mt | 25;
    b.writeUInt16BE(value, 1);
    return b;
  }
  const b = Buffer.alloc(5);
  b[0] = mt | 26;
  b.writeUInt32BE(value, 1);
  return b;
}

function cborUint(n: number): Buffer {
  return cborHead(0, n);
}

function cborNegInt(n: number): Buffer {
  return cborHead(1, -1 - n);
}

function cborBytes(buf: Buffer): Buffer {
  return Buffer.concat([cborHead(2, buf.length), buf]);
}

function cborText(str: string): Buffer {
  const buf = Buffer.from(str, 'utf8');
  return Buffer.concat([cborHead(3, buf.length), buf]);
}

function cborMapHead(numPairs: number): Buffer {
  return cborHead(5, numPairs);
}

// Encodes a P-256 public key as a COSE_Key CBOR map: {1: 2 (kty EC2),
// 3: -7 (alg ES256), -1: 1 (crv P-256), -2: x, -3: y} - the exact shape
// @simplewebauthn/server's decodeCredentialPublicKey expects.
function encodeCoseP256PublicKey(x: Buffer, y: Buffer): Buffer {
  return Buffer.concat([
    cborMapHead(5),
    cborUint(1),
    cborUint(2),
    cborUint(3),
    cborNegInt(-7),
    cborNegInt(-1),
    cborUint(1),
    cborNegInt(-2),
    cborBytes(x),
    cborNegInt(-3),
    cborBytes(y),
  ]);
}

export interface SyntheticRegistrationResult {
  response: RegistrationResponseJSON;
  credentialId: string;
  // Tahap 3 Sprint 2 (Passkey Login) - the same authenticator's private key,
  // returned so a caller can build a matching AUTHENTICATION assertion
  // (buildSyntheticAuthenticationResponse below) against the identical
  // credential a real login flow would - not a fresh, unrelated keypair.
  privateKey: crypto.KeyObject;
}

// userVerified controls the authenticatorData UV flag - see this file's
// header on why registration itself doesn't require it, and Sprint 2's
// eventual "UV passkey = MFA-equivalent" login-time check.
export function buildSyntheticRegistrationResponse(params: {
  rpID: string;
  origin: string;
  challenge: string;
  userVerified?: boolean;
}): SyntheticRegistrationResult {
  const { rpID, origin, challenge, userVerified = true } = params;

  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
  });
  const jwk = publicKey.export({ format: 'jwk' }) as { x: string; y: string };
  const x = Buffer.from(jwk.x, 'base64url');
  const y = Buffer.from(jwk.y, 'base64url');
  const coseKey = encodeCoseP256PublicKey(x, y);

  const credentialIdBytes = crypto.randomBytes(32);
  const rpIdHash = crypto.createHash('sha256').update(rpID).digest();

  // eslint-disable-next-line no-bitwise
  const flags = 0x01 | (userVerified ? 0x04 : 0) | 0x40; // UP | UV? | AT
  const flagsAndCounter = Buffer.from([flags, 0, 0, 0, 0]); // signCount = 0

  const aaguid = Buffer.alloc(16); // all-zero - not asserted by this synthetic authenticator
  const credentialIdLength = Buffer.alloc(2);
  credentialIdLength.writeUInt16BE(credentialIdBytes.length, 0);

  const attestedCredentialData = Buffer.concat([
    aaguid,
    credentialIdLength,
    credentialIdBytes,
    coseKey,
  ]);

  const authData = Buffer.concat([rpIdHash, flagsAndCounter, attestedCredentialData]);

  const attestationObject = Buffer.concat([
    cborMapHead(3),
    cborText('fmt'),
    cborText('none'),
    cborText('attStmt'),
    cborMapHead(0),
    cborText('authData'),
    cborBytes(authData),
  ]);

  const clientDataJSON = Buffer.from(
    JSON.stringify({
      type: 'webauthn.create',
      challenge,
      origin,
      crossOrigin: false,
    }),
    'utf8',
  );

  const credentialId = credentialIdBytes.toString('base64url');

  return {
    credentialId,
    privateKey,
    response: {
      id: credentialId,
      rawId: credentialId,
      type: 'public-key',
      clientExtensionResults: {},
      response: {
        clientDataJSON: clientDataJSON.toString('base64url'),
        attestationObject: attestationObject.toString('base64url'),
        transports: ['internal'],
      },
    },
  };
}

// Tahap 3 Sprint 2 (Passkey Login) - builds a real, cryptographically valid
// 'webauthn.get' AuthenticationResponseJSON that verifyAuthenticationResponse()
// will genuinely accept: a real ECDSA-SHA256 signature (Node's crypto.sign
// produces ASN.1 DER for an EC key, exactly the encoding WebAuthn assertions
// use) over authenticatorData || SHA-256(clientDataJSON), using the SAME
// keypair buildSyntheticRegistrationResponse generated - proving the
// signature-verification path for real, not just the CBOR/attestation
// parsing buildSyntheticRegistrationResponse alone exercises. No
// attestedCredentialData here (that's registration-only) - assertion
// authenticatorData is just rpIdHash + flags + signCount.
export function buildSyntheticAuthenticationResponse(params: {
  rpID: string;
  origin: string;
  challenge: string;
  credentialId: string;
  privateKey: crypto.KeyObject;
  counter?: number;
  userVerified?: boolean;
}): AuthenticationResponseJSON {
  const {
    rpID,
    origin,
    challenge,
    credentialId,
    privateKey,
    counter = 1,
    userVerified = true,
  } = params;

  const rpIdHash = crypto.createHash('sha256').update(rpID).digest();
  // eslint-disable-next-line no-bitwise
  const flags = 0x01 | (userVerified ? 0x04 : 0); // UP | UV? (no AT - not a registration)
  const counterBuf = Buffer.alloc(4);
  counterBuf.writeUInt32BE(counter, 0);
  const authenticatorData = Buffer.concat([rpIdHash, Buffer.from([flags]), counterBuf]);

  const clientDataJSON = Buffer.from(
    JSON.stringify({ type: 'webauthn.get', challenge, origin, crossOrigin: false }),
    'utf8',
  );
  const clientDataHash = crypto.createHash('sha256').update(clientDataJSON).digest();

  const signature = crypto.sign(
    'sha256',
    Buffer.concat([authenticatorData, clientDataHash]),
    privateKey,
  );

  return {
    id: credentialId,
    rawId: credentialId,
    type: 'public-key',
    clientExtensionResults: {},
    response: {
      clientDataJSON: clientDataJSON.toString('base64url'),
      authenticatorData: authenticatorData.toString('base64url'),
      signature: signature.toString('base64url'),
    },
  };
}
