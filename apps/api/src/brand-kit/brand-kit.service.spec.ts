import type { PrismaService } from '../prisma/prisma.service';
import { BrandKitService } from './brand-kit.service';

describe('BrandKitService', () => {
  let service: BrandKitService;
  let prisma: { user: { findUniqueOrThrow: jest.Mock; update: jest.Mock } };

  beforeEach(() => {
    prisma = { user: { findUniqueOrThrow: jest.fn(), update: jest.fn() } };
    service = new BrandKitService(prisma as unknown as PrismaService);
  });

  describe('get', () => {
    it('exposes logoUrl as an endpoint path, never the raw key', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue({
        brandLogoUrl: 'brand-logos/abc.png',
        brandPrimaryColor: '#1D4ED8',
        brandSecondaryColor: null,
        brandFontFamily: 'Poppins',
      });

      const result = await service.get('user-1');

      expect(result).toEqual({
        logoUrl: '/brand-kit/logo',
        primaryColor: '#1D4ED8',
        secondaryColor: null,
        fontFamily: 'Poppins',
      });
    });

    it('reports a null logoUrl when no logo has been uploaded', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue({
        brandLogoUrl: null,
        brandPrimaryColor: null,
        brandSecondaryColor: null,
        brandFontFamily: null,
      });

      const result = await service.get('user-1');

      expect(result.logoUrl).toBeNull();
    });
  });

  describe('update', () => {
    it('only updates the fields actually sent', async () => {
      prisma.user.update.mockResolvedValue({
        brandLogoUrl: null,
        brandPrimaryColor: '#FF0000',
        brandSecondaryColor: null,
        brandFontFamily: null,
      });

      await service.update('user-1', { primaryColor: '#FF0000' });

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { brandPrimaryColor: '#FF0000' },
        select: {
          brandLogoUrl: true,
          brandPrimaryColor: true,
          brandSecondaryColor: true,
          brandFontFamily: true,
        },
      });
    });

    it('updates both colors when both are sent', async () => {
      prisma.user.update.mockResolvedValue({
        brandLogoUrl: null,
        brandPrimaryColor: '#FF0000',
        brandSecondaryColor: '#00FF00',
        brandFontFamily: null,
      });

      await service.update('user-1', { primaryColor: '#FF0000', secondaryColor: '#00FF00' });

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { brandPrimaryColor: '#FF0000', brandSecondaryColor: '#00FF00' },
        }),
      );
    });

    it('updates fontFamily when sent, same "only fields actually sent" convention as the colors', async () => {
      prisma.user.update.mockResolvedValue({
        brandLogoUrl: null,
        brandPrimaryColor: null,
        brandSecondaryColor: null,
        brandFontFamily: 'Montserrat',
      });

      const result = await service.update('user-1', { fontFamily: 'Montserrat' });

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { brandFontFamily: 'Montserrat' } }),
      );
      expect(result.fontFamily).toBe('Montserrat');
    });
  });

  describe('saveLogo', () => {
    it('stores the raw storage key and returns the endpoint-path DTO', async () => {
      prisma.user.update.mockResolvedValue({
        brandLogoUrl: 'brand-logos/xyz.png',
        brandPrimaryColor: null,
        brandSecondaryColor: null,
      });

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
});
