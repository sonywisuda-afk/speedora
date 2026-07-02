import { UnauthorizedException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service';
import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy', () => {
  let strategy: JwtStrategy;
  let prisma: { user: { findUnique: jest.Mock } };

  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret';
    prisma = { user: { findUnique: jest.fn() } };
    strategy = new JwtStrategy(prisma as unknown as PrismaService);
  });

  it('returns the safe user when the token subject still exists', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'a@example.com',
      password: 'hashed',
    });

    const result = await strategy.validate({ sub: 'user-1', email: 'a@example.com' });

    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { id: 'user-1' } });
    expect(result).toEqual({ id: 'user-1', email: 'a@example.com' });
  });

  it('throws UnauthorizedException when the user no longer exists', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(
      strategy.validate({ sub: 'deleted-user', email: 'a@example.com' }),
    ).rejects.toThrow(UnauthorizedException);
  });
});
