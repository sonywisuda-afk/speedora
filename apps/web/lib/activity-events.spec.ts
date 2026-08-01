import { ActivityEventType, type ActivityEventDto } from '@speedora/shared';
import { ACTIVITY_ICONS, describeActivityEvent, isKnownActivityEventType } from './activity-events';

function makeEvent(overrides: Partial<ActivityEventDto> = {}): ActivityEventDto {
  return {
    id: 'event-1',
    type: ActivityEventType.VIDEO_UPLOADED,
    videoId: null,
    clipId: null,
    metadata: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('ACTIVITY_ICONS', () => {
  it('has an icon for every ActivityEventType', () => {
    for (const type of Object.values(ActivityEventType)) {
      expect(ACTIVITY_ICONS[type]).toBeDefined();
    }
  });
});

describe('describeActivityEvent', () => {
  it('has a non-empty description for every ActivityEventType', () => {
    for (const type of Object.values(ActivityEventType)) {
      const description = describeActivityEvent(makeEvent({ type }));
      expect(typeof description).toBe('string');
      expect(description.length).toBeGreaterThan(0);
    }
  });

  it('describes WORKSPACE_DELETED using the workspace name from metadata', () => {
    const description = describeActivityEvent(
      makeEvent({
        type: ActivityEventType.WORKSPACE_DELETED,
        metadata: { workspaceId: 'ws-1', name: 'Acme' },
      }),
    );
    expect(description).toBe('Menghapus workspace: Acme');
  });

  it('falls back to a generic name when WORKSPACE_DELETED metadata has none', () => {
    const description = describeActivityEvent(
      makeEvent({ type: ActivityEventType.WORKSPACE_DELETED, metadata: null }),
    );
    expect(description).toBe('Menghapus workspace: workspace');
  });
});

describe('isKnownActivityEventType', () => {
  it('accepts every real ActivityEventType value', () => {
    for (const type of Object.values(ActivityEventType)) {
      expect(isKnownActivityEventType(type)).toBe(true);
    }
  });

  it('rejects a type that does not exist in the enum', () => {
    expect(isKnownActivityEventType('SOMETHING_NEW_THE_BACKEND_ADDED')).toBe(false);
  });
});
