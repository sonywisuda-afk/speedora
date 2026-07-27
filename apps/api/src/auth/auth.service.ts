import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  recordSecurityEvent,
  type Prisma,
  type SecurityEventType,
  type UserRole,
} from '@speedora/database';
import * as bcrypt from 'bcrypt';
import * as crypto from 'node:crypto';
import { UAParser } from 'ua-parser-js';
import { LoginBackoffService } from './login-backoff.service';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

const SALT_ROUNDS = 10;
// Kept short - a live reset link is a bearer credential in email, a medium
// this app doesn't control the security of end-to-end (forwarding,
// shared inboxes, provider-side retention).
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

// Authentication Foundation Sprint 1 - default sliding window for a
// Session's refresh token, mirrored by REFRESH_TOKEN_EXPIRES_IN in
// .env.example. Overridable via env, same convention as JWT_EXPIRES_IN was.
const DEFAULT_REFRESH_TOKEN_EXPIRES_IN = '30d';

// Authentication Foundation Sprint 2 (Account Trust) - longer than
// RESET_TOKEN_TTL_MS since a signup confirmation email is expected to sit
// unread longer than a live password reset request.
const VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

// Authentication Foundation Sprint 4 (Attack Protection) - a risk score at
// or above this triggers Turnstile verification (see AuthController.login).
// A named constant, not an env var - matches this file's existing style of
// hardcoded-with-a-comment constants (RESET_TOKEN_TTL_MS above) rather than
// over-configuring a threshold nobody's asked to tune yet.
export const RISK_CAPTCHA_THRESHOLD = 50;
// How many of this account's most recent sessions are checked for a
// matching IP/device before a login is flagged as "new IP"/"new device".
const RISK_RECENT_SESSIONS_WINDOW = 10;
const RISK_REPEATED_FAILURES_THRESHOLD = 3;

export interface SafeUser {
  id: string;
  email: string;
  role: UserRole;
  emailVerified: boolean;
}

// Authentication Foundation Sprint 3 (Session Dashboard) - a type-only
// widening of SafeUser, not a change to it. JwtStrategy.validate() returns
// this instead of a plain SafeUser so a controller can know which Session
// the current request's access token belongs to (needed to mark "current
// device" in GET /auth/sessions and to exclude it from POST
// /auth/logout-others) - without touching SafeUser itself, which would
// ripple into every other controller spec in this codebase that fabricates
// a fake @CurrentUser() (see Sprint 2's SafeUser widening for emailVerified,
// which touched 17 unrelated files). AuthenticatedUser is assignable
// wherever SafeUser is expected, so every existing @CurrentUser() consumer
// needs zero changes.
export interface AuthenticatedUser extends SafeUser {
  sessionId: string;
}

// Authentication Foundation Sprint 3 (Session Dashboard) - what GET
// /auth/sessions returns per row. refreshTokenHash and the raw userAgent
// are never exposed, same "never the raw credential" convention as every
// other hashed-token field in this file.
export interface SessionSummary {
  id: string;
  browser: string | null;
  os: string | null;
  deviceName: string | null;
  ipAddress: string | null;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  current: boolean;
}

// Authentication Foundation Sprint 4 (Attack Protection) - result of
// computeLoginRisk. Never used to block a login by itself - only to decide
// whether Turnstile verification is required (see AuthController.login).
export interface LoginRiskResult {
  score: number;
  signals: string[];
}

// Authentication Foundation Sprint 1 - what login/register/refresh hand back
// to AuthController to set as cookies. refreshTokenExpiresAt is the same
// value written to Session.expiresAt, so the refresh_token cookie's maxAge
// can be derived from it directly rather than re-parsing the duration string
// a second time in the controller.
export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
}

// Supports the same "<number><unit>" shape as JWT_EXPIRES_IN/
// ACCESS_TOKEN_EXPIRES_IN (which jsonwebtoken parses itself via its own `ms`
// dependency) but for REFRESH_TOKEN_EXPIRES_IN, which this service needs as
// an actual millisecond duration (Session.expiresAt, cookie maxAge) rather
// than a string handed to a JWT library - not worth pulling in a whole
// dependency for a 4-unit lookup.
function parseDurationMs(value: string): number {
  const match = /^(\d+)(s|m|h|d)$/.exec(value);
  if (!match) {
    throw new Error(`Invalid duration "${value}" - expected e.g. "15m", "30d"`);
  }
  const unitMs: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return Number(match[1]) * unitMs[match[2]];
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly mailService: MailService,
    private readonly storage: StorageService,
    private readonly loginBackoff: LoginBackoffService,
  ) {}

  async register(email: string, password: string): Promise<SafeUser> {
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException('An account with this email already exists');
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    // Sprint 5A (Collaboration Foundation) - every User gets exactly one
    // isPersonal Workspace (role OWNER) at creation time, same "every User
    // has one from day one" invariant the migration backfilled for
    // pre-existing rows. WorkspaceAccessService.getPersonalWorkspaceId()
    // (video upload/import, the main video list) depends on this
    // unconditionally - never lazily created on first use.
    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: { email, password: passwordHash },
      });
      const workspace = await tx.workspace.create({
        data: { name: 'Personal', isPersonal: true, ownerId: created.id },
      });
      await tx.workspaceMembership.create({
        data: { workspaceId: workspace.id, userId: created.id, role: 'OWNER' },
      });
      return created;
    });

    return { id: user.id, email: user.email, role: user.role, emailVerified: user.emailVerified };
  }

  async validateUser(email: string, password: string): Promise<SafeUser> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const passwordMatches = await bcrypt.compare(password, user.password);
    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid email or password');
    }

    return { id: user.id, email: user.email, role: user.role, emailVerified: user.emailVerified };
  }

  issueToken(user: SafeUser, sessionId: string): string {
    return this.jwtService.sign({ sub: user.id, email: user.email, sid: sessionId });
  }

  // Authentication Foundation Sprint 1 - creates the Session row backing a
  // fresh login (register/login), and issues the paired access+refresh
  // tokens for it. userAgent is parsed once here via ua-parser-js into
  // browser/os/deviceName rather than re-parsed on every future read (e.g.
  // Sprint 3's session dashboard). ipAddress/userAgent capture is
  // best-effort - req.ip may be a reverse proxy's address in production
  // since `trust proxy` isn't configured, and neither is required for the
  // core token/rotation mechanics to work.
  async createSession(
    user: SafeUser,
    userAgent: string | undefined,
    ipAddress: string | undefined,
  ): Promise<SessionTokens> {
    const { browser, os, device } = UAParser(userAgent ?? '');
    const deviceName = [device.vendor, device.model].filter(Boolean).join(' ') || null;

    const rawRefreshToken = crypto.randomBytes(32).toString('hex');
    const refreshTokenHash = crypto.createHash('sha256').update(rawRefreshToken).digest('hex');
    const refreshTokenExpiresAt = new Date(
      Date.now() +
        parseDurationMs(process.env.REFRESH_TOKEN_EXPIRES_IN ?? DEFAULT_REFRESH_TOKEN_EXPIRES_IN),
    );

    const session = await this.prisma.session.create({
      data: {
        userId: user.id,
        refreshTokenHash,
        userAgent: userAgent ?? null,
        browser: browser.name ?? null,
        os: os.name ?? null,
        deviceName,
        ipAddress: ipAddress ?? null,
        expiresAt: refreshTokenExpiresAt,
      },
    });

    const accessToken = this.issueToken(user, session.id);
    return { accessToken, refreshToken: rawRefreshToken, refreshTokenExpiresAt };
  }

  // Rotation: the incoming refresh token is single-use - a new raw token
  // replaces its hash on the SAME Session row (not a new row), and a new
  // access token is issued carrying the same sid. Reuse-detection (treating
  // a replayed old refresh token as a compromise signal) is out of scope for
  // this sprint - see Sprint 4 (risk scoring).
  async rotateRefreshToken(rawToken: string): Promise<SessionTokens> {
    const refreshTokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const session = await this.prisma.session.findUnique({
      where: { refreshTokenHash },
      include: { user: true },
    });

    if (!session || session.revokedAt || session.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('Refresh token is invalid or has expired');
    }

    const newRawRefreshToken = crypto.randomBytes(32).toString('hex');
    const newRefreshTokenHash = crypto
      .createHash('sha256')
      .update(newRawRefreshToken)
      .digest('hex');
    const refreshTokenExpiresAt = new Date(
      Date.now() +
        parseDurationMs(process.env.REFRESH_TOKEN_EXPIRES_IN ?? DEFAULT_REFRESH_TOKEN_EXPIRES_IN),
    );

    await this.prisma.session.update({
      where: { id: session.id },
      data: {
        refreshTokenHash: newRefreshTokenHash,
        expiresAt: refreshTokenExpiresAt,
        lastSeenAt: new Date(),
      },
    });

    const accessToken = this.issueToken(
      {
        id: session.user.id,
        email: session.user.email,
        role: session.user.role,
        emailVerified: session.user.emailVerified,
      },
      session.id,
    );
    return { accessToken, refreshToken: newRawRefreshToken, refreshTokenExpiresAt };
  }

  // Idempotent, same "null-check then update" posture as ShareLink.revoke().
  // Silently no-ops on an unknown/already-revoked token - /auth/logout
  // always returns the same response regardless, same reasoning as
  // requestPasswordReset above.
  async revokeSession(rawRefreshToken: string, reason: string): Promise<void> {
    const refreshTokenHash = crypto.createHash('sha256').update(rawRefreshToken).digest('hex');
    const session = await this.prisma.session.findUnique({ where: { refreshTokenHash } });
    if (!session || session.revokedAt) return;

    await this.prisma.session.update({
      where: { id: session.id },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
  }

  async revokeAllSessions(userId: string, reason: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
  }

  // Authentication Foundation Sprint 3 (Session Dashboard) - "active" means
  // literally that: not revoked, not expired. Revoked/expired sessions
  // aren't part of a device-management list, only a future audit/history
  // view would show those (out of scope here).
  async listSessions(userId: string, currentSessionId: string): Promise<SessionSummary[]> {
    const sessions = await this.prisma.session.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastSeenAt: 'desc' },
    });

    return sessions.map((session) => ({
      id: session.id,
      browser: session.browser,
      os: session.os,
      deviceName: session.deviceName,
      ipAddress: session.ipAddress,
      createdAt: session.createdAt,
      lastSeenAt: session.lastSeenAt,
      expiresAt: session.expiresAt,
      current: session.id === currentSessionId,
    }));
  }

  // Ownership-scoped in one atomic updateMany, same pattern as
  // ClipsService.cancelScheduledPublish - no separate findUnique-then-check
  // round trip, and no workspace-role check needed since Session.userId is
  // a direct FK (no workspace involved).
  async revokeSessionById(userId: string, sessionId: string): Promise<void> {
    const { count } = await this.prisma.session.updateMany({
      where: { id: sessionId, userId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: 'user_revoked' },
    });
    if (count === 0) {
      throw new NotFoundException(`Session ${sessionId} not found`);
    }
  }

  // Same shape as revokeAllSessions but excludes the caller's own session -
  // "sign out other devices."
  async revokeOtherSessions(userId: string, currentSessionId: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { userId, revokedAt: null, id: { not: currentSessionId } },
      data: { revokedAt: new Date(), revokedReason: 'logout_others' },
    });
  }

  // Silently no-ops on an unknown email - same "don't confirm which emails
  // have an account" reasoning as the identical 404s on video/clip
  // ownership checks elsewhere in this app (see CLAUDE.md). The controller
  // always returns the same generic response regardless of which branch
  // ran here.
  async requestPasswordReset(email: string, webOrigin: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      return;
    }

    // Raw token only ever exists here and in the emailed link - only its
    // SHA-256 hash is persisted, same reasoning as bcrypt-hashing the login
    // password itself (see the resetPasswordTokenHash field comment in
    // schema.prisma). A new request overwrites the previous hash/expiry,
    // implicitly invalidating any earlier unused reset link.
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        resetPasswordTokenHash: tokenHash,
        resetPasswordTokenExpiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
      },
    });

    const resetUrl = `${webOrigin}/reset-password?token=${rawToken}`;
    await this.mailService.sendPasswordResetEmail(user.email, resetUrl);
  }

  async resetPassword(token: string, newPassword: string): Promise<SafeUser> {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const user = await this.prisma.user.findUnique({
      where: { resetPasswordTokenHash: tokenHash },
    });

    if (
      !user ||
      !user.resetPasswordTokenExpiresAt ||
      user.resetPasswordTokenExpiresAt.getTime() < Date.now()
    ) {
      throw new BadRequestException('Reset link is invalid or has expired');
    }

    const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: {
        password: passwordHash,
        resetPasswordTokenHash: null,
        resetPasswordTokenExpiresAt: null,
      },
    });

    return {
      id: updated.id,
      email: updated.email,
      role: updated.role,
      emailVerified: updated.emailVerified,
    };
  }

  // Authentication Foundation Sprint 2 (Account Trust) - same hashed-token-
  // at-rest pattern as requestPasswordReset above, applied a second time.
  // Called once right after AuthController.register()'s createSession() -
  // best-effort, MailService itself swallows send failures (never rethrows).
  async sendVerificationEmail(userId: string, webOrigin: string): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerificationTokenHash: tokenHash,
        emailVerificationTokenExpiresAt: new Date(Date.now() + VERIFICATION_TOKEN_TTL_MS),
      },
    });

    const verifyUrl = `${webOrigin}/verify-email?token=${rawToken}`;
    await this.mailService.sendVerificationEmail(user.email, verifyUrl);
  }

  async verifyEmail(token: string): Promise<SafeUser> {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const user = await this.prisma.user.findUnique({
      where: { emailVerificationTokenHash: tokenHash },
    });

    if (
      !user ||
      !user.emailVerificationTokenExpiresAt ||
      user.emailVerificationTokenExpiresAt.getTime() < Date.now()
    ) {
      throw new BadRequestException('Verification link is invalid or has expired');
    }

    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerified: true,
        emailVerificationTokenHash: null,
        emailVerificationTokenExpiresAt: null,
      },
    });

    return {
      id: updated.id,
      email: updated.email,
      role: updated.role,
      emailVerified: updated.emailVerified,
    };
  }

  // Authenticated (not email-based like requestPasswordReset) - register()
  // already auto-logs-in via createSession, so a just-registered user is
  // already authenticated, just unverified. Idempotent no-op if already
  // verified, same "quiet no-op" posture as requestPasswordReset/
  // revokeSession above.
  async resendVerification(userId: string, webOrigin: string): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.emailVerified) return;

    await this.sendVerificationEmail(userId, webOrigin);
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });

    const passwordMatches = await bcrypt.compare(currentPassword, user.password);
    if (!passwordMatches) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    await this.prisma.user.update({ where: { id: user.id }, data: { password: passwordHash } });
  }

  // Authentication Foundation Sprint 4 (Attack Protection) - each signal is
  // a simple heuristic over data this app already has (no new external
  // dependency). Called BEFORE the credential check in AuthController.login
  // (after LoginBackoffService.checkAllowed clears) so it applies equally
  // to attempts that will fail - that's what makes CAPTCHA-gating actually
  // useful against brute force, not just a cosmetic add-on for legitimate
  // users. Never blocks a login by itself; see LoginRiskResult.
  async computeLoginRisk(
    email: string,
    ipAddress: string | undefined,
    userAgent: string | undefined,
  ): Promise<LoginRiskResult> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      // Nothing to compare against - an unknown email is itself a signal
      // (could be account-enumeration/brute-force against nonexistent
      // accounts), so short-circuit the rest.
      return { score: 50, signals: ['unknown_email'] };
    }

    const recentSessions = await this.prisma.session.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: RISK_RECENT_SESSIONS_WINDOW,
      select: { ipAddress: true, browser: true, os: true },
    });

    let score = 0;
    const signals: string[] = [];

    if (ipAddress && !recentSessions.some((s) => s.ipAddress === ipAddress)) {
      score += 30;
      signals.push('new_ip');
    }

    if (userAgent) {
      const { browser, os } = UAParser(userAgent);
      const seenBefore = recentSessions.some(
        (s) => s.browser === (browser.name ?? null) && s.os === (os.name ?? null),
      );
      if (!seenBefore) {
        score += 20;
        signals.push('new_device');
      }
    }

    const failureCount = await this.loginBackoff.getFailureCount(email);
    if (failureCount >= RISK_REPEATED_FAILURES_THRESHOLD) {
      score += 40;
      signals.push('repeated_failures');
    }

    return { score: Math.min(score, 100), signals };
  }

  // Thin wrapper so AuthController never imports @speedora/database's
  // recordSecurityEvent directly - same "controllers talk to services, not
  // to packages/database helpers directly" convention ShareService follows
  // for recordAuditLog.
  async recordSecurityEvent(params: {
    userId?: string | null;
    email?: string | null;
    eventType: SecurityEventType;
    ipAddress?: string | null;
    userAgent?: string | null;
    metadata?: Prisma.InputJsonValue;
  }): Promise<void> {
    await recordSecurityEvent(this.prisma, params);
  }

  // Permanently deletes the account and everything it owns. The user row's
  // cascades take care of the database (videos -> clips -> publish records,
  // videos -> transcript segments, and social accounts all onDelete:
  // Cascade); storage objects are collected first (since the rows are about
  // to be gone) and cleaned up best-effort afterwards, same as deleting a
  // single video. findUniqueOrThrow gives a clean 404 if the account somehow
  // no longer exists.
  async deleteAccount(userId: string): Promise<void> {
    await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });

    const videos = await this.prisma.video.findMany({
      where: { ownerId: userId },
      select: { sourceUrl: true, clips: { select: { outputUrl: true } } },
    });
    const storageKeys = videos.flatMap((video) => [
      video.sourceUrl,
      ...video.clips.map((clip) => clip.outputUrl ?? ''),
    ]);

    await this.prisma.user.delete({ where: { id: userId } });
    await this.storage.deleteObjects(storageKeys);
  }
}
