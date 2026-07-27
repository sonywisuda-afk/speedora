import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { SafeUser } from '../auth.service';
import { EmailVerifiedGuard } from './email-verified.guard';

function fakeContext(user: SafeUser): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
    getHandler: () => jest.fn(),
    getClass: () => jest.fn(),
  } as unknown as ExecutionContext;
}

describe('EmailVerifiedGuard', () => {
  let guard: EmailVerifiedGuard;
  let reflector: { getAllAndOverride: jest.Mock };

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() };
    guard = new EmailVerifiedGuard(reflector as unknown as Reflector);
  });

  it('allows the request through when the route has no @RequireVerifiedEmail() metadata', () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    const context = fakeContext({
      id: 'user-1',
      email: 'a@example.com',
      role: 'CREATOR',
      emailVerified: false,
    });

    expect(guard.canActivate(context)).toBe(true);
  });

  it('allows the request through when the route requires verification and the user is verified', () => {
    reflector.getAllAndOverride.mockReturnValue(true);
    const context = fakeContext({
      id: 'user-1',
      email: 'a@example.com',
      role: 'CREATOR',
      emailVerified: true,
    });

    expect(guard.canActivate(context)).toBe(true);
  });

  it('throws ForbiddenException when the route requires verification and the user is not verified', () => {
    reflector.getAllAndOverride.mockReturnValue(true);
    const context = fakeContext({
      id: 'user-1',
      email: 'a@example.com',
      role: 'CREATOR',
      emailVerified: false,
    });

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });
});
