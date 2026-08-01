import { Bell } from 'lucide-react';
import { NotificationType } from '@speedora/shared';
import {
  getNotificationIcon,
  getNotificationLabel,
  isKnownNotificationType,
  NOTIFICATION_ICONS,
  NOTIFICATION_TYPE_LABELS,
  notificationTone,
} from './notification-definitions';

describe('NOTIFICATION_ICONS', () => {
  it('has an icon for every notification type', () => {
    for (const type of Object.values(NotificationType)) {
      expect(NOTIFICATION_ICONS[type]).toBeDefined();
    }
  });
});

describe('NOTIFICATION_TYPE_LABELS', () => {
  it('has a non-empty label for every notification type', () => {
    for (const type of Object.values(NotificationType)) {
      expect(NOTIFICATION_TYPE_LABELS[type].length).toBeGreaterThan(0);
    }
  });
});

describe('notificationTone', () => {
  it('maps success types to good and RENDER_FAILED to bad', () => {
    expect(notificationTone(NotificationType.UPLOAD_COMPLETE)).toBe('good');
    expect(notificationTone(NotificationType.CLIP_READY)).toBe('good');
    expect(notificationTone(NotificationType.EXPORT_READY)).toBe('good');
    expect(notificationTone(NotificationType.RENDER_FAILED)).toBe('bad');
  });
});

describe('isKnownNotificationType', () => {
  it('accepts every real NotificationType value', () => {
    for (const type of Object.values(NotificationType)) {
      expect(isKnownNotificationType(type)).toBe(true);
    }
  });

  it('rejects a type that does not exist in the enum', () => {
    expect(isKnownNotificationType('__UNKNOWN__')).toBe(false);
  });
});

// Contract Governance audit Sprint 3 (Runtime Safety, 2026-08-01) - proves
// the P0 fix for NotificationBell.tsx's `<Icon />` crash: a value this
// frontend build doesn't recognize (simulating a live frontend/backend
// version skew - the API sent a NotificationType this bundle predates)
// never throws, always resolves to a safe default, and always logs a
// warning so the skew is diagnosable instead of silently swallowed.
describe('runtime fallback for an unrecognized NotificationType ("__UNKNOWN__")', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('getNotificationIcon never throws and falls back to the default Bell icon', () => {
    expect(() => getNotificationIcon('__UNKNOWN__')).not.toThrow();
    expect(getNotificationIcon('__UNKNOWN__')).toBe(Bell);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('__UNKNOWN__'));
  });

  it('getNotificationLabel never throws and falls back to a generic label', () => {
    expect(() => getNotificationLabel('__UNKNOWN__')).not.toThrow();
    expect(getNotificationLabel('__UNKNOWN__')).toBe('Notifikasi tidak dikenal');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('__UNKNOWN__'));
  });

  it('notificationTone never throws and falls back to neutral', () => {
    expect(() => notificationTone('__UNKNOWN__')).not.toThrow();
    expect(notificationTone('__UNKNOWN__')).toBe('neutral');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('__UNKNOWN__'));
  });

  it('known types never log a warning', () => {
    getNotificationIcon(NotificationType.CLIP_READY);
    getNotificationLabel(NotificationType.CLIP_READY);
    notificationTone(NotificationType.CLIP_READY);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
