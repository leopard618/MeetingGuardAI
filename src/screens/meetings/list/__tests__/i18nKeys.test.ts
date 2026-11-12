/**
 * Every namespaced key the meetings list, calendar and creation chooser use exists (dynamic
 * `${...}` keys are expanded with the values they can take). EN/ES parity of the namespaces is
 * checked by src/i18n/__tests__/resources.test.ts.
 */
import fs from 'fs';
import path from 'path';

import { CONFERENCE_PROVIDERS } from '../../../../core/aiContract';
import { MEETING_SOURCES } from '../../../../core/types';
import { RESOURCES } from '../../../../i18n/resources';
import { CREATION_METHODS } from '../../../create/ChooseCreationMethodScreen';
import { SOURCE_FILTERS, TIME_FILTERS } from '../meetingListModel';

jest.mock('expo-localization', () => ({
  getLocales: jest.fn(() => [{ languageCode: 'en', languageTag: 'en-US' }]),
  getCalendars: jest.fn(() => [{ timeZone: 'UTC', uses24hourClock: false }]),
}));
// The chooser imports the whatsapp area (firebase/* ships untransformed ESM); only
// CREATION_METHODS is read here.
jest.mock('../../../../services/whatsapp', () => ({ useWhatsAppStatus: jest.fn() }));

type Tree = { readonly [key: string]: unknown };

const SCREENS = path.join(__dirname, '..', '..', '..');
const SOURCES = [path.join(SCREENS, 'meetings', 'list'), path.join(SCREENS, 'calendar'), path.join(SCREENS, 'create')];

/** Values of the `${...}` part of a dynamic key, by the static text before it. */
const DYNAMIC: Record<string, readonly string[]> = {
  'meetings:list.': ['today', 'tomorrow', 'yesterday'],
  'meetings:list.time.': TIME_FILTERS,
  'meetings:list.source.': SOURCE_FILTERS,
  'meetings:list.empty.': ['none', 'noMatches', ...TIME_FILTERS],
  'meetings:list.refreshFailed.': ['meetings', 'calendars', 'google', 'device'],
  'meetings:source.': MEETING_SOURCES,
  'calendarView:relation.': ['today', 'tomorrow', 'yesterday'],
  'calendarView:legend.': ['meetingguard', 'google', 'outlook', 'device'],
  'create:methods.': CREATION_METHODS,
  'alerts:provider.': CONFERENCE_PROVIDERS,
};

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === '__tests__') return [];
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? sourceFiles(full) : /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

function lookup(language: 'en' | 'es', key: string): unknown {
  const [namespace, rest] = key.split(':') as [string, string];
  const tree = (RESOURCES[language] as Record<string, Tree>)[namespace];
  return rest.split('.').reduce<unknown>((node, part) => (node && typeof node === 'object' ? (node as Tree)[part] : undefined), tree);
}

function defined(language: 'en' | 'es', key: string): boolean {
  if (typeof lookup(language, key) === 'string') return true;
  return typeof lookup(language, `${key}_one`) === 'string' && typeof lookup(language, `${key}_other`) === 'string';
}

/** Expands `a.${x}.b` into concrete keys. */
function expand(raw: string): string[] {
  const match = /^(.*?)\$\{[^}]+\}(.*)$/.exec(raw);
  if (!match) return [raw];
  const [, prefix = '', suffix = ''] = match;
  const values = DYNAMIC[prefix] ?? [`<unknown dynamic key ${prefix}>`];
  return values.flatMap((value) => expand(`${prefix}${value}${suffix}`));
}

describe('meetings / calendar / create screens i18n', () => {
  const keys = new Set<string>();
  for (const file of SOURCES.flatMap(sourceFiles)) {
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(/['"`]((?:meetings|calendarView|create|common|alerts):[A-Za-z0-9_.]*(?:\$\{[^}]+\}[A-Za-z0-9_.]*)*)['"`]/g)) {
      for (const key of expand(match[1] ?? '')) keys.add(key);
    }
  }

  it('finds the keys', () => {
    expect(keys.size).toBeGreaterThan(40);
  });

  it.each(['en', 'es'] as const)('defines every key in %s', (language) => {
    expect([...keys].filter((key) => !defined(language, key))).toEqual([]);
  });
});
