import { clipDurationSeconds, secondsToTimestamp } from './duration';

describe('secondsToTimestamp', () => {
  it('formats sub-minute durations as m:ss', () => {
    expect(secondsToTimestamp(5)).toBe('00:05');
  });

  it('formats sub-hour durations as mm:ss', () => {
    expect(secondsToTimestamp(125)).toBe('02:05');
  });

  it('formats hour-or-longer durations as hh:mm:ss', () => {
    expect(secondsToTimestamp(3661)).toBe('01:01:01');
  });

  it('truncates fractional seconds', () => {
    expect(secondsToTimestamp(59.9)).toBe('00:59');
  });

  it('formats zero as 00:00', () => {
    expect(secondsToTimestamp(0)).toBe('00:00');
  });
});

describe('clipDurationSeconds', () => {
  it('returns the difference between end and start', () => {
    expect(clipDurationSeconds(10, 25)).toBe(15);
  });

  it('clamps negative durations (end before start) to zero', () => {
    expect(clipDurationSeconds(25, 10)).toBe(0);
  });

  it('returns zero when start equals end', () => {
    expect(clipDurationSeconds(10, 10)).toBe(0);
  });
});
