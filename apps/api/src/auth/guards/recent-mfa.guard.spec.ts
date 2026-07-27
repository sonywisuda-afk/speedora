import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { AuthenticatedUser } from '../auth.service';
import { RecentMfaGuard } from './recent-mfa.guard';

function fakeContext(user: AuthenticatedUser): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
    getHandler: () => jest.fn(),
    getClass: () => jest.fn(),
  } as unknown as ExecutionContext;
}

const baseUser: Omit<AuthenticatedUser, 'elevatedAt'> = {
  id: 'user-1',
  email: 'a@example.com',
  role: 'CREATOR',
  emailVerified: true,
  sessionId: 'session-1',
};

describe('RecentMfaGuard', () => {
  let guard: RecentMfaGuard;
  let reflector: { getAllAndOverride: jest.Mock };

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() };
    guard = new RecentMfaGuard(reflector as unknown as Reflector);
  });

  it('allows the request through when the route has no @RequireRecentMfa() metadata', () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    const context = fakeContext({ ...baseUser, elevatedAt: null });

    expect(guard.canActivate(context)).toBe(true);
  });

  it('throws ForbiddenException with elevationRequired when the route requires it and elevatedAt is null', () => {
    reflector.getAllAndOverride.mockReturnValue(true);
    const context = fakeContext({ ...baseUser, elevatedAt: null });

    try {
      guard.canActivate(context);
      throw new Error('expected canActivate to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ForbiddenException);
      expect((err as ForbiddenException).getResponse()).toEqual(
        expect.objectContaining({ elevationRequired: true }),
      );
    }
  });

  it('allows the request through when elevatedAt is within the elevation window', () => {
    reflector.getAllAndOverride.mockReturnValue(true);
    const context = fakeContext({
      ...baseUser,
      elevatedAt: new Date(Date.now() - 60_000),
    });

    expect(guard.canActivate(context)).toBe(true);
  });

  it('throws ForbiddenException when elevatedAt has expired past the elevation window', () => {
    reflector.getAllAndOverride.mockReturnValue(true);
    const context = fakeContext({
      ...baseUser,
      elevatedAt: new Date(Date.now() - 20 * 60 * 1000),
    });

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });
});
