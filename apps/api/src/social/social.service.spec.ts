import { randomBytes } from 'node:crypto';
import { NotFoundException } from '@nestjs/common';
import { SocialPlatform } from '@viral-clip-app/database';
import type { PrismaService } from '../prisma/prisma.service';
import { decryptToken, encryptToken } from './token-encryption.util';
import { SocialAccountsService } from './social.service';
import type { YouTubeOAuthClient } from './youtube-oauth.client';

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
    service = new SocialAccountsService(
      prisma as unknown as PrismaService,
      youtube as unknown as YouTubeOAuthClient,
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
    function account() {
      return {
        id: 'acc-1',
        userId: 'user-1',
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
  });

  describe('getValidAccessToken', () => {
    function accountWithExpiry(expiresAt: Date) {
      return {
        id: 'acc-1',
        userId: 'user-1',
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
  });
});
