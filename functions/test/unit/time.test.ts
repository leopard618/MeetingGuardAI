import {
  addDaysToLocalDate,
  formatIsoWithOffset,
  getOffsetMinutes,
  isValidLocalDate,
  isValidLocalTime,
  isValidTimeZone,
  toLocalDate,
  toLocalTime,
  weekdayOfLocalDate,
  zonedDateTimeToInstant,
} from '../../src/assistant/time';

describe('assistant time helpers', () => {
  it('validates zones, dates and times', () => {
    expect(isValidTimeZone('Europe/Madrid')).toBe(true);
    expect(isValidTimeZone('America/Argentina/Buenos_Aires')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
    expect(isValidLocalDate('2026-02-28')).toBe(true);
    expect(isValidLocalDate('2026-02-30')).toBe(false);
    expect(isValidLocalDate('2026-2-3')).toBe(false);
    expect(isValidLocalTime('23:59')).toBe(true);
    expect(isValidLocalTime('24:00')).toBe(false);
    expect(isValidLocalTime('9:00')).toBe(false);
  });

  it('converts local wall time to an ISO string with the zone offset', () => {
    const bogota = zonedDateTimeToInstant('2026-10-05', '09:00', 'America/Bogota');
    expect(bogota.toISOString()).toBe('2026-10-05T14:00:00.000Z');
    expect(formatIsoWithOffset(bogota, 'America/Bogota')).toBe('2026-10-05T09:00:00-05:00');

    const madridSummer = zonedDateTimeToInstant('2026-07-01', '16:30', 'Europe/Madrid');
    expect(formatIsoWithOffset(madridSummer, 'Europe/Madrid')).toBe('2026-07-01T16:30:00+02:00');
    const madridWinter = zonedDateTimeToInstant('2026-12-01', '16:30', 'Europe/Madrid');
    expect(formatIsoWithOffset(madridWinter, 'Europe/Madrid')).toBe('2026-12-01T16:30:00+01:00');

    expect(formatIsoWithOffset(zonedDateTimeToInstant('2026-10-05', '00:00', 'UTC'), 'UTC')).toBe('2026-10-05T00:00:00+00:00');
    expect(formatIsoWithOffset(zonedDateTimeToInstant('2026-10-05', '10:00', 'Asia/Kolkata'), 'Asia/Kolkata')).toBe(
      '2026-10-05T10:00:00+05:30',
    );
  });

  it('shifts times inside a DST gap forward', () => {
    // Europe/Madrid: 2026-03-29 02:00 -> 03:00.
    const gap = zonedDateTimeToInstant('2026-03-29', '02:30', 'Europe/Madrid');
    expect(gap.toISOString()).toBe('2026-03-29T01:30:00.000Z');
    expect(toLocalTime(gap, 'Europe/Madrid')).toBe('03:30');
  });

  it('picks the earlier instant inside a DST overlap', () => {
    // America/New_York: 2026-11-01 02:00 EDT -> 01:00 EST, so 01:30 happens twice.
    const overlap = zonedDateTimeToInstant('2026-11-01', '01:30', 'America/New_York');
    expect(overlap.toISOString()).toBe('2026-11-01T05:30:00.000Z');
    expect(formatIsoWithOffset(overlap, 'America/New_York')).toBe('2026-11-01T01:30:00-04:00');
  });

  it('handles local dates and offsets', () => {
    const instant = new Date('2026-10-05T23:30:00.000Z');
    expect(toLocalDate(instant, 'Europe/Madrid')).toBe('2026-10-06');
    expect(toLocalDate(instant, 'America/Los_Angeles')).toBe('2026-10-05');
    expect(getOffsetMinutes(instant, 'America/Los_Angeles')).toBe(-420);
    expect(addDaysToLocalDate('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDaysToLocalDate('2026-03-01', -1)).toBe('2026-02-28');
    expect(weekdayOfLocalDate('2026-09-28')).toBe(1);
  });

  it('rejects invalid input', () => {
    expect(() => zonedDateTimeToInstant('2026-02-30', '10:00', 'UTC')).toThrow(RangeError);
    expect(() => zonedDateTimeToInstant('2026-02-01', '25:00', 'UTC')).toThrow(RangeError);
    expect(() => zonedDateTimeToInstant('2026-02-01', '10:00', 'Nowhere/City')).toThrow(RangeError);
  });
});
