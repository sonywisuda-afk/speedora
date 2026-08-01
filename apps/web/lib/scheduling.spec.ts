import { PublishStatus } from '@speedora/shared';
import { getPublishStatusLabel, PUBLISH_STATUS_LABELS } from './scheduling';

// Contract Governance audit Sprint 3 (Runtime Safety, 2026-08-01) - proves
// every PublishStatus consumer (calendar, campaign detail, clip
// performance tables) can never render nothing for a value this frontend
// build doesn't recognize (a live frontend/backend version skew),
// simulated here with "__UNKNOWN__".
describe('getPublishStatusLabel', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('resolves every known PublishStatus', () => {
    for (const status of Object.values(PublishStatus)) {
      expect(getPublishStatusLabel(status)).toBe(PUBLISH_STATUS_LABELS[status]);
    }
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('falls back to the raw value and warns for an unrecognized status', () => {
    expect(() => getPublishStatusLabel('__UNKNOWN__')).not.toThrow();
    expect(getPublishStatusLabel('__UNKNOWN__')).toBe('__UNKNOWN__');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('__UNKNOWN__'));
  });
});
