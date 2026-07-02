import { ConflictException, UnauthorizedException } from '@nestjs/common';
import type { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import type { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';

jest.mock('bcrypt');

describe('AuthService', () => {
  let service: AuthService;
  let prisma: { user: { findUnique: jest.Mock; create: jest.Mock } };
  let jwtService: { sign: jest.Mock };

  beforeEach(() => {
    prisma = { user: { findUnique: jest.fn(), create: jest.fn() } };
    jwtService = { sign: jest.fn() };
    service = new AuthService(
      prisma as unknown as PrismaService,
      jwtService as unknown as JwtService,
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
});
