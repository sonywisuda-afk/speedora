import { ActivityEventType, type ActivityEventDto } from '@speedora/shared';
import { activityBucketLabel, groupActivityEventsByTimeBucket } from './activity-time-buckets';

const NOW = new Date('2026-08-15T12:00:00');

function makeEvent(id: string, createdAt: string): ActivityEventDto {
  return {
    id,
    type: ActivityEventType.CLIP_GENERATED,
    videoId: null,
    clipId: null,
    metadata: null,
    title: 'Klip baru berhasil dibuat',
    description: null,
    createdAt,
  };
}

describe('groupActivityEventsByTimeBucket', () => {
  it('buckets an event from earlier today as today', () => {
    const result = groupActivityEventsByTimeBucket([makeEvent('e1', '2026-08-15T08:00:00')], NOW);
    expect(result).toEqual([{ bucket: 'today', events: [expect.objectContaining({ id: 'e1' })] }]);
  });

  it('buckets an event from yesterday as yesterday', () => {
    const result = groupActivityEventsByTimeBucket([makeEvent('e1', '2026-08-14T23:00:00')], NOW);
    expect(result[0].bucket).toBe('yesterday');
  });

  it('buckets an event 2-6 days ago as last7Days', () => {
    const result = groupActivityEventsByTimeBucket([makeEvent('e1', '2026-08-10T00:00:00')], NOW);
    expect(result[0].bucket).toBe('last7Days');
  });

  it('buckets an event 7+ days ago but in the same calendar month as thisMonth', () => {
    const result = groupActivityEventsByTimeBucket([makeEvent('e1', '2026-08-01T00:00:00')], NOW);
    expect(result[0].bucket).toBe('thisMonth');
  });

  it('buckets an event from a prior month as older', () => {
    const result = groupActivityEventsByTimeBucket([makeEvent('e1', '2026-07-15T00:00:00')], NOW);
    expect(result[0].bucket).toBe('older');
  });

  it('clamps a future/clock-skewed event into today rather than crashing', () => {
    const result = groupActivityEventsByTimeBucket([makeEvent('e1', '2026-08-16T00:00:00')], NOW);
    expect(result[0].bucket).toBe('today');
  });

  it('omits empty buckets from the result', () => {
    const result = groupActivityEventsByTimeBucket([makeEvent('e1', '2026-08-15T08:00:00')], NOW);
    expect(result.map((g) => g.bucket)).toEqual(['today']);
  });

  it('preserves createdAt-desc order within a bucket, never re-sorting', () => {
    const events = [
      makeEvent('newer', '2026-08-15T10:00:00'),
      makeEvent('older', '2026-08-15T08:00:00'),
    ];
    const result = groupActivityEventsByTimeBucket(events, NOW);
    expect(result[0].events.map((e) => e.id)).toEqual(['newer', 'older']);
  });

  it('returns groups in a fixed today->older order regardless of input order', () => {
    const events = [
      makeEvent('e-older', '2026-07-01T00:00:00'),
      makeEvent('e-today', '2026-08-15T08:00:00'),
      makeEvent('e-yesterday', '2026-08-14T08:00:00'),
    ];
    const result = groupActivityEventsByTimeBucket(events, NOW);
    expect(result.map((g) => g.bucket)).toEqual(['today', 'yesterday', 'older']);
  });

  it('returns an empty array for no events', () => {
    expect(groupActivityEventsByTimeBucket([], NOW)).toEqual([]);
  });
});

describe('activityBucketLabel', () => {
  it('has an Indonesian label for every bucket', () => {
    expect(activityBucketLabel('today')).toBe('Hari Ini');
    expect(activityBucketLabel('yesterday')).toBe('Kemarin');
    expect(activityBucketLabel('last7Days')).toBe('7 Hari Terakhir');
    expect(activityBucketLabel('thisMonth')).toBe('Bulan Ini');
    expect(activityBucketLabel('older')).toBe('Lebih Lama');
  });
});
