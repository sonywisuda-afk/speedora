import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Param,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import {
  clearAuthCookies,
  REFRESH_COOKIE_NAME,
  setAuthCookies,
  TRUSTED_DEVICE_COOKIE_NAME,
} from './auth-cookies.util';
import {
  AuthService,
  RISK_CAPTCHA_THRESHOLD,
  RISK_TRUSTED_DEVICE_THRESHOLD,
  type SafeUser,
  type SessionTokens,
} from './auth.service';
import { CAPTCHA_PROVIDER, type CaptchaProvider } from './captcha/captcha-provider.interface';
import { CurrentSessionId } from './decorators/current-session-id.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import { RequireRecentMfa } from './decorators/require-recent-mfa.decorator';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ElevateDto } from './dto/elevate.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RecentMfaGuard } from './guards/recent-mfa.guard';
import { LoginBackoffService } from './login-backoff.service';
import { PasskeyService } from './passkey/passkey.service';

// Express types the User-Agent header as string | string[] | undefined (a
// proxy could in principle send it twice) - createSession only cares about
// one representative value for parsing/display.
function userAgentOf(req: Request): string | undefined {
  const value = req.headers['user-agent'];
  return Array.isArray(value) ? value[0] : value;
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly loginBackoff: LoginBackoffService,
    private readonly passkeyService: PasskeyService,
    @Inject(CAPTCHA_PROVIDER) private readonly captchaProvider: CaptchaProvider,
  ) {}

  @Post('register')
  async register(
    @Body() body: RegisterDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const user = await this.authService.register(body.email, body.password);
    const tokens = await this.authService.createSession(user, userAgentOf(req), req.ip, 'password');
    setAuthCookies(res, tokens);
    // Best-effort - MailService itself never rethrows on a send failure, so
    // this can't turn a successful registration into a failed response.
    await this.authService.sendVerificationEmail(
      user.id,
      process.env.WEB_ORIGIN ?? 'http://localhost:3000',
    );
    return user;
  }

  // Authentication Foundation Sprint 4 (Attack Protection) - layered in the
  // user's own specified order: backoff gate first (cheapest, and what
  // actually slows brute force), then risk scoring, then - only above
  // RISK_CAPTCHA_THRESHOLD - a Turnstile challenge, then the credential
  // check itself. Every outcome (blocked, captcha-required, failed,
  // succeeded) is recorded as a SecurityEvent.
  @Post('login')
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  async login(
    @Body() body: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const ipAddress = req.ip;
    const userAgent = userAgentOf(req);

    const backoff = await this.loginBackoff.checkAllowed(body.email);
    if (!backoff.allowed) {
      throw new HttpException(
        {
          message: 'Too many failed attempts. Please try again later.',
          retryAfterMs: backoff.retryAfterMs,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const risk = await this.authService.computeLoginRisk(body.email, ipAddress, userAgent);
    if (risk.score >= RISK_CAPTCHA_THRESHOLD) {
      if (!body.captchaToken) {
        throw new BadRequestException({
          message: 'CAPTCHA verification required',
          requiresCaptcha: true,
        });
      }
      const captchaOk = await this.captchaProvider.verify(body.captchaToken, ipAddress);
      if (!captchaOk) {
        throw new BadRequestException({
          message: 'CAPTCHA verification failed',
          requiresCaptcha: true,
        });
      }
    }

    let user: SafeUser;
    try {
      user = await this.authService.validateUser(body.email, body.password);
    } catch (error) {
      await this.loginBackoff.recordFailure(body.email);
      await this.authService.recordSecurityEvent({
        email: body.email,
        eventType: 'LOGIN_FAILED',
        ipAddress,
        userAgent,
        metadata: { method: 'password', riskScore: risk.score, signals: risk.signals },
      });
      throw error;
    }

    await this.loginBackoff.reset(body.email);

    // Tahap 2 Step 2 Sprint 2a (MFA Enforcement) - a trusted-device cookie
    // only skips the challenge under LOW risk; even a valid cookie is
    // ignored the moment this login looks meaningfully different (new IP/
    // device/repeated failures - see RISK_TRUSTED_DEVICE_THRESHOLD's own
    // comment). No SecurityEvent yet for "challenge issued" - login isn't
    // complete until the challenge is verified (or skipped), matching how
    // only the terminal outcome gets logged everywhere else in this file.
    if (await this.authService.isMfaEnabled(user.id)) {
      const trusted =
        risk.score < RISK_TRUSTED_DEVICE_THRESHOLD &&
        (await this.authService.checkTrustedDevice(
          user.id,
          req.cookies?.[TRUSTED_DEVICE_COOKIE_NAME],
        ));
      if (!trusted) {
        return {
          mfaRequired: true,
          mfaToken: this.authService.issueMfaChallengeToken(user.id, 'password'),
        };
      }
    }

    await this.authService.recordSecurityEvent({
      userId: user.id,
      email: user.email,
      eventType: 'LOGIN_SUCCESS',
      ipAddress,
      userAgent,
      metadata: { method: 'password', riskScore: risk.score, signals: risk.signals },
    });

    const tokens = await this.authService.createSession(user, userAgent, ipAddress, 'password');
    setAuthCookies(res, tokens);
    return user;
  }

  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const rawRefreshToken = req.cookies?.[REFRESH_COOKIE_NAME];
    if (!rawRefreshToken) {
      clearAuthCookies(res);
      throw new UnauthorizedException('No refresh token provided');
    }

    let tokens: SessionTokens;
    try {
      tokens = await this.authService.rotateRefreshToken(rawRefreshToken);
    } catch (error) {
      // A token WAS provided but rejected (invalid/expired/revoked) - worth
      // logging. Distinct from the no-cookie-at-all branch above, which is
      // just "not logged in," not a security-relevant rejection.
      await this.authService.recordSecurityEvent({
        eventType: 'REFRESH_REJECTED',
        ipAddress: req.ip,
        userAgent: userAgentOf(req),
      });
      clearAuthCookies(res);
      throw error;
    }

    setAuthCookies(res, tokens);
    return { success: true };
  }

  @Post('logout')
  @HttpCode(200)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const rawRefreshToken = req.cookies?.[REFRESH_COOKIE_NAME];
    if (rawRefreshToken) {
      await this.authService.revokeSession(rawRefreshToken, 'logout');
    }
    await this.authService.recordSecurityEvent({
      eventType: 'LOGOUT',
      ipAddress: req.ip,
      userAgent: userAgentOf(req),
    });
    clearAuthCookies(res);
    return { success: true };
  }

  @Post('logout-all')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  async logoutAll(
    @CurrentUser() user: SafeUser,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.authService.revokeAllSessions(user.id, 'logout_all');
    await this.authService.recordSecurityEvent({
      userId: user.id,
      email: user.email,
      eventType: 'LOGOUT_ALL',
      ipAddress: req.ip,
      userAgent: userAgentOf(req),
      metadata: { scope: 'all' },
    });
    clearAuthCookies(res);
    return { success: true };
  }

  @Get('sessions')
  @UseGuards(JwtAuthGuard)
  async listSessions(@CurrentUser() user: SafeUser, @CurrentSessionId() sessionId: string) {
    return this.authService.listSessions(user.id, sessionId);
  }

  @Delete('sessions/:id')
  @HttpCode(204)
  @UseGuards(JwtAuthGuard)
  async revokeSessionById(
    @CurrentUser() user: SafeUser,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    await this.authService.revokeSessionById(user.id, id);
    await this.authService.recordSecurityEvent({
      userId: user.id,
      email: user.email,
      eventType: 'SESSION_REVOKED',
      ipAddress: req.ip,
      userAgent: userAgentOf(req),
      metadata: { sessionId: id },
    });
  }

  @Post('logout-others')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  async logoutOthers(
    @CurrentUser() user: SafeUser,
    @CurrentSessionId() sessionId: string,
    @Req() req: Request,
  ) {
    await this.authService.revokeOtherSessions(user.id, sessionId);
    await this.authService.recordSecurityEvent({
      userId: user.id,
      email: user.email,
      eventType: 'LOGOUT_ALL',
      ipAddress: req.ip,
      userAgent: userAgentOf(req),
      metadata: { scope: 'others' },
    });
    return { success: true };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: SafeUser) {
    // Safe to return as-is - see current-user.decorator.ts's own comment.
    // request.user internally carries more (e.g. sessionId), but
    // @CurrentUser() itself narrows to exactly SafeUser's fields before a
    // handler ever sees it, so no handler needs to re-narrow by hand.
    return user;
  }

  @Delete('me')
  @HttpCode(204)
  @UseGuards(JwtAuthGuard, RecentMfaGuard)
  @RequireRecentMfa()
  async deleteAccount(@CurrentUser() user: SafeUser, @Res({ passthrough: true }) res: Response) {
    await this.authService.deleteAccount(user.id);
    // The account is gone - drop the now-useless session cookies too.
    clearAuthCookies(res);
  }

  // Tahap 2 Step 2 Sprint 2b (Session Elevation) - re-proves the caller's
  // identity for the CURRENT session (a TOTP/recovery code if MFA is
  // enabled, the current password otherwise - see
  // AuthService.verifyElevationCredential), then marks that session
  // elevated for ELEVATION_WINDOW_MS. Same ThrottlerGuard as /auth/login -
  // still a credential-guessing surface even though the caller is already
  // authenticated.
  //
  // Tahap 3 Sprint 3 (Passkey Elevation) - a passkeyResponse in the body is
  // a THIRD credential option, checked first and routed to
  // PasskeyService.verifyElevationAssertion instead of
  // AuthService.verifyElevationCredential - closes a real lockout gap: an
  // OAuth-only account with MFA never enabled had no password and no TOTP
  // to elevate with at all, meaning it could never pass ANY
  // RecentMfaGuard-protected route, including adding its first passkey.
  // ThrottlerGuard still applies (passkeyResponse is validated first by
  // real cryptographic signature verification, but the route itself is
  // still worth rate-limiting the same as the other two credential shapes).
  @Post('elevate')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, ThrottlerGuard)
  async elevate(
    @Body() body: ElevateDto,
    @CurrentUser() user: SafeUser,
    @Req() req: Request,
    @CurrentSessionId() sessionId: string,
  ) {
    // Tahap 3.5 (Passkey UX & Observability) - which credential shape the
    // caller actually sent, purely for audit context (not a security
    // decision - that's still made by whichever verify* call below actually
    // runs). Previously POST /auth/elevate recorded NOTHING, success or
    // failure, for any of its three credential types - a repeated-failure
    // pattern here is a real signal (someone trying to step up a stolen
    // session).
    const credentialType = body.passkeyResponse ? 'passkey' : body.code ? 'totp' : 'password';
    const ipAddress = req.ip;
    const userAgent = userAgentOf(req);

    let verified: boolean;
    try {
      verified =
        body.passkeyResponse && body.passkeyChallengeToken
          ? await this.passkeyService.verifyElevationAssertion(
              user.id,
              body.passkeyResponse,
              body.passkeyChallengeToken,
            )
          : await this.authService.verifyElevationCredential(user.id, body);
    } catch (err) {
      // verifyElevationAssertion throws rather than returning false - same
      // generic ELEVATION_FAILED regardless of which of the two verify
      // paths rejected it.
      await this.authService.recordSecurityEvent({
        userId: user.id,
        email: user.email,
        eventType: 'ELEVATION_FAILED',
        ipAddress,
        userAgent,
        metadata: { credentialType },
      });
      throw err;
    }
    if (!verified) {
      await this.authService.recordSecurityEvent({
        userId: user.id,
        email: user.email,
        eventType: 'ELEVATION_FAILED',
        ipAddress,
        userAgent,
        metadata: { credentialType },
      });
      throw new UnauthorizedException('Invalid verification code or password');
    }

    await this.authService.recordSecurityEvent({
      userId: user.id,
      email: user.email,
      eventType: 'ELEVATION_SUCCESS',
      ipAddress,
      userAgent,
      metadata: { credentialType },
    });

    const elevatedUntil = await this.authService.elevateSession(sessionId);
    return { success: true, elevatedUntil };
  }

  @Post('forgot-password')
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  async forgotPassword(@Body() body: ForgotPasswordDto) {
    const webOrigin = process.env.WEB_ORIGIN ?? 'http://localhost:3000';
    await this.authService.requestPasswordReset(body.email, webOrigin);
    // Same response whether or not the email matched an account - see
    // AuthService.requestPasswordReset's comment.
    return { message: 'If that email is registered, a reset link has been sent.' };
  }

  @Post('reset-password')
  @HttpCode(200)
  async resetPassword(
    @Body() body: ResetPasswordDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const user = await this.authService.resetPassword(body.token, body.newPassword);
    await this.authService.recordSecurityEvent({
      userId: user.id,
      email: user.email,
      eventType: 'PASSWORD_RESET_COMPLETED',
      ipAddress: req.ip,
      userAgent: userAgentOf(req),
    });
    // Auto-login after a successful reset, same as register/login.
    const tokens = await this.authService.createSession(user, userAgentOf(req), req.ip, 'password');
    setAuthCookies(res, tokens);
    return user;
  }

  @Post('verify-email')
  @HttpCode(200)
  async verifyEmail(@Body() body: VerifyEmailDto, @Req() req: Request) {
    const user = await this.authService.verifyEmail(body.token);
    await this.authService.recordSecurityEvent({
      userId: user.id,
      email: user.email,
      eventType: 'EMAIL_VERIFIED',
      ipAddress: req.ip,
      userAgent: userAgentOf(req),
    });
    return user;
  }

  @Post('resend-verification')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, ThrottlerGuard)
  async resendVerification(@CurrentUser() user: SafeUser) {
    await this.authService.resendVerification(
      user.id,
      process.env.WEB_ORIGIN ?? 'http://localhost:3000',
    );
    return { message: 'Verification email sent.' };
  }

  @Post('change-password')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, RecentMfaGuard)
  @RequireRecentMfa()
  async changePassword(@Body() body: ChangePasswordDto, @CurrentUser() user: SafeUser) {
    await this.authService.changePassword(user.id, body.newPassword);
    return { success: true };
  }
}
