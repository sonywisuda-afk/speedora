import { randomBytes } from 'node:crypto';
import { NotFoundException } from '@nestjs/common';
import { SocialPlatform } from '@speedora/database';
import {
  decryptToken,
  encryptToken,
  type FacebookOAuthClient,
  type InstagramOAuthClient,
  type LinkedInOAuthClient,
  type PinterestOAuthClient,
  type ThreadsOAuthClient,
  type TikTokOAuthClient,
  type YouTubeOAuthClient,
} from '@speedora/social';
import type { PrismaService } from '../prisma/prisma.service';
import { SocialAccountsService } from './social.service';

describe('SocialAccountsService', () => {
  const originalEnv = process.env;
  let service: SocialAccountsService;
  let prisma: {
    socialAccount: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      upsert: jest.Mock;
      delete: jest.Mock;
      update: jest.Mock;
    };
  };
  let youtube: { revokeToken: jest.Mock; refreshAccessToken: jest.Mock };
  let tiktok: { revokeToken: jest.Mock; refreshAccessToken: jest.Mock };
  let instagram: { revokeToken: jest.Mock; refreshAccessToken: jest.Mock };
  let facebook: { revokeToken: jest.Mock; refreshAccessToken: jest.Mock };
  let threads: { revokeToken: jest.Mock; refreshAccessToken: jest.Mock };
  let linkedin: { revokeToken: jest.Mock; refreshAccessToken: jest.Mock };
  let pinterest: { revokeToken: jest.Mock; refreshAccessToken: jest.Mock };

  beforeEach(() => {
    process.env = { ...originalEnv, TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('hex') };
    prisma = {
      socialAccount: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        upsert: jest.fn(),
        delete: jest.fn(),
        update: jest.fn(),
      },
    };
    youtube = { revokeToken: jest.fn(), refreshAccessToken: jest.fn() };
    tiktok = { revokeToken: jest.fn(), refreshAccessToken: jest.fn() };
    instagram = { revokeToken: jest.fn(), refreshAccessToken: jest.fn() };
    facebook = { revokeToken: jest.fn(), refreshAccessToken: jest.fn() };
    threads = { revokeToken: jest.fn(), refreshAccessToken: jest.fn() };
    linkedin = { revokeToken: jest.fn(), refreshAccessToken: jest.fn() };
    pinterest = { revokeToken: jest.fn(), refreshAccessToken: jest.fn() };
    service = new SocialAccountsService(
      prisma as unknown as PrismaService,
      youtube as unknown as YouTubeOAuthClient,
      tiktok as unknown as TikTokOAuthClient,
      instagram as unknown as InstagramOAuthClient,
      facebook as unknown as FacebookOAuthClient,
      threads as unknown as ThreadsOAuthClient,
      linkedin as unknown as LinkedInOAuthClient,
      pinterest as unknown as PinterestOAuthClient,
    );
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('listForUser', () => {
    it('maps rows to the client-facing DTO, never including tokens', async () => {
      prisma.socialAccount.findMany.mockResolvedValue([
        {
          id: 'acc-1',
          platform: SocialPlatform.YOUTUBE,
          displayName: 'My Channel',
          accessToken: 'encrypted-access',
          refreshToken: 'encrypted-refresh',
          tokenExpiresAt: new Date('2026-01-01T00:00:00.000Z'),
          createdAt: new Date('2025-12-01T00:00:00.000Z'),
        },
      ]);

      const result = await service.listForUser('user-1');

      expect(prisma.socialAccount.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        orderBy: { createdAt: 'desc' },
      });
      expect(result).toEqual([
        {
          id: 'acc-1',
          platform: SocialPlatform.YOUTUBE,
          displayName: 'My Channel',
          tokenExpiresAt: '2026-01-01T00:00:00.000Z',
          createdAt: '2025-12-01T00:00:00.000Z',
        },
      ]);
      expect(result[0]).not.toHaveProperty('accessToken');
      expect(result[0]).not.toHaveProperty('refreshToken');
    });
  });

  describe('findOwnedOrThrow', () => {
    it('throws NotFoundException when the account does not exist', async () => {
      prisma.socialAccount.findUnique.mockResolvedValue(null);

      await expect(service.findOwnedOrThrow('missing', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws NotFoundException when the account belongs to a different user', async () => {
      prisma.socialAccount.findUnique.mockResolvedValue({ id: 'acc-1', userId: 'someone-else' });

      await expect(service.findOwnedOrThrow('acc-1', 'user-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('connectYouTube', () => {
    it('upserts on (userId, platform, platformAccountId) with encrypted tokens', async () => {
      prisma.socialAccount.upsert.mockImplementation(({ create }) =>
        Promise.resolve({
          id: 'acc-1',
          ...create,
          tokenExpiresAt: create.tokenExpiresAt,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
        }),
      );

      const result = await service.connectYouTube(
        'user-1',
        {
          accessToken: 'plain-access',
          refreshToken: 'plain-refresh',
          expiresAt: new Date('2026-02-01T00:00:00.000Z'),
        },
        { channelId: 'channel-1', title: 'My Channel' },
      );

      const call = prisma.socialAccount.upsert.mock.calls[0][0];
      expect(call.where).toEqual({
        userId_platform_platformAccountId: {
          userId: 'user-1',
          platform: SocialPlatform.YOUTUBE,
          platformAccountId: 'channel-1',
        },
      });
      // Never the plaintext token in what gets sent to Prisma.
      expect(call.create.accessToken).not.toBe('plain-access');
      expect(call.create.refreshToken).not.toBe('plain-refresh');
      expect(decryptToken(call.create.accessToken)).toBe('plain-access');
      expect(decryptToken(call.create.refreshToken)).toBe('plain-refresh');
      expect(call.create.displayName).toBe('My Channel');
      // update's tokens are separately-encrypted (random IV each call, by
      // design - see token-encryption.util.spec.ts), so compare by
      // decrypted plaintext rather than expecting byte-identical ciphertext.
      expect(decryptToken(call.update.accessToken)).toBe('plain-access');
      expect(decryptToken(call.update.refreshToken)).toBe('plain-refresh');
      expect(call.update.displayName).toBe('My Channel');
      expect(result.id).toBe('acc-1');
      expect(result.displayName).toBe('My Channel');
    });
  });

  describe('disconnect', () => {
    // A function, not a plain object built at describe-body evaluation
    // time - jest evaluates describe() callback bodies up front, before
    // the outer beforeEach() above has set TOKEN_ENCRYPTION_KEY, so calling
    // encryptToken() here directly would throw before any test even runs.
    function account(platform: SocialPlatform = SocialPlatform.YOUTUBE) {
      return {
        id: 'acc-1',
        userId: 'user-1',
        platform,
        accessToken: encryptToken('plain-access'),
        refreshToken: encryptToken('plain-refresh'),
      };
    }

    it('revokes the token and deletes the row', async () => {
      prisma.socialAccount.findUnique.mockResolvedValue(account());
      youtube.revokeToken.mockResolvedValue(undefined);

      await service.disconnect('acc-1', 'user-1');

      expect(youtube.revokeToken).toHaveBeenCalledWith('plain-access');
      expect(prisma.socialAccount.delete).toHaveBeenCalledWith({ where: { id: 'acc-1' } });
    });

    it('still deletes the row when revoking fails (e.g. token already invalid on Google)', async () => {
      prisma.socialAccount.findUnique.mockResolvedValue(account());
      youtube.revokeToken.mockRejectedValue(new Error('invalid_token'));
      jest.spyOn(console, 'warn').mockImplementation(() => undefined);

      await service.disconnect('acc-1', 'user-1');

      expect(prisma.socialAccount.delete).toHaveBeenCalledWith({ where: { id: 'acc-1' } });
    });

    it('throws NotFoundException without deleting anything when the account belongs to another user', async () => {
      prisma.socialAccount.findUnique.mockResolvedValue({ ...account(), userId: 'someone-else' });

      await expect(service.disconnect('acc-1', 'user-1')).rejects.toThrow(NotFoundException);
      expect(prisma.socialAccount.delete).not.toHaveBeenCalled();
    });

    it('dispatches to the TikTok client (not YouTube) for a TikTok account', async () => {
      prisma.socialAccount.findUnique.mockResolvedValue(account(SocialPlatform.TIKTOK));
      tiktok.revokeToken.mockResolvedValue(undefined);

      await service.disconnect('acc-1', 'user-1');

      expect(tiktok.revokeToken).toHaveBeenCalledWith('plain-access');
      expect(youtube.revokeToken).not.toHaveBeenCalled();
    });

    it('dispatches to the Instagram client (not YouTube/TikTok) for an Instagram account', async () => {
      prisma.socialAccount.findUnique.mockResolvedValue(account(SocialPlatform.INSTAGRAM));
      instagram.revokeToken.mockResolvedValue(undefined);

      await service.disconnect('acc-1', 'user-1');

      expect(instagram.revokeToken).toHaveBeenCalledWith('plain-access');
      expect(youtube.revokeToken).not.toHaveBeenCalled();
      expect(tiktok.revokeToken).not.toHaveBeenCalled();
    });
  });

  describe('getValidAccessToken', () => {
    function accountWithExpiry(expiresAt: Date, platform: SocialPlatform = SocialPlatform.YOUTUBE) {
      return {
        id: 'acc-1',
        userId: 'user-1',
        platform,
        accessToken: encryptToken('current-access'),
        refreshToken: encryptToken('current-refresh'),
        tokenExpiresAt: expiresAt,
      };
    }

    it('returns the current (decrypted) token when it is not close to expiring', async () => {
      prisma.socialAccount.findUnique.mockResolvedValue(
        accountWithExpiry(new Date(Date.now() + 60 * 60 * 1000)),
      );

      const token = await service.getValidAccessToken('acc-1', 'user-1');

      expect(token).toBe('current-access');
      expect(youtube.refreshAccessToken).not.toHaveBeenCalled();
    });

    it('refreshes and persists new tokens when the current one is at/near expiry', async () => {
      prisma.socialAccount.findUnique.mockResolvedValue(
        accountWithExpiry(new Date(Date.now() + 10_000)), // within the 60s refresh buffer
      );
      youtube.refreshAccessToken.mockResolvedValue({
        accessToken: 'new-access',
        refreshToken: 'new-refresh',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      });

      const token = await service.getValidAccessToken('acc-1', 'user-1');

      expect(youtube.refreshAccessToken).toHaveBeenCalledWith('current-refresh');
      expect(token).toBe('new-access');
      const updateCall = prisma.socialAccount.update.mock.calls[0][0];
      expect(updateCall.where).toEqual({ id: 'acc-1' });
      expect(decryptToken(updateCall.data.accessToken)).toBe('new-access');
      expect(decryptToken(updateCall.data.refreshToken)).toBe('new-refresh');
    });

    it('dispatches to the TikTok client (not YouTube) for a TikTok account', async () => {
      prisma.socialAccount.findUnique.mockResolvedValue(
        accountWithExpiry(new Date(Date.now() + 10_000), SocialPlatform.TIKTOK),
      );
      tiktok.refreshAccessToken.mockResolvedValue({
        accessToken: 'new-access',
        refreshToken: 'new-refresh',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      });

      const token = await service.getValidAccessToken('acc-1', 'user-1');

      expect(tiktok.refreshAccessToken).toHaveBeenCalledWith('current-refresh');
      expect(youtube.refreshAccessToken).not.toHaveBeenCalled();
      expect(token).toBe('new-access');
    });

    it('dispatches to the Instagram client (not YouTube/TikTok) for an Instagram account', async () => {
      prisma.socialAccount.findUnique.mockResolvedValue(
        accountWithExpiry(new Date(Date.now() + 10_000), SocialPlatform.INSTAGRAM),
      );
      instagram.refreshAccessToken.mockResolvedValue({
        accessToken: 'new-access',
        refreshToken: 'new-refresh',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      });

      const token = await service.getValidAccessToken('acc-1', 'user-1');

      expect(instagram.refreshAccessToken).toHaveBeenCalledWith('current-refresh');
      expect(youtube.refreshAccessToken).not.toHaveBeenCalled();
      expect(tiktok.refreshAccessToken).not.toHaveBeenCalled();
      expect(token).toBe('new-access');
    });
  });

  describe('connectTikTok', () => {
    it('upserts on (userId, platform, platformAccountId) with encrypted tokens', async () => {
      prisma.socialAccount.upsert.mockImplementation(({ create }) =>
        Promise.resolve({
          id: 'acc-1',
          ...create,
          tokenExpiresAt: create.tokenExpiresAt,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
        }),
      );

      const result = await service.connectTikTok(
        'user-1',
        {
          accessToken: 'plain-access',
          refreshToken: 'plain-refresh',
          expiresAt: new Date('2026-02-01T00:00:00.000Z'),
        },
        { openId: 'open-1', displayName: 'My TikTok' },
      );

      const call = prisma.socialAccount.upsert.mock.calls[0][0];
      expect(call.where).toEqual({
        userId_platform_platformAccountId: {
          userId: 'user-1',
          platform: SocialPlatform.TIKTOK,
          platformAccountId: 'open-1',
        },
      });
      expect(decryptToken(call.create.accessToken)).toBe('plain-access');
      expect(decryptToken(call.create.refreshToken)).toBe('plain-refresh');
      expect(call.create.displayName).toBe('My TikTok');
      expect(result.id).toBe('acc-1');
      expect(result.displayName).toBe('My TikTok');
    });
  });

  describe('connectInstagram', () => {
    it('upserts on (userId, platform, igUserId), storing the Page token as accessToken and the long-lived user token as refreshToken', async () => {
      prisma.socialAccount.upsert.mockImplementation(({ create }) =>
        Promise.resolve({
          id: 'acc-1',
          ...create,
          tokenExpiresAt: create.tokenExpiresAt,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
        }),
      );

      const result = await service.connectInstagram(
        'user-1',
        {
          accessToken: 'plain-long-lived-user-token',
          expiresAt: new Date('2026-03-01T00:00:00.000Z'),
        },
        { igUserId: 'ig-user-1', username: 'my_reels', pageAccessToken: 'plain-page-token' },
      );

      const call = prisma.socialAccount.upsert.mock.calls[0][0];
      expect(call.where).toEqual({
        userId_platform_platformAccountId: {
          userId: 'user-1',
          platform: SocialPlatform.INSTAGRAM,
          platformAccountId: 'ig-user-1',
        },
      });
      expect(decryptToken(call.create.accessToken)).toBe('plain-page-token');
      expect(decryptToken(call.create.refreshToken)).toBe('plain-long-lived-user-token');
      expect(call.create.displayName).toBe('my_reels');
      expect(result.id).toBe('acc-1');
      expect(result.displayName).toBe('my_reels');
    });
  });

  describe('connectFacebook', () => {
    it('upserts on (userId, platform, pageId), storing the Page token as accessToken and the long-lived user token as refreshToken', async () => {
      prisma.socialAccount.upsert.mockImplementation(({ create }) =>
        Promise.resolve({
          id: 'acc-1',
          ...create,
          tokenExpiresAt: create.tokenExpiresAt,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
        }),
      );

      const result = await service.connectFacebook(
        'user-1',
        {
          accessToken: 'plain-long-lived-user-token',
          expiresAt: new Date('2026-03-01T00:00:00.000Z'),
        },
        { pageId: 'page-1', pageName: 'My Page', pageAccessToken: 'plain-page-token' },
      );

      const call = prisma.socialAccount.upsert.mock.calls[0][0];
      expect(call.where).toEqual({
        userId_platform_platformAccountId: {
          userId: 'user-1',
          platform: SocialPlatform.FACEBOOK,
          platformAccountId: 'page-1',
        },
      });
      expect(decryptToken(call.create.accessToken)).toBe('plain-page-token');
      expect(decryptToken(call.create.refreshToken)).toBe('plain-long-lived-user-token');
      expect(call.create.displayName).toBe('My Page');
      expect(result.id).toBe('acc-1');
      expect(result.displayName).toBe('My Page');
    });
  });

  describe('connectThreads', () => {
    it('upserts on (userId, platform, threadsUserId), storing the same long-lived token as both accessToken and refreshToken', async () => {
      prisma.socialAccount.upsert.mockImplementation(({ create }) =>
        Promise.resolve({
          id: 'acc-1',
          ...create,
          tokenExpiresAt: create.tokenExpiresAt,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
        }),
      );

      const result = await service.connectThreads(
        'user-1',
        { accessToken: 'plain-long-lived-token', expiresAt: new Date('2026-03-01T00:00:00.000Z') },
        { threadsUserId: 'threads-user-1', username: 'my_threads' },
      );

      const call = prisma.socialAccount.upsert.mock.calls[0][0];
      expect(call.where).toEqual({
        userId_platform_platformAccountId: {
          userId: 'user-1',
          platform: SocialPlatform.THREADS,
          platformAccountId: 'threads-user-1',
        },
      });
      expect(decryptToken(call.create.accessToken)).toBe('plain-long-lived-token');
      expect(decryptToken(call.create.refreshToken)).toBe('plain-long-lived-token');
      expect(call.create.displayName).toBe('my_threads');
      expect(result.id).toBe('acc-1');
      expect(result.displayName).toBe('my_threads');
    });
  });

  describe('connectLinkedIn', () => {
    it('upserts on (userId, platform, personUrn), storing the member token directly (no Page indirection)', async () => {
      prisma.socialAccount.upsert.mockImplementation(({ create }) =>
        Promise.resolve({
          id: 'acc-1',
          ...create,
          tokenExpiresAt: create.tokenExpiresAt,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
        }),
      );

      const result = await service.connectLinkedIn(
        'user-1',
        {
          accessToken: 'plain-access',
          refreshToken: 'plain-refresh',
          expiresAt: new Date('2026-03-01T00:00:00.000Z'),
        },
        { personUrn: 'urn:li:person:abc123', name: 'Jane Doe' },
      );

      const call = prisma.socialAccount.upsert.mock.calls[0][0];
      expect(call.where).toEqual({
        userId_platform_platformAccountId: {
          userId: 'user-1',
          platform: SocialPlatform.LINKEDIN,
          platformAccountId: 'urn:li:person:abc123',
        },
      });
      expect(decryptToken(call.create.accessToken)).toBe('plain-access');
      expect(decryptToken(call.create.refreshToken)).toBe('plain-refresh');
      expect(call.create.displayName).toBe('Jane Doe');
      expect(result.id).toBe('acc-1');
      expect(result.displayName).toBe('Jane Doe');
    });

    it('stores an empty refreshToken when LinkedIn does not issue one', async () => {
      prisma.socialAccount.upsert.mockImplementation(({ create }) =>
        Promise.resolve({ id: 'acc-1', ...create, createdAt: new Date('2026-01-01T00:00:00.000Z') }),
      );

      await service.connectLinkedIn(
        'user-1',
        { accessToken: 'plain-access', refreshToken: null, expiresAt: new Date('2026-03-01T00:00:00.000Z') },
        { personUrn: 'urn:li:person:abc123', name: 'Jane Doe' },
      );

      const call = prisma.socialAccount.upsert.mock.calls[0][0];
      expect(decryptToken(call.create.refreshToken)).toBe('');
    });
  });

  describe('connectPinterest', () => {
    it('upserts on (userId, platform, boardId)', async () => {
      prisma.socialAccount.upsert.mockImplementation(({ create }) =>
        Promise.resolve({
          id: 'acc-1',
          ...create,
          tokenExpiresAt: create.tokenExpiresAt,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
        }),
      );

      const result = await service.connectPinterest(
        'user-1',
        {
          accessToken: 'plain-access',
          refreshToken: 'plain-refresh',
          expiresAt: new Date('2026-03-01T00:00:00.000Z'),
        },
        { boardId: 'board-1', displayName: 'my_pins — My Board' },
      );

      const call = prisma.socialAccount.upsert.mock.calls[0][0];
      expect(call.where).toEqual({
        userId_platform_platformAccountId: {
          userId: 'user-1',
          platform: SocialPlatform.PINTEREST,
          platformAccountId: 'board-1',
        },
      });
      expect(decryptToken(call.create.accessToken)).toBe('plain-access');
      expect(decryptToken(call.create.refreshToken)).toBe('plain-refresh');
      expect(call.create.displayName).toBe('my_pins — My Board');
      expect(result.id).toBe('acc-1');
      expect(result.displayName).toBe('my_pins — My Board');
    });
  });
});
