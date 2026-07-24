import { getObjectStream } from '@speedora/storage';
import type { Response } from 'express';
import type { BrandKitService } from './brand-kit.service';
import { BrandKitController } from './brand-kit.controller';
import type { StorageService } from '../storage/storage.service';

jest.mock('@speedora/storage', () => ({ getObjectStream: jest.fn() }));

describe('BrandKitController', () => {
  let controller: BrandKitController;
  let brandKit: {
    get: jest.Mock;
    update: jest.Mock;
    saveLogo: jest.Mock;
    findLogoKeyOrThrow: jest.Mock;
    saveWatermark: jest.Mock;
    findWatermarkKeyOrThrow: jest.Mock;
    removeWatermark: jest.Mock;
  };
  let storage: { saveBrandLogo: jest.Mock; saveBrandWatermark: jest.Mock };
  const user = { id: 'user-1', email: 'a@example.com', role: 'CREATOR' as const };

  beforeEach(() => {
    brandKit = {
      get: jest.fn(),
      update: jest.fn(),
      saveLogo: jest.fn(),
      findLogoKeyOrThrow: jest.fn(),
      saveWatermark: jest.fn(),
      findWatermarkKeyOrThrow: jest.fn(),
      removeWatermark: jest.fn(),
    };
    storage = { saveBrandLogo: jest.fn(), saveBrandWatermark: jest.fn() };
    controller = new BrandKitController(
      brandKit as unknown as BrandKitService,
      storage as unknown as StorageService,
    );
    jest.clearAllMocks();
  });

  describe('get', () => {
    it('delegates to the service', async () => {
      brandKit.get.mockResolvedValue({ logoUrl: null, primaryColor: null, secondaryColor: null });

      const result = await controller.get(user);

      expect(brandKit.get).toHaveBeenCalledWith('user-1');
      expect(result).toEqual({ logoUrl: null, primaryColor: null, secondaryColor: null });
    });
  });

  describe('update', () => {
    it('forwards the requester id and DTO', async () => {
      brandKit.update.mockResolvedValue({
        logoUrl: null,
        primaryColor: '#1D4ED8',
        secondaryColor: null,
      });

      await controller.update(user, { primaryColor: '#1D4ED8' });

      expect(brandKit.update).toHaveBeenCalledWith('user-1', { primaryColor: '#1D4ED8' });
    });
  });

  describe('uploadLogo', () => {
    it('saves the file to storage then records the key on the brand kit', async () => {
      storage.saveBrandLogo.mockResolvedValue('brand-logos/abc.png');
      brandKit.saveLogo.mockResolvedValue({
        logoUrl: '/brand-kit/logo',
        primaryColor: null,
        secondaryColor: null,
      });
      const file = {
        buffer: Buffer.from('x'),
        originalname: 'logo.png',
        mimetype: 'image/png',
      } as Express.Multer.File;

      const result = await controller.uploadLogo(user, file);

      expect(storage.saveBrandLogo).toHaveBeenCalledWith(file);
      expect(brandKit.saveLogo).toHaveBeenCalledWith('user-1', 'brand-logos/abc.png');
      expect(result.logoUrl).toBe('/brand-kit/logo');
    });
  });

  describe('downloadLogo', () => {
    it('streams the logo with a content type derived from its extension', async () => {
      brandKit.findLogoKeyOrThrow.mockResolvedValue({ logoKey: 'brand-logos/abc.png' });
      const fakeStream = { pipe: jest.fn() };
      (getObjectStream as jest.Mock).mockResolvedValue(fakeStream);
      const res = { setHeader: jest.fn() } as unknown as Response;

      await controller.downloadLogo(user, res);

      expect(getObjectStream).toHaveBeenCalledWith('brand-logos/abc.png');
      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'image/png');
      expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, max-age=86400');
      expect(fakeStream.pipe).toHaveBeenCalledWith(res);
    });

    it('derives image/jpeg for a .jpg key', async () => {
      brandKit.findLogoKeyOrThrow.mockResolvedValue({ logoKey: 'brand-logos/abc.jpg' });
      (getObjectStream as jest.Mock).mockResolvedValue({ pipe: jest.fn() });
      const res = { setHeader: jest.fn() } as unknown as Response;

      await controller.downloadLogo(user, res);

      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'image/jpeg');
    });

    it('404s without touching storage when no logo has been uploaded yet', async () => {
      brandKit.findLogoKeyOrThrow.mockResolvedValue({ logoKey: null });
      const res = { setHeader: jest.fn() } as unknown as Response;

      await expect(controller.downloadLogo(user, res)).rejects.toThrow(
        'No brand logo has been uploaded yet',
      );
      expect(getObjectStream).not.toHaveBeenCalled();
    });
  });

  describe('uploadWatermark', () => {
    it('saves the file to storage then records the key on the brand kit', async () => {
      storage.saveBrandWatermark.mockResolvedValue('watermarks/abc.png');
      brandKit.saveWatermark.mockResolvedValue({ watermarkUrl: '/brand-kit/watermark' });
      const file = {
        buffer: Buffer.from('x'),
        originalname: 'watermark.svg',
        mimetype: 'image/svg+xml',
      } as Express.Multer.File;

      const result = await controller.uploadWatermark(user, file);

      expect(storage.saveBrandWatermark).toHaveBeenCalledWith(file);
      expect(brandKit.saveWatermark).toHaveBeenCalledWith('user-1', 'watermarks/abc.png');
      expect(result.watermarkUrl).toBe('/brand-kit/watermark');
    });
  });

  describe('downloadWatermark', () => {
    it('streams the watermark with a content type derived from its extension', async () => {
      brandKit.findWatermarkKeyOrThrow.mockResolvedValue({ watermarkKey: 'watermarks/abc.png' });
      const fakeStream = { pipe: jest.fn() };
      (getObjectStream as jest.Mock).mockResolvedValue(fakeStream);
      const res = { setHeader: jest.fn() } as unknown as Response;

      await controller.downloadWatermark(user, res);

      expect(getObjectStream).toHaveBeenCalledWith('watermarks/abc.png');
      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'image/png');
      expect(fakeStream.pipe).toHaveBeenCalledWith(res);
    });

    it('404s without touching storage when no watermark has been uploaded yet', async () => {
      brandKit.findWatermarkKeyOrThrow.mockResolvedValue({ watermarkKey: null });
      const res = { setHeader: jest.fn() } as unknown as Response;

      await expect(controller.downloadWatermark(user, res)).rejects.toThrow(
        'No brand watermark has been uploaded yet',
      );
      expect(getObjectStream).not.toHaveBeenCalled();
    });
  });

  describe('removeWatermark', () => {
    it('delegates to the service', async () => {
      await controller.removeWatermark(user);

      expect(brandKit.removeWatermark).toHaveBeenCalledWith('user-1');
    });
  });
});
