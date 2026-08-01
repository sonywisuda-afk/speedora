import { AuditAction } from '@speedora/shared';
import { ACTION_LABELS, getAuditActionLabel } from './audit-log-labels';

describe('ACTION_LABELS', () => {
  it('has a non-empty label for every AuditAction', () => {
    for (const action of Object.values(AuditAction)) {
      expect(ACTION_LABELS[action].length).toBeGreaterThan(0);
    }
  });
});

// Contract Governance audit Sprint 3 (Runtime Safety, 2026-08-01) - proves
// the workspace audit-log pages' label lookup can never render nothing for
// a value this frontend build doesn't recognize (a live frontend/backend
// version skew - the exact shape of the AuditAction gap Sprint 1 found and
// fixed, simulated here as a hypothetical future gap with "__UNKNOWN__").
describe('getAuditActionLabel', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('resolves every known AuditAction', () => {
    for (const action of Object.values(AuditAction)) {
      expect(getAuditActionLabel(action)).toBe(ACTION_LABELS[action]);
    }
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('falls back to the raw value and warns for an unrecognized action', () => {
    expect(() => getAuditActionLabel('__UNKNOWN__')).not.toThrow();
    expect(getAuditActionLabel('__UNKNOWN__')).toBe('__UNKNOWN__');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('__UNKNOWN__'));
  });
});
