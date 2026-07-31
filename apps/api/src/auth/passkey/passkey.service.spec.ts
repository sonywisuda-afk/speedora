import { BadRequestException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@speedora/database';
import type { PrismaService } from '../../prisma/prisma.service';
import { buildSyntheticRegistrationResponse } from './passkey.test-authenticator';
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
    };
  };

  beforeEach(() => {
    prisma = {
      passkey: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
        updateMany: jest.fn(),
        deleteMany: jest.fn(),
        findUniqueOrThrow: jest.fn(),
      },
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
        service.verifyAndSaveRegistration('user-1', response, challengeToken, 'Security Key'),
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
        service.verifyAndSaveRegistration('user-1', response, challengeToken, 'Passkey'),
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
        service.verifyAndSaveRegistration('user-1', response, 'not-a-real-token', 'Passkey'),
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
        service.verifyAndSaveRegistration('user-2', response, challengeToken, 'Passkey'),
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
        service.verifyAndSaveRegistration('user-1', response, challengeToken, 'Passkey'),
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

      await service.verifyAndSaveRegistration('user-1', response, challengeToken, '   ');

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
  });
});
