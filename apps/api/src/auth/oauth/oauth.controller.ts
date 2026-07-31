import {
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { OAuthProvider } from '@speedora/database';
import { OAuthNotConfiguredError } from '@speedora/social';
import * as crypto from 'node:crypto';
import type { Request, Response } from 'express';
import { setAuthCookies, TRUSTED_DEVICE_COOKIE_NAME } from '../auth-cookies.util';
import { AuthService, RISK_TRUSTED_DEVICE_THRESHOLD, type SafeUser } from '../auth.service';
import { CurrentUser } from '../decorators/current-user.decorator';
import { RequireRecentMfa } from '../decorators/require-recent-mfa.decorator';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { RecentMfaGuard } from '../guards/recent-mfa.guard';
import { logger } from '../../logger';
import { GitHubOAuthLoginProvider } from './github-oauth-login.provider';
import { GoogleOAuthLoginProvider } from './google-oauth-login.provider';
import type { OAuthLoginAdapter } from './oauth-provider.interface';

interface OAuthState {
  // Deliberately no `sub` - unlike social.controller.ts's connect flow
  // (where the user is already logged in and state carries WHO initiated
  // it), login OAuth's state exists purely as an anti-CSRF nonce. Nobody's
  // identity is known yet - establishing it is the whole point of the
  // callback below.
  nonce: string;
}

function parseProvider(param: string): OAuthProvider | undefined {
  const upper = param.toUpperCase();
  return upper === 'GOOGLE' || upper === 'GITHUB' ? (upper as OAuthProvider) : undefined;
}

// Express types the User-Agent header as string | string[] | undefined -
// same helper as auth.controller.ts's userAgentOf, duplicated rather than
// exported since it's a one-liner and importing across controllers for
// this alone isn't worth the coupling.
function userAgentOf(req: Request): string | undefined {
  const value = req.headers['user-agent'];
  return Array.isArray(value) ? value[0] : value;
}

// Tahap 2 Step 1 (OAuth Login) - mirrors social.controller.ts's connect/
// callback mechanics (sign state -> redirect to buildAuthorizeUrl; on
// callback, verify state -> exchangeCode -> fetchProfile -> redirect) with
// one structural difference: `start` is unauthenticated (no JwtAuthGuard -
// signing in is the point) and state carries no user identity, only a nonce.
@Controller('auth/oauth')
export class OAuthController {
  private readonly registry: Record<OAuthProvider, OAuthLoginAdapter>;

  constructor(
    private readonly authService: AuthService,
    private readonly jwt: JwtService,
    google: GoogleOAuthLoginProvider,
    github: GitHubOAuthLoginProvider,
  ) {
    this.registry = { GOOGLE: google, GITHUB: github };
  }

  // Unknown :provider is a genuine client error (only ever reached via the
  // app's own generated links) - a plain 404, same posture as social's
  // connect route for an unknown platform.
  @Get(':provider/start')
  start(@Param('provider') providerParam: string, @Res() res: Response) {
    const provider = parseProvider(providerParam);
    if (!provider) {
      res.status(404).send('Unknown provider');
      return;
    }

    const state = this.jwt.sign({ nonce: crypto.randomUUID() } satisfies OAuthState, {
      expiresIn: '10m',
    });
    try {
      res.redirect(this.registry[provider].buildAuthorizeUrl(state));
    } catch (error) {
      if (error instanceof OAuthNotConfiguredError) {
        res.status(503).send(error.message);
        return;
      }
      throw error;
    }
  }

  // Deliberately not behind any guard - this is a fresh top-level
  // navigation from the provider's own origin, and by definition nobody is
  // logged in yet (that's what this route establishes). Never throws - any
  // failure redirects back to the login page with a ?error= reason, same as
  // social's callback (a navigation the provider itself made, not one the
  // app controls).
  @Get(':provider/callback')
  async callback(
    @Param('provider') providerParam: string,
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') error: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const webOrigin = process.env.WEB_ORIGIN ?? 'http://localhost:3000';
    const provider = parseProvider(providerParam);

    if (!provider) {
      res.redirect(`${webOrigin}/upload?error=unknown_provider`);
      return;
    }
    if (error || !code || !state) {
      res.redirect(`${webOrigin}/upload?error=${encodeURIComponent(error ?? 'missing_code')}`);
      return;
    }

    try {
      this.jwt.verify<OAuthState>(state);
    } catch {
      res.redirect(`${webOrigin}/upload?error=invalid_state`);
      return;
    }

    const adapter = this.registry[provider];
    try {
      const tokens = await adapter.exchangeCode(code);
      const profile = await adapter.fetchProfile(tokens);
      const user = await this.authService.resolveOAuthLogin(
        provider,
        profile.providerAccountId,
        profile.email,
      );

      const ipAddress = req.ip;
      const userAgent = userAgentOf(req);

      // Tahap 2 Step 2 Sprint 2a (MFA Enforcement) - same isMfaEnabled/
      // checkTrustedDevice/risk-gate sequence as AuthController.login's own
      // password path (see that method's comment on why a valid cookie is
      // still ignored under meaningful risk). OAuth login doesn't compute a
      // risk score anywhere else today - it's computed here purely to feed
      // this gate, same computeLoginRisk call password login already makes.
      if (await this.authService.isMfaEnabled(user.id)) {
        const risk = await this.authService.computeLoginRisk(user.email, ipAddress, userAgent);
        const trusted =
          risk.score < RISK_TRUSTED_DEVICE_THRESHOLD &&
          (await this.authService.checkTrustedDevice(
            user.id,
            req.cookies?.[TRUSTED_DEVICE_COOKIE_NAME],
          ));
        if (!trusted) {
          const mfaToken = this.authService.issueMfaChallengeToken(user.id);
          res.redirect(`${webOrigin}/mfa-challenge?token=${encodeURIComponent(mfaToken)}`);
          return;
        }
      }

      await this.authService.recordSecurityEvent({
        userId: user.id,
        email: user.email,
        eventType: 'LOGIN_SUCCESS',
        ipAddress,
        userAgent,
        metadata: { provider },
      });

      const sessionTokens = await this.authService.createSession(user, userAgent, ipAddress);
      setAuthCookies(res, sessionTokens);
      res.redirect(`${webOrigin}/upload`);
    } catch (err) {
      logger.error(`${provider} OAuth login callback failed`, {}, err);
      res.redirect(`${webOrigin}/upload?error=oauth_failed`);
    }
  }

  // Tahap 2 Step 3 (OAuth Account Management) - "Akun Terhubung" on the
  // Accounts page. Read-only, no elevation needed (nothing changes).
  @Get('linked')
  @UseGuards(JwtAuthGuard)
  async listLinked(@CurrentUser() user: SafeUser) {
    return this.authService.listLinkedProviders(user.id);
  }

  // Gated by RecentMfaGuard (reused as-is from Session Elevation, Sprint
  // 2b) - removing a sign-in method is exactly the kind of sensitive
  // operation that guard was built for, no new elevation mechanism needed.
  // Unknown :provider is a genuine client error (only ever reached via the
  // app's own generated links) - a plain 404, same posture as start/callback.
  @Delete('linked/:provider')
  @HttpCode(204)
  @UseGuards(JwtAuthGuard, RecentMfaGuard)
  @RequireRecentMfa()
  async unlinkProvider(
    @CurrentUser() user: SafeUser,
    @Param('provider') providerParam: string,
    @Req() req: Request,
  ) {
    const provider = parseProvider(providerParam);
    if (!provider) {
      throw new NotFoundException('Unknown provider');
    }

    await this.authService.unlinkOAuthProvider(user.id, provider);
    await this.authService.recordSecurityEvent({
      userId: user.id,
      email: user.email,
      eventType: 'OAUTH_UNLINKED',
      ipAddress: req.ip,
      userAgent: userAgentOf(req),
      metadata: { provider },
    });
  }
}
