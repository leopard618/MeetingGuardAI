/**
 * Linking logic (functions/src/whatsapp/link.ts): code minting with TTL and daily rate limit,
 * link status, unlink and the deleteAccount cleanup.
 */
jest.mock('firebase-functions/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

import { WHATSAPP_TUNING } from '../../src/config';
import {
  deleteWhatsAppDataForUid,
  handleLinkStart,
  handleLinkStatus,
  handleUnlink,
  mintDecision,
  mintUserFields,
  parseWhatsappUser,
  randomLinkCode,
  type LinkStore,
  type MintResult,
} from '../../src/whatsapp/link';
import { hashLinkCode } from '../../src/whatsapp/signature';

const NOW = new Date('2026-10-05T12:00:00.000Z');

class FakeLinkStore implements LinkStore {
  users = new Map<string, Record<string, unknown>>();
  codes = new Map<string, { uid: string; expiresAt: string }>();
  deleted: string[] = [];

  async getUser(uid: string): Promise<unknown> {
    return this.users.get(uid);
  }
  async mergeUser(uid: string, fields: Record<string, unknown>): Promise<void> {
    this.users.set(uid, { ...(this.users.get(uid) ?? {}), ...fields });
  }
  async mintCode(uid: string, codeHash: string, expiresAtIso: string, now: Date): Promise<MintResult> {
    // Same decision helper the Firestore adapter runs inside its transaction.
    const decision = mintDecision(this.users.get(uid), now);
    if (!decision.allowed) return { status: 'rate_limited' };
    if (decision.previousCodeHash !== null && decision.previousCodeHash !== codeHash) {
      await this.deleteLinkCode(decision.previousCodeHash);
    }
    this.codes.set(codeHash, { uid, expiresAt: expiresAtIso });
    await this.mergeUser(uid, mintUserFields(codeHash, expiresAtIso, decision.issuedToday, now));
    return { status: 'minted', issuedToday: decision.issuedToday };
  }
  async deleteLinkCode(codeHash: string): Promise<void> {
    this.codes.delete(codeHash);
    this.deleted.push(`code:${codeHash.slice(0, 8)}`);
  }
  async deleteLink(phoneE164: string): Promise<void> {
    this.deleted.push(`link:${phoneE164}`);
  }
  async deleteSession(phoneE164: string): Promise<void> {
    this.deleted.push(`session:${phoneE164}`);
  }
  async deleteUser(uid: string): Promise<void> {
    this.users.delete(uid);
    this.deleted.push(`user:${uid}`);
  }
}

describe('handleLinkStart', () => {
  it('mints a 6-digit code, stores only its hash with the TTL, and updates the rate-limit state', async () => {
    const store = new FakeLinkStore();
    const result = await handleLinkStart('u1', { store, now: () => NOW, newCode: () => '042099' });
    expect(result.code).toBe('042099');
    expect(result.expiresAtIso).toBe(new Date(NOW.getTime() + WHATSAPP_TUNING.codeTtlMinutes * 60_000).toISOString());
    expect(store.codes.get(hashLinkCode('042099'))).toEqual({ uid: 'u1', expiresAt: result.expiresAtIso });
    // The plain code never lands in the store.
    expect([...store.codes.keys()]).not.toContain('042099');
    const user = parseWhatsappUser(store.users.get('u1'));
    expect(user.codeHash).toBe(hashLinkCode('042099'));
    expect(user.codeIssuesToday).toBe(1);
    expect(user.lastCodeAt).toBe(NOW.toISOString());
  });

  it('replaces the previous active code (one active code per uid)', async () => {
    const store = new FakeLinkStore();
    await handleLinkStart('u1', { store, now: () => NOW, newCode: () => '111111' });
    await handleLinkStart('u1', { store, now: () => NOW, newCode: () => '222222' });
    expect(store.codes.has(hashLinkCode('111111'))).toBe(false);
    expect(store.codes.has(hashLinkCode('222222'))).toBe(true);
    expect(parseWhatsappUser(store.users.get('u1')).codeIssuesToday).toBe(2);
  });

  it('rate-limits after codesPerUidPerDay codes and resets on a new UTC day', async () => {
    const store = new FakeLinkStore();
    const deps = { store, now: () => NOW, newCode: () => '333333' };
    for (let index = 0; index < WHATSAPP_TUNING.codesPerUidPerDay; index += 1) {
      await handleLinkStart('u1', deps);
    }
    await expect(handleLinkStart('u1', deps)).rejects.toMatchObject({
      code: 'resource-exhausted',
      details: { reason: 'rate_limited' },
    });
    // The next UTC day starts a fresh budget.
    const tomorrow = new Date('2026-10-06T00:00:01.000Z');
    await expect(handleLinkStart('u1', { ...deps, now: () => tomorrow })).resolves.toMatchObject({ code: '333333' });
    expect(parseWhatsappUser(store.users.get('u1')).codeIssuesToday).toBe(1);
  });

  it('mintDecision (the in-transaction cap check) enforces the cap and carries the replaced hash', () => {
    expect(mintDecision(undefined, NOW)).toEqual({ allowed: true, previousCodeHash: null, issuedToday: 1 });
    const user = { codeHash: 'h0', codeIssuesToday: WHATSAPP_TUNING.codesPerUidPerDay - 1, lastCodeAt: NOW.toISOString() };
    expect(mintDecision(user, NOW)).toEqual({ allowed: true, previousCodeHash: 'h0', issuedToday: WHATSAPP_TUNING.codesPerUidPerDay });
    expect(mintDecision({ ...user, codeIssuesToday: WHATSAPP_TUNING.codesPerUidPerDay }, NOW)).toEqual({ allowed: false });
    // A new UTC day resets the budget.
    const tomorrow = new Date('2026-10-06T00:00:01.000Z');
    expect(mintDecision({ ...user, codeIssuesToday: WHATSAPP_TUNING.codesPerUidPerDay }, tomorrow)).toMatchObject({ allowed: true, issuedToday: 1 });
  });

  it('randomLinkCode is always exactly 6 digits (zero-padded)', () => {
    for (let index = 0; index < 50; index += 1) {
      expect(randomLinkCode()).toMatch(/^\d{6}$/);
    }
  });
});

describe('handleLinkStatus', () => {
  it('answers not configured while disabled or without a display number', async () => {
    const store = new FakeLinkStore();
    const deps = { store, now: () => NOW };
    await expect(handleLinkStatus('u1', { enabled: false, displayNumber: '15551234567' }, deps)).resolves.toEqual({
      enabled: false,
      linked: false,
      displayNumber: null,
      deepLink: null,
      linkedLast4: null,
    });
    await expect(handleLinkStatus('u1', { enabled: true, displayNumber: '' }, deps)).resolves.toEqual({
      enabled: true,
      linked: false,
      displayNumber: null,
      deepLink: null,
      linkedLast4: null,
    });
  });

  it('returns digits-only number, the wa.me deep link, the linked flag and the masked own number', async () => {
    const store = new FakeLinkStore();
    await store.mergeUser('u1', { phoneE164: '15551234567', linkedAt: NOW.toISOString() });
    const result = await handleLinkStatus('u1', { enabled: true, displayNumber: '+1 555 123 4567' }, { store, now: () => NOW });
    expect(result).toEqual({
      enabled: true,
      linked: true,
      displayNumber: '15551234567',
      deepLink: 'https://wa.me/15551234567',
      linkedLast4: '4567',
    });
  });
});

describe('unlink and deleteAccount cleanup', () => {
  it('deletes the link, session, user doc and any active code (idempotent trio)', async () => {
    const store = new FakeLinkStore();
    await store.mergeUser('u1', { phoneE164: '15551234567', codeHash: hashLinkCode('999999') });
    store.codes.set(hashLinkCode('999999'), { uid: 'u1', expiresAt: NOW.toISOString() });
    await expect(handleUnlink('u1', { store, now: () => NOW })).resolves.toEqual({ unlinked: true });
    expect(store.deleted).toEqual([
      `code:${hashLinkCode('999999').slice(0, 8)}`,
      'link:15551234567',
      'session:15551234567',
      'user:u1',
    ]);
  });

  it('resolves unlinked: false when nothing was linked (still cleans the user doc)', async () => {
    const store = new FakeLinkStore();
    await expect(handleUnlink('u1', { store, now: () => NOW })).resolves.toEqual({ unlinked: false });
    expect(store.deleted).toEqual(['user:u1']);
  });

  it('deleteWhatsAppDataForUid tolerates a completely missing user', async () => {
    const store = new FakeLinkStore();
    await expect(deleteWhatsAppDataForUid('ghost', store)).resolves.toBe(false);
  });
});
