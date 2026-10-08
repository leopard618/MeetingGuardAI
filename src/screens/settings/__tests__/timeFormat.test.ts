import { CLOCK_OPTIONS, clockOptionOf, is24HourFromOption, isClockOption } from '../timeFormat';

describe('time format choice', () => {
  it('maps the stored preference to a choice and back', () => {
    expect(clockOptionOf(null)).toBe('auto');
    expect(clockOptionOf(false)).toBe('12');
    expect(clockOptionOf(true)).toBe('24');
    for (const option of CLOCK_OPTIONS) {
      expect(clockOptionOf(is24HourFromOption(option))).toBe(option);
    }
  });

  it('only accepts the offered choices', () => {
    expect(isClockOption('24')).toBe(true);
    expect(isClockOption('36')).toBe(false);
  });
});
