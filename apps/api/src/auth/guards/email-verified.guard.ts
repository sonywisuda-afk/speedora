import {
  ForbiddenException,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { SafeUser } from '../auth.service';
import { EMAIL_VERIFIED_KEY } from '../decorators/require-verified-email.decorator';

// Authentication Foundation Sprint 2 (Account Trust) - mirrors RolesGuard
// exactly. Must run AFTER JwtAuthGuard (which populates request.user via
// JwtStrategy's per-request DB lookup, so `emailVerified` here is always the
// live value, not a stale JWT claim - the access token payload never
// carries it). No @RequireVerifiedEmail() on the route = no restriction
// (every existing endpoint stays untouched since none of them use it yet).
@Injectable()
export class EmailVerifiedGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiresVerifiedEmail = this.reflector.getAllAndOverride<boolean | undefined>(
      EMAIL_VERIFIED_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!requiresVerifiedEmail) return true;

    const request = context.switchToHttp().getRequest<Request & { user: SafeUser }>();
    if (!request.user.emailVerified) {
      throw new ForbiddenException('This endpoint requires a verified email address');
    }
    return true;
  }
}
