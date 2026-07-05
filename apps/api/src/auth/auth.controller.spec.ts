import type { Response } from 'express';
import type { AuthService } from './auth.service';
import { AuthController } from './auth.controller';

function fakeResponse() {
  return {
    cookie: jest.fn(),
    clearCookie: jest.fn(),
  } as unknown as Response;
}

describe('AuthController', () => {
  let controller: AuthController;
  let authService: {
    register: jest.Mock;
    validateUser: jest.Mock;
    issueToken: jest.Mock;
    requestPasswordReset: jest.Mock;
    resetPassword: jest.Mock;
    changePassword: jest.Mock;
    deleteAccount: jest.Mock;
  };

  beforeEach(() => {
    authService = {
      register: jest.fn(),
      validateUser: jest.fn(),
      issueToken: jest.fn().mockReturnValue('signed-token'),
      requestPasswordReset: jest.fn(),
      resetPassword: jest.fn(),
      changePassword: jest.fn(),
      deleteAccount: jest.fn().mockResolvedValue(undefined),
    };
    controller = new AuthController(authService as unknown as AuthService);
  });

  describe('register', () => {
    it('registers the user and sets an httpOnly session cookie', async () => {
      const user = { id: 'user-1', email: 'a@example.com' };
      authService.register.mockResolvedValue(user);
      const res = fakeResponse();

      const result = await controller.register({ email: user.email, password: 'pw' }, res);

      expect(authService.register).toHaveBeenCalledWith('a@example.com', 'pw');
      expect(authService.issueToken).toHaveBeenCalledWith(user);
      expect(res.cookie).toHaveBeenCalledWith(
        'token',
        'signed-token',
        expect.objectContaining({ httpOnly: true, sameSite: 'lax', path: '/' }),
      );
      expect(result).toEqual(user);
    });
  });

  describe('login', () => {
    it('validates credentials and sets the session cookie', async () => {
      const user = { id: 'user-1', email: 'a@example.com' };
      authService.validateUser.mockResolvedValue(user);
      const res = fakeResponse();

      const result = await controller.login({ email: user.email, password: 'pw' }, res);

      expect(authService.validateUser).toHaveBeenCalledWith('a@example.com', 'pw');
      expect(res.cookie).toHaveBeenCalledWith('token', 'signed-token', expect.any(Object));
      expect(result).toEqual(user);
    });
  });

  describe('logout', () => {
    it('clears the session cookie', () => {
      const res = fakeResponse();

      const result = controller.logout(res);

      expect(res.clearCookie).toHaveBeenCalledWith('token');
      expect(result).toEqual({ success: true });
    });
  });

  describe('me', () => {
    it('returns the current user from the request', () => {
      const user = { id: 'user-1', email: 'a@example.com' };

      expect(controller.me(user)).toEqual(user);
    });
  });

  describe('deleteAccount', () => {
    it('deletes the account and clears the session cookie', async () => {
      const user = { id: 'user-1', email: 'a@example.com' };
      const res = fakeResponse();

      await controller.deleteAccount(user, res);

      expect(authService.deleteAccount).toHaveBeenCalledWith('user-1');
      expect(res.clearCookie).toHaveBeenCalledWith('token');
    });
  });

  describe('forgotPassword', () => {
    it('calls requestPasswordReset and returns a generic message', async () => {
      const result = await controller.forgotPassword({ email: 'a@example.com' });

      expect(authService.requestPasswordReset).toHaveBeenCalledWith(
        'a@example.com',
        expect.any(String),
      );
      expect(result).toEqual({
        message: 'If that email is registered, a reset link has been sent.',
      });
    });
  });

  describe('resetPassword', () => {
    it('resets the password and sets the session cookie', async () => {
      const user = { id: 'user-1', email: 'a@example.com' };
      authService.resetPassword.mockResolvedValue(user);
      const res = fakeResponse();

      const result = await controller.resetPassword(
        { token: 'raw-token', newPassword: 'newplaintext' },
        res,
      );

      expect(authService.resetPassword).toHaveBeenCalledWith('raw-token', 'newplaintext');
      expect(res.cookie).toHaveBeenCalledWith('token', 'signed-token', expect.any(Object));
      expect(result).toEqual(user);
    });
  });

  describe('changePassword', () => {
    it('calls changePassword with the current user id', async () => {
      const user = { id: 'user-1', email: 'a@example.com' };

      const result = await controller.changePassword(
        { currentPassword: 'currentplaintext', newPassword: 'newplaintext' },
        user,
      );

      expect(authService.changePassword).toHaveBeenCalledWith(
        'user-1',
        'currentplaintext',
        'newplaintext',
      );
      expect(result).toEqual({ success: true });
    });
  });
});
