import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedUser, SafeUser } from '../auth.service';

// Security architecture review (2026-07-27, prompted by a real sessionId
// leak through GET /auth/me) - this is the SOLE distribution point for
// request.user across the entire app (confirmed: no controller reads
// req.user/request.user directly anywhere in apps/api/src). JwtStrategy
// actually populates request.user with the wider AuthenticatedUser (it
// carries sessionId, needed by GET /auth/sessions and POST
// /auth/logout-others via the separate CurrentSessionId decorator) - this
// decorator deliberately destructures down to exactly SafeUser's fields
// here, once, rather than trusting every future @CurrentUser() consumer to
// narrow it themselves. Any future field added to AuthenticatedUser (e.g.
// a Sprint 4 risk-scoring signal) is invisible to every existing consumer
// by construction, unless someone deliberately edits this destructuring or
// adds a new dedicated decorator (mirroring CurrentSessionId) - both are
// visible, single-file changes a code review would catch, not a silent
// side effect of widening a shared type.
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): SafeUser => {
    const request = ctx.switchToHttp().getRequest<Request & { user: AuthenticatedUser }>();
    const { id, email, role, emailVerified } = request.user;
    return { id, email, role, emailVerified };
  },
);
