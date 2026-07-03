import { Injectable, NotFoundException } from '@nestjs/common';
import { SocialPlatform, type SocialAccount as SocialAccountRow } from '@viral-clip-app/database';
import {
  encryptToken,
  decryptToken,
  resolveAccessToken,
  YouTubeOAuthClient,
  type YouTubeChannel,
  type YouTubeTokens,
} from '@viral-clip-app/social';
import type { SocialAccount, SocialPlatform as SharedSocialPlatform } from '@viral-clip-app/shared';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SocialAccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly youtube: YouTubeOAuthClient,
  ) {}

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

  async disconnect(id: string, userId: string): Promise<void> {
    const account = await this.findOwnedOrThrow(id, userId);
    try {
      await this.youtube.revokeToken(decryptToken(account.accessToken));
    } catch (error) {
      // Best-effort - the local row is still removed even if the token was
      // already invalid/expired on Google's side (e.g. user revoked access
      // from their Google account settings directly).
      console.warn(`[social] failed to revoke token for account ${id}:`, error);
    }
    await this.prisma.socialAccount.delete({ where: { id } });
  }

  // Not wired to any HTTP endpoint - apps/worker's publish-clip job (Fase
  // 6b) is the actual caller that needs a live token, via its own copy of
  // this same resolveAccessToken() logic from @viral-clip-app/social (see
  // CLAUDE.md's Fase 6b section for why that's a shared package rather
  // than duplicated). Kept here, tested, for apps/api's own future
  // API-surface needs (e.g. a "verify this account still works" check).
  async getValidAccessToken(id: string, userId: string): Promise<string> {
    const account = await this.findOwnedOrThrow(id, userId);
    const resolved = await resolveAccessToken(account, this.youtube);

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
