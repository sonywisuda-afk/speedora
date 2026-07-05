import { BadRequestException, ConflictException, UnauthorizedException } from '@nestjs/common';
import type { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as crypto from 'node:crypto';
import type { MailService } from '../mail/mail.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { StorageService } from '../storage/storage.service';
import { AuthService } from './auth.service';

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
  };
  let jwtService: { sign: jest.Mock };
  let mailService: { sendPasswordResetEmail: jest.Mock };
  let storage: { deleteObjects: jest.Mock };

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
    };
    jwtService = { sign: jest.fn() };
    mailService = { sendPasswordResetEmail: jest.fn() };
    storage = { deleteObjects: jest.fn().mockResolvedValue(undefined) };
    service = new AuthService(
      prisma as unknown as PrismaService,
      jwtService as unknown as JwtService,
      mailService as unknown as MailService,
      storage as unknown as StorageService,
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
      });

      const result = await service.register('a@example.com', 'plaintext');

      expect(bcrypt.hash).toHaveBeenCalledWith('plaintext', 10);
      expect(prisma.user.create).toHaveBeenCalledWith({
        data: { email: 'a@example.com', password: 'hashed-password' },
      });
      expect(result).toEqual({ id: 'user-1', email: 'a@example.com' });
    });

    it('throws ConflictException when the email is already registered', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'existing', email: 'a@example.com' });

      await expect(service.register('a@example.com', 'plaintext')).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.user.create).not.toHaveBeenCalled();
    });
  });

  describe('validateUser', () => {
    it('returns the safe user when email and password match', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'a@example.com',
        password: 'hashed-password',
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.validateUser('a@example.com', 'plaintext');

      expect(result).toEqual({ id: 'user-1', email: 'a@example.com' });
    });

    it('throws UnauthorizedException when the user does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.validateUser('nope@example.com', 'plaintext')).rejects.toThrow(
        UnauthorizedException,
      );
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
    it('signs a JWT with the user id and email', () => {
      jwtService.sign.mockReturnValue('signed-token');

      const token = service.issueToken({ id: 'user-1', email: 'a@example.com' });

      expect(jwtService.sign).toHaveBeenCalledWith({ sub: 'user-1', email: 'a@example.com' });
      expect(token).toBe('signed-token');
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
      prisma.user.update.mockResolvedValue({ id: 'user-1', email: 'a@example.com' });

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
      expect(result).toEqual({ id: 'user-1', email: 'a@example.com' });
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
