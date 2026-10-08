/**
 * Every translation key used by the notes and attachments screens exists (EN; the resources test
 * checks EN/ES parity). Static keys are read from the sources; keys built from enums are listed.
 */
import fs from 'fs';
import path from 'path';

import { NOTE_CATEGORIES } from '../../../core/types';
import { I18N_NAMESPACE_LIST, type I18nNamespace } from '../../../core/contracts';
import { RESOURCES } from '../../../i18n/resources';

const SRC = path.join(__dirname, '..', '..', '..');
const DIRECTORIES = ['screens/notes', 'screens/attachments', 'services/attachments'];
const KEY_LITERAL = /['"`]([a-z][A-Za-z]*:[A-Za-z0-9_.]+)['"`]/g;
/** appEvents names (core/events) look like keys; some share a namespace name ("meetings:changed"). */
const EVENT_NAMES = new Set([
  'meetings:changed',
  'preferences:changed',
  'session:started',
  'session:ended',
  'alerts:fired',
  'calendar:synced',
  'language:changed',
]);

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

function exists(key: string): boolean {
  const [namespace, rest] = key.split(':') as [string, string];
  const tree = (RESOURCES.en as Record<string, unknown>)[namespace as I18nNamespace];
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
  .filter((key) => !EVENT_NAMES.has(key) && (I18N_NAMESPACE_LIST as readonly string[]).includes(key.split(':')[0] as string))
  .sort();

const dynamicKeys = [
  ...NOTE_CATEGORIES.map((category) => `notes:categories.${category}`),
  ...['titleRequired', 'titleTooLong', 'contentTooLong'].map((error) => `notes:errors.${error}`),
  ...['unsupported_type', 'too_large', 'copy_failed', 'save_failed'].map((reason) => `attachments:failure.${reason}`),
  ...['b', 'kb', 'mb', 'gb'].map((unit) => `attachments:size.${unit}`),
  ...['documents', 'images', 'videos', 'audio', 'archives'].map((category) => `attachments:category.${category}`),
];

it('finds the keys used by the notes and attachments screens', () => {
  expect(usedKeys.length).toBeGreaterThan(60);
});

it('defines every key they use', () => {
  expect([...usedKeys, ...dynamicKeys].filter((key) => !exists(key))).toEqual([]);
});
