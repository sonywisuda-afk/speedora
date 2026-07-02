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
  let authService: { register: jest.Mock; validateUser: jest.Mock; issueToken: jest.Mock };

  beforeEach(() => {
    authService = {
      register: jest.fn(),
      validateUser: jest.fn(),
      issueToken: jest.fn().mockReturnValue('signed-token'),
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
});
