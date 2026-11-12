/**
 * Every translation key used by the dashboard and insights screens exists in English (the
 * resources test checks EN/ES parity). Static keys are read from the sources; keys built from
 * values (day period, intensity, permission, source, weekday) are listed here.
 */
import fs from 'fs';
import path from 'path';

import { I18N_NAMESPACE_LIST } from '../../../core/contracts';
import { MEETING_SOURCES } from '../../../core/types';
import { RESOURCES } from '../../../i18n/resources';

const SRC = path.join(__dirname, '..', '..', '..');
const DIRECTORIES = ['screens/home', 'screens/insights'];
const KEY_LITERAL = /['"`]([a-z][A-Za-z]*:[A-Za-z0-9_.]+)['"`]/g;

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name.startsWith('__') ? [] : sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

function exists(key: string): boolean {
  const [namespace, rest] = key.split(':') as [string, string];
  const tree = (RESOURCES.en as Record<string, unknown>)[namespace];
  if (!tree) return false;
  const parts = rest.split('.');
  const last = parts.pop() as string;
  let node: unknown = tree;
  for (const part of parts) node = (node as Record<string, unknown> | undefined)?.[part];
  const parent = node as Record<string, unknown> | undefined;
  return typeof parent?.[last] === 'string' || typeof parent?.[`${last}_other`] === 'string';
}

const usedKeys = [
  ...new Set(
    DIRECTORIES.flatMap((dir) => sourceFiles(path.join(SRC, dir))).flatMap((file) =>
      [...fs.readFileSync(file, 'utf8').matchAll(KEY_LITERAL)].map((match) => match[1] as string),
    ),
  ),
]
  .filter((key) => (I18N_NAMESPACE_LIST as readonly string[]).includes(key.split(':')[0] as string))
  .sort();

const dynamicKeys = [
  ...['morning', 'afternoon', 'evening'].map((period) => `home:greeting.${period}NoName`),
  ...MEETING_SOURCES.map((source) => `insights:sources.${source}`),
  ...[0, 1, 2, 3, 4, 5, 6].flatMap((day) => [`insights:weekday.${day}`, `insights:weekdayLong.${day}`]),
];

it('finds the keys used by the dashboard and insights screens', () => {
  expect(usedKeys.length).toBeGreaterThan(60);
});

it('defines every key they use', () => {
  expect([...usedKeys, ...dynamicKeys].filter((key) => !exists(key))).toEqual([]);
});
