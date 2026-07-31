import { BadRequestException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@speedora/database';
import type { PrismaService } from '../../prisma/prisma.service';
import {
  buildSyntheticAuthenticationResponse,
  buildSyntheticRegistrationResponse,
} from './passkey.test-authenticator';
import { PasskeyService } from './passkey.service';

process.env.WEB_ORIGIN = 'http://localhost:3000';
delete process.env.WEBAUTHN_RP_ID;
delete process.env.WEBAUTHN_RP_NAME;

function p2002(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '5.0.0',
  });
}

// Tahap 3.5 (Passkey UX & Observability) - what Prisma throws when a
// Serializable transaction is aborted due to a concurrent write conflict.
function p2034(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(
    'Transaction failed due to a write conflict or a deadlock. Please retry your transaction',
    { code: 'P2034', clientVersion: '5.0.0' },
  );
}

describe('PasskeyService', () => {
  let service: PasskeyService;
  let jwtService: JwtService;
  let prisma: {
    passkey: {
      findMany: jest.Mock;
      create: jest.Mock;
      updateMany: jest.Mock;
      deleteMany: jest.Mock;
      findUniqueOrThrow: jest.Mock;
      count: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
    user: { findUniqueOrThrow: jest.Mock };
    oAuthIdentity: { count: jest.Mock };
    $transaction: jest.Mock;
  };

  beforeEach(() => {
    prisma = {
      passkey: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
        updateMany: jest.fn(),
        deleteMany: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        // Tahap 3 Sprint 2 (Passkey Login) - default to "1 passkey left,
        // this delete would be the last one" so the pre-existing delete
        // tests below (which never set count explicitly) exercise the
        // guard's password/oauthCount fallback path deterministically,
        // same reasoning the other default mocks in this file already use.
        count: jest.fn().mockResolvedValue(1),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ password: 'hashed' }) },
      oAuthIdentity: { count: jest.fn().mockResolvedValue(0) },
      // Tahap 3.5 (Passkey UX & Observability) - delete() now runs its
      // guard+deleteMany inside $transaction(tx => ...). Passing `prisma`
      // itself as `tx` (same pattern auth.service.spec.ts's own
      // $transaction mock already uses) means every existing
      // prisma.passkey.*/prisma.user.*/prisma.oAuthIdentity.* mock above
      // still applies unchanged inside the callback.
      $transaction: jest.fn().mockImplementation((fn: (tx: unknown) => unknown) => fn(prisma)),
    };
    // Real JwtService (not mocked) - same "real crypto round trip" posture
    // as MfaService's spec exercising real otplib, since the challenge
    // token's sign/verify IS the security boundary being tested here.
    jwtService = new JwtService({ secret: 'test-secret' });
    service = new PasskeyService(prisma as unknown as PrismaService, jwtService);
  });

  describe('generateRegistrationOptionsFor', () => {
    it('returns real WebAuthn creation options scoped to the derived rpID/rpName', async () => {
      const { options } = await service.generateRegistrationOptionsFor('user-1', 'a@example.com');

      expect(options.rp.id).toBe('localhost');
      expect(options.rp.name).toBe('Speedora');
      expect(options.user.name).toBe('a@example.com');
      expect(options.authenticatorSelection).toMatchObject({
        residentKey: 'preferred',
        userVerification: 'preferred',
      });
      expect(typeof options.challenge).toBe('string');
    });

    it("excludes the account's existing passkeys so the same authenticator cannot be re-registered", async () => {
      prisma.passkey.findMany.mockResolvedValue([
        { credentialId: 'existing-cred-id', transports: ['internal'] },
      ]);

      const { options } = await service.generateRegistrationOptionsFor('user-1', 'a@example.com');

      expect(options.excludeCredentials).toEqual([
        { id: 'existing-cred-id', transports: ['internal'], type: 'public-key' },
      ]);
    });

    it('signs a challenge token binding the challenge to this userId', async () => {
      const { options, challengeToken } = await service.generateRegistrationOptionsFor(
        'user-1',
        'a@example.com',
      );

      const payload = jwtService.verify<{ sub: string; purpose: string; challenge: string }>(
        challengeToken,
      );
      expect(payload.sub).toBe('user-1');
      expect(payload.purpose).toBe('passkey_registration');
      expect(payload.challenge).toBe(options.challenge);
    });
  });

  describe('verifyAndSaveRegistration', () => {
    async function issueChallenge(userId = 'user-1') {
      const { options, challengeToken } = await service.generateRegistrationOptionsFor(
        userId,
        'a@example.com',
      );
      return { challenge: options.challenge, challengeToken };
    }

    it('verifies a real synthetic attestation and persists the credential', async () => {
      const { challenge, challengeToken } = await issueChallenge();
      const { response, credentialId } = buildSyntheticRegistrationResponse({
        rpID: 'localhost',
        origin: 'http://localhost:3000',
        challenge,
      });
      prisma.passkey.create.mockImplementation(({ data }) =>
        Promise.resolve({
          id: 'passkey-1',
          ...data,
          createdAt: new Date('2026-07-31T00:00:00.000Z'),
          lastUsedAt: new Date('2026-07-31T00:00:00.000Z'),
        }),
      );

      const summary = await service.verifyAndSaveRegistration(
        'user-1',
        response,
        challengeToken,
        '  MacBook Touch ID  ',
        'Chrome on macOS',
      );

      expect(prisma.passkey.create).toHaveBeenCalledTimes(1);
      const createArgs = prisma.passkey.create.mock.calls[0][0];
      expect(createArgs.data.userId).toBe('user-1');
      expect(createArgs.data.credentialId).toBe(credentialId);
      expect(Buffer.isBuffer(createArgs.data.publicKey)).toBe(true);
      expect(createArgs.data.counter).toBe(0n);
      expect(createArgs.data.deviceType).toBe('singleDevice');
      expect(createArgs.data.backedUp).toBe(false);
      expect(createArgs.data.name).toBe('MacBook Touch ID');
      // Tahap 3.5 (Passkey UX & Observability)
      expect(createArgs.data.createdDeviceLabel).toBe('Chrome on macOS');
      expect(summary.id).toBe('passkey-1');
    });

    it('accepts an authenticator that only asserts user presence (no PIN/biometric)', async () => {
      const { challenge, challengeToken } = await issueChallenge();
      const { response } = buildSyntheticRegistrationResponse({
        rpID: 'localhost',
        origin: 'http://localhost:3000',
        challenge,
        userVerified: false,
      });
      prisma.passkey.create.mockResolvedValue({
        id: 'passkey-1',
        name: 'Security Key',
        deviceType: 'singleDevice',
        backedUp: false,
        createdAt: new Date(),
        lastUsedAt: new Date(),
      });

      await expect(
        service.verifyAndSaveRegistration('user-1', response, challengeToken, 'Security Key', null),
      ).resolves.toMatchObject({ id: 'passkey-1' });
    });

    it('rejects a response signed for a different origin', async () => {
      const { challenge, challengeToken } = await issueChallenge();
      const { response } = buildSyntheticRegistrationResponse({
        rpID: 'localhost',
        origin: 'http://evil.example.com',
        challenge,
      });

      await expect(
        service.verifyAndSaveRegistration('user-1', response, challengeToken, 'Passkey', null),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.passkey.create).not.toHaveBeenCalled();
    });

    it('rejects a tampered/garbage challenge token', async () => {
      const { response } = buildSyntheticRegistrationResponse({
        rpID: 'localhost',
        origin: 'http://localhost:3000',
        challenge: 'whatever',
      });

      await expect(
        service.verifyAndSaveRegistration('user-1', response, 'not-a-real-token', 'Passkey', null),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects a challenge token issued to a different account', async () => {
      const { challenge, challengeToken } = await issueChallenge('user-1');
      const { response } = buildSyntheticRegistrationResponse({
        rpID: 'localhost',
        origin: 'http://localhost:3000',
        challenge,
      });

      await expect(
        service.verifyAndSaveRegistration('user-2', response, challengeToken, 'Passkey', null),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('maps a unique-constraint collision to a friendly error', async () => {
      const { challenge, challengeToken } = await issueChallenge();
      const { response } = buildSyntheticRegistrationResponse({
        rpID: 'localhost',
        origin: 'http://localhost:3000',
        challenge,
      });
      prisma.passkey.create.mockRejectedValue(p2002());

      await expect(
        service.verifyAndSaveRegistration('user-1', response, challengeToken, 'Passkey', null),
      ).rejects.toThrow('This passkey is already registered');
    });

    it('falls back to a default name when given a blank one', async () => {
      const { challenge, challengeToken } = await issueChallenge();
      const { response } = buildSyntheticRegistrationResponse({
        rpID: 'localhost',
        origin: 'http://localhost:3000',
        challenge,
      });
      prisma.passkey.create.mockImplementation(({ data }) =>
        Promise.resolve({
          id: 'passkey-1',
          ...data,
          createdAt: new Date(),
          lastUsedAt: new Date(),
        }),
      );

      await service.verifyAndSaveRegistration('user-1', response, challengeToken, '   ', null);

      expect(prisma.passkey.create.mock.calls[0][0].data.name).toBe('Passkey');
    });
  });

  describe('list', () => {
    it("returns this user's passkeys ordered oldest-first", async () => {
      prisma.passkey.findMany.mockResolvedValue([
        {
          id: 'p1',
          name: 'A',
          deviceType: 'singleDevice',
          backedUp: false,
          createdAt: new Date(),
          lastUsedAt: new Date(),
        },
      ]);

      const result = await service.list('user-1');

      expect(prisma.passkey.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        orderBy: { createdAt: 'asc' },
      });
      expect(result).toHaveLength(1);
    });
  });

  describe('rename', () => {
    it('rejects a blank name without touching the database', async () => {
      await expect(service.rename('user-1', 'p1', '   ')).rejects.toThrow(BadRequestException);
      expect(prisma.passkey.updateMany).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the passkey does not belong to this user', async () => {
      prisma.passkey.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.rename('user-1', 'p1', 'New name')).rejects.toThrow(NotFoundException);
    });

    it('renames and returns the updated summary', async () => {
      prisma.passkey.updateMany.mockResolvedValue({ count: 1 });
      prisma.passkey.findUniqueOrThrow.mockResolvedValue({
        id: 'p1',
        name: 'New name',
        deviceType: 'singleDevice',
        backedUp: false,
        createdAt: new Date(),
        lastUsedAt: new Date(),
      });

      const result = await service.rename('user-1', 'p1', 'New name');

      expect(prisma.passkey.updateMany).toHaveBeenCalledWith({
        where: { id: 'p1', userId: 'user-1' },
        data: { name: 'New name' },
      });
      expect(result.name).toBe('New name');
    });
  });

  describe('delete', () => {
    it("scopes deletion to userId, matching unlinkOAuthProvider's pattern", async () => {
      prisma.passkey.deleteMany.mockResolvedValue({ count: 1 });

      await service.delete('user-1', 'p1');

      expect(prisma.passkey.deleteMany).toHaveBeenCalledWith({
        where: { id: 'p1', userId: 'user-1' },
      });
    });

    it('throws NotFoundException when nothing was deleted', async () => {
      prisma.passkey.deleteMany.mockResolvedValue({ count: 0 });

      await expect(service.delete('user-1', 'p1')).rejects.toThrow(NotFoundException);
    });

    // Tahap 3 Sprint 2 (Passkey Login) - "at least one sign-in method must
    // remain," mirroring AuthService.unlinkOAuthProvider's own guard.
    it('does not block deleting the last passkey when a password is set', async () => {
      prisma.passkey.count.mockResolvedValue(1);
      prisma.user.findUniqueOrThrow.mockResolvedValue({ password: 'hashed' });
      prisma.passkey.deleteMany.mockResolvedValue({ count: 1 });

      await expect(service.delete('user-1', 'p1')).resolves.toBeUndefined();
    });

    it('does not block deleting the last passkey when an OAuth identity remains', async () => {
      prisma.passkey.count.mockResolvedValue(1);
      prisma.user.findUniqueOrThrow.mockResolvedValue({ password: null });
      prisma.oAuthIdentity.count.mockResolvedValue(1);
      prisma.passkey.deleteMany.mockResolvedValue({ count: 1 });

      await expect(service.delete('user-1', 'p1')).resolves.toBeUndefined();
    });

    it('blocks deleting the last passkey when no password or OAuth identity remains', async () => {
      prisma.passkey.count.mockResolvedValue(1);
      prisma.user.findUniqueOrThrow.mockResolvedValue({ password: null });
      prisma.oAuthIdentity.count.mockResolvedValue(0);

      await expect(service.delete('user-1', 'p1')).rejects.toThrow(BadRequestException);
      expect(prisma.passkey.deleteMany).not.toHaveBeenCalled();
    });

    it('does not even check password/OAuth when more than one passkey remains', async () => {
      prisma.passkey.count.mockResolvedValue(2);
      prisma.passkey.deleteMany.mockResolvedValue({ count: 1 });

      await service.delete('user-1', 'p1');

      expect(prisma.user.findUniqueOrThrow).not.toHaveBeenCalled();
    });

    // Tahap 3.5 (Passkey UX & Observability) - race condition fix.
    it('runs the guard+delete inside a Serializable transaction', async () => {
      prisma.passkey.count.mockResolvedValue(2);
      prisma.passkey.deleteMany.mockResolvedValue({ count: 1 });

      await service.delete('user-1', 'p1');

      expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    });

    it('maps a P2034 write-conflict into a 409 asking the caller to retry', async () => {
      prisma.$transaction.mockRejectedValue(p2034());

      await expect(service.delete('user-1', 'p1')).rejects.toThrow(
        'This request conflicted with another change - please retry',
      );
    });
  });

  describe('generateAuthenticationOptionsFor', () => {
    it('returns usernameless options with no allowCredentials restriction', async () => {
      const { options } = await service.generateAuthenticationOptionsFor();

      expect(options.rpId).toBe('localhost');
      expect(options.userVerification).toBe('required');
      expect(options.allowCredentials).toBeUndefined();
    });

    it('signs a challenge token carrying no user identity', async () => {
      const { options, challengeToken } = await service.generateAuthenticationOptionsFor();

      const payload = jwtService.verify<{ sub?: string; purpose: string; challenge: string }>(
        challengeToken,
      );
      expect(payload.sub).toBeUndefined();
      expect(payload.purpose).toBe('passkey_login');
      expect(payload.challenge).toBe(options.challenge);
    });
  });

  describe('verifyAuthentication', () => {
    async function issueLoginChallenge() {
      const { options, challengeToken } = await service.generateAuthenticationOptionsFor();
      return { challenge: options.challenge, challengeToken };
    }

    // Registers a real synthetic passkey (via the already-verified
    // registration path above) and returns everything needed to build a
    // matching AUTHENTICATION assertion against the SAME keypair - a
    // genuine end-to-end proof that registration's stored publicKey is
    // exactly what verifyAuthenticationResponse can later verify a
    // signature against, not two independently-fabricated fixtures that
    // happen to both be well-formed.
    async function registerSyntheticPasskey() {
      const regChallenge = await service.generateRegistrationOptionsFor('user-1', 'a@example.com');
      const { response, credentialId, privateKey } = buildSyntheticRegistrationResponse({
        rpID: 'localhost',
        origin: 'http://localhost:3000',
        challenge: regChallenge.options.challenge,
      });
      let storedPublicKey: Buffer | undefined;
      prisma.passkey.create.mockImplementationOnce(({ data }) => {
        storedPublicKey = data.publicKey;
        return Promise.resolve({
          id: 'passkey-1',
          ...data,
          createdAt: new Date(),
          lastUsedAt: new Date(),
        });
      });
      await service.verifyAndSaveRegistration(
        'user-1',
        response,
        regChallenge.challengeToken,
        'Test Passkey',
        null,
      );
      return { credentialId, privateKey, storedPublicKey: storedPublicKey! };
    }

    it('verifies a real synthetic assertion against the stored credential and advances the counter', async () => {
      const { credentialId, privateKey, storedPublicKey } = await registerSyntheticPasskey();
      prisma.passkey.findUnique.mockResolvedValue({
        id: 'passkey-1',
        userId: 'user-1',
        credentialId,
        publicKey: storedPublicKey,
        counter: 0n,
        transports: ['internal'],
      });

      const { challenge, challengeToken } = await issueLoginChallenge();
      const assertion = buildSyntheticAuthenticationResponse({
        rpID: 'localhost',
        origin: 'http://localhost:3000',
        challenge,
        credentialId,
        privateKey,
      });

      const result = await service.verifyAuthentication(assertion, challengeToken);

      expect(result).toEqual({ userId: 'user-1', userVerified: true });
      expect(prisma.passkey.update).toHaveBeenCalledWith({
        where: { id: 'passkey-1' },
        data: { counter: 1n, lastUsedAt: expect.any(Date) },
      });
    });

    it('reports userVerified: false for an assertion without user verification', async () => {
      const { credentialId, privateKey, storedPublicKey } = await registerSyntheticPasskey();
      prisma.passkey.findUnique.mockResolvedValue({
        id: 'passkey-1',
        userId: 'user-1',
        credentialId,
        publicKey: storedPublicKey,
        counter: 0n,
        transports: ['internal'],
      });

      const { challenge, challengeToken } = await issueLoginChallenge();
      const assertion = buildSyntheticAuthenticationResponse({
        rpID: 'localhost',
        origin: 'http://localhost:3000',
        challenge,
        credentialId,
        privateKey,
        userVerified: false,
      });

      const result = await service.verifyAuthentication(assertion, challengeToken);

      expect(result).toEqual({ userId: 'user-1', userVerified: false });
    });

    it('rejects a signature that fails to verify against the stored public key (wrong keypair)', async () => {
      const { credentialId, storedPublicKey } = await registerSyntheticPasskey();
      const attacker = buildSyntheticRegistrationResponse({
        rpID: 'localhost',
        origin: 'http://localhost:3000',
        challenge: 'irrelevant-for-this-fixture',
      });
      prisma.passkey.findUnique.mockResolvedValue({
        id: 'passkey-1',
        userId: 'user-1',
        credentialId,
        publicKey: storedPublicKey,
        counter: 0n,
        transports: ['internal'],
      });

      const { challenge, challengeToken } = await issueLoginChallenge();
      // Signed with a DIFFERENT keypair than the one on file for this
      // credentialId - simulates a forged assertion.
      const forged = buildSyntheticAuthenticationResponse({
        rpID: 'localhost',
        origin: 'http://localhost:3000',
        challenge,
        credentialId,
        privateKey: attacker.privateKey,
      });

      await expect(service.verifyAuthentication(forged, challengeToken)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(prisma.passkey.update).not.toHaveBeenCalled();
    });

    it('rejects an assertion for an unknown credentialId with a generic error', async () => {
      prisma.passkey.findUnique.mockResolvedValue(null);
      const { challengeToken } = await issueLoginChallenge();

      await expect(
        service.verifyAuthentication(
          { id: 'unknown-cred', rawId: 'unknown-cred' } as never,
          challengeToken,
        ),
      ).rejects.toThrow(UnauthorizedException);
      expect(prisma.passkey.update).not.toHaveBeenCalled();
    });

    it('rejects a tampered/garbage login challenge token', async () => {
      await expect(
        service.verifyAuthentication({ id: 'x', rawId: 'x' } as never, 'not-a-real-token'),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('generateElevationOptionsFor', () => {
    it("scopes allowCredentials to the caller's own passkeys, unlike login's usernameless options", async () => {
      prisma.passkey.findMany.mockResolvedValue([
        { credentialId: 'cred-1', transports: ['internal'] },
      ]);

      const { options } = await service.generateElevationOptionsFor('user-1');

      expect(prisma.passkey.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        select: { credentialId: true, transports: true },
      });
      expect(options.allowCredentials).toEqual([
        { id: 'cred-1', transports: ['internal'], type: 'public-key' },
      ]);
      expect(options.userVerification).toBe('required');
    });

    it('refuses to generate options when the account has no passkey at all', async () => {
      prisma.passkey.findMany.mockResolvedValue([]);

      await expect(service.generateElevationOptionsFor('user-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('signs a challenge token bound to this userId', async () => {
      prisma.passkey.findMany.mockResolvedValue([
        { credentialId: 'cred-1', transports: ['internal'] },
      ]);

      const { options, challengeToken } = await service.generateElevationOptionsFor('user-1');

      const payload = jwtService.verify<{ sub: string; purpose: string; challenge: string }>(
        challengeToken,
      );
      expect(payload.sub).toBe('user-1');
      expect(payload.purpose).toBe('passkey_elevation');
      expect(payload.challenge).toBe(options.challenge);
    });
  });

  describe('verifyElevationAssertion', () => {
    async function registerSyntheticPasskeyFor(userId: string) {
      const regChallenge = await service.generateRegistrationOptionsFor(userId, 'a@example.com');
      const { response, credentialId, privateKey } = buildSyntheticRegistrationResponse({
        rpID: 'localhost',
        origin: 'http://localhost:3000',
        challenge: regChallenge.options.challenge,
      });
      let storedPublicKey: Buffer | undefined;
      prisma.passkey.create.mockImplementationOnce(({ data }) => {
        storedPublicKey = data.publicKey;
        return Promise.resolve({
          id: 'passkey-1',
          ...data,
          createdAt: new Date(),
          lastUsedAt: new Date(),
        });
      });
      await service.verifyAndSaveRegistration(
        userId,
        response,
        regChallenge.challengeToken,
        'Test Passkey',
        null,
      );
      return { credentialId, privateKey, storedPublicKey: storedPublicKey! };
    }

    it('elevates on a real UV assertion for a passkey owned by this user', async () => {
      const { credentialId, privateKey, storedPublicKey } =
        await registerSyntheticPasskeyFor('user-1');
      prisma.passkey.findMany.mockResolvedValue([{ credentialId, transports: ['internal'] }]);
      prisma.passkey.findUnique.mockResolvedValue({
        id: 'passkey-1',
        userId: 'user-1',
        credentialId,
        publicKey: storedPublicKey,
        counter: 0n,
        transports: ['internal'],
      });

      const { options, challengeToken } = await service.generateElevationOptionsFor('user-1');
      const assertion = buildSyntheticAuthenticationResponse({
        rpID: 'localhost',
        origin: 'http://localhost:3000',
        challenge: options.challenge,
        credentialId,
        privateKey,
        userVerified: true,
      });

      await expect(
        service.verifyElevationAssertion('user-1', assertion, challengeToken),
      ).resolves.toBe(true);
      expect(prisma.passkey.update).toHaveBeenCalledWith({
        where: { id: 'passkey-1' },
        data: { counter: 1n, lastUsedAt: expect.any(Date) },
      });
    });

    // Elevation has no fallback behind it the way login has trusted-device/
    // MFA-challenge - a non-UV assertion must be rejected outright, not
    // merely denied the bypass.
    it('rejects an assertion without user verification, unlike login', async () => {
      const { credentialId, privateKey, storedPublicKey } =
        await registerSyntheticPasskeyFor('user-1');
      prisma.passkey.findMany.mockResolvedValue([{ credentialId, transports: ['internal'] }]);
      prisma.passkey.findUnique.mockResolvedValue({
        id: 'passkey-1',
        userId: 'user-1',
        credentialId,
        publicKey: storedPublicKey,
        counter: 0n,
        transports: ['internal'],
      });

      const { options, challengeToken } = await service.generateElevationOptionsFor('user-1');
      const assertion = buildSyntheticAuthenticationResponse({
        rpID: 'localhost',
        origin: 'http://localhost:3000',
        challenge: options.challenge,
        credentialId,
        privateKey,
        userVerified: false,
      });

      await expect(
        service.verifyElevationAssertion('user-1', assertion, challengeToken),
      ).rejects.toThrow(UnauthorizedException);
      expect(prisma.passkey.update).not.toHaveBeenCalled();
    });

    // Defense in depth beyond allowCredentials scoping the browser prompt -
    // even if a credential belonging to a DIFFERENT account were somehow
    // presented, the resolved passkey.userId must match the caller.
    it('rejects a credential that resolves to a DIFFERENT account than the caller', async () => {
      const { credentialId, privateKey, storedPublicKey } =
        await registerSyntheticPasskeyFor('victim-user');
      prisma.passkey.findMany.mockResolvedValue([]);
      prisma.passkey.findUnique.mockResolvedValue({
        id: 'passkey-1',
        userId: 'victim-user',
        credentialId,
        publicKey: storedPublicKey,
        counter: 0n,
        transports: ['internal'],
      });

      // Attacker's own session (userId 'attacker') requests elevation
      // options - since prisma.passkey.findMany is mocked to [] for this
      // call, generateElevationOptionsFor would normally refuse (no
      // passkeys), so build the challenge token directly the way it would
      // look if an attacker replayed a stolen token bound to their own id.
      const challengeToken = jwtService.sign(
        { sub: 'attacker', purpose: 'passkey_elevation', challenge: 'some-challenge' },
        { expiresIn: '5m' },
      );
      const assertion = buildSyntheticAuthenticationResponse({
        rpID: 'localhost',
        origin: 'http://localhost:3000',
        challenge: 'some-challenge',
        credentialId,
        privateKey,
        userVerified: true,
      });

      await expect(
        service.verifyElevationAssertion('attacker', assertion, challengeToken),
      ).rejects.toThrow(UnauthorizedException);
      expect(prisma.passkey.update).not.toHaveBeenCalled();
    });

    it('rejects a tampered/garbage elevation challenge token', async () => {
      await expect(
        service.verifyElevationAssertion(
          'user-1',
          { id: 'x', rawId: 'x' } as never,
          'not-a-real-token',
        ),
      ).rejects.toThrow(UnauthorizedException);
    });
  });
});
