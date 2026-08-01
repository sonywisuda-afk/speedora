import { OCR_CATEGORY_LABELS, OCR_TEXT_CATEGORIES, getOcrCategoryLabel } from './ocrReview';

// Contract Governance audit Sprint 3 (Runtime Safety, 2026-08-01) - proves
// OcrReviewer.tsx's predicted-category label can never render nothing for
// a value this frontend build doesn't recognize (a live frontend/backend
// version skew), simulated here with "__UNKNOWN__".
describe('getOcrCategoryLabel', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('resolves every known OcrTextCategory', () => {
    for (const category of OCR_TEXT_CATEGORIES) {
      expect(getOcrCategoryLabel(category)).toBe(OCR_CATEGORY_LABELS[category]);
    }
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('falls back to the raw value and warns for an unrecognized category', () => {
    expect(() => getOcrCategoryLabel('__UNKNOWN__')).not.toThrow();
    expect(getOcrCategoryLabel('__UNKNOWN__')).toBe('__UNKNOWN__');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('__UNKNOWN__'));
  });
});
