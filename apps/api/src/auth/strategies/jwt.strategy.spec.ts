import { UnauthorizedException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service';
import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy', () => {
  let strategy: JwtStrategy;
  let prisma: { session: { findUnique: jest.Mock } };

  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret';
    prisma = { session: { findUnique: jest.fn() } };
    strategy = new JwtStrategy(prisma as unknown as PrismaService);
  });

  it('returns the safe user when the session is active', async () => {
    prisma.session.findUnique.mockResolvedValue({
      id: 'session-1',
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      user: { id: 'user-1', email: 'a@example.com', role: 'CREATOR', emailVerified: true },
    });

    const result = await strategy.validate({
      sub: 'user-1',
      email: 'a@example.com',
      sid: 'session-1',
    });

    expect(prisma.session.findUnique).toHaveBeenCalledWith({
      where: { id: 'session-1' },
      include: { user: true },
    });
    expect(result).toEqual({
      id: 'user-1',
      email: 'a@example.com',
      role: 'CREATOR',
      emailVerified: true,
      sessionId: 'session-1',
    });
  });

  it('throws UnauthorizedException when the payload has no session id', async () => {
    await expect(strategy.validate({ sub: 'user-1', email: 'a@example.com' })).rejects.toThrow(
      UnauthorizedException,
    );
    expect(prisma.session.findUnique).not.toHaveBeenCalled();
  });

  it('throws UnauthorizedException when the session no longer exists', async () => {
    prisma.session.findUnique.mockResolvedValue(null);

    await expect(
      strategy.validate({ sub: 'user-1', email: 'a@example.com', sid: 'deleted-session' }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException when the session is revoked', async () => {
    prisma.session.findUnique.mockResolvedValue({
      id: 'session-1',
      revokedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
      user: { id: 'user-1', email: 'a@example.com', role: 'CREATOR', emailVerified: true },
    });

    await expect(
      strategy.validate({ sub: 'user-1', email: 'a@example.com', sid: 'session-1' }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException when the session has expired', async () => {
    prisma.session.findUnique.mockResolvedValue({
      id: 'session-1',
      revokedAt: null,
      expiresAt: new Date(Date.now() - 60_000),
      user: { id: 'user-1', email: 'a@example.com', role: 'CREATOR', emailVerified: true },
    });

    await expect(
      strategy.validate({ sub: 'user-1', email: 'a@example.com', sid: 'session-1' }),
    ).rejects.toThrow(UnauthorizedException);
  });
});
