import { ServiceUnavailableException } from '@nestjs/common';
import {
  OAuthNotConfiguredError,
  type InstagramOAuthClient,
  type TikTokOAuthClient,
  type YouTubeOAuthClient,
} from '@viral-clip-app/social';
import type { Response } from 'express';
import { SocialController } from './social.controller';
import type { SocialAccountsService } from './social.service';

describe('SocialController', () => {
  let controller: SocialController;
  let socialAccounts: {
    listForUser: jest.Mock;
    disconnect: jest.Mock;
    connectYouTube: jest.Mock;
    connectTikTok: jest.Mock;
    connectInstagram: jest.Mock;
  };
  let youtube: {
    buildAuthorizeUrl: jest.Mock;
    exchangeCode: jest.Mock;
    fetchChannelInfo: jest.Mock;
  };
  let tiktok: {
    buildAuthorizeUrl: jest.Mock;
    exchangeCode: jest.Mock;
    fetchUserInfo: jest.Mock;
  };
  let instagram: {
    buildAuthorizeUrl: jest.Mock;
    exchangeCode: jest.Mock;
    fetchAccountInfo: jest.Mock;
  };
  let jwt: { sign: jest.Mock; verify: jest.Mock };
  const user = { id: 'user-1', email: 'a@example.com' };

  function fakeResponse(): Response {
    return { redirect: jest.fn() } as unknown as Response;
  }

  beforeEach(() => {
    socialAccounts = {
      listForUser: jest.fn(),
      disconnect: jest.fn(),
      connectYouTube: jest.fn(),
      connectTikTok: jest.fn(),
      connectInstagram: jest.fn(),
    };
    youtube = {
      buildAuthorizeUrl: jest.fn(),
      exchangeCode: jest.fn(),
      fetchChannelInfo: jest.fn(),
    };
    tiktok = {
      buildAuthorizeUrl: jest.fn(),
      exchangeCode: jest.fn(),
      fetchUserInfo: jest.fn(),
    };
    instagram = {
      buildAuthorizeUrl: jest.fn(),
      exchangeCode: jest.fn(),
      fetchAccountInfo: jest.fn(),
    };
    jwt = { sign: jest.fn(), verify: jest.fn() };
    controller = new SocialController(
      socialAccounts as unknown as SocialAccountsService,
      youtube as unknown as YouTubeOAuthClient,
      tiktok as unknown as TikTokOAuthClient,
      instagram as unknown as InstagramOAuthClient,
      jwt as never,
    );
    process.env.WEB_ORIGIN = 'http://localhost:3000';
  });

  it('delegates GET /social/accounts to SocialAccountsService.listForUser', async () => {
    socialAccounts.listForUser.mockResolvedValue([{ id: 'acc-1' }]);

    const result = await controller.list(user);

    expect(socialAccounts.listForUser).toHaveBeenCalledWith('user-1');
    expect(result).toEqual([{ id: 'acc-1' }]);
  });

  it('delegates DELETE /social/accounts/:id to SocialAccountsService.disconnect', async () => {
    await controller.disconnect(user, 'acc-1');

    expect(socialAccounts.disconnect).toHaveBeenCalledWith('acc-1', 'user-1');
  });

  describe('connect', () => {
    it('signs a short-lived state JWT and redirects to the built authorize URL', () => {
      jwt.sign.mockReturnValue('signed-state');
      youtube.buildAuthorizeUrl.mockReturnValue('https://accounts.google.com/authorize?...');
      const res = fakeResponse();

      controller.connect(user, res);

      expect(jwt.sign).toHaveBeenCalledWith({ sub: 'user-1' }, { expiresIn: '10m' });
      expect(youtube.buildAuthorizeUrl).toHaveBeenCalledWith('signed-state');
      expect(res.redirect).toHaveBeenCalledWith('https://accounts.google.com/authorize?...');
    });

    it('translates OAuthNotConfiguredError into a 503 rather than crashing', () => {
      jwt.sign.mockReturnValue('signed-state');
      youtube.buildAuthorizeUrl.mockImplementation(() => {
        throw new OAuthNotConfiguredError();
      });
      const res = fakeResponse();

      expect(() => controller.connect(user, res)).toThrow(ServiceUnavailableException);
    });
  });

  describe('callback', () => {
    it('redirects with the error code when Google reports one (e.g. user denied consent)', async () => {
      const res = fakeResponse();

      await controller.callback(undefined, undefined, 'access_denied', res);

      expect(res.redirect).toHaveBeenCalledWith(
        'http://localhost:3000/accounts?error=access_denied',
      );
      expect(jwt.verify).not.toHaveBeenCalled();
    });

    it('redirects with missing_code when there is no code and no explicit error', async () => {
      const res = fakeResponse();

      await controller.callback(undefined, 'some-state', undefined, res);

      expect(res.redirect).toHaveBeenCalledWith(
        'http://localhost:3000/accounts?error=missing_code',
      );
    });

    it('redirects with invalid_state when the state JWT fails to verify', async () => {
      jwt.verify.mockImplementation(() => {
        throw new Error('jwt expired');
      });
      const res = fakeResponse();

      await controller.callback('the-code', 'bad-state', undefined, res);

      expect(res.redirect).toHaveBeenCalledWith(
        'http://localhost:3000/accounts?error=invalid_state',
      );
      expect(youtube.exchangeCode).not.toHaveBeenCalled();
    });

    it('exchanges the code, fetches the channel, connects the account, and redirects on success', async () => {
      jwt.verify.mockReturnValue({ sub: 'user-1' });
      youtube.exchangeCode.mockResolvedValue({ accessToken: 'access-1' });
      youtube.fetchChannelInfo.mockResolvedValue({ channelId: 'channel-1', title: 'My Channel' });
      const res = fakeResponse();

      await controller.callback('the-code', 'signed-state', undefined, res);

      expect(youtube.exchangeCode).toHaveBeenCalledWith('the-code');
      expect(youtube.fetchChannelInfo).toHaveBeenCalledWith('access-1');
      expect(socialAccounts.connectYouTube).toHaveBeenCalledWith(
        'user-1',
        { accessToken: 'access-1' },
        { channelId: 'channel-1', title: 'My Channel' },
      );
      expect(res.redirect).toHaveBeenCalledWith('http://localhost:3000/accounts?connected=youtube');
    });

    it('redirects with connect_failed rather than throwing when the exchange/upsert fails', async () => {
      jwt.verify.mockReturnValue({ sub: 'user-1' });
      youtube.exchangeCode.mockRejectedValue(new Error('token exchange failed'));
      jest.spyOn(console, 'error').mockImplementation(() => undefined);
      const res = fakeResponse();

      await controller.callback('the-code', 'signed-state', undefined, res);

      expect(res.redirect).toHaveBeenCalledWith(
        'http://localhost:3000/accounts?error=connect_failed',
      );
    });
  });

  describe('connectTikTok', () => {
    it('signs a short-lived state JWT and redirects to the built authorize URL', () => {
      jwt.sign.mockReturnValue('signed-state');
      tiktok.buildAuthorizeUrl.mockReturnValue('https://www.tiktok.com/v2/auth/authorize/?...');
      const res = fakeResponse();

      controller.connectTikTok(user, res);

      expect(jwt.sign).toHaveBeenCalledWith({ sub: 'user-1' }, { expiresIn: '10m' });
      expect(tiktok.buildAuthorizeUrl).toHaveBeenCalledWith('signed-state');
      expect(res.redirect).toHaveBeenCalledWith('https://www.tiktok.com/v2/auth/authorize/?...');
    });

    it('translates OAuthNotConfiguredError into a 503 rather than crashing', () => {
      jwt.sign.mockReturnValue('signed-state');
      tiktok.buildAuthorizeUrl.mockImplementation(() => {
        throw new OAuthNotConfiguredError();
      });
      const res = fakeResponse();

      expect(() => controller.connectTikTok(user, res)).toThrow(ServiceUnavailableException);
    });
  });

  describe('tiktokCallback', () => {
    it('exchanges the code, fetches user info, connects the account, and redirects on success', async () => {
      jwt.verify.mockReturnValue({ sub: 'user-1' });
      tiktok.exchangeCode.mockResolvedValue({ accessToken: 'access-1' });
      tiktok.fetchUserInfo.mockResolvedValue({ openId: 'open-1', displayName: 'My TikTok' });
      const res = fakeResponse();

      await controller.tiktokCallback('the-code', 'signed-state', undefined, res);

      expect(tiktok.exchangeCode).toHaveBeenCalledWith('the-code');
      expect(tiktok.fetchUserInfo).toHaveBeenCalledWith('access-1');
      expect(socialAccounts.connectTikTok).toHaveBeenCalledWith(
        'user-1',
        { accessToken: 'access-1' },
        { openId: 'open-1', displayName: 'My TikTok' },
      );
      expect(res.redirect).toHaveBeenCalledWith('http://localhost:3000/accounts?connected=tiktok');
    });

    it('redirects with connect_failed rather than throwing when the exchange/upsert fails', async () => {
      jwt.verify.mockReturnValue({ sub: 'user-1' });
      tiktok.exchangeCode.mockRejectedValue(new Error('token exchange failed'));
      jest.spyOn(console, 'error').mockImplementation(() => undefined);
      const res = fakeResponse();

      await controller.tiktokCallback('the-code', 'signed-state', undefined, res);

      expect(res.redirect).toHaveBeenCalledWith(
        'http://localhost:3000/accounts?error=connect_failed',
      );
    });

    it('redirects with the error code when TikTok reports one (e.g. user denied consent)', async () => {
      const res = fakeResponse();

      await controller.tiktokCallback(undefined, undefined, 'access_denied', res);

      expect(res.redirect).toHaveBeenCalledWith(
        'http://localhost:3000/accounts?error=access_denied',
      );
      expect(jwt.verify).not.toHaveBeenCalled();
    });
  });

  describe('connectInstagram', () => {
    it('signs a short-lived state JWT and redirects to the built authorize URL', () => {
      jwt.sign.mockReturnValue('signed-state');
      instagram.buildAuthorizeUrl.mockReturnValue(
        'https://www.facebook.com/v21.0/dialog/oauth?...',
      );
      const res = fakeResponse();

      controller.connectInstagram(user, res);

      expect(jwt.sign).toHaveBeenCalledWith({ sub: 'user-1' }, { expiresIn: '10m' });
      expect(instagram.buildAuthorizeUrl).toHaveBeenCalledWith('signed-state');
      expect(res.redirect).toHaveBeenCalledWith('https://www.facebook.com/v21.0/dialog/oauth?...');
    });

    it('translates OAuthNotConfiguredError into a 503 rather than crashing', () => {
      jwt.sign.mockReturnValue('signed-state');
      instagram.buildAuthorizeUrl.mockImplementation(() => {
        throw new OAuthNotConfiguredError();
      });
      const res = fakeResponse();

      expect(() => controller.connectInstagram(user, res)).toThrow(ServiceUnavailableException);
    });
  });

  describe('instagramCallback', () => {
    it('exchanges the code, fetches account info, connects the account, and redirects on success', async () => {
      jwt.verify.mockReturnValue({ sub: 'user-1' });
      instagram.exchangeCode.mockResolvedValue({ accessToken: 'long-lived-user-token' });
      instagram.fetchAccountInfo.mockResolvedValue({
        igUserId: 'ig-user-1',
        username: 'my_reels',
        pageAccessToken: 'page-token',
      });
      const res = fakeResponse();

      await controller.instagramCallback('the-code', 'signed-state', undefined, res);

      expect(instagram.exchangeCode).toHaveBeenCalledWith('the-code');
      expect(instagram.fetchAccountInfo).toHaveBeenCalledWith('long-lived-user-token');
      expect(socialAccounts.connectInstagram).toHaveBeenCalledWith(
        'user-1',
        { accessToken: 'long-lived-user-token' },
        { igUserId: 'ig-user-1', username: 'my_reels', pageAccessToken: 'page-token' },
      );
      expect(res.redirect).toHaveBeenCalledWith(
        'http://localhost:3000/accounts?connected=instagram',
      );
    });

    it('redirects with connect_failed rather than throwing when the exchange/upsert fails', async () => {
      jwt.verify.mockReturnValue({ sub: 'user-1' });
      instagram.exchangeCode.mockRejectedValue(new Error('token exchange failed'));
      jest.spyOn(console, 'error').mockImplementation(() => undefined);
      const res = fakeResponse();

      await controller.instagramCallback('the-code', 'signed-state', undefined, res);

      expect(res.redirect).toHaveBeenCalledWith(
        'http://localhost:3000/accounts?error=connect_failed',
      );
    });

    it('redirects with the error code when Meta reports one (e.g. user denied consent)', async () => {
      const res = fakeResponse();

      await controller.instagramCallback(undefined, undefined, 'access_denied', res);

      expect(res.redirect).toHaveBeenCalledWith(
        'http://localhost:3000/accounts?error=access_denied',
      );
      expect(jwt.verify).not.toHaveBeenCalled();
    });
  });
});
