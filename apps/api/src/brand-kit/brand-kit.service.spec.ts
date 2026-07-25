import type { PrismaService } from '../prisma/prisma.service';
import { BrandKitService } from './brand-kit.service';

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
};

describe('BrandKitService', () => {
  let service: BrandKitService;
  let prisma: { user: { findUniqueOrThrow: jest.Mock; update: jest.Mock } };

  beforeEach(() => {
    prisma = { user: { findUniqueOrThrow: jest.fn(), update: jest.fn() } };
    service = new BrandKitService(prisma as unknown as PrismaService);
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
      });

      const result = await service.get('user-1');

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
      });
    });

    it('reports a null logoUrl/watermarkUrl/introUrl when none has been uploaded', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue(BASE_ROW);

      const result = await service.get('user-1');

      expect(result.logoUrl).toBeNull();
      expect(result.watermarkUrl).toBeNull();
      expect(result.introUrl).toBeNull();
      expect(result.introType).toBeNull();
    });
  });

  describe('update', () => {
    it('only updates the fields actually sent', async () => {
      prisma.user.update.mockResolvedValue({ ...BASE_ROW, brandPrimaryColor: '#FF0000' });

      await service.update('user-1', { primaryColor: '#FF0000' });

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
        },
      });
    });

    it('updates both colors when both are sent', async () => {
      prisma.user.update.mockResolvedValue({
        ...BASE_ROW,
        brandPrimaryColor: '#FF0000',
        brandSecondaryColor: '#00FF00',
      });

      await service.update('user-1', { primaryColor: '#FF0000', secondaryColor: '#00FF00' });

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { brandPrimaryColor: '#FF0000', brandSecondaryColor: '#00FF00' },
        }),
      );
    });

    it('updates fontFamily when sent, same "only fields actually sent" convention as the colors', async () => {
      prisma.user.update.mockResolvedValue({ ...BASE_ROW, brandFontFamily: 'Montserrat' });

      const result = await service.update('user-1', { fontFamily: 'Montserrat' });

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

      const result = await service.update('user-1', {
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

      const result = await service.update('user-1', { introImageDurationSeconds: 5 });

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { brandIntroImageDurationSeconds: 5 } }),
      );
      expect(result.introImageDurationSeconds).toBe(5);
    });
  });

  describe('saveLogo', () => {
    it('stores the raw storage key and returns the endpoint-path DTO', async () => {
      prisma.user.update.mockResolvedValue({ ...BASE_ROW, brandLogoUrl: 'brand-logos/xyz.png' });

      const result = await service.saveLogo('user-1', 'brand-logos/xyz.png');

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { brandLogoUrl: 'brand-logos/xyz.png' } }),
      );
      expect(result.logoUrl).toBe('/brand-kit/logo');
    });
  });

  describe('findLogoKeyOrThrow', () => {
    it('returns the raw key without throwing when a logo exists', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue({ brandLogoUrl: 'brand-logos/xyz.png' });

      expect(await service.findLogoKeyOrThrow('user-1')).toEqual({
        logoKey: 'brand-logos/xyz.png',
      });
    });

    it('returns a null logoKey (not a throw) when no logo has been uploaded', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue({ brandLogoUrl: null });

      expect(await service.findLogoKeyOrThrow('user-1')).toEqual({ logoKey: null });
    });
  });

  describe('saveWatermark', () => {
    it('stores the raw storage key and returns the endpoint-path DTO', async () => {
      prisma.user.update.mockResolvedValue({ ...BASE_ROW, brandWatermarkUrl: 'watermarks/xyz.png' });

      const result = await service.saveWatermark('user-1', 'watermarks/xyz.png');

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { brandWatermarkUrl: 'watermarks/xyz.png' } }),
      );
      expect(result.watermarkUrl).toBe('/brand-kit/watermark');
    });
  });

  describe('findWatermarkKeyOrThrow', () => {
    it('returns the raw key without throwing when a watermark exists', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue({
        brandWatermarkUrl: 'watermarks/xyz.png',
      });

      expect(await service.findWatermarkKeyOrThrow('user-1')).toEqual({
        watermarkKey: 'watermarks/xyz.png',
      });
    });

    it('returns a null watermarkKey (not a throw) when no watermark has been uploaded', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue({ brandWatermarkUrl: null });

      expect(await service.findWatermarkKeyOrThrow('user-1')).toEqual({ watermarkKey: null });
    });
  });

  describe('removeWatermark', () => {
    it('clears the watermark key', async () => {
      prisma.user.update.mockResolvedValue({});

      await service.removeWatermark('user-1');

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { brandWatermarkUrl: null },
      });
    });
  });

  describe('saveIntro', () => {
    it('stores the raw storage key and type together, returns the endpoint-path DTO', async () => {
      prisma.user.update.mockResolvedValue({
        ...BASE_ROW,
        brandIntroUrl: 'intros/xyz.mp4',
        brandIntroType: 'video',
      });

      const result = await service.saveIntro('user-1', 'intros/xyz.mp4', 'video');

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
      prisma.user.findUniqueOrThrow.mockResolvedValue({ brandIntroUrl: 'intros/xyz.mp4' });

      expect(await service.findIntroKeyOrThrow('user-1')).toEqual({
        introKey: 'intros/xyz.mp4',
      });
    });

    it('returns a null introKey (not a throw) when no intro has been uploaded', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue({ brandIntroUrl: null });

      expect(await service.findIntroKeyOrThrow('user-1')).toEqual({ introKey: null });
    });
  });

  describe('removeIntro', () => {
    it('clears both the intro key and type', async () => {
      prisma.user.update.mockResolvedValue({});

      await service.removeIntro('user-1');

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { brandIntroUrl: null, brandIntroType: null },
      });
    });
  });
});
