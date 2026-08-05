import { ActivityEventType } from '../types/dashboard';
import { describeActivityEvent } from './activity-events';

describe('describeActivityEvent', () => {
  it('describes VIDEO_UPLOADED using the video title from metadata', () => {
    expect(describeActivityEvent(ActivityEventType.VIDEO_UPLOADED, { title: 'My Video' })).toEqual({
      title: 'Video diunggah',
      description: 'My Video',
    });
  });

  it('falls back to a generic title when VIDEO_UPLOADED metadata has none', () => {
    expect(describeActivityEvent(ActivityEventType.VIDEO_UPLOADED, null)).toEqual({
      title: 'Video diunggah',
      description: 'video tanpa judul',
    });
  });

  it('describes CLIP_GENERATED with no variable description', () => {
    expect(describeActivityEvent(ActivityEventType.CLIP_GENERATED, null)).toEqual({
      title: 'Klip baru berhasil dibuat',
      description: null,
    });
  });

  it('describes CLIP_EXPORTED with no variable description', () => {
    expect(describeActivityEvent(ActivityEventType.CLIP_EXPORTED, null)).toEqual({
      title: 'Klip diunduh',
      description: null,
    });
  });

  it('describes MEMBER_INVITED using the invitee email from metadata', () => {
    expect(describeActivityEvent(ActivityEventType.MEMBER_INVITED, { email: 'a@b.com' })).toEqual({
      title: 'Mengundang',
      description: 'a@b.com',
    });
  });

  it('has a null description for MEMBER_INVITED when metadata has no email', () => {
    expect(describeActivityEvent(ActivityEventType.MEMBER_INVITED, null)).toEqual({
      title: 'Mengundang',
      description: null,
    });
  });

  it('describes WORKSPACE_DELETED using the workspace name from metadata', () => {
    expect(
      describeActivityEvent(ActivityEventType.WORKSPACE_DELETED, {
        workspaceId: 'ws-1',
        name: 'Acme',
      }),
    ).toEqual({ title: 'Menghapus workspace', description: 'Acme' });
  });

  it('falls back to a generic name when WORKSPACE_DELETED metadata has none', () => {
    expect(describeActivityEvent(ActivityEventType.WORKSPACE_DELETED, null)).toEqual({
      title: 'Menghapus workspace',
      description: 'workspace',
    });
  });
});
