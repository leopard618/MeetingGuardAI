/**
 * Guard against the failure that shipped the daily briefing broken: firestore.rules validates the
 * preferences document with `keys().hasOnly([...])`, so a field added to Preferences but not to
 * that list is REJECTED by the server. The app writes offline-first, so the user sees the setting
 * save, the sync fails with permission-denied, the write is rolled back, and the setting is back
 * to its old value the next time the app loads. Nothing in the app logs an error the user sees.
 *
 * This test reads the real rules file, so the two cannot drift apart again. It needs no emulator
 * and runs in the normal suite (the emulator-backed rules tests live in functions/test/rules).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { DEFAULT_PREFERENCES } from '../types';

function allowedPreferenceKeys(): string[] {
  const rules = readFileSync(join(__dirname, '..', '..', '..', 'firestore.rules'), 'utf8');
  const start = rules.indexOf('function isValidPreferences(');
  expect(start).toBeGreaterThan(-1);
  const hasOnly = rules.indexOf('hasOnly([', start);
  expect(hasOnly).toBeGreaterThan(-1);
  const end = rules.indexOf('])', hasOnly);
  expect(end).toBeGreaterThan(-1);
  return [...rules.slice(hasOnly, end).matchAll(/'([A-Za-z0-9_]+)'/g)].map((match) => match[1] as string);
}

describe('firestore.rules preferences allowlist', () => {
  it('names every field the app stores, or the server rolls the write back', () => {
    const allowed = new Set(allowedPreferenceKeys());
    const missing = Object.keys(DEFAULT_PREFERENCES).filter((key) => !allowed.has(key));
    expect(missing).toEqual([]);
  });

  it('names nothing the app does not store, so the list stays honest', () => {
    // updatedAt is set by the writer, not part of DEFAULT_PREFERENCES values.
    const stored = new Set([...Object.keys(DEFAULT_PREFERENCES), 'updatedAt']);
    const extra = allowedPreferenceKeys().filter((key) => !stored.has(key));
    expect(extra).toEqual([]);
  });

  it('validates the briefing fields it allows', () => {
    const rules = readFileSync(join(__dirname, '..', '..', '..', 'firestore.rules'), 'utf8');
    expect(rules).toContain("d.get('briefingEnabled', false) is bool");
    // A stored time that is not "HH:mm" would schedule nothing at all.
    expect(rules).toContain("d.briefingTime.matches('([01][0-9]|2[0-3]):[0-5][0-9]')");
  });
});
