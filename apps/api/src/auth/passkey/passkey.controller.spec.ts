import type { Request } from 'express';
import type { AuthService } from '../auth.service';
import { PasskeyController } from './passkey.controller';
import type { PasskeyService } from './passkey.service';

const fakeUser = {
  id: 'user-1',
  email: 'a@example.com',
  role: 'CREATOR' as const,
  emailVerified: true,
};

function fakeRequest(): Request {
  return {
    headers: { 'user-agent': 'Mozilla/5.0 (Test)' },
    ip: '127.0.0.1',
  } as unknown as Request;
}

describe('PasskeyController', () => {
  let controller: PasskeyController;
  let passkeyService: {
    list: jest.Mock;
    generateRegistrationOptionsFor: jest.Mock;
    verifyAndSaveRegistration: jest.Mock;
    rename: jest.Mock;
    delete: jest.Mock;
  };
  let authService: { recordSecurityEvent: jest.Mock };

  beforeEach(() => {
    passkeyService = {
      list: jest.fn(),
      generateRegistrationOptionsFor: jest.fn(),
      verifyAndSaveRegistration: jest.fn(),
      rename: jest.fn(),
      delete: jest.fn(),
    };
    authService = { recordSecurityEvent: jest.fn().mockResolvedValue(undefined) };
    controller = new PasskeyController(
      passkeyService as unknown as PasskeyService,
      authService as unknown as AuthService,
    );
  });

  describe('list', () => {
    it('delegates to PasskeyService scoped to the current user', async () => {
      passkeyService.list.mockResolvedValue([{ id: 'p1' }]);

      const result = await controller.list(fakeUser);

      expect(passkeyService.list).toHaveBeenCalledWith('user-1');
      expect(result).toEqual([{ id: 'p1' }]);
    });
  });

  describe('registerOptions', () => {
    it('generates options scoped to the current user id/email', async () => {
      passkeyService.generateRegistrationOptionsFor.mockResolvedValue({
        options: { challenge: 'c' },
        challengeToken: 'tok',
      });

      await controller.registerOptions(fakeUser);

      expect(passkeyService.generateRegistrationOptionsFor).toHaveBeenCalledWith(
        'user-1',
        'a@example.com',
      );
    });
  });

  describe('registerVerify', () => {
    it('saves the credential and records a PASSKEY_ADDED security event', async () => {
      const passkey = { id: 'p1', deviceType: 'singleDevice' };
      passkeyService.verifyAndSaveRegistration.mockResolvedValue(passkey);
      const req = fakeRequest();

      const result = await controller.registerVerify(
        fakeUser,
        { response: {} as never, challengeToken: 'tok', name: 'My Passkey' },
        req,
      );

      expect(passkeyService.verifyAndSaveRegistration).toHaveBeenCalledWith(
        'user-1',
        {},
        'tok',
        'My Passkey',
      );
      expect(authService.recordSecurityEvent).toHaveBeenCalledWith({
        userId: 'user-1',
        email: 'a@example.com',
        eventType: 'PASSKEY_ADDED',
        ipAddress: '127.0.0.1',
        userAgent: 'Mozilla/5.0 (Test)',
        metadata: { passkeyId: 'p1', deviceType: 'singleDevice' },
      });
      expect(result).toBe(passkey);
    });

    it('does not record a security event when verification throws', async () => {
      passkeyService.verifyAndSaveRegistration.mockRejectedValue(new Error('boom'));

      await expect(
        controller.registerVerify(
          fakeUser,
          { response: {} as never, challengeToken: 'tok', name: 'My Passkey' },
          fakeRequest(),
        ),
      ).rejects.toThrow('boom');
      expect(authService.recordSecurityEvent).not.toHaveBeenCalled();
    });
  });

  describe('rename', () => {
    it('delegates to PasskeyService scoped to the current user', async () => {
      passkeyService.rename.mockResolvedValue({ id: 'p1', name: 'New name' });

      const result = await controller.rename(fakeUser, 'p1', { name: 'New name' });

      expect(passkeyService.rename).toHaveBeenCalledWith('user-1', 'p1', 'New name');
      expect(result).toEqual({ id: 'p1', name: 'New name' });
    });
  });

  describe('delete', () => {
    it('deletes and records a PASSKEY_REMOVED security event', async () => {
      const req = fakeRequest();

      await controller.delete(fakeUser, 'p1', req);

      expect(passkeyService.delete).toHaveBeenCalledWith('user-1', 'p1');
      expect(authService.recordSecurityEvent).toHaveBeenCalledWith({
        userId: 'user-1',
        email: 'a@example.com',
        eventType: 'PASSKEY_REMOVED',
        ipAddress: '127.0.0.1',
        userAgent: 'Mozilla/5.0 (Test)',
        metadata: { passkeyId: 'p1' },
      });
    });

    it('does not record a security event when deletion throws', async () => {
      passkeyService.delete.mockRejectedValue(new Error('not found'));

      await expect(controller.delete(fakeUser, 'p1', fakeRequest())).rejects.toThrow('not found');
      expect(authService.recordSecurityEvent).not.toHaveBeenCalled();
    });
  });
});
