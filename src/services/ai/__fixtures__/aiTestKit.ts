/**
 * Test helpers for the AI area (imported by __tests__ only; never by app code).
 * No jest globals here, so the file lints as regular source.
 */
import type {
  AiAction,
  AiMeetingDraft,
  AssistantResponse,
  AssistantUsage,
  BulkUpdateAction,
  CreateMeetingAction,
  DeleteMeetingAction,
  ListAction,
  ShareMeetingAction,
  UpdateMeetingAction,
} from '../../../core/aiContract';
import type { TranslateFn } from '../../../core/contracts';
import { buildMeeting, type Meeting, type MeetingCreateInput } from '../../../core/types';
import enAi from '../../../i18n/locales/en/ai.json';
import esAi from '../../../i18n/locales/es/ai.json';
import type { KeyValueStorage } from '../executedStore';
import type { AssistantFormatter } from '../types';

type Json = { [key: string]: Json } | string;

const RESOURCES: Record<'en' | 'es', Json> = { en: enAi as Json, es: esAi as Json };

function lookup(table: Json, path: string): string | undefined {
  let node: Json | undefined = table;
  for (const part of path.split('.')) {
    if (node === undefined || typeof node === 'string') return undefined;
    node = node[part];
  }
  return typeof node === 'string' ? node : undefined;
}

/**
 * Minimal i18next stand-in for the "ai" namespace: plural suffixes (_one/_other) and {{var}}
 * interpolation. Keys of other namespaces resolve to the key itself.
 */
export function createTranslator(language: 'en' | 'es' = 'en'): TranslateFn & { missing: string[] } {
  const missing: string[] = [];
  const t = ((key: string, options?: Record<string, unknown>): string => {
    const [ns, path] = key.includes(':') ? (key.split(':', 2) as [string, string]) : ['', key];
    if (ns !== 'ai') return key;
    let template: string | undefined;
    if (options && typeof options.count === 'number') {
      const form = new Intl.PluralRules(language).select(options.count) === 'one' ? 'one' : 'other';
      template = lookup(RESOURCES[language], `${path}_${form}`);
    }
    template = template ?? lookup(RESOURCES[language], path);
    if (template === undefined) {
      missing.push(key);
      return key;
    }
    return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(options?.[name] ?? `{{${name}}}`));
  }) as TranslateFn & { missing: string[] };
  t.missing = missing;
  return t;
}

/** Deterministic formatter (UTC ISO based) for assertions. */
export function createTestFormatter(options: { language?: 'en' | 'es'; timeZone?: string; t?: TranslateFn } = {}): AssistantFormatter {
  const language = options.language ?? 'en';
  return {
    t: options.t ?? createTranslator(language),
    language,
    timeZone: options.timeZone ?? 'UTC',
    meetingTime: (m) => (m.allDay ? `${m.date} (all day)` : `${m.startAt.slice(0, 16)}Z+${m.durationMinutes}m`),
    duration: (minutes) => `${minutes} min`,
    dateTime: (value) => value.slice(0, 16),
    date: (value) => value.slice(0, 10),
    time: (value) => value.slice(11, 16),
    relative: (value) => `at ${value}`,
  };
}

export function memoryStorage(initial: Record<string, string> = {}): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: async (key) => data.get(key) ?? null,
    setItem: async (key, value) => {
      data.set(key, value);
    },
    removeItem: async (key) => {
      data.delete(key);
    },
  };
}

export const NOW = new Date('2030-03-10T09:00:00.000Z');
export const UID = 'user_1';

export function makeMeeting(id: string, overrides: Partial<MeetingCreateInput> = {}): Meeting {
  return buildMeeting(
    { title: `Meeting ${id}`, startAt: '2030-03-11T15:00:00.000Z', source: 'manual', timezone: 'UTC', ...overrides },
    { id, userId: UID, now: NOW, defaultTimezone: 'UTC', defaultLanguage: 'en' },
  );
}

export function makeDraft(overrides: Partial<AiMeetingDraft> = {}): AiMeetingDraft {
  return {
    title: 'Budget review',
    description: '',
    startAt: '2030-03-12T16:00:00.000Z',
    durationMinutes: 60,
    timezone: 'UTC',
    allDay: false,
    location: null,
    conference: null,
    participants: [],
    preparationTips: [],
    customAlertTimes: null,
    language: 'en',
    ...overrides,
  };
}

const base = { summary: 'Proposed by the assistant', confidence: 92 };

export function createAction(id: string, draft: Partial<AiMeetingDraft> = {}): CreateMeetingAction {
  return { type: 'create_meeting', id, ...base, meeting: makeDraft(draft) };
}

export function updateAction(id: string, meetingId: string, changes: UpdateMeetingAction['changes']): UpdateMeetingAction {
  return { type: 'update_meeting', id, ...base, meetingId, changes };
}

export function deleteAction(id: string, meetingId: string): DeleteMeetingAction {
  return { type: 'delete_meeting', id, ...base, meetingId };
}

export function shareAction(
  id: string,
  meetingId: string,
  overrides: Partial<Pick<ShareMeetingAction, 'recipients' | 'channel' | 'message'>> = {},
): ShareMeetingAction {
  return {
    type: 'share_meeting',
    id,
    ...base,
    meetingId,
    recipients: ['john@company.com'],
    channel: 'email',
    message: null,
    ...overrides,
  };
}

export function bulkAction(
  id: string,
  meetingIds: string[],
  overrides: Partial<Pick<BulkUpdateAction, 'shiftMinutes' | 'changes'>> = {},
): BulkUpdateAction {
  return { type: 'bulk_update', id, ...base, meetingIds, shiftMinutes: 30, changes: null, ...overrides };
}

export function listAction(id: string, meetingIds: string[]): ListAction {
  return { type: 'list', id, ...base, meetingIds };
}

export function usage(overrides: Partial<AssistantUsage> = {}): AssistantUsage {
  return { used: 1, limit: 10, plan: 'free', resetsAt: '2030-03-11T00:00:00.000Z', period: 'window', ...overrides };
}

export function response(overrides: Partial<AssistantResponse> = {}, actions: AiAction[] = []): AssistantResponse {
  return { reply: 'Sure!', actions, suggestions: [], usage: usage(), ...overrides };
}
