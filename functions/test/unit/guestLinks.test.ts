/** M14: guest invitation links (functions/src/guests/core.ts). */
import type { GuestResponseDoc } from '../../src/shared/aiContract';
import {
  GUEST_TUNING,
  GuestError,
  cleanGuestEmail,
  cleanGuestText,
  handleLinkCreate,
  handleLinkRevoke,
  handleRespond,
  handleView,
  linkHashOf,
  responseIdOf,
  type GuestDeps,
  type GuestLinkRecord,
  type GuestStore,
} from '../../src/guests/core';
import { clientIpOf } from '../../src/guests/index';

const NOW = new Date('2026-11-23T12:00:00.000Z');
const TOKEN = 'A'.repeat(43);
const CLIENT = 'client-1234567890abcd';

class MemoryGuestStore implements GuestStore {
  tokens = new Map<string, { token: string; expiresAt: string; hash: string }>();
  links = new Map<string, GuestLinkRecord>();
  counters = new Map<string, number>();
  meetings = new Map<string, Record<string, unknown>>();
  responses = new Map<string, GuestResponseDoc>();
  owner = { name: 'Francisco M.', language: 'es' };

  async getMeetingToken(uid: string, meetingId: string) {
    const entry = this.tokens.get(`${uid}__${meetingId}`);
    return entry ? { token: entry.token, expiresAt: entry.expiresAt } : null;
  }
  async saveLink(token: string, record: GuestLinkRecord) {
    this.links.set(linkHashOf(token), { ...record });
    this.tokens.set(`${record.uid}__${record.meetingId}`, { token, expiresAt: record.expiresAt, hash: linkHashOf(token) });
  }
  async revoke(uid: string, meetingId: string, now: Date) {
    const entry = this.tokens.get(`${uid}__${meetingId}`);
    if (!entry) return false;
    this.links.get(entry.hash)!.revokedAt = now.toISOString();
    this.tokens.delete(`${uid}__${meetingId}`);
    return true;
  }
  async getLink(hash: string) {
    return this.links.get(hash) ?? null;
  }
  async bump(key: string) {
    const next = (this.counters.get(key) ?? 0) + 1;
    this.counters.set(key, next);
    return next;
  }
  async getMeeting(uid: string, meetingId: string) {
    return this.meetings.get(`${uid}/${meetingId}`);
  }
  async getOwner() {
    return this.owner;
  }
  async getResponse(uid: string, id: string) {
    return this.responses.get(`${uid}/${id}`) ?? null;
  }
  async saveResponse(uid: string, id: string, doc: GuestResponseDoc) {
    this.responses.set(`${uid}/${id}`, doc);
  }
}

function setup(meeting: Record<string, unknown> | null = {}) {
  const store = new MemoryGuestStore();
  let now = NOW;
  const deps: GuestDeps = { store, now: () => now, newToken: () => TOKEN };
  if (meeting !== null) {
    store.meetings.set('u1/m1', {
      title: 'Kickoff with Ana',
      description: 'secret agenda',
      startAt: '2026-11-25T15:00:00.000Z',
      durationMinutes: 45,
      timezone: 'America/Costa_Rica',
      allDay: false,
      status: 'scheduled',
      deletedAt: null,
      participants: [{ email: 'other@guest.com' }],
      location: { address: 'Office' },
      conference: { url: 'https://meet.example/abc' },
      ...meeting,
    });
  }
  return { store, deps, setNow: (next: Date) => (now = next) };
}

describe('the owner side', () => {
  it('creates one link per meeting and returns the same token again', async () => {
    const { store, deps } = setup();
    const first = await handleLinkCreate('u1', 'm1', deps);
    expect(first.token).toBe(TOKEN);
    const second = await handleLinkCreate('u1', 'm1', { ...deps, newToken: () => 'B'.repeat(43) });
    expect(second).toEqual(first);
    expect(store.links.size).toBe(1);
  });

  it('a revoked link answers revoked and a new one can be made', async () => {
    const { store, deps } = setup();
    await handleLinkCreate('u1', 'm1', deps);
    expect(await handleLinkRevoke('u1', 'm1', deps)).toEqual({ revoked: true });
    expect((await handleView({ token: TOKEN }, null, deps)).state).toBe('revoked');
    const next = await handleLinkCreate('u1', 'm1', { ...deps, newToken: () => 'B'.repeat(43) });
    expect(next.token).toBe('B'.repeat(43));
    expect(store.links.size).toBe(2);
  });
});

describe('the guest page', () => {
  it('shows only the title, the time, the zone and the organizer', async () => {
    const { deps } = setup();
    await handleLinkCreate('u1', 'm1', deps);
    const view = await handleView({ token: TOKEN }, '1.2.3.4', deps);
    expect(view).toEqual({
      state: 'open',
      meeting: { title: 'Kickoff with Ana', startAt: '2026-11-25T15:00:00.000Z', durationMinutes: 45, allDay: false, timezone: 'America/Costa_Rica', recurring: false },
      organizerName: 'Francisco M.',
      language: 'es',
      canPropose: true,
      myResponse: null,
    });
    expect(JSON.stringify(view)).not.toMatch(/secret|other@guest|Office|meet\.example/);
  });

  it('every bad link gets the same shape with no meeting', async () => {
    const { deps } = setup();
    for (const token of ['short', 'B'.repeat(43)]) {
      expect(await handleView({ token }, null, deps)).toEqual({ state: 'invalid', meeting: null, organizerName: null, language: 'en', canPropose: false, myResponse: null });
    }
  });

  it('cancelled, deleted, past and expired meetings close the link', async () => {
    for (const [patch, state] of [
      [{ status: 'cancelled' }, 'cancelled'],
      [{ deletedAt: '2026-11-22T00:00:00.000Z' }, 'cancelled'],
      [{ startAt: '2026-11-20T15:00:00.000Z' }, 'past'],
    ] as const) {
      const { deps } = setup(patch);
      await handleLinkCreate('u1', 'm1', deps);
      expect((await handleView({ token: TOKEN }, null, deps)).state).toBe(state);
    }
    const missing = setup(null);
    await handleLinkCreate('u1', 'm1', missing.deps);
    expect((await handleView({ token: TOKEN }, null, missing.deps)).state).toBe('cancelled');
    const old = setup();
    await handleLinkCreate('u1', 'm1', old.deps);
    old.setNow(new Date(NOW.getTime() + (GUEST_TUNING.linkDays + 1) * 86_400_000));
    expect((await handleView({ token: TOKEN }, null, old.deps)).state).toBe('expired');
  });

  it('a series shows its next occurrence and takes no proposals', async () => {
    const { deps } = setup({ startAt: '2026-11-02T15:00:00.000Z', recurrence: { freq: 'weekly', interval: 1, byWeekday: ['MO'], byMonthDay: null, until: null, count: null } });
    await handleLinkCreate('u1', 'm1', deps);
    const view = await handleView({ token: TOKEN }, null, deps);
    expect(view).toMatchObject({ state: 'open', canPropose: false, meeting: { recurring: true, startAt: '2026-11-23T15:00:00.000Z' } });
    await expect(handleRespond({ token: TOKEN, clientId: CLIENT, kind: 'proposed', proposedStartAt: '2026-12-01T15:00:00.000Z' }, null, deps)).rejects.toEqual(new GuestError('invalid_request'));
    expect((await handleRespond({ token: TOKEN, clientId: CLIENT, kind: 'accepted' }, null, deps)).saved).toBe(true);
  });
});

describe('answers', () => {
  it('stores one answer per browser, the latest wins, and the page shows it back', async () => {
    const { store, deps } = setup();
    await handleLinkCreate('u1', 'm1', deps);
    expect(await handleRespond({ token: TOKEN, clientId: CLIENT, kind: 'accepted', name: '  Ana\u0000 Gomez ', email: 'ANA@Example.com' }, null, deps)).toEqual({ state: 'open', saved: true });
    await handleRespond({ token: TOKEN, clientId: CLIENT, kind: 'proposed', proposedStartAt: '2026-11-26T16:00:00-06:00', message: 'Thursday works better' }, null, deps);
    expect(store.responses.size).toBe(1);
    const doc = store.responses.get(`u1/${responseIdOf(linkHashOf(TOKEN), CLIENT)}`)!;
    expect(doc).toMatchObject({ meetingId: 'm1', kind: 'proposed', proposedStartAt: '2026-11-26T22:00:00.000Z', message: 'Thursday works better', state: 'new', meetingStartAtSeen: '2026-11-25T15:00:00.000Z' });
    expect((await handleView({ token: TOKEN, clientId: CLIENT }, null, deps)).myResponse).toEqual({ kind: 'proposed', proposedStartAt: '2026-11-26T22:00:00.000Z' });
  });

  it('refuses a proposal in the past or too far ahead; nothing is saved on a closed link', async () => {
    const { store, deps } = setup();
    await handleLinkCreate('u1', 'm1', deps);
    await expect(handleRespond({ token: TOKEN, clientId: CLIENT, kind: 'proposed', proposedStartAt: '2026-11-01T10:00:00.000Z' }, null, deps)).rejects.toEqual(new GuestError('invalid_request'));
    await expect(handleRespond({ token: TOKEN, clientId: CLIENT, kind: 'proposed', proposedStartAt: '2028-11-01T10:00:00.000Z' }, null, deps)).rejects.toEqual(new GuestError('invalid_request'));
    await handleLinkRevoke('u1', 'm1', deps);
    expect(await handleRespond({ token: TOKEN, clientId: CLIENT, kind: 'accepted' }, null, deps)).toEqual({ state: 'revoked', saved: false });
    expect(store.responses.size).toBe(0);
  });

  it('limits per IP and per link', async () => {
    const { deps } = setup();
    await handleLinkCreate('u1', 'm1', deps);
    for (let i = 0; i < GUEST_TUNING.responsesPerLinkPerDay; i += 1) await handleRespond({ token: TOKEN, clientId: `${CLIENT}${i}`, kind: 'accepted' }, null, deps);
    await expect(handleRespond({ token: TOKEN, clientId: CLIENT, kind: 'accepted' }, null, deps)).rejects.toEqual(new GuestError('rate_limited'));
    const ip = setup();
    for (let i = 0; i < GUEST_TUNING.requestsPerIpPerDay; i += 1) await handleView({ token: 'x' }, '9.9.9.9', ip.deps);
    await expect(handleView({ token: 'x' }, '9.9.9.9', ip.deps)).rejects.toEqual(new GuestError('rate_limited'));
  });

  it('cleans the free text', () => {
    expect(cleanGuestText(' a‮b\nc ', 10)).toBe('a b c');
    expect(cleanGuestText('   ', 10)).toBeNull();
    expect(cleanGuestEmail(' Ana@Example.COM ')).toBe('ana@example.com');
    expect(cleanGuestEmail('not an email')).toBeNull();
  });
});

describe('review fixes', () => {
  it('an all-day meeting takes no proposals', async () => {
    const { deps } = setup({ allDay: true, startAt: '2026-11-25T06:00:00.000Z', durationMinutes: 1440 });
    await handleLinkCreate('u1', 'm1', deps);
    expect((await handleView({ token: TOKEN }, null, deps)).canPropose).toBe(false);
    await expect(handleRespond({ token: TOKEN, clientId: CLIENT, kind: 'proposed', proposedStartAt: '2026-11-26T15:00:00.000Z' }, null, deps)).rejects.toEqual(new GuestError('invalid_request'));
  });

  it('a closed link no longer shows the organizer', async () => {
    const { deps } = setup();
    await handleLinkCreate('u1', 'm1', deps);
    await handleLinkRevoke('u1', 'm1', deps);
    expect((await handleView({ token: TOKEN }, null, deps)).organizerName).toBeNull();
  });

  it('the client address is the one Google appended; anything odd shares one bucket', () => {
    expect(clientIpOf({ headers: { 'x-forwarded-for': 'spoofed, 203.0.113.7, 35.191.0.1' } })).toBe('203.0.113.7');
    expect(clientIpOf({ headers: { 'x-forwarded-for': '203.0.113.7' } })).toBe('203.0.113.7');
    expect(clientIpOf({ headers: { 'x-forwarded-for': `${'x'.repeat(80)}, ${'y'.repeat(80)}` } })).toBe('unknown');
    expect(clientIpOf(undefined)).toBe('unknown');
  });
});
