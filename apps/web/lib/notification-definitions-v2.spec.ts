import { Bell } from 'lucide-react';
import {
  NotificationPriorityV2,
  NotificationThreadStatusV2,
  NotificationType,
} from '@speedora/shared';
import {
  getNotificationIconV2,
  getPriorityDefinition,
  getThreadStatusDefinition,
  getTimelineStageStatusDefinition,
  PRIORITY_DEFINITIONS,
  THREAD_STATUS_DEFINITIONS,
  TIMELINE_STAGE_STATUS_DEFINITIONS,
} from './notification-definitions-v2';

describe('getNotificationIconV2', () => {
  it('resolves every V1 NotificationType via the shared NOTIFICATION_ICONS registry', () => {
    for (const type of Object.values(NotificationType)) {
      expect(getNotificationIconV2(type)).toBeDefined();
    }
  });

  it('resolves the V2-only PIPELINE_PROGRESS value without throwing', () => {
    expect(() => getNotificationIconV2('PIPELINE_PROGRESS')).not.toThrow();
    expect(getNotificationIconV2('PIPELINE_PROGRESS')).toBeDefined();
  });
});

// Contract Governance audit Sprint 3 (Runtime Safety, 2026-08-01) - proves
// NotificationRowV2.tsx/NotificationThreadPanel.tsx's `.icon`/`.label`
// access (previously a direct, unguarded PRIORITY_DEFINITIONS[...]/
// THREAD_STATUS_DEFINITIONS[...]/TIMELINE_STAGE_STATUS_DEFINITIONS[...]
// index) can never crash on a value this frontend build doesn't recognize
// (a live frontend/backend version skew), simulated here with "__UNKNOWN__".
describe('runtime fallback for an unrecognized value ("__UNKNOWN__")', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('getPriorityDefinition resolves every known priority and falls back safely otherwise', () => {
    for (const priority of Object.values(NotificationPriorityV2)) {
      expect(getPriorityDefinition(priority)).toBe(PRIORITY_DEFINITIONS[priority]);
    }

    expect(() => getPriorityDefinition('__UNKNOWN__')).not.toThrow();
    const fallback = getPriorityDefinition('__UNKNOWN__');
    expect(fallback.icon).toBeDefined();
    expect(fallback.label).toBeTruthy();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('__UNKNOWN__'));
  });

  it('getThreadStatusDefinition resolves every known status and falls back safely otherwise', () => {
    for (const status of Object.values(NotificationThreadStatusV2)) {
      expect(getThreadStatusDefinition(status)).toBe(THREAD_STATUS_DEFINITIONS[status]);
    }

    expect(() => getThreadStatusDefinition('__UNKNOWN__')).not.toThrow();
    const fallback = getThreadStatusDefinition('__UNKNOWN__');
    expect(fallback.icon).toBeDefined();
    expect(fallback.label).toBeTruthy();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('__UNKNOWN__'));
  });

  it('getTimelineStageStatusDefinition resolves every known stage status and falls back safely otherwise', () => {
    for (const status of Object.keys(TIMELINE_STAGE_STATUS_DEFINITIONS) as Array<
      keyof typeof TIMELINE_STAGE_STATUS_DEFINITIONS
    >) {
      expect(getTimelineStageStatusDefinition(status)).toBe(
        TIMELINE_STAGE_STATUS_DEFINITIONS[status],
      );
    }

    expect(() => getTimelineStageStatusDefinition('__UNKNOWN__')).not.toThrow();
    const fallback = getTimelineStageStatusDefinition('__UNKNOWN__');
    expect(fallback.icon).toBeDefined();
    expect(fallback.label).toBeTruthy();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('__UNKNOWN__'));
  });

  it('never returns undefined, only the icon component itself would crash React', () => {
    const bellIsDefined = Bell !== undefined;
    expect(bellIsDefined).toBe(true);
    expect(getPriorityDefinition('__UNKNOWN__').icon).not.toBeUndefined();
    expect(getThreadStatusDefinition('__UNKNOWN__').icon).not.toBeUndefined();
    expect(getTimelineStageStatusDefinition('__UNKNOWN__').icon).not.toBeUndefined();
  });
});
