/**
 * Small PURE text helpers for screens (unit-tested).
 */

/**
 * First letter in upper case, the rest unchanged: for labels that start a line or a header.
 * Spanish dates and month names are lower case ("lunes, 5 de octubre de 2026"), which looks like a
 * typo at the start of a header ("Lunes, 5 de octubre de 2026").
 */
export function capitalizeFirst(value: string): string {
  return value.length === 0 ? value : value.charAt(0).toLocaleUpperCase() + value.slice(1);
}
