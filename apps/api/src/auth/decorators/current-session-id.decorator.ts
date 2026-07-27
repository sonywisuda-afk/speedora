import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../auth.service';

// Authentication Foundation Sprint 3 (Session Dashboard) - same shape as
// CurrentUser, used only where the current request's Session id is actually
// needed (marking "current device" in GET /auth/sessions, excluding it in
// POST /auth/logout-others).
export const CurrentSessionId = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const request = ctx.switchToHttp().getRequest<Request & { user: AuthenticatedUser }>();
  return request.user.sessionId;
});
