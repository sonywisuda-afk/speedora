import { mergeBrandKitFields, type BrandKitFields } from './brand-kit';

const EMPTY: BrandKitFields = {
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

describe('mergeBrandKitFields', () => {
  it('passes the owner fields through untouched when workspace is null (personal workspace)', () => {
    const owner: BrandKitFields = { ...EMPTY, brandFontFamily: 'Roboto', brandPrimaryColor: '#111' };

    expect(mergeBrandKitFields(null, owner)).toEqual(owner);
  });

  it('prefers a workspace field over the owner field when the workspace has set it', () => {
    const workspace: BrandKitFields = { ...EMPTY, brandFontFamily: 'Oswald' };
    const owner: BrandKitFields = { ...EMPTY, brandFontFamily: 'Roboto' };

    expect(mergeBrandKitFields(workspace, owner).brandFontFamily).toBe('Oswald');
  });

  it("falls back to the owner field when the workspace hasn't set that particular field", () => {
    const workspace: BrandKitFields = { ...EMPTY, brandFontFamily: null, brandPrimaryColor: '#222' };
    const owner: BrandKitFields = { ...EMPTY, brandFontFamily: 'Roboto', brandPrimaryColor: '#111' };

    const merged = mergeBrandKitFields(workspace, owner);

    expect(merged.brandFontFamily).toBe('Roboto');
    expect(merged.brandPrimaryColor).toBe('#222');
  });

  it('merges independently per field - a team logo/color can coexist with a personal watermark', () => {
    const workspace: BrandKitFields = {
      ...EMPTY,
      brandLogoUrl: 'logos/team.png',
      brandPrimaryColor: '#TEAM',
    };
    const owner: BrandKitFields = {
      ...EMPTY,
      brandWatermarkUrl: 'watermarks/personal.png',
      brandWatermarkOpacity: 0.6,
    };

    const merged = mergeBrandKitFields(workspace, owner);

    expect(merged.brandLogoUrl).toBe('logos/team.png');
    expect(merged.brandPrimaryColor).toBe('#TEAM');
    expect(merged.brandWatermarkUrl).toBe('watermarks/personal.png');
    expect(merged.brandWatermarkOpacity).toBe(0.6);
  });

  it('keeps a paired intro url+type from the same source (never mixes workspace url with owner type)', () => {
    const workspace: BrandKitFields = {
      ...EMPTY,
      brandIntroUrl: 'intros/team.mp4',
      brandIntroType: 'video',
    };
    const owner: BrandKitFields = {
      ...EMPTY,
      brandIntroUrl: 'intros/personal.png',
      brandIntroType: 'image',
    };

    const merged = mergeBrandKitFields(workspace, owner);

    expect(merged.brandIntroUrl).toBe('intros/team.mp4');
    expect(merged.brandIntroType).toBe('video');
  });

  it("falls back to the owner's intro pair together when the workspace hasn't set an intro at all", () => {
    const workspace: BrandKitFields = { ...EMPTY, brandIntroUrl: null, brandIntroType: null };
    const owner: BrandKitFields = {
      ...EMPTY,
      brandIntroUrl: 'intros/personal.png',
      brandIntroType: 'image',
    };

    const merged = mergeBrandKitFields(workspace, owner);

    expect(merged.brandIntroUrl).toBe('intros/personal.png');
    expect(merged.brandIntroType).toBe('image');
  });
});
