import {
  Controller,
  Delete,
  Get,
  Param,
  Query,
  Res,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  InstagramOAuthClient,
  OAuthNotConfiguredError,
  TikTokOAuthClient,
  YouTubeOAuthClient,
} from '@viral-clip-app/social';
import type { Response } from 'express';
import type { SafeUser } from '../auth/auth.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SocialAccountsService } from './social.service';

interface OAuthState {
  sub: string;
}

@Controller('social')
export class SocialController {
  constructor(
    private readonly socialAccounts: SocialAccountsService,
    private readonly youtube: YouTubeOAuthClient,
    private readonly tiktok: TikTokOAuthClient,
    private readonly instagram: InstagramOAuthClient,
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
    try {
      res.redirect(this.youtube.buildAuthorizeUrl(state));
    } catch (error) {
      if (error instanceof OAuthNotConfiguredError) {
        throw new ServiceUnavailableException(error.message);
      }
      throw error;
    }
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

  // Same reasoning as the YouTube connect route above - a plain top-level
  // navigation, not a fetch.
  @Get('tiktok/connect')
  @UseGuards(JwtAuthGuard)
  connectTikTok(@CurrentUser() user: SafeUser, @Res() res: Response) {
    const state = this.jwt.sign({ sub: user.id } satisfies OAuthState, { expiresIn: '10m' });
    try {
      res.redirect(this.tiktok.buildAuthorizeUrl(state));
    } catch (error) {
      if (error instanceof OAuthNotConfiguredError) {
        throw new ServiceUnavailableException(error.message);
      }
      throw error;
    }
  }

  // Same reasoning as the YouTube callback route above - deliberately NOT
  // behind JwtAuthGuard, identity comes from the signed `state` param.
  @Get('tiktok/callback')
  async tiktokCallback(
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
      const tokens = await this.tiktok.exchangeCode(code);
      const user = await this.tiktok.fetchUserInfo(tokens.accessToken);
      await this.socialAccounts.connectTikTok(userId, tokens, user);
      res.redirect(`${webOrigin}/accounts?connected=tiktok`);
    } catch (err) {
      console.error('[social] TikTok OAuth callback failed:', err);
      res.redirect(`${webOrigin}/accounts?error=connect_failed`);
    }
  }

  // Same reasoning as the YouTube connect route above - a plain top-level
  // navigation, not a fetch. This is a Facebook Login dialog (see
  // CLAUDE.md's Fase 6d "Instagram" section for why), not an Instagram one.
  @Get('instagram/connect')
  @UseGuards(JwtAuthGuard)
  connectInstagram(@CurrentUser() user: SafeUser, @Res() res: Response) {
    const state = this.jwt.sign({ sub: user.id } satisfies OAuthState, { expiresIn: '10m' });
    try {
      res.redirect(this.instagram.buildAuthorizeUrl(state));
    } catch (error) {
      if (error instanceof OAuthNotConfiguredError) {
        throw new ServiceUnavailableException(error.message);
      }
      throw error;
    }
  }

  // Same reasoning as the YouTube callback route above - deliberately NOT
  // behind JwtAuthGuard, identity comes from the signed `state` param.
  @Get('instagram/callback')
  async instagramCallback(
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
      const tokens = await this.instagram.exchangeCode(code);
      const account = await this.instagram.fetchAccountInfo(tokens.accessToken);
      await this.socialAccounts.connectInstagram(userId, tokens, account);
      res.redirect(`${webOrigin}/accounts?connected=instagram`);
    } catch (err) {
      console.error('[social] Instagram OAuth callback failed:', err);
      res.redirect(`${webOrigin}/accounts?error=connect_failed`);
    }
  }
}
