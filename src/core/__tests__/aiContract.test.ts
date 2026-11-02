import fs from 'fs';
import path from 'path';

import {
  aiActionSchema,
  aiMeetingContextDocSchema,
  assistantErrorCodeFromFunctionsCode,
  assistantRequestSchema,
  assistantResponseSchema,
  nextUsageResetIso,
  usageDayKey,
} from '../aiContract';
import { buildMeeting, toMeetingDoc } from '../types';

const draft = {
  title: 'Standup',
  description: '',
  startAt: '2026-10-05T09:00:00-05:00',
  durationMinutes: 15,
  timezone: 'America/Bogota',
  allDay: false,
  location: null,
  conference: { provider: 'google_meet', url: null, password: null },
  participants: [{ email: 'ana@example.com', name: null }],
  preparationTips: [],
  customAlertTimes: null,
  language: 'es',
} as const;

describe('assistant request', () => {
  const base = { language: 'es', timezone: 'America/Bogota', nowIso: '2026-10-01T10:00:00Z', followUpMeetingId: null };

  it('requires a trailing user message in chat mode', () => {
    expect(assistantRequestSchema.safeParse({ ...base, mode: 'chat', messages: [{ role: 'user', content: 'hola' }] }).success).toBe(true);
    expect(assistantRequestSchema.safeParse({ ...base, mode: 'chat', messages: [] }).success).toBe(false);
    expect(
      assistantRequestSchema.safeParse({ ...base, mode: 'chat', messages: [{ role: 'assistant', content: 'hi' }] }).success,
    ).toBe(false);
  });

  it('requires followUpMeetingId in followup mode', () => {
    expect(assistantRequestSchema.safeParse({ ...base, mode: 'followup', messages: [] }).success).toBe(false);
    expect(assistantRequestSchema.safeParse({ ...base, mode: 'followup', followUpMeetingId: 'm1', messages: [] }).success).toBe(true);
  });

  it('debrief mode (v7) needs the meeting AND the spoken transcript as a trailing user message', () => {
    const transcript = [{ role: 'user', content: 'Ana sends the budget by Friday' }];
    expect(assistantRequestSchema.safeParse({ ...base, mode: 'debrief', followUpMeetingId: 'm1', messages: transcript }).success).toBe(true);
    expect(assistantRequestSchema.safeParse({ ...base, mode: 'debrief', messages: transcript }).success).toBe(false);
    expect(assistantRequestSchema.safeParse({ ...base, mode: 'debrief', followUpMeetingId: 'm1', messages: [] }).success).toBe(false);
  });
});

describe('actions', () => {
  const common = { id: 'act_1', summary: 'Crear reunión', confidence: 90 };

  it('accepts every action type', () => {
    const actions = [
      { ...common, type: 'create_meeting', meeting: draft },
      { ...common, type: 'update_meeting', meetingId: 'm1', changes: { durationMinutes: 30 } },
      { ...common, type: 'delete_meeting', meetingId: 'm1' },
      { ...common, type: 'share_meeting', meetingId: 'm1', recipients: ['john@company.com'], channel: 'email', message: null },
      { ...common, type: 'share_meeting', meetingId: 'm1', recipients: [], channel: 'system_share', message: null },
      { ...common, type: 'bulk_update', meetingIds: ['m1', 'm2'], shiftMinutes: 30, changes: null },
      { ...common, type: 'list', meetingIds: [] },
    ];
    for (const action of actions) {
      expect(aiActionSchema.safeParse(action).success).toBe(true);
    }
  });

  it('rejects invalid proposals', () => {
    const invalid = [
      { ...common, type: 'update_meeting', meetingId: 'm1', changes: {} },
      { ...common, type: 'share_meeting', meetingId: 'm1', recipients: [], channel: 'email', message: null },
      { ...common, type: 'bulk_update', meetingIds: ['m1'], shiftMinutes: null, changes: null },
      { ...common, type: 'bulk_update', meetingIds: ['m1'], shiftMinutes: 0, changes: null },
      { ...common, type: 'bulk_update', meetingIds: ['m1'], shiftMinutes: null, changes: { startAt: '2026-10-05T09:00:00Z' } },
      { ...common, type: 'delete_meeting', meetingId: 'bad:id' },
      { ...common, type: 'create_meeting', meeting: { ...draft, conference: { provider: 'zoom', url: 'ftp://x', password: null } } },
      { ...common, type: 'execute_sql', meetingId: 'm1' },
    ];
    for (const action of invalid) {
      expect(aiActionSchema.safeParse(action).success).toBe(false);
    }
  });

  it('v2: accepts recurrence on drafts and scoped update/delete; strips unknown fields (v1 clients)', () => {
    const weekly = { freq: 'weekly', interval: 1, byWeekday: ['MO'], byMonthDay: null, until: null, count: null };
    expect(aiActionSchema.safeParse({ ...common, type: 'create_meeting', meeting: { ...draft, recurrence: weekly } }).success).toBe(true);
    // v1 servers omit the field entirely.
    expect(aiActionSchema.safeParse({ ...common, type: 'create_meeting', meeting: draft }).success).toBe(true);
    // update changes may set or clear the rule.
    expect(aiActionSchema.safeParse({ ...common, type: 'update_meeting', meetingId: 'm1', changes: { recurrence: weekly } }).success).toBe(true);
    expect(aiActionSchema.safeParse({ ...common, type: 'update_meeting', meetingId: 'm1', changes: { recurrence: null } }).success).toBe(true);
    // Scoped actions.
    const occUpdate = {
      ...common,
      type: 'update_meeting',
      meetingId: 'm1',
      changes: { startAt: '2026-10-06T09:00:00Z' },
      scope: 'occurrence',
      occurrenceDate: '2026-10-05',
    };
    expect(aiActionSchema.safeParse(occUpdate).success).toBe(true);
    expect(aiActionSchema.safeParse({ ...occUpdate, occurrenceDate: undefined }).success).toBe(false);
    // Occurrence scope limits the change surface to startAt/durationMinutes/title.
    expect(aiActionSchema.safeParse({ ...occUpdate, changes: { description: 'x' } }).success).toBe(false);
    expect(
      aiActionSchema.safeParse({ ...common, type: 'delete_meeting', meetingId: 'm1', scope: 'occurrence', occurrenceDate: '2026-10-05' })
        .success,
    ).toBe(true);
    expect(aiActionSchema.safeParse({ ...common, type: 'delete_meeting', meetingId: 'm1', scope: 'occurrence' }).success).toBe(false);
    expect(aiActionSchema.safeParse({ ...common, type: 'delete_meeting', meetingId: 'm1', scope: 'series' }).success).toBe(true);
    // Bad rules are rejected outright.
    expect(
      aiActionSchema.safeParse({ ...common, type: 'create_meeting', meeting: { ...draft, recurrence: { ...weekly, freq: 'yearly' } } })
        .success,
    ).toBe(false);
    // An old APP receiving v2 fields: zod object parsing STRIPS unknown keys instead of failing.
    const futureExtra = { ...common, type: 'delete_meeting', meetingId: 'm1', someFutureField: 'x' };
    const parsed = aiActionSchema.safeParse(futureExtra);
    expect(parsed.success).toBe(true);
    expect(parsed.success && 'someFutureField' in parsed.data).toBe(false);
  });

  it('validates a full response', () => {
    const response = {
      reply: 'Listo',
      actions: [{ ...common, type: 'create_meeting', meeting: draft }],
      suggestions: ['Enviar notas'],
      usage: { used: 1, limit: 5, plan: 'free', resetsAt: '2026-10-02T00:00:00.000Z' },
    };
    expect(assistantResponseSchema.safeParse(response).success).toBe(true);
  });
});

describe('helpers', () => {
  it('maps callable error codes', () => {
    expect(assistantErrorCodeFromFunctionsCode('functions/resource-exhausted')).toBe('quota_exceeded');
    expect(assistantErrorCodeFromFunctionsCode('unauthenticated')).toBe('unauthenticated');
    expect(assistantErrorCodeFromFunctionsCode('functions/invalid-argument')).toBe('invalid_request');
    expect(assistantErrorCodeFromFunctionsCode('functions/internal')).toBe('upstream_error');
    expect(assistantErrorCodeFromFunctionsCode(undefined)).toBe('upstream_error');
  });

  it('uses UTC days for quotas', () => {
    const date = new Date('2026-10-05T23:30:00-05:00');
    expect(usageDayKey(date)).toBe('2026-10-06');
    expect(nextUsageResetIso(date)).toBe('2026-10-07T00:00:00.000Z');
  });

  it('server context reader accepts the app meeting document', () => {
    const meeting = buildMeeting(
      { title: 'Doc', startAt: '2026-10-05T14:00:00.000Z', source: 'manual' },
      { id: 'm1', userId: 'u1', now: '2026-10-01T00:00:00.000Z', defaultTimezone: 'UTC', defaultLanguage: 'en' },
    );
    const parsed = aiMeetingContextDocSchema.safeParse(JSON.parse(JSON.stringify(toMeetingDoc(meeting))));
    expect(parsed.success).toBe(true);
    // Sparse docs (recurrence omitted) and garbage recurrence values both read as null.
    expect(parsed.success && parsed.data.recurrence).toBeNull();
    const garbage = aiMeetingContextDocSchema.safeParse({ ...JSON.parse(JSON.stringify(toMeetingDoc(meeting))), recurrence: 'weekly' });
    expect(garbage.success && garbage.data.recurrence).toBeNull();
  });

  it('stays self-contained (imports only zod) so /functions can copy it verbatim', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'aiContract.ts'), 'utf8');
    const imports = [...source.matchAll(/^import .* from '([^']+)';$/gm)].map((match) => match[1]);
    expect(imports).toEqual(['zod']);
  });
});
