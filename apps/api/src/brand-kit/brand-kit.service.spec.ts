import { WorkspaceRole } from '@speedora/database';
import type { PrismaService } from '../prisma/prisma.service';
import type { WorkspaceAccessService } from '../workspace/workspace-access.service';
import { BrandKitService, type BrandKitTarget } from './brand-kit.service';

const USER_TARGET: BrandKitTarget = { kind: 'user', id: 'user-1' };
const WORKSPACE_TARGET: BrandKitTarget = { kind: 'workspace', id: 'workspace-1' };

const BASE_ROW = {
  brandLogoUrl: null,
  brandPrimaryColor: null,
  brandSecondaryColor: null,
  brandFontFamily: null,
  brandWatermarkUrl: null,
  brandWatermarkOpacity: null,
  brandWatermarkScale: null,
  brandWatermarkMargin: null,
  brandWatermarkPosition: null,
  brandIntroUrl: null,
  brandIntroType: null,
  brandIntroImageDurationSeconds: null,
  brandOutroUrl: null,
  brandOutroType: null,
  brandOutroImageDurationSeconds: null,
};

const BASE_TEMPLATE_ROW = {
  id: 'template-1',
  userId: 'user-1',
  name: 'My Template',
  logoUrl: null,
  primaryColor: null,
  secondaryColor: null,
  fontFamily: null,
  watermarkUrl: null,
  watermarkOpacity: null,
  watermarkScale: null,
  watermarkMargin: null,
  watermarkPosition: null,
  introUrl: null,
  introType: null,
  introImageDurationSeconds: null,
  outroUrl: null,
  outroType: null,
  outroImageDurationSeconds: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

describe('BrandKitService', () => {
  let service: BrandKitService;
  let prisma: {
    user: { findUniqueOrThrow: jest.Mock; update: jest.Mock };
    workspace: { findUniqueOrThrow: jest.Mock; update: jest.Mock };
    brandKitTemplate: {
      create: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
  };
  let workspaceAccess: { assertMinRole: jest.Mock };

  beforeEach(() => {
    prisma = {
      user: { findUniqueOrThrow: jest.fn(), update: jest.fn() },
      workspace: { findUniqueOrThrow: jest.fn(), update: jest.fn() },
      brandKitTemplate: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };
    workspaceAccess = { assertMinRole: jest.fn() };
    service = new BrandKitService(
      prisma as unknown as PrismaService,
      workspaceAccess as unknown as WorkspaceAccessService,
    );
  });

  // Workspace-level Brand Kit roadmap (P3g).
  describe('resolveTarget', () => {
    it('resolves to the user target when no workspaceId is given', async () => {
      const target = await service.resolveTarget('user-1', undefined, WorkspaceRole.VIEWER);

      expect(target).toEqual(USER_TARGET);
      expect(workspaceAccess.assertMinRole).not.toHaveBeenCalled();
    });

    it('resolves to the user target when the given workspaceId is the personal workspace', async () => {
      prisma.workspace.findUniqueOrThrow.mockResolvedValue({ isPersonal: true });

      const target = await service.resolveTarget('user-1', 'personal-ws', WorkspaceRole.EDITOR);

      expect(workspaceAccess.assertMinRole).toHaveBeenCalledWith(
        'user-1',
        'personal-ws',
        WorkspaceRole.EDITOR,
      );
      expect(target).toEqual(USER_TARGET);
    });

    it('resolves to the workspace target for a non-personal workspace with sufficient role', async () => {
      prisma.workspace.findUniqueOrThrow.mockResolvedValue({ isPersonal: false });

      const target = await service.resolveTarget('user-1', 'workspace-1', WorkspaceRole.EDITOR);

      expect(target).toEqual(WORKSPACE_TARGET);
    });

    it('propagates the ForbiddenException/NotFoundException from assertMinRole for insufficient role', async () => {
      workspaceAccess.assertMinRole.mockRejectedValue(new Error('Forbidden'));

      await expect(
        service.resolveTarget('user-1', 'workspace-1', WorkspaceRole.EDITOR),
      ).rejects.toThrow('Forbidden');
      expect(prisma.workspace.findUniqueOrThrow).not.toHaveBeenCalled();
    });
  });

  describe('get', () => {
    it('exposes logoUrl/watermarkUrl as endpoint paths, never the raw keys', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue({
        ...BASE_ROW,
        brandLogoUrl: 'brand-logos/abc.png',
        brandPrimaryColor: '#1D4ED8',
        brandFontFamily: 'Poppins',
        brandWatermarkUrl: 'watermarks/abc.png',
        brandWatermarkOpacity: 0.8,
        brandWatermarkScale: 0.15,
        brandWatermarkMargin: 0.03,
        brandWatermarkPosition: 'BOTTOM_RIGHT',
        brandIntroUrl: 'intros/abc.mp4',
        brandIntroType: 'video',
        brandIntroImageDurationSeconds: null,
        brandOutroUrl: 'outros/abc.mp4',
        brandOutroType: 'video',
        brandOutroImageDurationSeconds: null,
      });

      const result = await service.get(USER_TARGET);

      expect(result).toEqual({
        logoUrl: '/brand-kit/logo',
        primaryColor: '#1D4ED8',
        secondaryColor: null,
        fontFamily: 'Poppins',
        watermarkUrl: '/brand-kit/watermark',
        watermarkOpacity: 0.8,
        watermarkScale: 0.15,
        watermarkMargin: 0.03,
        watermarkPosition: 'BOTTOM_RIGHT',
        introUrl: '/brand-kit/intro',
        introType: 'video',
        introImageDurationSeconds: null,
        outroUrl: '/brand-kit/outro',
        outroType: 'video',
        outroImageDurationSeconds: null,
      });
    });

    it('reports a null logoUrl/watermarkUrl/introUrl/outroUrl when none has been uploaded', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue(BASE_ROW);

      const result = await service.get(USER_TARGET);

      expect(result.logoUrl).toBeNull();
      expect(result.watermarkUrl).toBeNull();
      expect(result.introUrl).toBeNull();
      expect(result.introType).toBeNull();
      expect(result.outroUrl).toBeNull();
      expect(result.outroType).toBeNull();
    });

    it('reads from the Workspace row (not User) for a workspace target', async () => {
      prisma.workspace.findUniqueOrThrow.mockResolvedValue({
        ...BASE_ROW,
        brandPrimaryColor: '#00AACC',
      });

      const result = await service.get(WORKSPACE_TARGET);

      expect(prisma.workspace.findUniqueOrThrow).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'workspace-1' } }),
      );
      expect(prisma.user.findUniqueOrThrow).not.toHaveBeenCalled();
      expect(result.primaryColor).toBe('#00AACC');
    });
  });

  describe('update', () => {
    it('only updates the fields actually sent', async () => {
      prisma.user.update.mockResolvedValue({ ...BASE_ROW, brandPrimaryColor: '#FF0000' });

      await service.update(USER_TARGET, { primaryColor: '#FF0000' });

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { brandPrimaryColor: '#FF0000' },
        select: {
          brandLogoUrl: true,
          brandPrimaryColor: true,
          brandSecondaryColor: true,
          brandFontFamily: true,
          brandWatermarkUrl: true,
          brandWatermarkOpacity: true,
          brandWatermarkScale: true,
          brandWatermarkMargin: true,
          brandWatermarkPosition: true,
          brandIntroUrl: true,
          brandIntroType: true,
          brandIntroImageDurationSeconds: true,
          brandOutroUrl: true,
          brandOutroType: true,
          brandOutroImageDurationSeconds: true,
        },
      });
    });

    it('updates both colors when both are sent', async () => {
      prisma.user.update.mockResolvedValue({
        ...BASE_ROW,
        brandPrimaryColor: '#FF0000',
        brandSecondaryColor: '#00FF00',
      });

      await service.update(USER_TARGET, { primaryColor: '#FF0000', secondaryColor: '#00FF00' });

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { brandPrimaryColor: '#FF0000', brandSecondaryColor: '#00FF00' },
        }),
      );
    });

    it('updates fontFamily when sent, same "only fields actually sent" convention as the colors', async () => {
      prisma.user.update.mockResolvedValue({ ...BASE_ROW, brandFontFamily: 'Montserrat' });

      const result = await service.update(USER_TARGET, { fontFamily: 'Montserrat' });

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { brandFontFamily: 'Montserrat' } }),
      );
      expect(result.fontFamily).toBe('Montserrat');
    });

    it('updates every watermark control field when all are sent', async () => {
      prisma.user.update.mockResolvedValue({
        ...BASE_ROW,
        brandWatermarkOpacity: 0.5,
        brandWatermarkScale: 0.2,
        brandWatermarkMargin: 0.05,
        brandWatermarkPosition: 'TOP_LEFT',
      });

      const result = await service.update(USER_TARGET, {
        watermarkOpacity: 0.5,
        watermarkScale: 0.2,
        watermarkMargin: 0.05,
        watermarkPosition: 'TOP_LEFT',
      });

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            brandWatermarkOpacity: 0.5,
            brandWatermarkScale: 0.2,
            brandWatermarkMargin: 0.05,
            brandWatermarkPosition: 'TOP_LEFT',
          },
        }),
      );
      expect(result.watermarkOpacity).toBe(0.5);
      expect(result.watermarkPosition).toBe('TOP_LEFT');
    });

    it('updates introImageDurationSeconds when sent', async () => {
      prisma.user.update.mockResolvedValue({ ...BASE_ROW, brandIntroImageDurationSeconds: 5 });

      const result = await service.update(USER_TARGET, { introImageDurationSeconds: 5 });

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { brandIntroImageDurationSeconds: 5 } }),
      );
      expect(result.introImageDurationSeconds).toBe(5);
    });

    it('updates outroImageDurationSeconds when sent', async () => {
      prisma.user.update.mockResolvedValue({ ...BASE_ROW, brandOutroImageDurationSeconds: 4 });

      const result = await service.update(USER_TARGET, { outroImageDurationSeconds: 4 });

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { brandOutroImageDurationSeconds: 4 } }),
      );
      expect(result.outroImageDurationSeconds).toBe(4);
    });

    it('writes to the Workspace row (not User) for a workspace target', async () => {
      prisma.workspace.update.mockResolvedValue({ ...BASE_ROW, brandPrimaryColor: '#123456' });

      await service.update(WORKSPACE_TARGET, { primaryColor: '#123456' });

      expect(prisma.workspace.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'workspace-1' } }),
      );
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });

  describe('saveLogo', () => {
    it('stores the raw storage key and returns the endpoint-path DTO', async () => {
      prisma.user.update.mockResolvedValue({ ...BASE_ROW, brandLogoUrl: 'brand-logos/xyz.png' });

      const result = await service.saveLogo(USER_TARGET, 'brand-logos/xyz.png');

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { brandLogoUrl: 'brand-logos/xyz.png' } }),
      );
      expect(result.logoUrl).toBe('/brand-kit/logo');
    });
  });

  describe('findLogoKeyOrThrow', () => {
    it('returns the raw key without throwing when a logo exists', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue({
        ...BASE_ROW,
        brandLogoUrl: 'brand-logos/xyz.png',
      });

      expect(await service.findLogoKeyOrThrow(USER_TARGET)).toEqual({
        logoKey: 'brand-logos/xyz.png',
      });
    });

    it('returns a null logoKey (not a throw) when no logo has been uploaded', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue(BASE_ROW);

      expect(await service.findLogoKeyOrThrow(USER_TARGET)).toEqual({ logoKey: null });
    });
  });

  describe('saveWatermark', () => {
    it('stores the raw storage key and returns the endpoint-path DTO', async () => {
      prisma.user.update.mockResolvedValue({
        ...BASE_ROW,
        brandWatermarkUrl: 'watermarks/xyz.png',
      });

      const result = await service.saveWatermark(USER_TARGET, 'watermarks/xyz.png');

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { brandWatermarkUrl: 'watermarks/xyz.png' } }),
      );
      expect(result.watermarkUrl).toBe('/brand-kit/watermark');
    });
  });

  describe('findWatermarkKeyOrThrow', () => {
    it('returns the raw key without throwing when a watermark exists', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue({
        ...BASE_ROW,
        brandWatermarkUrl: 'watermarks/xyz.png',
      });

      expect(await service.findWatermarkKeyOrThrow(USER_TARGET)).toEqual({
        watermarkKey: 'watermarks/xyz.png',
      });
    });

    it('returns a null watermarkKey (not a throw) when no watermark has been uploaded', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue(BASE_ROW);

      expect(await service.findWatermarkKeyOrThrow(USER_TARGET)).toEqual({ watermarkKey: null });
    });
  });

  describe('removeWatermark', () => {
    it('clears the watermark key', async () => {
      prisma.user.update.mockResolvedValue(BASE_ROW);

      await service.removeWatermark(USER_TARGET);

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-1' },
          data: { brandWatermarkUrl: null },
        }),
      );
    });
  });

  describe('saveIntro', () => {
    it('stores the raw storage key and type together, returns the endpoint-path DTO', async () => {
      prisma.user.update.mockResolvedValue({
        ...BASE_ROW,
        brandIntroUrl: 'intros/xyz.mp4',
        brandIntroType: 'video',
      });

      const result = await service.saveIntro(USER_TARGET, 'intros/xyz.mp4', 'video');

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { brandIntroUrl: 'intros/xyz.mp4', brandIntroType: 'video' },
        }),
      );
      expect(result.introUrl).toBe('/brand-kit/intro');
      expect(result.introType).toBe('video');
    });
  });

  describe('findIntroKeyOrThrow', () => {
    it('returns the raw key without throwing when an intro exists', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue({
        ...BASE_ROW,
        brandIntroUrl: 'intros/xyz.mp4',
      });

      expect(await service.findIntroKeyOrThrow(USER_TARGET)).toEqual({
        introKey: 'intros/xyz.mp4',
      });
    });

    it('returns a null introKey (not a throw) when no intro has been uploaded', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue(BASE_ROW);

      expect(await service.findIntroKeyOrThrow(USER_TARGET)).toEqual({ introKey: null });
    });
  });

  describe('removeIntro', () => {
    it('clears both the intro key and type', async () => {
      prisma.user.update.mockResolvedValue(BASE_ROW);

      await service.removeIntro(USER_TARGET);

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-1' },
          data: { brandIntroUrl: null, brandIntroType: null },
        }),
      );
    });
  });

  describe('saveOutro', () => {
    it('stores the raw storage key and type together, returns the endpoint-path DTO', async () => {
      prisma.user.update.mockResolvedValue({
        ...BASE_ROW,
        brandOutroUrl: 'outros/xyz.mp4',
        brandOutroType: 'video',
      });

      const result = await service.saveOutro(USER_TARGET, 'outros/xyz.mp4', 'video');

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { brandOutroUrl: 'outros/xyz.mp4', brandOutroType: 'video' },
        }),
      );
      expect(result.outroUrl).toBe('/brand-kit/outro');
      expect(result.outroType).toBe('video');
    });
  });

  describe('findOutroKeyOrThrow', () => {
    it('returns the raw key without throwing when an outro exists', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue({
        ...BASE_ROW,
        brandOutroUrl: 'outros/xyz.mp4',
      });

      expect(await service.findOutroKeyOrThrow(USER_TARGET)).toEqual({
        outroKey: 'outros/xyz.mp4',
      });
    });

    it('returns a null outroKey (not a throw) when no outro has been uploaded', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue(BASE_ROW);

      expect(await service.findOutroKeyOrThrow(USER_TARGET)).toEqual({ outroKey: null });
    });
  });

  describe('removeOutro', () => {
    it('clears both the outro key and type', async () => {
      prisma.user.update.mockResolvedValue(BASE_ROW);

      await service.removeOutro(USER_TARGET);

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-1' },
          data: { brandOutroUrl: null, brandOutroType: null },
        }),
      );
    });
  });

  describe('createTemplate', () => {
    it('snapshots every current Brand Kit field into a new template row', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue({
        ...BASE_ROW,
        brandLogoUrl: 'brand-logos/abc.png',
        brandPrimaryColor: '#1D4ED8',
        brandFontFamily: 'Poppins',
        brandWatermarkUrl: 'watermarks/abc.png',
        brandWatermarkPosition: 'BOTTOM_RIGHT',
        brandIntroUrl: 'intros/abc.mp4',
        brandIntroType: 'video',
        brandOutroUrl: 'outros/abc.png',
        brandOutroType: 'image',
        brandOutroImageDurationSeconds: 3,
      });
      prisma.brandKitTemplate.create.mockResolvedValue({
        ...BASE_TEMPLATE_ROW,
        logoUrl: 'brand-logos/abc.png',
        primaryColor: '#1D4ED8',
        fontFamily: 'Poppins',
        watermarkUrl: 'watermarks/abc.png',
        watermarkPosition: 'BOTTOM_RIGHT',
        introUrl: 'intros/abc.mp4',
        introType: 'video',
        outroUrl: 'outros/abc.png',
        outroType: 'image',
        outroImageDurationSeconds: 3,
      });

      const result = await service.createTemplate('user-1', 'My Template', USER_TARGET);

      expect(prisma.brandKitTemplate.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          name: 'My Template',
          logoUrl: 'brand-logos/abc.png',
          primaryColor: '#1D4ED8',
          secondaryColor: null,
          fontFamily: 'Poppins',
          watermarkUrl: 'watermarks/abc.png',
          watermarkOpacity: null,
          watermarkScale: null,
          watermarkMargin: null,
          watermarkPosition: 'BOTTOM_RIGHT',
          introUrl: 'intros/abc.mp4',
          introType: 'video',
          introImageDurationSeconds: null,
          outroUrl: 'outros/abc.png',
          outroType: 'image',
          outroImageDurationSeconds: 3,
        },
      });
      expect(result).toEqual({
        id: 'template-1',
        name: 'My Template',
        primaryColor: '#1D4ED8',
        secondaryColor: null,
        fontFamily: 'Poppins',
        hasLogo: true,
        hasWatermark: true,
        watermarkPosition: 'BOTTOM_RIGHT',
        hasIntro: true,
        introType: 'video',
        hasOutro: true,
        outroType: 'image',
        createdAt: '2026-01-01T00:00:00.000Z',
      });
    });

    it('snapshots from the Workspace row when the target is a workspace', async () => {
      prisma.workspace.findUniqueOrThrow.mockResolvedValue({
        ...BASE_ROW,
        brandPrimaryColor: '#00AACC',
      });
      prisma.brandKitTemplate.create.mockResolvedValue({
        ...BASE_TEMPLATE_ROW,
        primaryColor: '#00AACC',
      });

      await service.createTemplate('user-1', 'Team Template', WORKSPACE_TARGET);

      expect(prisma.user.findUniqueOrThrow).not.toHaveBeenCalled();
      expect(prisma.brandKitTemplate.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ primaryColor: '#00AACC' }) }),
      );
    });
  });

  describe('listTemplates', () => {
    it("lists the user's templates, newest first, as summary DTOs", async () => {
      prisma.brandKitTemplate.findMany.mockResolvedValue([BASE_TEMPLATE_ROW]);

      const result = await service.listTemplates('user-1');

      expect(prisma.brandKitTemplate.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
      expect(result.templates).toEqual([
        expect.objectContaining({ id: 'template-1', name: 'My Template', hasLogo: false }),
      ]);
    });
  });

  describe('renameTemplate', () => {
    it('renames a template owned by the user', async () => {
      prisma.brandKitTemplate.findUnique.mockResolvedValue(BASE_TEMPLATE_ROW);
      prisma.brandKitTemplate.update.mockResolvedValue({
        ...BASE_TEMPLATE_ROW,
        name: 'Renamed',
      });

      const result = await service.renameTemplate('user-1', 'template-1', 'Renamed');

      expect(prisma.brandKitTemplate.update).toHaveBeenCalledWith({
        where: { id: 'template-1' },
        data: { name: 'Renamed' },
      });
      expect(result.name).toBe('Renamed');
    });

    it('404s when the template belongs to a different user', async () => {
      prisma.brandKitTemplate.findUnique.mockResolvedValue({
        ...BASE_TEMPLATE_ROW,
        userId: 'other-user',
      });

      await expect(service.renameTemplate('user-1', 'template-1', 'Renamed')).rejects.toThrow(
        'Brand Kit template template-1 not found',
      );
      expect(prisma.brandKitTemplate.update).not.toHaveBeenCalled();
    });

    it('404s when the template does not exist', async () => {
      prisma.brandKitTemplate.findUnique.mockResolvedValue(null);

      await expect(service.renameTemplate('user-1', 'missing', 'Renamed')).rejects.toThrow(
        'Brand Kit template missing not found',
      );
    });
  });

  describe('deleteTemplate', () => {
    it('deletes a template owned by the user', async () => {
      prisma.brandKitTemplate.findUnique.mockResolvedValue(BASE_TEMPLATE_ROW);

      await service.deleteTemplate('user-1', 'template-1');

      expect(prisma.brandKitTemplate.delete).toHaveBeenCalledWith({ where: { id: 'template-1' } });
    });

    it('404s when the template belongs to a different user', async () => {
      prisma.brandKitTemplate.findUnique.mockResolvedValue({
        ...BASE_TEMPLATE_ROW,
        userId: 'other-user',
      });

      await expect(service.deleteTemplate('user-1', 'template-1')).rejects.toThrow(
        'Brand Kit template template-1 not found',
      );
      expect(prisma.brandKitTemplate.delete).not.toHaveBeenCalled();
    });
  });

  describe('applyTemplate', () => {
    it("copies the template's fields back onto the target's live Brand Kit fields", async () => {
      prisma.brandKitTemplate.findUnique.mockResolvedValue({
        ...BASE_TEMPLATE_ROW,
        logoUrl: 'brand-logos/abc.png',
        primaryColor: '#1D4ED8',
        fontFamily: 'Poppins',
        watermarkUrl: 'watermarks/abc.png',
        watermarkOpacity: 0.8,
        watermarkScale: 0.15,
        watermarkMargin: 0.03,
        watermarkPosition: 'BOTTOM_RIGHT',
        introUrl: 'intros/abc.mp4',
        introType: 'video',
        outroUrl: 'outros/abc.png',
        outroType: 'image',
        outroImageDurationSeconds: 3,
      });
      prisma.user.update.mockResolvedValue({
        ...BASE_ROW,
        brandLogoUrl: 'brand-logos/abc.png',
        brandPrimaryColor: '#1D4ED8',
        brandFontFamily: 'Poppins',
        brandWatermarkUrl: 'watermarks/abc.png',
        brandWatermarkOpacity: 0.8,
        brandWatermarkScale: 0.15,
        brandWatermarkMargin: 0.03,
        brandWatermarkPosition: 'BOTTOM_RIGHT',
        brandIntroUrl: 'intros/abc.mp4',
        brandIntroType: 'video',
        brandOutroUrl: 'outros/abc.png',
        brandOutroType: 'image',
        brandOutroImageDurationSeconds: 3,
      });

      const result = await service.applyTemplate('user-1', 'template-1', USER_TARGET);

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: {
          brandLogoUrl: 'brand-logos/abc.png',
          brandPrimaryColor: '#1D4ED8',
          brandSecondaryColor: null,
          brandFontFamily: 'Poppins',
          brandWatermarkUrl: 'watermarks/abc.png',
          brandWatermarkOpacity: 0.8,
          brandWatermarkScale: 0.15,
          brandWatermarkMargin: 0.03,
          brandWatermarkPosition: 'BOTTOM_RIGHT',
          brandIntroUrl: 'intros/abc.mp4',
          brandIntroType: 'video',
          brandIntroImageDurationSeconds: null,
          brandOutroUrl: 'outros/abc.png',
          brandOutroType: 'image',
          brandOutroImageDurationSeconds: 3,
        },
        select: expect.any(Object),
      });
      expect(result.logoUrl).toBe('/brand-kit/logo');
      expect(result.watermarkPosition).toBe('BOTTOM_RIGHT');
      expect(result.outroType).toBe('image');
    });

    it('writes to the Workspace row (not User) when applied to a workspace target', async () => {
      prisma.brandKitTemplate.findUnique.mockResolvedValue(BASE_TEMPLATE_ROW);
      prisma.workspace.update.mockResolvedValue(BASE_ROW);

      await service.applyTemplate('user-1', 'template-1', WORKSPACE_TARGET);

      expect(prisma.workspace.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'workspace-1' } }),
      );
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('404s when the template belongs to a different user', async () => {
      prisma.brandKitTemplate.findUnique.mockResolvedValue({
        ...BASE_TEMPLATE_ROW,
        userId: 'other-user',
      });

      await expect(service.applyTemplate('user-1', 'template-1', USER_TARGET)).rejects.toThrow(
        'Brand Kit template template-1 not found',
      );
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });
});
