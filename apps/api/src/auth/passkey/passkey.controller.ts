import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { setAuthCookies, TRUSTED_DEVICE_COOKIE_NAME } from '../auth-cookies.util';
import { AuthService, RISK_TRUSTED_DEVICE_THRESHOLD, type SafeUser } from '../auth.service';
import { CurrentUser } from '../decorators/current-user.decorator';
import { RequireRecentMfa } from '../decorators/require-recent-mfa.decorator';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { RecentMfaGuard } from '../guards/recent-mfa.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { RenamePasskeyDto } from './dto/rename-passkey.dto';
import { VerifyPasskeyAuthenticationDto } from './dto/verify-authentication.dto';
import { VerifyPasskeyRegistrationDto } from './dto/verify-registration.dto';
import { PasskeyService } from './passkey.service';

// Same helper as auth.controller.ts's/oauth.controller.ts's userAgentOf,
// duplicated rather than exported since it's a one-liner and importing
// across controllers for this alone isn't worth the coupling (same
// reasoning oauth.controller.ts's own copy already documents).
function userAgentOf(req: Request): string | undefined {
  const value = req.headers['user-agent'];
  return Array.isArray(value) ? value[0] : value;
}

// Tahap 3 Sprint 1/2 (Passkey Foundation/Login) - "Passkeys" section on the
// Accounts page (list/register/rename/delete) plus, since Sprint 2,
// unauthenticated login (login/options, login/verify) - mirroring
// OAuthController's own precedent of mixing guarded "manage" routes and
// unauthenticated "authenticate" routes in ONE controller rather than
// splitting into two. JwtAuthGuard moved from class-level (Sprint 1) to
// per-route here, same reasoning: signing in is, by definition, something
// done before a session exists.
@Controller('auth/passkeys')
export class PasskeyController {
  constructor(
    private readonly passkeyService: PasskeyService,
    private readonly authService: AuthService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  async list(@CurrentUser() user: SafeUser) {
    return this.passkeyService.list(user.id);
  }

  @Post('register/options')
  @UseGuards(JwtAuthGuard)
  async registerOptions(@CurrentUser() user: SafeUser) {
    return this.passkeyService.generateRegistrationOptionsFor(user.id, user.email);
  }

  // Adding a new credential to the account is sensitive enough to warrant
  // the same step-up as OAuth unlink/MFA disable (RecentMfaGuard), not just
  // the ceremony's own challenge token - a stolen access token alone
  // shouldn't be able to plant a persistent, attacker-controlled sign-in
  // credential on the victim's account.
  @Post('register/verify')
  @HttpCode(201)
  @UseGuards(JwtAuthGuard, RecentMfaGuard)
  @RequireRecentMfa()
  async registerVerify(
    @CurrentUser() user: SafeUser,
    @Body() body: VerifyPasskeyRegistrationDto,
    @Req() req: Request,
  ) {
    const passkey = await this.passkeyService.verifyAndSaveRegistration(
      user.id,
      body.response,
      body.challengeToken,
      body.name,
    );
    await this.authService.recordSecurityEvent({
      userId: user.id,
      email: user.email,
      eventType: 'PASSKEY_ADDED',
      ipAddress: req.ip,
      userAgent: userAgentOf(req),
      metadata: { passkeyId: passkey.id, deviceType: passkey.deviceType },
    });
    return passkey;
  }

  // Tahap 3 Sprint 3 (Passkey Elevation) - scoped to the CALLER's own
  // passkeys (unlike login/options' deliberate usernameless-ness), since
  // the caller is already authenticated here. The actual elevation
  // completion is NOT a route on this controller - it's a third branch of
  // AuthController.elevate (POST /auth/elevate), which stays the single
  // place that marks Session.elevatedAt, same as it already does for
  // TOTP/password.
  @Post('elevate/options')
  @UseGuards(JwtAuthGuard)
  async elevateOptions(@CurrentUser() user: SafeUser) {
    return this.passkeyService.generateElevationOptionsFor(user.id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  async rename(
    @CurrentUser() user: SafeUser,
    @Param('id') id: string,
    @Body() body: RenamePasskeyDto,
  ) {
    return this.passkeyService.rename(user.id, id, body.name);
  }

  @Delete(':id')
  @HttpCode(204)
  @UseGuards(JwtAuthGuard, RecentMfaGuard)
  @RequireRecentMfa()
  async delete(@CurrentUser() user: SafeUser, @Param('id') id: string, @Req() req: Request) {
    await this.passkeyService.delete(user.id, id);
    await this.authService.recordSecurityEvent({
      userId: user.id,
      email: user.email,
      eventType: 'PASSKEY_REMOVED',
      ipAddress: req.ip,
      userAgent: userAgentOf(req),
      metadata: { passkeyId: id },
    });
  }

  // Tahap 3 Sprint 2 (Passkey Login) - deliberately unauthenticated and not
  // rate-limited (no ThrottlerGuard), same posture as OAuthController's
  // start/callback: generating options has no side effects (no DB write,
  // just a signed JWT) and, unlike a password, there is no guessable
  // secret here for a rate limit to actually protect against.
  @Post('login/options')
  async loginOptions() {
    return this.passkeyService.generateAuthenticationOptionsFor();
  }

  // Also unauthenticated (nobody has a session yet - that's what this
  // route produces) and also un-throttled, for the same reason as
  // login/options: a WebAuthn assertion isn't a brute-forceable secret,
  // it's a challenge-response proof over a key that never leaves the
  // authenticator - the same reasoning OAuthController's callback route
  // (also no ThrottlerGuard) already documents for an authorization code.
  //
  // Mirrors AuthController.login's own tail exactly once the credential
  // itself is established: isMfaEnabled -> trusted-device -> maybe
  // challenge -> recordSecurityEvent -> createSession -> setAuthCookies.
  // The one difference is WHEN that branch runs at all - Tahap 3 Sprint 2's
  // decision: a passkey assertion with real user verification (UV) is
  // already MFA-equivalent, so it skips the branch entirely (and does NOT
  // set Session.elevatedAt - consistent with a successful MFA CHALLENGE
  // during login not auto-elevating either; elevation only ever comes from
  // an explicit POST /auth/elevate). An assertion WITHOUT UV falls through
  // to the exact same gate password/OAuth login use.
  @Post('login/verify')
  @HttpCode(200)
  async loginVerify(
    @Body() body: VerifyPasskeyAuthenticationDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { userId, userVerified } = await this.passkeyService.verifyAuthentication(
      body.response,
      body.challengeToken,
    );
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { id: true, email: true, role: true, emailVerified: true },
    });

    const ipAddress = req.ip;
    const userAgent = userAgentOf(req);
    // Computed unconditionally - needed for the trusted-device threshold
    // check when userVerified is false, and otherwise recorded purely as
    // SecurityEvent audit context, same as OAuth login's own
    // "doesn't compute a risk score anywhere else, purely to feed this
    // gate/log" posture.
    const risk = await this.authService.computeLoginRisk(user.email, ipAddress, userAgent);

    if (!userVerified && (await this.authService.isMfaEnabled(user.id))) {
      const trusted =
        risk.score < RISK_TRUSTED_DEVICE_THRESHOLD &&
        (await this.authService.checkTrustedDevice(
          user.id,
          req.cookies?.[TRUSTED_DEVICE_COOKIE_NAME],
        ));
      if (!trusted) {
        return { mfaRequired: true, mfaToken: this.authService.issueMfaChallengeToken(user.id) };
      }
    }

    await this.authService.recordSecurityEvent({
      userId: user.id,
      email: user.email,
      eventType: 'LOGIN_SUCCESS',
      ipAddress,
      userAgent,
      metadata: { method: 'passkey', userVerified, riskScore: risk.score, signals: risk.signals },
    });

    const tokens = await this.authService.createSession(user, userAgent, ipAddress);
    setAuthCookies(res, tokens);
    return user;
  }
}
