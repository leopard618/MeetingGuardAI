/**
 * PURE helpers of the Settings "Time format" choice (Preferences.use24HourClock; unit-tested).
 * The choice applies to every time the app shows (lists, details, alerts, the assistant).
 */

/** Clock choices: 'auto' = null (the language / device default). */
export const CLOCK_OPTIONS = ['auto', '12', '24'] as const;
export type ClockOption = (typeof CLOCK_OPTIONS)[number];

export function clockOptionOf(use24HourClock: boolean | null): ClockOption {
  return use24HourClock === null ? 'auto' : use24HourClock ? '24' : '12';
}

export function is24HourFromOption(option: ClockOption): boolean | null {
  return option === 'auto' ? null : option === '24';
}

export function isClockOption(value: string): value is ClockOption {
  return (CLOCK_OPTIONS as readonly string[]).includes(value);
}
