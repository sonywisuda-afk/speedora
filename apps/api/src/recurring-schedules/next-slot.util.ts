// Publishing Expansion Phase 6 (Scheduling) - the one genuinely new
// algorithm this phase introduces, and the first IANA-timezone-aware code
// anywhere in this app. No date/timezone library (date-fns, luxon, dayjs)
// is a dependency anywhere in the repo - Node's built-in Intl.DateTimeFormat
// has full ICU/IANA support, so this doesn't need one either.

export interface RecurringScheduleSlotInput {
  timezone: string; // IANA name, e.g. "Asia/Jakarta"
  daysOfWeek: number[]; // 0=Sunday..6=Saturday, matches Date.getUTCDay()
  timeOfDay: string; // "HH:mm", 24h, wall-clock time in `timezone`
}

const MAX_DAYS_TO_SEARCH = 8; // a full week + 1 buffer day

interface WallClock {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
}

// What wall-clock date/time does `date` display as when viewed in
// `timeZone`? This is the one primitive Intl.DateTimeFormat gives us
// directly - everything else in this file is built from it.
function wallClockInZone(date: Date, timeZone: string): WallClock {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
  // ICU's hour12:false can render midnight as "24" rather than "00" in some
  // implementations - normalize back to 0.
  const hour = get('hour');
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: hour === 24 ? 0 : hour,
    minute: get('minute'),
  };
}

// The inverse of wallClockInZone: what UTC instant corresponds to this
// wall-clock date/time as observed in `timeZone`? Converges via the
// standard "guess as UTC, measure the error, correct" trick - 2 iterations
// covers any real IANA zone (including fractional offsets like
// Asia/Kolkata's UTC+5:30), since offsets don't change between two
// candidate instants this close together except exactly at a DST
// transition, which a second iteration also resolves correctly.
function zonedTimeToUtc(wall: WallClock, timeZone: string): Date {
  let guess = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute);
  for (let i = 0; i < 2; i++) {
    const observed = wallClockInZone(new Date(guess), timeZone);
    const observedUtc = Date.UTC(
      observed.year,
      observed.month - 1,
      observed.day,
      observed.hour,
      observed.minute,
    );
    const desiredUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute);
    const diff = desiredUtc - observedUtc;
    if (diff === 0) break;
    guess += diff;
  }
  return new Date(guess);
}

function parseTimeOfDay(timeOfDay: string): { hour: number; minute: number } {
  const match = /^(\d{2}):(\d{2})$/.exec(timeOfDay);
  const hour = match ? Number(match[1]) : NaN;
  const minute = match ? Number(match[2]) : NaN;
  if (!match || hour > 23 || minute > 59) {
    throw new Error(`Invalid timeOfDay "${timeOfDay}" - expected 24h "HH:mm"`);
  }
  return { hour, minute };
}

// The next moment (strictly after `after`) that falls on one of
// `schedule.daysOfWeek` at `schedule.timeOfDay` wall-clock time in
// `schedule.timezone`. Used by RecurringSchedulesService/ClipsService to
// assign each newly-queued clip the next open slot, synchronously at queue
// time - see CLAUDE.md's Publish Center section.
export function computeNextSlot(schedule: RecurringScheduleSlotInput, after: Date): Date {
  if (schedule.daysOfWeek.length === 0) {
    throw new Error('daysOfWeek must have at least one day');
  }
  const { hour, minute } = parseTimeOfDay(schedule.timeOfDay);
  const daysOfWeekSet = new Set(schedule.daysOfWeek);
  const startWallClock = wallClockInZone(after, schedule.timezone);

  for (let offset = 0; offset < MAX_DAYS_TO_SEARCH; offset++) {
    // Advance the CALENDAR DAY by `offset`, computed from the wall-clock
    // date components (not by adding real elapsed time to `after`) - a
    // calendar date's weekday is a timezone-independent fact once you have
    // the Y/M/D, so this avoids any DST-adjacent arithmetic mistakes.
    const candidateDate = new Date(
      Date.UTC(startWallClock.year, startWallClock.month - 1, startWallClock.day + offset),
    );
    // getUTCDay() on a pure UTC-midnight date IS the calendar weekday for
    // that Y/M/D - a calendar date's weekday is a timezone-independent
    // fact once you have the date components, no zone conversion needed.
    if (!daysOfWeekSet.has(candidateDate.getUTCDay())) continue;

    const candidateSlot = zonedTimeToUtc(
      {
        year: candidateDate.getUTCFullYear(),
        month: candidateDate.getUTCMonth() + 1,
        day: candidateDate.getUTCDate(),
        hour,
        minute,
      },
      schedule.timezone,
    );
    if (candidateSlot.getTime() > after.getTime()) {
      return candidateSlot;
    }
  }

  throw new Error(
    'No matching recurring slot found within 8 days - check daysOfWeek/timeOfDay/timezone',
  );
}
