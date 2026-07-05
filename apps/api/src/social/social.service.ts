import { Injectable, NotFoundException } from '@nestjs/common';
import { SocialPlatform, type SocialAccount as SocialAccountRow } from '@speedora/database';
import {
  encryptToken,
  decryptToken,
  resolveAccessToken,
  InstagramOAuthClient,
  TikTokOAuthClient,
  YouTubeOAuthClient,
  type InstagramAccount,
  type InstagramTokens,
  type TikTokTokens,
  type TikTokUser,
  type YouTubeChannel,
  type YouTubeTokens,
} from '@speedora/social';
import type { SocialAccount, SocialPlatform as SharedSocialPlatform } from '@speedora/shared';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SocialAccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly youtube: YouTubeOAuthClient,
    private readonly tiktok: TikTokOAuthClient,
    private readonly instagram: InstagramOAuthClient,
  ) {}

  // Both revokeToken() and resolveAccessToken() (via OAuthRefreshClient)
  // only need the platform's client, not the whole SocialAccountsService -
  // this is the one place that maps a stored SocialAccount.platform back to
  // the concrete OAuth client that owns it.
  private clientFor(
    platform: SocialPlatform,
  ): YouTubeOAuthClient | TikTokOAuthClient | InstagramOAuthClient {
    switch (platform) {
      case SocialPlatform.YOUTUBE:
        return this.youtube;
      case SocialPlatform.TIKTOK:
        return this.tiktok;
      case SocialPlatform.INSTAGRAM:
        return this.instagram;
    }
  }

  async listForUser(userId: string): Promise<SocialAccount[]> {
    const accounts = await this.prisma.socialAccount.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    return accounts.map(toDto);
  }

  // Same "not found" for a missing account and someone else's account, so
  // a client can't use this to probe which account IDs exist.
  async findOwnedOrThrow(id: string, userId: string): Promise<SocialAccountRow> {
    const account = await this.prisma.socialAccount.findUnique({ where: { id } });
    if (!account || account.userId !== userId) {
      throw new NotFoundException(`Social account ${id} not found`);
    }
    return account;
  }

  // Upserts on (userId, platform, platformAccountId) - reconnecting the
  // same YouTube channel refreshes its stored tokens/display name in place
  // rather than creating a duplicate row.
  async connectYouTube(
    userId: string,
    tokens: YouTubeTokens,
    channel: YouTubeChannel,
  ): Promise<SocialAccount> {
    const account = await this.prisma.socialAccount.upsert({
      where: {
        userId_platform_platformAccountId: {
          userId,
          platform: SocialPlatform.YOUTUBE,
          platformAccountId: channel.channelId,
        },
      },
      create: {
        userId,
        platform: SocialPlatform.YOUTUBE,
        platformAccountId: channel.channelId,
        displayName: channel.title,
        accessToken: encryptToken(tokens.accessToken),
        refreshToken: encryptToken(tokens.refreshToken),
        tokenExpiresAt: tokens.expiresAt,
      },
      update: {
        displayName: channel.title,
        accessToken: encryptToken(tokens.accessToken),
        refreshToken: encryptToken(tokens.refreshToken),
        tokenExpiresAt: tokens.expiresAt,
      },
    });
    return toDto(account);
  }

  // Upserts on (userId, platform, platformAccountId) - same reconnect
  // behavior as connectYouTube(), just keyed on TikTok's open_id instead of
  // a YouTube channelId.
  async connectTikTok(
    userId: string,
    tokens: TikTokTokens,
    user: TikTokUser,
  ): Promise<SocialAccount> {
    const account = await this.prisma.socialAccount.upsert({
      where: {
        userId_platform_platformAccountId: {
          userId,
          platform: SocialPlatform.TIKTOK,
          platformAccountId: user.openId,
        },
      },
      create: {
        userId,
        platform: SocialPlatform.TIKTOK,
        platformAccountId: user.openId,
        displayName: user.displayName,
        accessToken: encryptToken(tokens.accessToken),
        refreshToken: encryptToken(tokens.refreshToken),
        tokenExpiresAt: tokens.expiresAt,
      },
      update: {
        displayName: user.displayName,
        accessToken: encryptToken(tokens.accessToken),
        refreshToken: encryptToken(tokens.refreshToken),
        tokenExpiresAt: tokens.expiresAt,
      },
    });
    return toDto(account);
  }

  // Upserts on (userId, platform, platformAccountId), keyed on the
  // Instagram Business Account id. Unlike YouTube/TikTok, the two
  // parameters here don't map 1:1 to accessToken/refreshToken the way
  // Instagram's own OAuth model works (see instagram-oauth.client.ts):
  // `account.pageAccessToken` (not `tokens.accessToken`) is the token
  // actually used for Content Publishing API calls, and the long-lived
  // USER token (`tokens.accessToken`) is stored as `refreshToken` because
  // it's what refreshAccessToken() needs later to re-derive a fresh Page
  // token - Meta has no separate distinct "refresh token" concept here.
  async connectInstagram(
    userId: string,
    tokens: InstagramTokens,
    account: InstagramAccount,
  ): Promise<SocialAccount> {
    const row = await this.prisma.socialAccount.upsert({
      where: {
        userId_platform_platformAccountId: {
          userId,
          platform: SocialPlatform.INSTAGRAM,
          platformAccountId: account.igUserId,
        },
      },
      create: {
        userId,
        platform: SocialPlatform.INSTAGRAM,
        platformAccountId: account.igUserId,
        displayName: account.username,
        accessToken: encryptToken(account.pageAccessToken),
        refreshToken: encryptToken(tokens.accessToken),
        tokenExpiresAt: tokens.expiresAt,
      },
      update: {
        displayName: account.username,
        accessToken: encryptToken(account.pageAccessToken),
        refreshToken: encryptToken(tokens.accessToken),
        tokenExpiresAt: tokens.expiresAt,
      },
    });
    return toDto(row);
  }

  async disconnect(id: string, userId: string): Promise<void> {
    const account = await this.findOwnedOrThrow(id, userId);
    try {
      await this.clientFor(account.platform).revokeToken(decryptToken(account.accessToken));
    } catch (error) {
      // Best-effort - the local row is still removed even if the token was
      // already invalid/expired on the platform's side (e.g. user revoked
      // access from their Google/TikTok account settings directly).
      console.warn(`[social] failed to revoke token for account ${id}:`, error);
    }
    await this.prisma.socialAccount.delete({ where: { id } });
  }

  // Not wired to any HTTP endpoint - apps/worker's publish-clip job (Fase
  // 6b) is the actual caller that needs a live token, via its own copy of
  // this same resolveAccessToken() logic from @speedora/social (see
  // CLAUDE.md's Fase 6b section for why that's a shared package rather
  // than duplicated). Kept here, tested, for apps/api's own future
  // API-surface needs (e.g. a "verify this account still works" check).
  async getValidAccessToken(id: string, userId: string): Promise<string> {
    const account = await this.findOwnedOrThrow(id, userId);
    const resolved = await resolveAccessToken(account, this.clientFor(account.platform));

    if (resolved.refreshed && resolved.updated) {
      await this.prisma.socialAccount.update({ where: { id }, data: resolved.updated });
    }
    return resolved.accessToken;
  }
}

function toDto(account: SocialAccountRow): SocialAccount {
  return {
    id: account.id,
    // Prisma's generated SocialPlatform and packages/shared's are two
    // separately-declared TS enums with identical string members (same
    // "Mirrors X" convention as CaptionStyle/VideoStatus) - nominally
    // distinct types even though they're structurally identical at
    // runtime, hence the explicit cast rather than a silent compile error.
    platform: account.platform as unknown as SharedSocialPlatform,
    displayName: account.displayName,
    tokenExpiresAt: account.tokenExpiresAt.toISOString(),
    createdAt: account.createdAt.toISOString(),
  };
}
