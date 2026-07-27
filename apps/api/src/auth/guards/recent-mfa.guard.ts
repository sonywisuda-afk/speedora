import {
  ForbiddenException,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ELEVATION_WINDOW_MS, type AuthenticatedUser } from '../auth.service';
import { RECENT_MFA_KEY } from '../decorators/require-recent-mfa.decorator';

// Tahap 2 Step 2 Sprint 2b (Session Elevation) - mirrors EmailVerifiedGuard/
// RolesGuard exactly. Must run AFTER JwtAuthGuard (which populates
// request.user via JwtStrategy's per-request Session lookup, so
// elevatedAt here is always the live value for the CURRENT session, not a
// stale JWT claim - the access token payload never carries it). No
// @RequireRecentMfa() on the route = no restriction.
@Injectable()
export class RecentMfaGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiresRecentMfa = this.reflector.getAllAndOverride<boolean | undefined>(
      RECENT_MFA_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!requiresRecentMfa) return true;

    const request = context.switchToHttp().getRequest<Request & { user: AuthenticatedUser }>();
    const { elevatedAt } = request.user;
    const stillElevated = elevatedAt && Date.now() - elevatedAt.getTime() < ELEVATION_WINDOW_MS;
    if (!stillElevated) {
      throw new ForbiddenException({
        message: 'Recent verification required',
        elevationRequired: true,
      });
    }
    return true;
  }
}
