import { computeNextSlot } from './next-slot.util';

describe('computeNextSlot', () => {
  // 2024-01-01 is a Monday (weekday 1) - a fixed, easily-verified anchor
  // date rather than relying on the system clock.
  it("returns today's slot when the time has not passed yet, in a fixed-offset zone (Asia/Jakarta, UTC+7)", () => {
    const after = new Date('2024-01-01T00:00:00Z'); // 07:00 Jakarta local
    const slot = computeNextSlot(
      { timezone: 'Asia/Jakarta', daysOfWeek: [1], timeOfDay: '09:00' },
      after,
    );

    expect(slot.toISOString()).toBe('2024-01-01T02:00:00.000Z'); // 09:00 Jakarta = 02:00 UTC
  });

  it("rolls to the next matching weekday when today's slot has already passed", () => {
    const after = new Date('2024-01-01T03:00:00Z'); // 10:00 Jakarta local, past 09:00
    const slot = computeNextSlot(
      { timezone: 'Asia/Jakarta', daysOfWeek: [1], timeOfDay: '09:00' },
      after,
    );

    expect(slot.toISOString()).toBe('2024-01-08T02:00:00.000Z'); // next Monday
  });

  it('picks the soonest match among multiple daysOfWeek', () => {
    const after = new Date('2024-01-01T03:00:00Z'); // past Monday's slot
    const slot = computeNextSlot(
      { timezone: 'Asia/Jakarta', daysOfWeek: [1, 3, 5], timeOfDay: '09:00' },
      after,
    );

    expect(slot.toISOString()).toBe('2024-01-03T02:00:00.000Z'); // Wednesday
  });

  it('handles a fractional UTC offset timezone (Asia/Kolkata, UTC+5:30)', () => {
    const after = new Date('2024-01-01T00:00:00Z'); // 05:30 Kolkata local
    const slot = computeNextSlot(
      { timezone: 'Asia/Kolkata', daysOfWeek: [1], timeOfDay: '09:00' },
      after,
    );

    expect(slot.toISOString()).toBe('2024-01-01T03:30:00.000Z'); // 09:00 IST = 03:30 UTC
  });

  it('resolves the correct UTC offset across a DST transition (America/New_York, spring forward)', () => {
    // March 10, 2024 is the US spring-forward day (2am -> 3am local,
    // EST/UTC-5 -> EDT/UTC-4) and also a Sunday.
    const after = new Date('2024-03-09T12:00:00Z'); // Saturday, before the slot
    const slot = computeNextSlot(
      { timezone: 'America/New_York', daysOfWeek: [0], timeOfDay: '09:00' },
      after,
    );

    // 09:00 local on the transition day is already past the 2am jump, so
    // it's EDT (UTC-4): 09:00 + 4h = 13:00 UTC.
    expect(slot.toISOString()).toBe('2024-03-10T13:00:00.000Z');
  });

  it('handles the local calendar date (Monday) landing on a different UTC calendar date (Sunday)', () => {
    // 23:30 Jakarta local on Dec 31, 2023 (a Sunday). The next Monday
    // 00:05 Jakarta slot is only 35 minutes of local wall-clock time away,
    // but Jakarta (UTC+7) puts that instant back on Dec 31 in UTC terms -
    // the local weekday (Monday) and the UTC weekday (Sunday) disagree for
    // this exact instant, which is exactly what this case is verifying.
    const after = new Date('2023-12-31T16:30:00Z'); // 23:30 Jakarta, Dec 31 (Sunday)
    const slot = computeNextSlot(
      { timezone: 'Asia/Jakarta', daysOfWeek: [1], timeOfDay: '00:05' },
      after,
    );

    expect(slot.toISOString()).toBe('2023-12-31T17:05:00.000Z'); // Mon 00:05 Jakarta local = Sun 17:05 UTC
  });

  it('throws on an invalid timeOfDay format', () => {
    expect(() =>
      computeNextSlot({ timezone: 'Asia/Jakarta', daysOfWeek: [1], timeOfDay: '9:00' }, new Date()),
    ).toThrow(/Invalid timeOfDay/);
  });

  it('throws on an out-of-range timeOfDay', () => {
    expect(() =>
      computeNextSlot(
        { timezone: 'Asia/Jakarta', daysOfWeek: [1], timeOfDay: '25:00' },
        new Date(),
      ),
    ).toThrow(/Invalid timeOfDay/);
  });

  it('throws when daysOfWeek is empty', () => {
    expect(() =>
      computeNextSlot({ timezone: 'Asia/Jakarta', daysOfWeek: [], timeOfDay: '09:00' }, new Date()),
    ).toThrow(/daysOfWeek must have at least one day/);
  });
});
