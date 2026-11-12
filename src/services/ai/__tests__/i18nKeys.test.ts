import fs from 'fs';
import path from 'path';

import {
  AI_ACTION_TYPES,
  CONFERENCE_PROVIDERS,
  LANGUAGES,
  LOCATION_TYPES,
  PLANS,
  RECURRENCE_FREQS,
  RECURRENCE_WEEKDAYS,
  SHARE_CHANNELS,
} from '../../../core/aiContract';
import { MEETING_SOURCES } from '../../../core/types';
import en from '../../../i18n/locales/en/ai.json';
import es from '../../../i18n/locales/es/ai.json';
import { VOICE_PROBLEMS } from '../../../screens/assistant/voiceModel';

type Json = { [key: string]: Json } | string;

function flatten(node: Json, prefix = ''): string[] {
  if (typeof node === 'string') return [prefix];
  return Object.entries(node).flatMap(([key, value]) => flatten(value, prefix ? `${prefix}.${key}` : key));
}

const ROOT = path.join(__dirname, '..', '..', '..');
const SOURCES = [
  'services/ai',
  'screens/assistant',
  'components/MeetingConfirmationModal.tsx',
  'components/ConfidenceBadge.tsx',
].map((p) => path.join(ROOT, p));

function sourceFiles(target: string): string[] {
  if (!fs.statSync(target).isDirectory()) return [target];
  return fs.readdirSync(target, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === '__tests__' || entry.name === '__fixtures__') return [];
    const full = path.join(target, entry.name);
    return entry.isDirectory() ? sourceFiles(full) : /\.(ts|tsx|js|jsx)$/.test(entry.name) ? [full] : [];
  });
}

const enKeys = new Set(flatten(en as Json));
const esKeys = new Set(flatten(es as Json));

/** A key exists directly or as a plural family (_one/_other). */
function defined(keys: Set<string>, key: string): boolean {
  return keys.has(key) || (keys.has(`${key}_one`) && keys.has(`${key}_other`));
}

/** Values the dynamic `ai:<prefix>.${x}` keys can take. */
const DYNAMIC: Record<string, readonly string[]> = {
  'errors.quota': ['day', 'window', 'month'],
  'usage.current': ['day', 'window', 'month'],
  'usage.a11y': ['day', 'window', 'month'],
  'usage.allowance': ['introductory', 'perMonth'],
  'usage.a11yAllowance': ['introductory', 'perMonth'],
  'actions.type': AI_ACTION_TYPES,
  'actions.status': ['proposed', 'executing', 'done', 'failed', 'rejected'],
  'confirm.title': AI_ACTION_TYPES,
  'confidence': ['high', 'medium', 'low'],
  'examples': ['e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'e7', 'e8'],
  'fields': ['title', 'when', 'duration', 'description', 'location', 'conference', 'participants', 'tips', 'alerts', 'language', 'repeats', 'scope'],
  'recurrence': RECURRENCE_FREQS,
  'recurrence.weekday': RECURRENCE_WEEKDAYS,
  'share.channel': SHARE_CHANNELS,
  'source': MEETING_SOURCES,
  'usage.plan': PLANS,
  'values.language': LANGUAGES,
  'values.locationType': LOCATION_TYPES,
  'values.provider': CONFERENCE_PROVIDERS,
  'voice': VOICE_PROBLEMS,
  'warnings': ['meeting_not_found', 'start_in_past', 'overlaps_existing', 'google_meet_needs_calendar', 'no_recipients'],
};

describe('ai namespace resources', () => {
  it('has the same keys in English and Spanish', () => {
    expect([...esKeys].sort()).toEqual([...enKeys].sort());
  });

  it('has no empty strings', () => {
    const empty = (node: Json): boolean => (typeof node === 'string' ? node.trim() === '' : Object.values(node).some(empty));
    expect(empty(en as Json)).toBe(false);
    expect(empty(es as Json)).toBe(false);
  });

  it('defines every ai: key referenced by the AI area', () => {
    const missing: string[] = [];
    for (const file of SOURCES.flatMap(sourceFiles)) {
      const source = fs.readFileSync(file, 'utf8');
      for (const match of source.matchAll(/['"`]ai:([A-Za-z0-9_.]+?)(\.\$\{[^}]+\})?['"`]/g)) {
        const key = match[1] ?? '';
        const keys = match[2] ? (DYNAMIC[key] ?? ['<unknown dynamic key>']).map((suffix) => `${key}.${suffix}`) : [key];
        for (const full of keys) {
          if (!defined(enKeys, full)) missing.push(`${path.basename(file)}: ai:${full}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
