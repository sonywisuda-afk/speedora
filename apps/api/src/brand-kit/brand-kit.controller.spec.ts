import { WorkspaceRole } from '@speedora/database';
import { getObjectStream } from '@speedora/storage';
import type { Response } from 'express';
import type { BrandKitTarget } from './brand-kit.service';
import type { BrandKitService } from './brand-kit.service';
import { BrandKitController } from './brand-kit.controller';
import type { StorageService } from '../storage/storage.service';

jest.mock('@speedora/storage', () => ({ getObjectStream: jest.fn() }));

const USER_TARGET: BrandKitTarget = { kind: 'user', id: 'user-1' };
const WORKSPACE_TARGET: BrandKitTarget = { kind: 'workspace', id: 'workspace-1' };

describe('BrandKitController', () => {
  let controller: BrandKitController;
  let brandKit: {
    resolveTarget: jest.Mock;
    get: jest.Mock;
    update: jest.Mock;
    saveLogo: jest.Mock;
    findLogoKeyOrThrow: jest.Mock;
    saveWatermark: jest.Mock;
    findWatermarkKeyOrThrow: jest.Mock;
    removeWatermark: jest.Mock;
    saveIntro: jest.Mock;
    findIntroKeyOrThrow: jest.Mock;
    removeIntro: jest.Mock;
    saveOutro: jest.Mock;
    findOutroKeyOrThrow: jest.Mock;
    removeOutro: jest.Mock;
    createTemplate: jest.Mock;
    listTemplates: jest.Mock;
    renameTemplate: jest.Mock;
    deleteTemplate: jest.Mock;
    applyTemplate: jest.Mock;
  };
  let storage: {
    saveBrandLogo: jest.Mock;
    saveBrandWatermark: jest.Mock;
    saveBrandIntro: jest.Mock;
    saveBrandOutro: jest.Mock;
  };
  const user = {
    id: 'user-1',
    email: 'a@example.com',
    role: 'CREATOR' as const,
    emailVerified: true,
  };

  beforeEach(() => {
    brandKit = {
      resolveTarget: jest.fn().mockResolvedValue(USER_TARGET),
      get: jest.fn(),
      update: jest.fn(),
      saveLogo: jest.fn(),
      findLogoKeyOrThrow: jest.fn(),
      saveWatermark: jest.fn(),
      findWatermarkKeyOrThrow: jest.fn(),
      removeWatermark: jest.fn(),
      saveIntro: jest.fn(),
      findIntroKeyOrThrow: jest.fn(),
      removeIntro: jest.fn(),
      saveOutro: jest.fn(),
      findOutroKeyOrThrow: jest.fn(),
      removeOutro: jest.fn(),
      createTemplate: jest.fn(),
      listTemplates: jest.fn(),
      renameTemplate: jest.fn(),
      deleteTemplate: jest.fn(),
      applyTemplate: jest.fn(),
    };
    storage = {
      saveBrandLogo: jest.fn(),
      saveBrandWatermark: jest.fn(),
      saveBrandIntro: jest.fn(),
      saveBrandOutro: jest.fn(),
    };
    controller = new BrandKitController(
      brandKit as unknown as BrandKitService,
      storage as unknown as StorageService,
    );
    jest.clearAllMocks();
    brandKit.resolveTarget.mockResolvedValue(USER_TARGET);
  });

  describe('get', () => {
    it("resolves the target (no workspaceId -> VIEWER on the user's own row) and delegates", async () => {
      brandKit.get.mockResolvedValue({ logoUrl: null, primaryColor: null, secondaryColor: null });

      const result = await controller.get(user);

      expect(brandKit.resolveTarget).toHaveBeenCalledWith(
        'user-1',
        undefined,
        WorkspaceRole.VIEWER,
      );
      expect(brandKit.get).toHaveBeenCalledWith(USER_TARGET);
      expect(result).toEqual({ logoUrl: null, primaryColor: null, secondaryColor: null });
    });

    it('forwards an explicit workspaceId to resolveTarget', async () => {
      brandKit.resolveTarget.mockResolvedValue(WORKSPACE_TARGET);
      brandKit.get.mockResolvedValue({
        logoUrl: null,
        primaryColor: '#00AACC',
        secondaryColor: null,
      });

      await controller.get(user, 'workspace-1');

      expect(brandKit.resolveTarget).toHaveBeenCalledWith(
        'user-1',
        'workspace-1',
        WorkspaceRole.VIEWER,
      );
      expect(brandKit.get).toHaveBeenCalledWith(WORKSPACE_TARGET);
    });
  });

  describe('update', () => {
    it('resolves EDITOR+ and forwards the target and DTO', async () => {
      brandKit.update.mockResolvedValue({
        logoUrl: null,
        primaryColor: '#1D4ED8',
        secondaryColor: null,
      });

      await controller.update(user, { primaryColor: '#1D4ED8' });

      expect(brandKit.resolveTarget).toHaveBeenCalledWith(
        'user-1',
        undefined,
        WorkspaceRole.EDITOR,
      );
      expect(brandKit.update).toHaveBeenCalledWith(USER_TARGET, { primaryColor: '#1D4ED8' });
    });
  });

  describe('uploadLogo', () => {
    it('saves the file to storage then records the key on the resolved target', async () => {
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
      expect(brandKit.saveLogo).toHaveBeenCalledWith(USER_TARGET, 'brand-logos/abc.png');
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

      expect(brandKit.findLogoKeyOrThrow).toHaveBeenCalledWith(USER_TARGET);
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
    it('saves the file to storage then records the key on the resolved target', async () => {
      storage.saveBrandWatermark.mockResolvedValue('watermarks/abc.png');
      brandKit.saveWatermark.mockResolvedValue({ watermarkUrl: '/brand-kit/watermark' });
      const file = {
        buffer: Buffer.from('x'),
        originalname: 'watermark.svg',
        mimetype: 'image/svg+xml',
      } as Express.Multer.File;

      const result = await controller.uploadWatermark(user, file);

      expect(storage.saveBrandWatermark).toHaveBeenCalledWith(file);
      expect(brandKit.saveWatermark).toHaveBeenCalledWith(USER_TARGET, 'watermarks/abc.png');
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
    it('resolves EDITOR+ and delegates to the service', async () => {
      await controller.removeWatermark(user);

      expect(brandKit.resolveTarget).toHaveBeenCalledWith(
        'user-1',
        undefined,
        WorkspaceRole.EDITOR,
      );
      expect(brandKit.removeWatermark).toHaveBeenCalledWith(USER_TARGET);
    });
  });

  describe('uploadIntro', () => {
    it('derives introType "video" from a video mimetype and saves the file', async () => {
      storage.saveBrandIntro.mockResolvedValue('intros/abc.mp4');
      brandKit.saveIntro.mockResolvedValue({ introUrl: '/brand-kit/intro', introType: 'video' });
      const file = {
        buffer: Buffer.from('x'),
        originalname: 'intro.mp4',
        mimetype: 'video/mp4',
      } as Express.Multer.File;

      const result = await controller.uploadIntro(user, file);

      expect(storage.saveBrandIntro).toHaveBeenCalledWith(file);
      expect(brandKit.saveIntro).toHaveBeenCalledWith(USER_TARGET, 'intros/abc.mp4', 'video');
      expect(result.introUrl).toBe('/brand-kit/intro');
    });

    it('derives introType "image" from an image mimetype', async () => {
      storage.saveBrandIntro.mockResolvedValue('intros/abc.png');
      brandKit.saveIntro.mockResolvedValue({ introUrl: '/brand-kit/intro', introType: 'image' });
      const file = {
        buffer: Buffer.from('x'),
        originalname: 'intro.png',
        mimetype: 'image/png',
      } as Express.Multer.File;

      await controller.uploadIntro(user, file);

      expect(brandKit.saveIntro).toHaveBeenCalledWith(USER_TARGET, 'intros/abc.png', 'image');
    });
  });

  describe('downloadIntro', () => {
    it('streams a video intro with a video content type derived from its extension', async () => {
      brandKit.findIntroKeyOrThrow.mockResolvedValue({ introKey: 'intros/abc.mp4' });
      const fakeStream = { pipe: jest.fn() };
      (getObjectStream as jest.Mock).mockResolvedValue(fakeStream);
      const res = { setHeader: jest.fn() } as unknown as Response;

      await controller.downloadIntro(user, res);

      expect(getObjectStream).toHaveBeenCalledWith('intros/abc.mp4');
      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'video/mp4');
      expect(fakeStream.pipe).toHaveBeenCalledWith(res);
    });

    it('streams an image intro with an image content type', async () => {
      brandKit.findIntroKeyOrThrow.mockResolvedValue({ introKey: 'intros/abc.png' });
      (getObjectStream as jest.Mock).mockResolvedValue({ pipe: jest.fn() });
      const res = { setHeader: jest.fn() } as unknown as Response;

      await controller.downloadIntro(user, res);

      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'image/png');
    });

    it('404s without touching storage when no intro has been uploaded yet', async () => {
      brandKit.findIntroKeyOrThrow.mockResolvedValue({ introKey: null });
      const res = { setHeader: jest.fn() } as unknown as Response;

      await expect(controller.downloadIntro(user, res)).rejects.toThrow(
        'No brand intro has been uploaded yet',
      );
      expect(getObjectStream).not.toHaveBeenCalled();
    });
  });

  describe('removeIntro', () => {
    it('resolves EDITOR+ and delegates to the service', async () => {
      await controller.removeIntro(user);

      expect(brandKit.resolveTarget).toHaveBeenCalledWith(
        'user-1',
        undefined,
        WorkspaceRole.EDITOR,
      );
      expect(brandKit.removeIntro).toHaveBeenCalledWith(USER_TARGET);
    });
  });

  describe('uploadOutro', () => {
    it('derives outroType "video" from a video mimetype and saves the file', async () => {
      storage.saveBrandOutro.mockResolvedValue('outros/abc.mp4');
      brandKit.saveOutro.mockResolvedValue({ outroUrl: '/brand-kit/outro', outroType: 'video' });
      const file = {
        buffer: Buffer.from('x'),
        originalname: 'outro.mp4',
        mimetype: 'video/mp4',
      } as Express.Multer.File;

      const result = await controller.uploadOutro(user, file);

      expect(storage.saveBrandOutro).toHaveBeenCalledWith(file);
      expect(brandKit.saveOutro).toHaveBeenCalledWith(USER_TARGET, 'outros/abc.mp4', 'video');
      expect(result.outroUrl).toBe('/brand-kit/outro');
    });

    it('derives outroType "image" from an image mimetype', async () => {
      storage.saveBrandOutro.mockResolvedValue('outros/abc.png');
      brandKit.saveOutro.mockResolvedValue({ outroUrl: '/brand-kit/outro', outroType: 'image' });
      const file = {
        buffer: Buffer.from('x'),
        originalname: 'outro.png',
        mimetype: 'image/png',
      } as Express.Multer.File;

      await controller.uploadOutro(user, file);

      expect(brandKit.saveOutro).toHaveBeenCalledWith(USER_TARGET, 'outros/abc.png', 'image');
    });
  });

  describe('downloadOutro', () => {
    it('streams a video outro with a video content type derived from its extension', async () => {
      brandKit.findOutroKeyOrThrow.mockResolvedValue({ outroKey: 'outros/abc.mp4' });
      const fakeStream = { pipe: jest.fn() };
      (getObjectStream as jest.Mock).mockResolvedValue(fakeStream);
      const res = { setHeader: jest.fn() } as unknown as Response;

      await controller.downloadOutro(user, res);

      expect(getObjectStream).toHaveBeenCalledWith('outros/abc.mp4');
      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'video/mp4');
      expect(fakeStream.pipe).toHaveBeenCalledWith(res);
    });

    it('streams an image outro with an image content type', async () => {
      brandKit.findOutroKeyOrThrow.mockResolvedValue({ outroKey: 'outros/abc.png' });
      (getObjectStream as jest.Mock).mockResolvedValue({ pipe: jest.fn() });
      const res = { setHeader: jest.fn() } as unknown as Response;

      await controller.downloadOutro(user, res);

      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'image/png');
    });

    it('404s without touching storage when no outro has been uploaded yet', async () => {
      brandKit.findOutroKeyOrThrow.mockResolvedValue({ outroKey: null });
      const res = { setHeader: jest.fn() } as unknown as Response;

      await expect(controller.downloadOutro(user, res)).rejects.toThrow(
        'No brand outro has been uploaded yet',
      );
      expect(getObjectStream).not.toHaveBeenCalled();
    });
  });

  describe('removeOutro', () => {
    it('resolves EDITOR+ and delegates to the service', async () => {
      await controller.removeOutro(user);

      expect(brandKit.resolveTarget).toHaveBeenCalledWith(
        'user-1',
        undefined,
        WorkspaceRole.EDITOR,
      );
      expect(brandKit.removeOutro).toHaveBeenCalledWith(USER_TARGET);
    });
  });

  describe('createTemplate', () => {
    it('resolves VIEWER+ (read-only snapshot) and forwards the requester id, name, and target', async () => {
      brandKit.createTemplate.mockResolvedValue({ id: 'template-1', name: 'My Template' });

      const result = await controller.createTemplate(user, { name: 'My Template' });

      expect(brandKit.resolveTarget).toHaveBeenCalledWith(
        'user-1',
        undefined,
        WorkspaceRole.VIEWER,
      );
      expect(brandKit.createTemplate).toHaveBeenCalledWith('user-1', 'My Template', USER_TARGET);
      expect(result).toEqual({ id: 'template-1', name: 'My Template' });
    });
  });

  describe('listTemplates', () => {
    it('delegates to the service without any target resolution (templates are always userId-owned)', async () => {
      brandKit.listTemplates.mockResolvedValue({ templates: [] });

      const result = await controller.listTemplates(user);

      expect(brandKit.listTemplates).toHaveBeenCalledWith('user-1');
      expect(brandKit.resolveTarget).not.toHaveBeenCalled();
      expect(result).toEqual({ templates: [] });
    });
  });

  describe('renameTemplate', () => {
    it('forwards the requester id, template id, and new name', async () => {
      brandKit.renameTemplate.mockResolvedValue({ id: 'template-1', name: 'Renamed' });

      const result = await controller.renameTemplate(user, 'template-1', { name: 'Renamed' });

      expect(brandKit.renameTemplate).toHaveBeenCalledWith('user-1', 'template-1', 'Renamed');
      expect(result.name).toBe('Renamed');
    });
  });

  describe('deleteTemplate', () => {
    it('delegates to the service', async () => {
      await controller.deleteTemplate(user, 'template-1');

      expect(brandKit.deleteTemplate).toHaveBeenCalledWith('user-1', 'template-1');
    });
  });

  describe('applyTemplate', () => {
    it('resolves EDITOR+ (mutates the kit) and forwards the requester id, template id, and target', async () => {
      brandKit.applyTemplate.mockResolvedValue({ logoUrl: '/brand-kit/logo' });

      const result = await controller.applyTemplate(user, 'template-1');

      expect(brandKit.resolveTarget).toHaveBeenCalledWith(
        'user-1',
        undefined,
        WorkspaceRole.EDITOR,
      );
      expect(brandKit.applyTemplate).toHaveBeenCalledWith('user-1', 'template-1', USER_TARGET);
      expect(result.logoUrl).toBe('/brand-kit/logo');
    });
  });
});
