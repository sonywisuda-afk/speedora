import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import type { Request } from 'express';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedUser } from '../auth.service';

interface JwtPayload {
  sub: string;
  email: string;
  // Authentication Foundation Sprint 1 - the Session row this access token
  // was issued for. Optional so a pre-Sprint-1 access token still parses
  // (jwt.verify doesn't reject unknown-shape payloads) - validate() below
  // treats a missing sid as "no active session" the same as one that
  // doesn't resolve, so any token issued by the old scheme is rejected
  // rather than silently trusted forever on its own now-shortened expiry.
  sid?: string;
}

function extractFromCookie(req: Request): string | null {
  return req?.cookies?.token ?? null;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([extractFromCookie]),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET,
    });
  }

  // Session-aware: a valid JWT signature/expiry is no longer sufficient on
  // its own - the underlying Session must still exist and be neither
  // revoked nor expired, so /auth/logout and /auth/logout-all take effect
  // immediately rather than waiting out the (now much shorter) access token
  // expiry.
  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    if (!payload.sid) {
      throw new UnauthorizedException('Session is no longer active');
    }

    const session = await this.prisma.session.findUnique({
      where: { id: payload.sid },
      include: { user: true },
    });
    if (!session || session.revokedAt || session.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('Session is no longer active');
    }

    return {
      id: session.user.id,
      email: session.user.email,
      role: session.user.role,
      emailVerified: session.user.emailVerified,
      sessionId: session.id,
      // Tahap 2 Step 2 Sprint 2b (Session Elevation) - the row is already in
      // hand, so RecentMfaGuard can read this straight off request.user
      // with no extra query.
      elevatedAt: session.elevatedAt,
    };
  }
}
