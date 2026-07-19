import {
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Query,
  Res,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  FacebookOAuthClient,
  InstagramOAuthClient,
  LinkedInOAuthClient,
  OAuthNotConfiguredError,
  PinterestOAuthClient,
  ThreadsOAuthClient,
  TikTokOAuthClient,
  XOAuthClient,
  YouTubeOAuthClient,
  type FacebookPage,
  type FacebookTokens,
  type InstagramAccount,
  type InstagramTokens,
  type LinkedInMember,
  type LinkedInTokens,
  type PinterestAccount,
  type PinterestTokens,
  type ThreadsTokens,
  type ThreadsUser,
  type TikTokTokens,
  type TikTokUser,
  type XAccount,
  type XTokens,
  type YouTubeChannel,
  type YouTubeTokens,
} from '@speedora/social';
import { SocialPlatform } from '@speedora/shared';
import type { Response } from 'express';
import type { SafeUser } from '../auth/auth.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { logger } from '../logger';
import { SocialAccountsService } from './social.service';

interface OAuthState {
  sub: string;
}

// Multi-Platform Publishing Expansion, Phase 0. Every platform's connect/
// callback dance is the exact same shape (sign state -> redirect to
// buildAuthorizeUrl; on callback, verify state -> exchangeCode ->
// fetchProfile -> connect -> redirect) even though the token/profile SHAPES
// genuinely differ per platform (YouTube channel vs. TikTok user vs.
// Instagram's Page-token quirk - see SocialAccountsService.connectInstagram's
// comment). This adapter only unifies the dispatch, not the shapes - each
// entry below closes over its own concretely-typed client/service methods,
// so the `unknown` casts are localized here rather than forcing a single
// leaky interface on SocialAccountsService itself.
// exchangeCode takes `state` as a second param solely for X's PKCE flow
// (see x-graph.ts's deriveCodeVerifier comment) - every other platform's
// closure below just ignores it. The callback handler already has `state`
// in scope (verified immediately before this call), so this is a same-
// signature-family addition, not new data to thread through.
interface OAuthConnectAdapter {
  buildAuthorizeUrl(state: string): string;
  exchangeCode(code: string, state: string): Promise<{ accessToken: string }>;
  fetchProfile(accessToken: string): Promise<unknown>;
  connect(userId: string, tokens: unknown, profile: unknown): Promise<unknown>;
}

// No request-id middleware exists in this app yet - rather than adding one
// just for these three log lines, this reads whatever the client/a reverse
// proxy already set (a common convention), and is simply omitted from the
// log entry when absent. "Include standard fields where available" - this
// is the "where available" case.
function requestIdOf(res: Response): string | undefined {
  const value = res.req?.headers?.['x-request-id'];
  return Array.isArray(value) ? value[0] : value;
}

// Case-insensitive on purpose - connectYouTubeUrl()-style helpers on the
// frontend build lowercase URL segments (/social/youtube/connect), while
// SocialPlatform enum members are uppercase.
function parsePlatform(param: string): SocialPlatform | undefined {
  const upper = param.toUpperCase();
  return (Object.values(SocialPlatform) as string[]).includes(upper)
    ? (upper as SocialPlatform)
    : undefined;
}

@Controller('social')
export class SocialController {
  private readonly oauthRegistry: Record<SocialPlatform, OAuthConnectAdapter>;

  constructor(
    private readonly socialAccounts: SocialAccountsService,
    private readonly youtube: YouTubeOAuthClient,
    private readonly tiktok: TikTokOAuthClient,
    private readonly instagram: InstagramOAuthClient,
    private readonly facebook: FacebookOAuthClient,
    private readonly threads: ThreadsOAuthClient,
    private readonly linkedin: LinkedInOAuthClient,
    private readonly pinterest: PinterestOAuthClient,
    private readonly x: XOAuthClient,
    // Separate JwtModule instance from AuthModule's (see social.module.ts) -
    // same JWT_SECRET, unrelated purpose (signing the OAuth `state` param,
    // not session auth), short-lived (10m) so a state token can't be
    // replayed long after the connect flow was abandoned.
    private readonly jwt: JwtService,
  ) {
    this.oauthRegistry = {
      [SocialPlatform.YOUTUBE]: {
        buildAuthorizeUrl: (state) => this.youtube.buildAuthorizeUrl(state),
        exchangeCode: (code) => this.youtube.exchangeCode(code),
        fetchProfile: (token) => this.youtube.fetchChannelInfo(token),
        connect: (userId, tokens, profile) =>
          this.socialAccounts.connectYouTube(
            userId,
            tokens as YouTubeTokens,
            profile as YouTubeChannel,
          ),
      },
      [SocialPlatform.TIKTOK]: {
        buildAuthorizeUrl: (state) => this.tiktok.buildAuthorizeUrl(state),
        exchangeCode: (code) => this.tiktok.exchangeCode(code),
        fetchProfile: (token) => this.tiktok.fetchUserInfo(token),
        connect: (userId, tokens, profile) =>
          this.socialAccounts.connectTikTok(userId, tokens as TikTokTokens, profile as TikTokUser),
      },
      [SocialPlatform.INSTAGRAM]: {
        buildAuthorizeUrl: (state) => this.instagram.buildAuthorizeUrl(state),
        exchangeCode: (code) => this.instagram.exchangeCode(code),
        fetchProfile: (token) => this.instagram.fetchAccountInfo(token),
        connect: (userId, tokens, profile) =>
          this.socialAccounts.connectInstagram(
            userId,
            tokens as InstagramTokens,
            profile as InstagramAccount,
          ),
      },
      [SocialPlatform.FACEBOOK]: {
        buildAuthorizeUrl: (state) => this.facebook.buildAuthorizeUrl(state),
        exchangeCode: (code) => this.facebook.exchangeCode(code),
        fetchProfile: (token) => this.facebook.fetchAccountInfo(token),
        connect: (userId, tokens, profile) =>
          this.socialAccounts.connectFacebook(
            userId,
            tokens as FacebookTokens,
            profile as FacebookPage,
          ),
      },
      [SocialPlatform.THREADS]: {
        buildAuthorizeUrl: (state) => this.threads.buildAuthorizeUrl(state),
        exchangeCode: (code) => this.threads.exchangeCode(code),
        fetchProfile: (token) => this.threads.fetchAccountInfo(token),
        connect: (userId, tokens, profile) =>
          this.socialAccounts.connectThreads(
            userId,
            tokens as ThreadsTokens,
            profile as ThreadsUser,
          ),
      },
      [SocialPlatform.LINKEDIN]: {
        buildAuthorizeUrl: (state) => this.linkedin.buildAuthorizeUrl(state),
        exchangeCode: (code) => this.linkedin.exchangeCode(code),
        fetchProfile: (token) => this.linkedin.fetchAccountInfo(token),
        connect: (userId, tokens, profile) =>
          this.socialAccounts.connectLinkedIn(
            userId,
            tokens as LinkedInTokens,
            profile as LinkedInMember,
          ),
      },
      [SocialPlatform.PINTEREST]: {
        buildAuthorizeUrl: (state) => this.pinterest.buildAuthorizeUrl(state),
        exchangeCode: (code) => this.pinterest.exchangeCode(code),
        fetchProfile: (token) => this.pinterest.fetchAccountInfo(token),
        connect: (userId, tokens, profile) =>
          this.socialAccounts.connectPinterest(
            userId,
            tokens as PinterestTokens,
            profile as PinterestAccount,
          ),
      },
      [SocialPlatform.X]: {
        buildAuthorizeUrl: (state) => this.x.buildAuthorizeUrl(state),
        // The only platform that actually needs `state` here - PKCE
        // requires re-deriving the code_verifier from it (see x-graph.ts).
        exchangeCode: (code, state) => this.x.exchangeCode(code, state),
        fetchProfile: (token) => this.x.fetchAccountInfo(token),
        connect: (userId, tokens, profile) =>
          this.socialAccounts.connectX(userId, tokens as XTokens, profile as XAccount),
      },
    };
  }

  @Get('accounts')
  @UseGuards(JwtAuthGuard)
  list(@CurrentUser() user: SafeUser) {
    return this.socialAccounts.listForUser(user.id);
  }

  @Delete('accounts/:id')
  @HttpCode(204)
  @UseGuards(JwtAuthGuard)
  async disconnect(@CurrentUser() user: SafeUser, @Param('id') id: string) {
    await this.socialAccounts.disconnect(id, user.id);
  }

  // A plain top-level browser navigation (an <a href>, not a fetch) - OAuth
  // requires an actual redirect to the platform, which a fetch() can't do.
  // The session cookie is still attached (SameSite=Lax allows it on
  // top-level GET navigation), so JwtAuthGuard resolves @CurrentUser()
  // normally here. An unknown :platform is a genuine client error (this
  // route is only ever reached via the app's own generated links) - a plain
  // 404 rather than a redirect, unlike the callback route below.
  @Get(':platform/connect')
  @UseGuards(JwtAuthGuard)
  connect(
    @CurrentUser() user: SafeUser,
    @Param('platform') platformParam: string,
    @Res() res: Response,
  ) {
    const platform = parsePlatform(platformParam);
    if (!platform) {
      throw new NotFoundException(`Unknown platform: ${platformParam}`);
    }
    const state = this.jwt.sign({ sub: user.id } satisfies OAuthState, { expiresIn: '10m' });
    try {
      res.redirect(this.oauthRegistry[platform].buildAuthorizeUrl(state));
    } catch (error) {
      if (error instanceof OAuthNotConfiguredError) {
        throw new ServiceUnavailableException(error.message);
      }
      throw error;
    }
  }

  // Deliberately NOT behind JwtAuthGuard - the platform's redirect back here
  // is a fresh top-level navigation from its own origin, and by the time it
  // lands the user's own session could plausibly have expired/logged out
  // mid-flow. The signed `state` param (not the session cookie) is what
  // identifies which user initiated this - tamper-proof since it's a JWT
  // signed with JWT_SECRET, and short-lived so it can't be replayed later.
  // An unknown :platform here still redirects (never throws) - this is a
  // navigation the platform itself made, not one the app controls.
  @Get(':platform/callback')
  async callback(
    @Param('platform') platformParam: string,
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') error: string | undefined,
    @Res() res: Response,
  ) {
    const webOrigin = process.env.WEB_ORIGIN ?? 'http://localhost:3000';
    const platform = parsePlatform(platformParam);

    if (!platform) {
      res.redirect(`${webOrigin}/social?error=unknown_platform`);
      return;
    }

    if (error || !code || !state) {
      res.redirect(`${webOrigin}/social?error=${encodeURIComponent(error ?? 'missing_code')}`);
      return;
    }

    let userId: string;
    try {
      userId = this.jwt.verify<OAuthState>(state).sub;
    } catch {
      res.redirect(`${webOrigin}/social?error=invalid_state`);
      return;
    }

    const adapter = this.oauthRegistry[platform];
    try {
      const tokens = await adapter.exchangeCode(code, state);
      const profile = await adapter.fetchProfile(tokens.accessToken);
      await adapter.connect(userId, tokens, profile);
      res.redirect(`${webOrigin}/social?connected=${platformParam.toLowerCase()}`);
    } catch (err) {
      logger.error(
        `${platform} OAuth callback failed`,
        { userId, requestId: requestIdOf(res) },
        err,
      );
      res.redirect(`${webOrigin}/social?error=connect_failed`);
    }
  }
}
