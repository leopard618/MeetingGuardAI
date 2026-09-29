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
  });

  it('stays self-contained (imports only zod) so /functions can copy it verbatim', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'aiContract.ts'), 'utf8');
    const imports = [...source.matchAll(/^import .* from '([^']+)';$/gm)].map((match) => match[1]);
    expect(imports).toEqual(['zod']);
  });
});
