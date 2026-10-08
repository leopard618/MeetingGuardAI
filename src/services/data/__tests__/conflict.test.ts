import { createDefaultPreferences, SERVER_OWNED_PROFILE_KEYS } from '../../../core/types';
import { decideCommit, shouldAcceptRemote } from '../conflict';
import type { OutboxEntry } from '../outbox';

function entry(partial: Partial<OutboxEntry>): OutboxEntry {
  return {
    id: 'e1',
    seq: 1,
    kind: 'meeting',
    docId: 'm1',
    mode: 'set',
    data: { title: 'Local', updatedAt: '2026-10-01T10:00:00.000Z' },
    updatedAt: '2026-10-01T10:00:00.000Z',
    origin: 'user',
    enqueuedAt: '2026-10-01T10:00:00.000Z',
    attempts: 0,
    lastError: null,
    ...partial,
  };
}

const defaults = createDefaultPreferences({ language: 'en', timezone: 'Europe/Madrid' });
const ctx = { defaults };

describe('decideCommit: meetings and notes (last-writer-wins on updatedAt)', () => {
  it('create writes only when the document is absent', () => {
    expect(decideCommit(entry({ mode: 'create' }), null, ctx).type).toBe('write');
    expect(decideCommit(entry({ mode: 'create' }), { title: 'Other device' }, ctx)).toEqual({ type: 'skip', reason: 'exists' });
  });

  it('set skips when the server copy is strictly newer, writes when equal (idempotent resend) or older', () => {
    const e = entry({ mode: 'set' });
    const server = (updatedAt: string): Record<string, unknown> => ({
      userId: 'u1',
      title: 'Server',
      startAt: '2026-10-05T08:00:00.000Z',
      timezone: 'Europe/Madrid',
      source: 'manual',
      createdAt: '2026-09-01T10:00:00.000Z',
      updatedAt,
    });
    expect(decideCommit(e, server('2026-10-01T10:00:00.001Z'), ctx)).toEqual({ type: 'skip', reason: 'stale' });
    expect(decideCommit(e, server('2026-10-01T10:00:00.000Z'), ctx).type).toBe('write');
    expect(decideCommit(e, server('2026-10-01T09:00:00.000Z'), ctx).type).toBe('write');
    // Pre-rebuild documents cannot be updated under the rules: delete, then create.
    expect(decideCommit(e, { title: 'legacy', updated_date: 'x' }, ctx)).toEqual({ type: 'delete', followUp: 'create' });
  });

  it('migrate replaces only documents still in the old shape (delete, then create)', () => {
    const e = entry({ mode: 'migrate' });
    expect(decideCommit(e, { title: 'legacy', date: '2026-10-05', time: '10:00' }, ctx)).toEqual({ type: 'delete', followUp: 'create' });
    expect(decideCommit(e, null, ctx).type).toBe('write');
    const current = {
      userId: 'u1',
      title: 'Migrated elsewhere',
      startAt: '2026-10-05T08:00:00.000Z',
      timezone: 'Europe/Madrid',
      source: 'manual',
      createdAt: '2026-10-01T10:00:00.000Z',
      updatedAt: '2026-10-01T10:00:00.000Z',
    };
    expect(decideCommit(e, current, ctx)).toEqual({ type: 'skip', reason: 'already_migrated' });
  });

  it('note delete is skipped when absent or newer on the server', () => {
    const e = entry({ kind: 'note', mode: 'delete', data: null });
    expect(decideCommit(e, null, ctx)).toEqual({ type: 'skip', reason: 'absent' });
    expect(decideCommit(e, { updatedAt: '2026-10-02T00:00:00.000Z' }, ctx)).toEqual({ type: 'skip', reason: 'stale' });
    expect(decideCommit(e, { updatedAt: '2026-09-01T00:00:00.000Z' }, ctx)).toEqual({ type: 'delete' });
  });
});

describe('decideCommit: preferences (field-level merge)', () => {
  it('applies the pending patch over the current server document without resetting other fields', () => {
    const server = { ...defaults, alertIntensity: 'light', vibrationEnabled: false, updatedAt: '2026-10-01T12:00:00.000Z' };
    const decision = decideCommit(
      entry({ kind: 'preferences', docId: 'preferences', mode: 'merge', data: { language: 'es' }, updatedAt: '2026-10-01T11:00:00.000Z' }),
      server,
      ctx,
    );
    expect(decision.type).toBe('write');
    if (decision.type !== 'write') return;
    expect(decision.data).toMatchObject({ language: 'es', alertIntensity: 'light', vibrationEnabled: false });
    expect(decision.data.updatedAt).toBe('2026-10-01T12:00:00.000Z');
  });

  it('keeps valid server fields when another field is corrupt (no reset, report #19)', () => {
    const decision = decideCommit(
      entry({ kind: 'preferences', docId: 'preferences', mode: 'merge', data: { alertEnabled: false } }),
      { alertIntensity: 'medium', alertVolume: 'loud' },
      ctx,
    );
    if (decision.type !== 'write') throw new Error('expected write');
    expect(decision.data).toMatchObject({ alertEnabled: false, alertIntensity: 'medium', alertVolume: defaults.alertVolume });
  });

  it('rejects an invalid patch as a permanent failure', () => {
    expect(() =>
      decideCommit(entry({ kind: 'preferences', docId: 'preferences', mode: 'merge', data: { alertVolume: 7 } }), null, ctx),
    ).toThrow(expect.objectContaining({ code: 'invalid_input' }) as Error);
  });
});

describe('decideCommit: profile', () => {
  const patch = {
    uid: 'u1',
    email: 'a@b.co',
    displayName: 'Ana',
    photoURL: null,
    updatedAt: '2026-10-01T10:00:00.000Z',
    lastLoginAt: '2026-10-01T10:00:00.000Z',
    createdAt: '2026-10-01T10:00:00.000Z',
    plan: 'premium',
  };

  it('never writes server-owned keys and writes createdAt only once', () => {
    const created = decideCommit(entry({ kind: 'profile', docId: 'u1', mode: 'merge', data: patch }), null, ctx);
    if (created.type !== 'write') throw new Error('expected write');
    expect(created.data.createdAt).toBe('2026-10-01T10:00:00.000Z');
    for (const key of SERVER_OWNED_PROFILE_KEYS) expect(created.data).not.toHaveProperty(key);

    const currentDoc = { uid: 'u1', email: 'old@b.co', createdAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-01-01T00:00:00.000Z' };
    const merged = decideCommit(entry({ kind: 'profile', docId: 'u1', mode: 'merge', data: patch }), currentDoc, ctx);
    expect(merged.type).toBe('merge');
    if (merged.type !== 'merge') return;
    expect(merged.data).not.toHaveProperty('createdAt');
    expect(merged.data).not.toHaveProperty('plan');
    expect(merged.data).toMatchObject({ email: 'a@b.co', lastLoginAt: patch.lastLoginAt });
  });

  it('rewrites a pre-rebuild profile with the allowed keys only (the rules reject legacy keys)', () => {
    const legacyDoc = { plan: 'pro', createdAt: '2025-01-01T00:00:00.000Z', name: 'Old', picture: 'https://x/p.png', preferences: { language: 'es' } };
    const decision = decideCommit(entry({ kind: 'profile', docId: 'u1', mode: 'merge', data: patch }), legacyDoc, ctx);
    expect(decision).toEqual({
      type: 'write',
      data: {
        uid: 'u1',
        email: 'a@b.co',
        displayName: 'Ana',
        photoURL: null,
        lastLoginAt: patch.lastLoginAt,
        updatedAt: patch.updatedAt,
        createdAt: '2025-01-01T00:00:00.000Z',
        legacyMigratedAt: null,
      },
    });
  });
});

describe('shouldAcceptRemote', () => {
  it('accepts remote versions that are not older than the local one', () => {
    expect(shouldAcceptRemote(undefined, { updatedAt: '2026-10-01T10:00:00.000Z' })).toBe(true);
    expect(shouldAcceptRemote({ updatedAt: '2026-10-01T10:00:00.000Z' }, { updatedAt: '2026-10-01T10:00:00.000Z' })).toBe(true);
    expect(shouldAcceptRemote({ updatedAt: '2026-10-01T10:00:01.000Z' }, { updatedAt: '2026-10-01T10:00:00.000Z' })).toBe(false);
  });
});
