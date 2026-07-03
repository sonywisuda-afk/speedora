import { ServiceUnavailableException } from '@nestjs/common';
import { OAuthNotConfiguredError, type YouTubeOAuthClient } from '@viral-clip-app/social';
import type { Response } from 'express';
import { SocialController } from './social.controller';
import type { SocialAccountsService } from './social.service';

describe('SocialController', () => {
  let controller: SocialController;
  let socialAccounts: { listForUser: jest.Mock; disconnect: jest.Mock; connectYouTube: jest.Mock };
  let youtube: {
    buildAuthorizeUrl: jest.Mock;
    exchangeCode: jest.Mock;
    fetchChannelInfo: jest.Mock;
  };
  let jwt: { sign: jest.Mock; verify: jest.Mock };
  const user = { id: 'user-1', email: 'a@example.com' };

  function fakeResponse(): Response {
    return { redirect: jest.fn() } as unknown as Response;
  }

  beforeEach(() => {
    socialAccounts = { listForUser: jest.fn(), disconnect: jest.fn(), connectYouTube: jest.fn() };
    youtube = {
      buildAuthorizeUrl: jest.fn(),
      exchangeCode: jest.fn(),
      fetchChannelInfo: jest.fn(),
    };
    jwt = { sign: jest.fn(), verify: jest.fn() };
    controller = new SocialController(
      socialAccounts as unknown as SocialAccountsService,
      youtube as unknown as YouTubeOAuthClient,
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
});
