import { Controller, Delete, Get, Param, Query, Res, UseGuards } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Response } from 'express';
import type { SafeUser } from '../auth/auth.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SocialAccountsService } from './social.service';
import { YouTubeOAuthClient } from './youtube-oauth.client';

interface OAuthState {
  sub: string;
}

@Controller('social')
export class SocialController {
  constructor(
    private readonly socialAccounts: SocialAccountsService,
    private readonly youtube: YouTubeOAuthClient,
    // Separate JwtModule instance from AuthModule's (see social.module.ts) -
    // same JWT_SECRET, unrelated purpose (signing the OAuth `state` param,
    // not session auth), short-lived (10m) so a state token can't be
    // replayed long after the connect flow was abandoned.
    private readonly jwt: JwtService,
  ) {}

  @Get('accounts')
  @UseGuards(JwtAuthGuard)
  list(@CurrentUser() user: SafeUser) {
    return this.socialAccounts.listForUser(user.id);
  }

  @Delete('accounts/:id')
  @UseGuards(JwtAuthGuard)
  async disconnect(@CurrentUser() user: SafeUser, @Param('id') id: string) {
    await this.socialAccounts.disconnect(id, user.id);
  }

  // A plain top-level browser navigation (an <a href>, not a fetch) - OAuth
  // requires an actual redirect to Google, which a fetch() can't do. The
  // session cookie is still attached (SameSite=Lax allows it on top-level
  // GET navigation), so JwtAuthGuard resolves @CurrentUser() normally here.
  @Get('youtube/connect')
  @UseGuards(JwtAuthGuard)
  connect(@CurrentUser() user: SafeUser, @Res() res: Response) {
    const state = this.jwt.sign({ sub: user.id } satisfies OAuthState, { expiresIn: '10m' });
    res.redirect(this.youtube.buildAuthorizeUrl(state));
  }

  // Deliberately NOT behind JwtAuthGuard - Google's redirect back here is a
  // fresh top-level navigation from Google's origin, and by the time it
  // lands the user's own session could plausibly have expired/logged out
  // mid-flow. The signed `state` param (not the session cookie) is what
  // identifies which user initiated this - tamper-proof since it's a JWT
  // signed with JWT_SECRET, and short-lived so it can't be replayed later.
  @Get('youtube/callback')
  async callback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') error: string | undefined,
    @Res() res: Response,
  ) {
    const webOrigin = process.env.WEB_ORIGIN ?? 'http://localhost:3000';

    if (error || !code || !state) {
      res.redirect(`${webOrigin}/accounts?error=${encodeURIComponent(error ?? 'missing_code')}`);
      return;
    }

    let userId: string;
    try {
      userId = this.jwt.verify<OAuthState>(state).sub;
    } catch {
      res.redirect(`${webOrigin}/accounts?error=invalid_state`);
      return;
    }

    try {
      const tokens = await this.youtube.exchangeCode(code);
      const channel = await this.youtube.fetchChannelInfo(tokens.accessToken);
      await this.socialAccounts.connectYouTube(userId, tokens, channel);
      res.redirect(`${webOrigin}/accounts?connected=youtube`);
    } catch (err) {
      console.error('[social] YouTube OAuth callback failed:', err);
      res.redirect(`${webOrigin}/accounts?error=connect_failed`);
    }
  }
}
