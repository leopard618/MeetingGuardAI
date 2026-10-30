import {
  addDaysToLocalDate,
  dayRangeUtc,
  endIso,
  getDeviceTimeZone,
  getTimeZoneOffsetMinutes,
  isLocalDate,
  isLocalTime,
  isValidTimeZone,
  minutesBetween,
  setDeviceTimeZoneProvider,
  toLocalDateTime,
  todayInZone,
  toUtcIso,
  zonedDateTimeToUtcIso,
} from '../time';
import { isAppError } from '../errors';

describe('time zone validation', () => {
  it('accepts IANA zones and rejects garbage', () => {
    expect(isValidTimeZone('Europe/Madrid')).toBe(true);
    expect(isValidTimeZone('UTC')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
  });
});

describe('offsets and local wall clock', () => {
  it('computes offsets including half-hour zones and DST', () => {
    expect(getTimeZoneOffsetMinutes('2026-01-15T12:00:00Z', 'Europe/Madrid')).toBe(60);
    expect(getTimeZoneOffsetMinutes('2026-07-15T12:00:00Z', 'Europe/Madrid')).toBe(120);
    expect(getTimeZoneOffsetMinutes('2026-07-15T12:00:00Z', 'Asia/Kolkata')).toBe(330);
    expect(getTimeZoneOffsetMinutes('2026-07-15T12:00:00Z', 'America/New_York')).toBe(-240);
  });

  it('derives local date/time of an instant', () => {
    expect(toLocalDateTime('2026-10-05T22:30:00.000Z', 'America/Mexico_City')).toEqual({ date: '2026-10-05', time: '16:30' });
    expect(toLocalDateTime('2026-10-05T22:30:00.000Z', 'Europe/Madrid')).toEqual({ date: '2026-10-06', time: '00:30' });
  });
});

describe('zonedDateTimeToUtcIso', () => {
  it('round-trips normal wall times', () => {
    const iso = zonedDateTimeToUtcIso('2026-10-05', '16:30', 'America/Mexico_City');
    expect(iso).toBe('2026-10-05T22:30:00.000Z');
    expect(toLocalDateTime(iso, 'America/Mexico_City')).toEqual({ date: '2026-10-05', time: '16:30' });
  });

  it('handles half-hour offsets', () => {
    expect(zonedDateTimeToUtcIso('2026-03-01', '09:00', 'Asia/Kolkata')).toBe('2026-03-01T03:30:00.000Z');
  });

  it('moves non-existent spring-forward times after the gap', () => {
    // Madrid 2026-03-29: 02:00 -> 03:00.
    const iso = zonedDateTimeToUtcIso('2026-03-29', '02:30', 'Europe/Madrid');
    expect(toLocalDateTime(iso, 'Europe/Madrid')).toEqual({ date: '2026-03-29', time: '03:30' });
  });

  it('resolves ambiguous fall-back times to a valid instant', () => {
    // New York 2026-11-01: 02:00 -> 01:00.
    const iso = zonedDateTimeToUtcIso('2026-11-01', '01:30', 'America/New_York');
    expect(toLocalDateTime(iso, 'America/New_York')).toEqual({ date: '2026-11-01', time: '01:30' });
  });

  it('rejects invalid input with AppError', () => {
    expect.assertions(3);
    for (const call of [
      () => zonedDateTimeToUtcIso('2026-02-30', '10:00', 'UTC'),
      () => zonedDateTimeToUtcIso('2026-02-10', '25:00', 'UTC'),
      () => zonedDateTimeToUtcIso('2026-02-10', '10:00', 'Nowhere/Zone'),
    ]) {
      try {
        call();
      } catch (error) {
        expect(isAppError(error) && error.code === 'invalid_input').toBe(true);
      }
    }
  });
});

describe('day helpers', () => {
  it('adds days across month/year ends', () => {
    expect(addDaysToLocalDate('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDaysToLocalDate('2028-03-01', -1)).toBe('2028-02-29');
  });

  it('gives 23-hour DST days', () => {
    const range = dayRangeUtc('2026-03-29', 'Europe/Madrid');
    expect(range).toEqual({ from: '2026-03-28T23:00:00.000Z', to: '2026-03-29T22:00:00.000Z' });
    expect(minutesBetween(range.from, range.to)).toBe(23 * 60);
  });

  it('computes today in a zone', () => {
    expect(todayInZone('Pacific/Auckland', new Date('2026-06-30T20:00:00Z'))).toBe('2026-07-01');
  });

  it('validates local date/time strings', () => {
    expect(isLocalDate('2026-02-28')).toBe(true);
    expect(isLocalDate('2026-02-29')).toBe(false);
    expect(isLocalTime('23:59')).toBe(true);
    expect(isLocalTime('24:00')).toBe(false);
  });

  it('normalizes instants and computes ends', () => {
    expect(toUtcIso('2026-10-05T16:30:00-06:00')).toBe('2026-10-05T22:30:00.000Z');
    expect(endIso({ startAt: '2026-10-05T22:30:00.000Z', durationMinutes: 90 })).toBe('2026-10-06T00:00:00.000Z');
  });
});

describe('device time zone provider', () => {
  afterEach(() => setDeviceTimeZoneProvider(null));

  it('registering a new provider replaces the cached answer at once', () => {
    setDeviceTimeZoneProvider(() => 'America/Bogota');
    expect(getDeviceTimeZone()).toBe('America/Bogota');
    setDeviceTimeZoneProvider(() => 'Europe/Madrid');
    expect(getDeviceTimeZone()).toBe('Europe/Madrid');
  });

  it('prefers a valid registered provider and ignores invalid ones', () => {
    setDeviceTimeZoneProvider(() => 'America/Bogota');
    expect(getDeviceTimeZone()).toBe('America/Bogota');
    setDeviceTimeZoneProvider(() => 'Not/AZone');
    expect(isValidTimeZone(getDeviceTimeZone())).toBe(true);
  });
});
