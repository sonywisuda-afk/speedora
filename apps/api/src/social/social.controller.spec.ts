import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import {
  OAuthNotConfiguredError,
  type FacebookOAuthClient,
  type InstagramOAuthClient,
  type LinkedInOAuthClient,
  type PinterestOAuthClient,
  type ThreadsOAuthClient,
  type TikTokOAuthClient,
  type YouTubeOAuthClient,
} from '@speedora/social';
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
    connectFacebook: jest.Mock;
    connectThreads: jest.Mock;
    connectLinkedIn: jest.Mock;
    connectPinterest: jest.Mock;
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
  let facebook: {
    buildAuthorizeUrl: jest.Mock;
    exchangeCode: jest.Mock;
    fetchAccountInfo: jest.Mock;
  };
  let threads: {
    buildAuthorizeUrl: jest.Mock;
    exchangeCode: jest.Mock;
    fetchAccountInfo: jest.Mock;
  };
  let linkedin: {
    buildAuthorizeUrl: jest.Mock;
    exchangeCode: jest.Mock;
    fetchAccountInfo: jest.Mock;
  };
  let pinterest: {
    buildAuthorizeUrl: jest.Mock;
    exchangeCode: jest.Mock;
    fetchAccountInfo: jest.Mock;
  };
  let jwt: { sign: jest.Mock; verify: jest.Mock };
  const user = { id: 'user-1', email: 'a@example.com', role: 'CREATOR' as const };

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
      connectFacebook: jest.fn(),
      connectThreads: jest.fn(),
      connectLinkedIn: jest.fn(),
      connectPinterest: jest.fn(),
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
    facebook = {
      buildAuthorizeUrl: jest.fn(),
      exchangeCode: jest.fn(),
      fetchAccountInfo: jest.fn(),
    };
    threads = {
      buildAuthorizeUrl: jest.fn(),
      exchangeCode: jest.fn(),
      fetchAccountInfo: jest.fn(),
    };
    linkedin = {
      buildAuthorizeUrl: jest.fn(),
      exchangeCode: jest.fn(),
      fetchAccountInfo: jest.fn(),
    };
    pinterest = {
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
      facebook as unknown as FacebookOAuthClient,
      threads as unknown as ThreadsOAuthClient,
      linkedin as unknown as LinkedInOAuthClient,
      pinterest as unknown as PinterestOAuthClient,
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

      controller.connect(user, 'youtube', res);

      expect(jwt.sign).toHaveBeenCalledWith({ sub: 'user-1' }, { expiresIn: '10m' });
      expect(youtube.buildAuthorizeUrl).toHaveBeenCalledWith('signed-state');
      expect(res.redirect).toHaveBeenCalledWith('https://accounts.google.com/authorize?...');
    });

    it('is case-insensitive on the :platform param', () => {
      jwt.sign.mockReturnValue('signed-state');
      tiktok.buildAuthorizeUrl.mockReturnValue('https://www.tiktok.com/v2/auth/authorize/?...');
      const res = fakeResponse();

      controller.connect(user, 'TikTok', res);

      expect(tiktok.buildAuthorizeUrl).toHaveBeenCalledWith('signed-state');
    });

    it('throws NotFoundException for an unknown platform', () => {
      const res = fakeResponse();

      expect(() => controller.connect(user, 'snapchat', res)).toThrow(NotFoundException);
      expect(jwt.sign).not.toHaveBeenCalled();
    });

    it('translates OAuthNotConfiguredError into a 503 rather than crashing', () => {
      jwt.sign.mockReturnValue('signed-state');
      youtube.buildAuthorizeUrl.mockImplementation(() => {
        throw new OAuthNotConfiguredError();
      });
      const res = fakeResponse();

      expect(() => controller.connect(user, 'youtube', res)).toThrow(ServiceUnavailableException);
    });
  });

  describe('callback', () => {
    it('redirects with unknown_platform for an unrecognized :platform', async () => {
      const res = fakeResponse();

      await controller.callback('snapchat', 'the-code', 'signed-state', undefined, res);

      expect(res.redirect).toHaveBeenCalledWith(
        'http://localhost:3000/social?error=unknown_platform',
      );
      expect(jwt.verify).not.toHaveBeenCalled();
    });

    it('redirects with the error code when the platform reports one (e.g. user denied consent)', async () => {
      const res = fakeResponse();

      await controller.callback('youtube', undefined, undefined, 'access_denied', res);

      expect(res.redirect).toHaveBeenCalledWith('http://localhost:3000/social?error=access_denied');
      expect(jwt.verify).not.toHaveBeenCalled();
    });

    it('redirects with missing_code when there is no code and no explicit error', async () => {
      const res = fakeResponse();

      await controller.callback('youtube', undefined, 'some-state', undefined, res);

      expect(res.redirect).toHaveBeenCalledWith('http://localhost:3000/social?error=missing_code');
    });

    it('redirects with invalid_state when the state JWT fails to verify', async () => {
      jwt.verify.mockImplementation(() => {
        throw new Error('jwt expired');
      });
      const res = fakeResponse();

      await controller.callback('youtube', 'the-code', 'bad-state', undefined, res);

      expect(res.redirect).toHaveBeenCalledWith('http://localhost:3000/social?error=invalid_state');
      expect(youtube.exchangeCode).not.toHaveBeenCalled();
    });

    it('exchanges the code, fetches the channel, connects the account, and redirects on success (YouTube)', async () => {
      jwt.verify.mockReturnValue({ sub: 'user-1' });
      youtube.exchangeCode.mockResolvedValue({ accessToken: 'access-1' });
      youtube.fetchChannelInfo.mockResolvedValue({ channelId: 'channel-1', title: 'My Channel' });
      const res = fakeResponse();

      await controller.callback('youtube', 'the-code', 'signed-state', undefined, res);

      expect(youtube.exchangeCode).toHaveBeenCalledWith('the-code');
      expect(youtube.fetchChannelInfo).toHaveBeenCalledWith('access-1');
      expect(socialAccounts.connectYouTube).toHaveBeenCalledWith(
        'user-1',
        { accessToken: 'access-1' },
        { channelId: 'channel-1', title: 'My Channel' },
      );
      expect(res.redirect).toHaveBeenCalledWith('http://localhost:3000/social?connected=youtube');
    });

    it('exchanges the code, fetches user info, connects the account, and redirects on success (TikTok)', async () => {
      jwt.verify.mockReturnValue({ sub: 'user-1' });
      tiktok.exchangeCode.mockResolvedValue({ accessToken: 'access-1' });
      tiktok.fetchUserInfo.mockResolvedValue({ openId: 'open-1', displayName: 'My TikTok' });
      const res = fakeResponse();

      await controller.callback('tiktok', 'the-code', 'signed-state', undefined, res);

      expect(tiktok.exchangeCode).toHaveBeenCalledWith('the-code');
      expect(tiktok.fetchUserInfo).toHaveBeenCalledWith('access-1');
      expect(socialAccounts.connectTikTok).toHaveBeenCalledWith(
        'user-1',
        { accessToken: 'access-1' },
        { openId: 'open-1', displayName: 'My TikTok' },
      );
      expect(res.redirect).toHaveBeenCalledWith('http://localhost:3000/social?connected=tiktok');
    });

    it('exchanges the code, fetches account info, connects the account, and redirects on success (Instagram)', async () => {
      jwt.verify.mockReturnValue({ sub: 'user-1' });
      instagram.exchangeCode.mockResolvedValue({ accessToken: 'long-lived-user-token' });
      instagram.fetchAccountInfo.mockResolvedValue({
        igUserId: 'ig-user-1',
        username: 'my_reels',
        pageAccessToken: 'page-token',
      });
      const res = fakeResponse();

      await controller.callback('instagram', 'the-code', 'signed-state', undefined, res);

      expect(instagram.exchangeCode).toHaveBeenCalledWith('the-code');
      expect(instagram.fetchAccountInfo).toHaveBeenCalledWith('long-lived-user-token');
      expect(socialAccounts.connectInstagram).toHaveBeenCalledWith(
        'user-1',
        { accessToken: 'long-lived-user-token' },
        { igUserId: 'ig-user-1', username: 'my_reels', pageAccessToken: 'page-token' },
      );
      expect(res.redirect).toHaveBeenCalledWith('http://localhost:3000/social?connected=instagram');
    });

    it('redirects with connect_failed rather than throwing when the exchange/upsert fails', async () => {
      jwt.verify.mockReturnValue({ sub: 'user-1' });
      youtube.exchangeCode.mockRejectedValue(new Error('token exchange failed'));
      jest.spyOn(console, 'error').mockImplementation(() => undefined);
      const res = fakeResponse();

      await controller.callback('youtube', 'the-code', 'signed-state', undefined, res);

      expect(res.redirect).toHaveBeenCalledWith(
        'http://localhost:3000/social?error=connect_failed',
      );
    });

    it('exchanges the code, fetches the Page, connects the account, and redirects on success (Facebook)', async () => {
      jwt.verify.mockReturnValue({ sub: 'user-1' });
      facebook.exchangeCode.mockResolvedValue({ accessToken: 'long-lived-user-token' });
      facebook.fetchAccountInfo.mockResolvedValue({
        pageId: 'page-1',
        pageName: 'My Page',
        pageAccessToken: 'page-token',
      });
      const res = fakeResponse();

      await controller.callback('facebook', 'the-code', 'signed-state', undefined, res);

      expect(facebook.exchangeCode).toHaveBeenCalledWith('the-code');
      expect(facebook.fetchAccountInfo).toHaveBeenCalledWith('long-lived-user-token');
      expect(socialAccounts.connectFacebook).toHaveBeenCalledWith(
        'user-1',
        { accessToken: 'long-lived-user-token' },
        { pageId: 'page-1', pageName: 'My Page', pageAccessToken: 'page-token' },
      );
      expect(res.redirect).toHaveBeenCalledWith('http://localhost:3000/social?connected=facebook');
    });

    it('exchanges the code, fetches the profile, connects the account, and redirects on success (Threads)', async () => {
      jwt.verify.mockReturnValue({ sub: 'user-1' });
      threads.exchangeCode.mockResolvedValue({ accessToken: 'long-lived-token' });
      threads.fetchAccountInfo.mockResolvedValue({
        threadsUserId: 'threads-user-1',
        username: 'my_threads',
      });
      const res = fakeResponse();

      await controller.callback('threads', 'the-code', 'signed-state', undefined, res);

      expect(threads.exchangeCode).toHaveBeenCalledWith('the-code');
      expect(threads.fetchAccountInfo).toHaveBeenCalledWith('long-lived-token');
      expect(socialAccounts.connectThreads).toHaveBeenCalledWith(
        'user-1',
        { accessToken: 'long-lived-token' },
        { threadsUserId: 'threads-user-1', username: 'my_threads' },
      );
      expect(res.redirect).toHaveBeenCalledWith('http://localhost:3000/social?connected=threads');
    });

    it('exchanges the code, fetches the member, connects the account, and redirects on success (LinkedIn)', async () => {
      jwt.verify.mockReturnValue({ sub: 'user-1' });
      linkedin.exchangeCode.mockResolvedValue({ accessToken: 'access-1', refreshToken: null });
      linkedin.fetchAccountInfo.mockResolvedValue({
        personUrn: 'urn:li:person:abc123',
        name: 'Jane Doe',
      });
      const res = fakeResponse();

      await controller.callback('linkedin', 'the-code', 'signed-state', undefined, res);

      expect(linkedin.exchangeCode).toHaveBeenCalledWith('the-code');
      expect(linkedin.fetchAccountInfo).toHaveBeenCalledWith('access-1');
      expect(socialAccounts.connectLinkedIn).toHaveBeenCalledWith(
        'user-1',
        { accessToken: 'access-1', refreshToken: null },
        { personUrn: 'urn:li:person:abc123', name: 'Jane Doe' },
      );
      expect(res.redirect).toHaveBeenCalledWith('http://localhost:3000/social?connected=linkedin');
    });

    it('exchanges the code, fetches the board, connects the account, and redirects on success (Pinterest)', async () => {
      jwt.verify.mockReturnValue({ sub: 'user-1' });
      pinterest.exchangeCode.mockResolvedValue({
        accessToken: 'access-1',
        refreshToken: 'refresh-1',
      });
      pinterest.fetchAccountInfo.mockResolvedValue({
        boardId: 'board-1',
        displayName: 'my_pins — My Board',
      });
      const res = fakeResponse();

      await controller.callback('pinterest', 'the-code', 'signed-state', undefined, res);

      expect(pinterest.exchangeCode).toHaveBeenCalledWith('the-code');
      expect(pinterest.fetchAccountInfo).toHaveBeenCalledWith('access-1');
      expect(socialAccounts.connectPinterest).toHaveBeenCalledWith(
        'user-1',
        { accessToken: 'access-1', refreshToken: 'refresh-1' },
        { boardId: 'board-1', displayName: 'my_pins — My Board' },
      );
      expect(res.redirect).toHaveBeenCalledWith('http://localhost:3000/social?connected=pinterest');
    });
  });
});
