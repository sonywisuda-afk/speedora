import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as crypto from 'node:crypto';
import type { MailService } from '../mail/mail.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { StorageService } from '../storage/storage.service';
import { AuthService } from './auth.service';
import type { LoginBackoffService } from './login-backoff.service';

jest.mock('bcrypt');

describe('AuthService', () => {
  let service: AuthService;
  let prisma: {
    user: {
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      findUniqueOrThrow: jest.Mock;
      delete: jest.Mock;
    };
    video: { findMany: jest.Mock };
    workspace: { create: jest.Mock };
    workspaceMembership: { create: jest.Mock };
    session: {
      create: jest.Mock;
      findUnique: jest.Mock;
      findMany: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
    securityEvent: { create: jest.Mock };
    oAuthIdentity: { findUnique: jest.Mock; create: jest.Mock };
    $transaction: jest.Mock;
  };
  let jwtService: { sign: jest.Mock };
  let mailService: { sendPasswordResetEmail: jest.Mock; sendVerificationEmail: jest.Mock };
  let storage: { deleteObjects: jest.Mock };
  let loginBackoff: { getFailureCount: jest.Mock };

  beforeEach(() => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        delete: jest.fn().mockResolvedValue({}),
      },
      video: { findMany: jest.fn().mockResolvedValue([]) },
      // Sprint 5A (Collaboration Foundation) - register() creates a
      // personal Workspace + OWNER membership in the same transaction as
      // the User row.
      workspace: { create: jest.fn() },
      workspaceMembership: { create: jest.fn() },
      session: {
        create: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      securityEvent: { create: jest.fn().mockResolvedValue({}) },
      oAuthIdentity: { findUnique: jest.fn(), create: jest.fn() },
      $transaction: jest.fn().mockImplementation((fn: (tx: unknown) => unknown) => fn(prisma)),
    };
    jwtService = { sign: jest.fn() };
    mailService = { sendPasswordResetEmail: jest.fn(), sendVerificationEmail: jest.fn() };
    storage = { deleteObjects: jest.fn().mockResolvedValue(undefined) };
    loginBackoff = { getFailureCount: jest.fn().mockResolvedValue(0) };
    service = new AuthService(
      prisma as unknown as PrismaService,
      jwtService as unknown as JwtService,
      mailService as unknown as MailService,
      storage as unknown as StorageService,
      loginBackoff as unknown as LoginBackoffService,
    );
    jest.clearAllMocks();
  });

  describe('register', () => {
    it('creates a user with a bcrypt-hashed password when the email is unused', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-password');
      prisma.user.create.mockResolvedValue({
        id: 'user-1',
        email: 'a@example.com',
        password: 'hashed-password',
        role: 'CREATOR',
        emailVerified: false,
      });
      prisma.workspace.create.mockResolvedValue({ id: 'ws-1' });

      const result = await service.register('a@example.com', 'plaintext');

      expect(bcrypt.hash).toHaveBeenCalledWith('plaintext', 10);
      expect(prisma.user.create).toHaveBeenCalledWith({
        data: { email: 'a@example.com', password: 'hashed-password' },
      });
      // Sprint 5A (Collaboration Foundation) - every new User gets exactly
      // one isPersonal Workspace (role OWNER) in the same transaction.
      expect(prisma.workspace.create).toHaveBeenCalledWith({
        data: { name: 'Personal', isPersonal: true, ownerId: 'user-1' },
      });
      expect(prisma.workspaceMembership.create).toHaveBeenCalledWith({
        data: { workspaceId: 'ws-1', userId: 'user-1', role: 'OWNER' },
      });
      expect(result).toEqual({
        id: 'user-1',
        email: 'a@example.com',
        role: 'CREATOR',
        emailVerified: false,
      });
    });

    it('throws ConflictException when the email is already registered', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'existing', email: 'a@example.com' });

      await expect(service.register('a@example.com', 'plaintext')).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.user.create).not.toHaveBeenCalled();
    });
  });

  describe('resolveOAuthLogin', () => {
    it('returns the linked user when an OAuthIdentity already exists for this provider account', async () => {
      prisma.oAuthIdentity.findUnique.mockResolvedValue({
        id: 'identity-1',
        user: {
          id: 'user-1',
          email: 'a@example.com',
          role: 'CREATOR',
          emailVerified: true,
        },
      });

      const result = await service.resolveOAuthLogin('GOOGLE', 'google-sub-123', 'a@example.com');

      expect(prisma.oAuthIdentity.findUnique).toHaveBeenCalledWith({
        where: { provider_providerAccountId: { provider: 'GOOGLE', providerAccountId: 'google-sub-123' } },
        include: { user: true },
      });
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
      expect(result).toEqual({
        id: 'user-1',
        email: 'a@example.com',
        role: 'CREATOR',
        emailVerified: true,
      });
    });

    it('auto-links to an existing password-based account by email and verifies it', async () => {
      prisma.oAuthIdentity.findUnique.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'a@example.com',
        role: 'CREATOR',
        emailVerified: false,
      });
      prisma.user.update.mockResolvedValue({
        id: 'user-1',
        email: 'a@example.com',
        role: 'CREATOR',
        emailVerified: true,
      });

      const result = await service.resolveOAuthLogin('GOOGLE', 'google-sub-123', 'a@example.com');

      expect(prisma.oAuthIdentity.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          provider: 'GOOGLE',
          providerAccountId: 'google-sub-123',
          email: 'a@example.com',
        },
      });
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { emailVerified: true },
      });
      expect(result.emailVerified).toBe(true);
    });

    it('does not re-update emailVerified when the existing account is already verified', async () => {
      prisma.oAuthIdentity.findUnique.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'a@example.com',
        role: 'CREATOR',
        emailVerified: true,
      });

      await service.resolveOAuthLogin('GOOGLE', 'google-sub-123', 'a@example.com');

      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('creates a brand-new User + personal Workspace + OAuthIdentity when neither exists', async () => {
      prisma.oAuthIdentity.findUnique.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue({
        id: 'user-new',
        email: 'new@example.com',
        role: 'CREATOR',
        emailVerified: true,
      });
      prisma.workspace.create.mockResolvedValue({ id: 'ws-1' });

      const result = await service.resolveOAuthLogin('GITHUB', 'gh-456', 'new@example.com');

      expect(prisma.user.create).toHaveBeenCalledWith({
        data: { email: 'new@example.com', password: null, emailVerified: true },
      });
      expect(prisma.workspace.create).toHaveBeenCalledWith({
        data: { name: 'Personal', isPersonal: true, ownerId: 'user-new' },
      });
      expect(prisma.workspaceMembership.create).toHaveBeenCalledWith({
        data: { workspaceId: 'ws-1', userId: 'user-new', role: 'OWNER' },
      });
      expect(prisma.oAuthIdentity.create).toHaveBeenCalledWith({
        data: { userId: 'user-new', provider: 'GITHUB', providerAccountId: 'gh-456', email: 'new@example.com' },
      });
      expect(result).toEqual({
        id: 'user-new',
        email: 'new@example.com',
        role: 'CREATOR',
        emailVerified: true,
      });
    });
  });

  describe('validateUser', () => {
    it('returns the safe user when email and password match', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'a@example.com',
        password: 'hashed-password',
        role: 'CREATOR',
        emailVerified: true,
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.validateUser('a@example.com', 'plaintext');

      expect(result).toEqual({
        id: 'user-1',
        email: 'a@example.com',
        role: 'CREATOR',
        emailVerified: true,
      });
    });

    it('throws UnauthorizedException when the user does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.validateUser('nope@example.com', 'plaintext')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('throws UnauthorizedException (never bcrypt.compare) for an OAuth-only account with no password', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'oauth-only@example.com',
        password: null,
        role: 'CREATOR',
        emailVerified: true,
      });

      await expect(
        service.validateUser('oauth-only@example.com', 'anything'),
      ).rejects.toThrow(UnauthorizedException);
      expect(bcrypt.compare).not.toHaveBeenCalled();
    });

    it('throws UnauthorizedException when the password is wrong', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'a@example.com',
        password: 'hashed-password',
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(service.validateUser('a@example.com', 'wrong')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('issueToken', () => {
    it('signs a JWT with the user id, email, and session id', () => {
      jwtService.sign.mockReturnValue('signed-token');

      const token = service.issueToken(
        { id: 'user-1', email: 'a@example.com', role: 'CREATOR', emailVerified: true },
        'session-1',
      );

      expect(jwtService.sign).toHaveBeenCalledWith({
        sub: 'user-1',
        email: 'a@example.com',
        sid: 'session-1',
      });
      expect(token).toBe('signed-token');
    });
  });

  describe('createSession', () => {
    it('creates a Session row and returns an access+refresh token pair', async () => {
      prisma.session.create.mockResolvedValue({ id: 'session-1' });
      jwtService.sign.mockReturnValue('signed-token');

      const result = await service.createSession(
        { id: 'user-1', email: 'a@example.com', role: 'CREATOR', emailVerified: false },
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0',
        '127.0.0.1',
      );

      expect(prisma.session.create).toHaveBeenCalledTimes(1);
      const createArgs = prisma.session.create.mock.calls[0][0];
      expect(createArgs.data.userId).toBe('user-1');
      expect(createArgs.data.ipAddress).toBe('127.0.0.1');
      expect(createArgs.data.browser).toBe('Chrome');
      expect(createArgs.data.os).toBe('Windows');
      expect(createArgs.data.expiresAt).toBeInstanceOf(Date);
      expect(createArgs.data.refreshTokenHash).toMatch(/^[0-9a-f]{64}$/);

      expect(jwtService.sign).toHaveBeenCalledWith({
        sub: 'user-1',
        email: 'a@example.com',
        sid: 'session-1',
      });
      expect(result.accessToken).toBe('signed-token');
      expect(result.refreshToken).toMatch(/^[0-9a-f]{64}$/);
      expect(result.refreshTokenExpiresAt).toBeInstanceOf(Date);

      const expectedHash = crypto.createHash('sha256').update(result.refreshToken).digest('hex');
      expect(createArgs.data.refreshTokenHash).toBe(expectedHash);
    });
  });

  describe('rotateRefreshToken', () => {
    it('rotates the hash on the same Session row and issues a new access token', async () => {
      const rawToken = 'raw-refresh-token';
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
      prisma.session.findUnique.mockResolvedValue({
        id: 'session-1',
        refreshTokenHash: tokenHash,
        revokedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
        user: { id: 'user-1', email: 'a@example.com', role: 'CREATOR', emailVerified: true },
      });
      jwtService.sign.mockReturnValue('new-signed-token');

      const result = await service.rotateRefreshToken(rawToken);

      expect(prisma.session.findUnique).toHaveBeenCalledWith({
        where: { refreshTokenHash: tokenHash },
        include: { user: true },
      });
      expect(prisma.session.update).toHaveBeenCalledTimes(1);
      const updateArgs = prisma.session.update.mock.calls[0][0];
      expect(updateArgs.where).toEqual({ id: 'session-1' });
      expect(updateArgs.data.refreshTokenHash).not.toBe(tokenHash);
      expect(result.accessToken).toBe('new-signed-token');
      expect(result.refreshToken).not.toBe(rawToken);
    });

    it('throws UnauthorizedException when the token does not match any session', async () => {
      prisma.session.findUnique.mockResolvedValue(null);

      await expect(service.rotateRefreshToken('bogus')).rejects.toThrow(UnauthorizedException);
      expect(prisma.session.update).not.toHaveBeenCalled();
    });

    it('throws UnauthorizedException when the session is revoked', async () => {
      prisma.session.findUnique.mockResolvedValue({
        id: 'session-1',
        revokedAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
        user: { id: 'user-1', email: 'a@example.com', role: 'CREATOR', emailVerified: true },
      });

      await expect(service.rotateRefreshToken('raw')).rejects.toThrow(UnauthorizedException);
      expect(prisma.session.update).not.toHaveBeenCalled();
    });

    it('throws UnauthorizedException when the session has expired', async () => {
      prisma.session.findUnique.mockResolvedValue({
        id: 'session-1',
        revokedAt: null,
        expiresAt: new Date(Date.now() - 60_000),
        user: { id: 'user-1', email: 'a@example.com', role: 'CREATOR', emailVerified: true },
      });

      await expect(service.rotateRefreshToken('raw')).rejects.toThrow(UnauthorizedException);
      expect(prisma.session.update).not.toHaveBeenCalled();
    });
  });

  describe('revokeSession', () => {
    it('marks the matching session revoked with the given reason', async () => {
      const rawToken = 'raw-refresh-token';
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
      prisma.session.findUnique.mockResolvedValue({
        id: 'session-1',
        refreshTokenHash: tokenHash,
        revokedAt: null,
      });

      await service.revokeSession(rawToken, 'logout');

      expect(prisma.session.update).toHaveBeenCalledWith({
        where: { id: 'session-1' },
        data: { revokedAt: expect.any(Date), revokedReason: 'logout' },
      });
    });

    it('silently no-ops when the token does not match any session', async () => {
      prisma.session.findUnique.mockResolvedValue(null);

      await service.revokeSession('bogus', 'logout');

      expect(prisma.session.update).not.toHaveBeenCalled();
    });

    it('silently no-ops when the session is already revoked', async () => {
      prisma.session.findUnique.mockResolvedValue({ id: 'session-1', revokedAt: new Date() });

      await service.revokeSession('raw', 'logout');

      expect(prisma.session.update).not.toHaveBeenCalled();
    });
  });

  describe('revokeAllSessions', () => {
    it('revokes every non-revoked session owned by the user', async () => {
      await service.revokeAllSessions('user-1', 'logout_all');

      expect(prisma.session.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', revokedAt: null },
        data: { revokedAt: expect.any(Date), revokedReason: 'logout_all' },
      });
    });
  });

  describe('listSessions', () => {
    it('lists active sessions, marking the current one', async () => {
      const now = new Date();
      prisma.session.findMany.mockResolvedValue([
        {
          id: 'session-1',
          browser: 'Chrome',
          os: 'Windows',
          deviceName: null,
          ipAddress: '127.0.0.1',
          createdAt: now,
          lastSeenAt: now,
          expiresAt: new Date(now.getTime() + 60_000),
        },
        {
          id: 'session-2',
          browser: 'Safari',
          os: 'macOS',
          deviceName: null,
          ipAddress: '10.0.0.1',
          createdAt: now,
          lastSeenAt: now,
          expiresAt: new Date(now.getTime() + 60_000),
        },
      ]);

      const result = await service.listSessions('user-1', 'session-1');

      expect(prisma.session.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', revokedAt: null, expiresAt: { gt: expect.any(Date) } },
        orderBy: { lastSeenAt: 'desc' },
      });
      expect(result).toEqual([
        expect.objectContaining({ id: 'session-1', current: true }),
        expect.objectContaining({ id: 'session-2', current: false }),
      ]);
    });
  });

  describe('revokeSessionById', () => {
    it('revokes the session when it belongs to the user', async () => {
      prisma.session.updateMany.mockResolvedValue({ count: 1 });

      await service.revokeSessionById('user-1', 'session-1');

      expect(prisma.session.updateMany).toHaveBeenCalledWith({
        where: { id: 'session-1', userId: 'user-1', revokedAt: null },
        data: { revokedAt: expect.any(Date), revokedReason: 'user_revoked' },
      });
    });

    it('throws NotFoundException when the session does not belong to the user', async () => {
      prisma.session.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.revokeSessionById('user-1', 'not-mine')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('revokeOtherSessions', () => {
    it('revokes every non-revoked session except the current one', async () => {
      await service.revokeOtherSessions('user-1', 'session-1');

      expect(prisma.session.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', revokedAt: null, id: { not: 'session-1' } },
        data: { revokedAt: expect.any(Date), revokedReason: 'logout_others' },
      });
    });
  });

  describe('requestPasswordReset', () => {
    it('stores a hashed token and emails the raw one, when the email matches a user', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1', email: 'a@example.com' });
      prisma.user.update.mockResolvedValue({});

      await service.requestPasswordReset('a@example.com', 'http://localhost:3000');

      expect(prisma.user.update).toHaveBeenCalledTimes(1);
      const updateArgs = prisma.user.update.mock.calls[0][0];
      expect(updateArgs.where).toEqual({ id: 'user-1' });
      expect(updateArgs.data.resetPasswordTokenExpiresAt).toBeInstanceOf(Date);
      const storedHash: string = updateArgs.data.resetPasswordTokenHash;
      expect(storedHash).toMatch(/^[0-9a-f]{64}$/);

      expect(mailService.sendPasswordResetEmail).toHaveBeenCalledTimes(1);
      const [to, resetUrl] = mailService.sendPasswordResetEmail.mock.calls[0];
      expect(to).toBe('a@example.com');
      expect(resetUrl).toMatch(/^http:\/\/localhost:3000\/reset-password\?token=[0-9a-f]{64}$/);

      const rawToken = new URL(resetUrl).searchParams.get('token')!;
      const expectedHash = crypto.createHash('sha256').update(rawToken).digest('hex');
      expect(storedHash).toBe(expectedHash);
    });

    it('silently no-ops when the email does not match any user', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await service.requestPasswordReset('nope@example.com', 'http://localhost:3000');

      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(mailService.sendPasswordResetEmail).not.toHaveBeenCalled();
    });
  });

  describe('resetPassword', () => {
    it('updates the password and clears the reset fields for a valid, unexpired token', async () => {
      const rawToken = 'raw-token';
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'a@example.com',
        resetPasswordTokenHash: tokenHash,
        resetPasswordTokenExpiresAt: new Date(Date.now() + 60_000),
      });
      (bcrypt.hash as jest.Mock).mockResolvedValue('new-hashed-password');
      prisma.user.update.mockResolvedValue({
        id: 'user-1',
        email: 'a@example.com',
        role: 'CREATOR',
        emailVerified: false,
      });

      const result = await service.resetPassword(rawToken, 'newplaintext');

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { resetPasswordTokenHash: tokenHash },
      });
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: {
          password: 'new-hashed-password',
          resetPasswordTokenHash: null,
          resetPasswordTokenExpiresAt: null,
        },
      });
      expect(result).toEqual({
        id: 'user-1',
        email: 'a@example.com',
        role: 'CREATOR',
        emailVerified: false,
      });
    });

    it('throws BadRequestException when the token does not match any user', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.resetPassword('bogus-token', 'newplaintext')).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when the token has expired', async () => {
      const rawToken = 'raw-token';
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'a@example.com',
        resetPasswordTokenHash: tokenHash,
        resetPasswordTokenExpiresAt: new Date(Date.now() - 1000),
      });

      await expect(service.resetPassword(rawToken, 'newplaintext')).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });

  describe('sendVerificationEmail', () => {
    it('stores a hashed token and emails the raw one', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue({ id: 'user-1', email: 'a@example.com' });
      prisma.user.update.mockResolvedValue({});

      await service.sendVerificationEmail('user-1', 'http://localhost:3000');

      expect(prisma.user.update).toHaveBeenCalledTimes(1);
      const updateArgs = prisma.user.update.mock.calls[0][0];
      expect(updateArgs.where).toEqual({ id: 'user-1' });
      expect(updateArgs.data.emailVerificationTokenExpiresAt).toBeInstanceOf(Date);
      const storedHash: string = updateArgs.data.emailVerificationTokenHash;
      expect(storedHash).toMatch(/^[0-9a-f]{64}$/);

      expect(mailService.sendVerificationEmail).toHaveBeenCalledTimes(1);
      const [to, verifyUrl] = mailService.sendVerificationEmail.mock.calls[0];
      expect(to).toBe('a@example.com');
      expect(verifyUrl).toMatch(/^http:\/\/localhost:3000\/verify-email\?token=[0-9a-f]{64}$/);

      const rawToken = new URL(verifyUrl).searchParams.get('token')!;
      const expectedHash = crypto.createHash('sha256').update(rawToken).digest('hex');
      expect(storedHash).toBe(expectedHash);
    });
  });

  describe('verifyEmail', () => {
    it('marks the email verified and clears the token for a valid, unexpired token', async () => {
      const rawToken = 'raw-verify-token';
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'a@example.com',
        emailVerificationTokenHash: tokenHash,
        emailVerificationTokenExpiresAt: new Date(Date.now() + 60_000),
      });
      prisma.user.update.mockResolvedValue({
        id: 'user-1',
        email: 'a@example.com',
        role: 'CREATOR',
        emailVerified: true,
      });

      const result = await service.verifyEmail(rawToken);

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { emailVerificationTokenHash: tokenHash },
      });
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: {
          emailVerified: true,
          emailVerificationTokenHash: null,
          emailVerificationTokenExpiresAt: null,
        },
      });
      expect(result).toEqual({
        id: 'user-1',
        email: 'a@example.com',
        role: 'CREATOR',
        emailVerified: true,
      });
    });

    it('throws BadRequestException when the token does not match any user', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.verifyEmail('bogus-token')).rejects.toThrow(BadRequestException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when the token has expired', async () => {
      const rawToken = 'raw-verify-token';
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'a@example.com',
        emailVerificationTokenHash: tokenHash,
        emailVerificationTokenExpiresAt: new Date(Date.now() - 1000),
      });

      await expect(service.verifyEmail(rawToken)).rejects.toThrow(BadRequestException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });

  describe('resendVerification', () => {
    it('regenerates and re-sends the token when the user is not yet verified', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue({
        id: 'user-1',
        email: 'a@example.com',
        emailVerified: false,
      });
      prisma.user.update.mockResolvedValue({});

      await service.resendVerification('user-1', 'http://localhost:3000');

      expect(mailService.sendVerificationEmail).toHaveBeenCalledTimes(1);
    });

    it('silently no-ops when the user is already verified', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue({
        id: 'user-1',
        email: 'a@example.com',
        emailVerified: true,
      });

      await service.resendVerification('user-1', 'http://localhost:3000');

      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(mailService.sendVerificationEmail).not.toHaveBeenCalled();
    });
  });

  describe('computeLoginRisk', () => {
    it('returns a flat unknown_email signal when no user matches the email', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      const result = await service.computeLoginRisk('nope@example.com', '127.0.0.1', 'UA');

      expect(result).toEqual({ score: 50, signals: ['unknown_email'] });
      expect(prisma.session.findMany).not.toHaveBeenCalled();
    });

    it('returns a zero score when IP/device match recent sessions and failures are low', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1', email: 'a@example.com' });
      prisma.session.findMany.mockResolvedValue([
        { ipAddress: '127.0.0.1', browser: 'Chrome', os: 'Windows' },
      ]);
      loginBackoff.getFailureCount.mockResolvedValue(0);

      const result = await service.computeLoginRisk(
        'a@example.com',
        '127.0.0.1',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0',
      );

      expect(result).toEqual({ score: 0, signals: [] });
    });

    it('flags a new IP, a new device, and repeated failures independently', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1', email: 'a@example.com' });
      prisma.session.findMany.mockResolvedValue([
        { ipAddress: '10.0.0.1', browser: 'Firefox', os: 'macOS' },
      ]);
      loginBackoff.getFailureCount.mockResolvedValue(5);

      const result = await service.computeLoginRisk(
        'a@example.com',
        '192.168.1.1',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0',
      );

      expect(result.score).toBe(90);
      expect(result.signals).toEqual(
        expect.arrayContaining(['new_ip', 'new_device', 'repeated_failures']),
      );
    });

    it('never exceeds 100 even when every signal fires (no session history at all)', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1', email: 'a@example.com' });
      prisma.session.findMany.mockResolvedValue([]);
      loginBackoff.getFailureCount.mockResolvedValue(10);

      const result = await service.computeLoginRisk(
        'a@example.com',
        '192.168.1.1',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0',
      );

      // new_ip (30) + new_device (20) + repeated_failures (40) = 90, the
      // max achievable via the three additive signals - still exercises
      // Math.min(score, 100)'s cap, just doesn't need to engage it here.
      expect(result.score).toBe(90);
      expect(result.score).toBeLessThanOrEqual(100);
    });
  });

  describe('recordSecurityEvent', () => {
    it('writes a SecurityEvent row with the given fields', async () => {
      await service.recordSecurityEvent({
        userId: 'user-1',
        email: 'a@example.com',
        eventType: 'LOGIN_SUCCESS',
        ipAddress: '127.0.0.1',
        userAgent: 'UA',
        metadata: { riskScore: 0, signals: [] },
      });

      expect(prisma.securityEvent.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          email: 'a@example.com',
          eventType: 'LOGIN_SUCCESS',
          ipAddress: '127.0.0.1',
          userAgent: 'UA',
          metadata: { riskScore: 0, signals: [] },
        },
      });
    });

    it('does not throw when the underlying insert fails', async () => {
      prisma.securityEvent.create.mockRejectedValue(new Error('db down'));

      await expect(
        service.recordSecurityEvent({ eventType: 'LOGOUT' }),
      ).resolves.toBeUndefined();
    });
  });

  describe('changePassword', () => {
    it('updates the password when the current password is correct', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue({
        id: 'user-1',
        email: 'a@example.com',
        password: 'hashed-password',
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      (bcrypt.hash as jest.Mock).mockResolvedValue('new-hashed-password');

      await service.changePassword('user-1', 'currentplaintext', 'newplaintext');

      expect(bcrypt.compare).toHaveBeenCalledWith('currentplaintext', 'hashed-password');
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { password: 'new-hashed-password' },
      });
    });

    it('throws UnauthorizedException (never bcrypt.compare) for an OAuth-only account with no password', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue({
        id: 'user-1',
        email: 'oauth-only@example.com',
        password: null,
      });

      await expect(
        service.changePassword('user-1', 'anything', 'newplaintext'),
      ).rejects.toThrow(UnauthorizedException);
      expect(bcrypt.compare).not.toHaveBeenCalled();
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('throws UnauthorizedException when the current password is wrong', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue({
        id: 'user-1',
        email: 'a@example.com',
        password: 'hashed-password',
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(
        service.changePassword('user-1', 'wrongplaintext', 'newplaintext'),
      ).rejects.toThrow(UnauthorizedException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });

  describe('deleteAccount', () => {
    it('deletes the user row and cleans up every owned source + rendered clip object', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue({ id: 'user-1', email: 'a@example.com' });
      prisma.video.findMany.mockResolvedValue([
        {
          sourceUrl: 'videos/a.mp4',
          clips: [{ outputUrl: 'renders/a1.mp4' }, { outputUrl: null }],
        },
        { sourceUrl: 'videos/b.mp4', clips: [] },
      ]);

      await service.deleteAccount('user-1');

      expect(prisma.user.delete).toHaveBeenCalledWith({ where: { id: 'user-1' } });
      expect(storage.deleteObjects).toHaveBeenCalledWith([
        'videos/a.mp4',
        'renders/a1.mp4',
        '',
        'videos/b.mp4',
      ]);
    });

    it('throws when the account no longer exists and deletes nothing', async () => {
      prisma.user.findUniqueOrThrow.mockRejectedValue(new Error('not found'));

      await expect(service.deleteAccount('missing')).rejects.toThrow();
      expect(prisma.user.delete).not.toHaveBeenCalled();
      expect(storage.deleteObjects).not.toHaveBeenCalled();
    });
  });
});
