/**
 * A4 part 2: the owner's Microsoft mailbox (docs/v2/A4-THREAT-MODEL.md T9, tests 1 to 10). The
 * assistant only SENDS from it; replies come to the matter address. On the in-memory fakes and a
 * fake Microsoft (token endpoint, /me, /me/sendMail): nothing reaches the network.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import * as logger from 'firebase-functions/logger';

import { MailboxSendError, senderFor } from '../../src/matters/email';
import { MAILBOX_SCOPES, authorizeUrl, graphMessage, mailboxRedirectUri, pkceChallenge, type FetchLike } from '../../src/matters/graph';
import { handleInboundEmail, handleMatterConfirm, handleMatterDraft, type MatterDeps } from '../../src/matters/handlers';
import {
  callbackPage,
  createMailboxSender,
  handleMailboxCallback,
  handleMatterMailbox,
  returnUrl,
  type MailboxDeps,
  type MailboxRecord,
  type MailboxState,
  type MailboxStore,
} from '../../src/matters/mailbox';
import { MailboxCryptoError, keyIdOf, mailboxAad, openSecret, parseMailboxKeys, sealSecret, type MailboxKey } from '../../src/matters/mailboxCrypto';
import { handleMatterSetStatus } from '../../src/matters/manage';
import { draftHash, type EmailAuth, type MatterEvent } from '../../src/matters/model';
import { handleInboundRead, handleMatterDecide, runMatterTick } from '../../src/matters/replies';
import { CALLER, DOMAIN, NOW, REQUEST, TOKEN, inboundPayload, makeDeps, proposal } from './mattersFakes';

jest.mock('firebase-functions/logger', () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const ZONE = 'Europe/Madrid';
const HOUR = 3_600_000;
const MAILBOX = 'ana.lopez@outlook.com';
const REFRESH = 'M.R3_BAY.refresh-token-one';
const REFRESH_TWO = 'M.R3_BAY.refresh-token-two';
const ACCESS = 'EwBYA8l6BAAU.access-token';
const KEY_A = Buffer.alloc(32, 7).toString('base64');
const KEY_B = Buffer.alloc(32, 9).toString('hex');
const TRUSTED: EmailAuth = { verdict: 'trusted', fromAligned: true, spf: 'pass', arcTrusted: false, reason: null };
const assess = { intent: 'answer_within_mandate', reason: 'none', quote: 'Here it is.', reply: 'Hello Carlos,\n\nThank you, I have received it.\n\nBest,', commitments: [] };

class FakeMailboxStore implements MailboxStore {
  readonly records = new Map<string, MailboxRecord>();
  readonly states = new Map<string, MailboxState>();
  async get(uid: string) {
    return this.records.get(uid) ?? null;
  }
  async put(uid: string, record: MailboxRecord) {
    this.records.set(uid, record);
  }
  async rotate(uid: string, address: string, sealedRefresh: string, keyId: string, nowIso: string) {
    const current = this.records.get(uid);
    if (!current || current.address !== address) return false;
    this.records.set(uid, { ...current, sealedRefresh, keyId, updatedAt: nowIso });
    return true;
  }
  async owners(address: string) {
    return [...this.records.entries()].filter(([, r]) => r.address === address.trim().toLowerCase()).map(([uid]) => uid).slice(0, 2);
  }
  async remove(uid: string) {
    return this.records.delete(uid);
  }
  async createState(stateId: string, state: MailboxState) {
    if (this.states.has(stateId)) throw new Error('exists');
    this.states.set(stateId, state);
  }
  async takeState(stateId: string) {
    const state = this.states.get(stateId) ?? null;
    this.states.delete(stateId);
    return state;
  }
}

/** Microsoft as the tests need it: the token endpoint, /me and /me/sendMail. */
class FakeMicrosoft {
  readonly calls: { url: string; method: string; body: string }[] = [];
  readonly sent: Record<string, unknown>[] = [];
  /** The challenge of the last sign-in link: the code is only redeemed with its verifier. */
  challenge: string | null = null;
  grantedScope = 'https://graph.microsoft.com/Mail.Send https://graph.microsoft.com/User.Read';
  tokenError: string | null = null;
  rotate = false;
  sendStatus = 202;
  me: Record<string, unknown> = { mail: null, userPrincipalName: 'Ana.Lopez@outlook.com', displayName: 'Ana Lopez' };

  fetch: FetchLike = async (url, init) => {
    this.calls.push({ url, method: init.method, body: init.body ?? '' });
    const json = (status: number, body: unknown) => ({ status, json: async () => body });
    if (url.endsWith('/oauth2/v2.0/token')) {
      const form = new URLSearchParams(init.body ?? '');
      if (this.tokenError) return json(400, { error: this.tokenError });
      if (form.get('grant_type') === 'authorization_code') {
        if (form.get('code') !== 'the-code' || pkceChallenge(form.get('code_verifier') ?? '') !== this.challenge) return json(400, { error: 'invalid_grant' });
        return json(200, { access_token: ACCESS, refresh_token: REFRESH, scope: this.grantedScope });
      }
      if (form.get('grant_type') === 'refresh_token') {
        if (![REFRESH, REFRESH_TWO].includes(form.get('refresh_token') ?? '')) return json(400, { error: 'invalid_grant' });
        return json(200, { access_token: ACCESS, ...(this.rotate ? { refresh_token: REFRESH_TWO } : {}), scope: this.grantedScope });
      }
      return json(400, { error: 'unsupported_grant_type' });
    }
    if (url.includes('/v1.0/me?')) return json(200, this.me);
    if (url.endsWith('/v1.0/me/sendMail')) {
      if (this.sendStatus === 202) this.sent.push(JSON.parse(init.body ?? '{}') as Record<string, unknown>);
      return json(this.sendStatus, {});
    }
    return json(404, {});
  };
}

function setup(overrides: Partial<MatterDeps> = {}, keyText = KEY_A) {
  const clock = { now: NOW };
  let seq = 0;
  const microsoft = new FakeMicrosoft();
  const mailboxStore = new FakeMailboxStore();
  let randomSeq = 0;
  const mailbox: MailboxDeps = {
    store: mailboxStore,
    available: true,
    graph: () => ({ clientId: 'client-id', clientSecret: 'client-secret', redirectUri: mailboxRedirectUri('us-central1', 'demo-project'), timeoutMs: 1000, fetch: microsoft.fetch }),
    keys: () => parseMailboxKeys(keyText),
    stateTtlMs: 10 * 60_000,
    random: (size) => Buffer.alloc(size, ++randomSeq),
  };
  const ctx = makeDeps({
    now: () => clock.now,
    random: () => `r${++seq}`,
    mailbox,
    mailboxSender: (uid, address) => createMailboxSender(mailbox, uid, address, () => clock.now),
    ...overrides,
  });
  return { ...ctx, clock, microsoft, mailboxStore, mailbox };
}
type Ctx = ReturnType<typeof setup>;

/** "Connect your mailbox" end to end: the link, then Microsoft's form_post with the code. */
async function connect(ctx: Ctx) {
  const started = await handleMatterMailbox(CALLER, { action: 'connect', language: 'en' }, ctx.deps);
  const url = new URL(started.authUrl!);
  ctx.microsoft.challenge = url.searchParams.get('code_challenge');
  const state = url.searchParams.get('state')!;
  const done = await handleMailboxCallback({ code: 'the-code', state }, ctx.deps);
  return { started, state, done };
}

async function draft(ctx: Ctx) {
  ctx.llm.queue.push(proposal({ ends_at: '2026-11-30T18:00' }));
  return handleMatterDraft(CALLER, { text: REQUEST, source: 'text', language: 'en', timeZone: ZONE }, ctx.deps);
}

async function active(ctx: Ctx) {
  const d = await draft(ctx);
  await handleMatterConfirm(CALLER, { matterId: d.matterId, draftHash: d.draftHash }, ctx.deps);
  return d.matterId;
}

let providerSeq = 0;
async function reply(ctx: Ctx) {
  providerSeq += 1;
  await handleInboundEmail(inboundPayload({ MessageID: `mb-${providerSeq}` }), { store: ctx.store, now: ctx.deps.now, domain: DOMAIN, markerTtlDays: 7, checkSender: async () => TRUSTED });
  return ctx.store.lastAddedId!;
}

async function replyCard(ctx: Ctx, matterId: string) {
  ctx.llm.queue.push(assess);
  await handleInboundRead({ uid: 'u1', matterId, messageId: await reply(ctx) }, ctx.deps);
  return ctx.store.cardList('u1', matterId).find((c) => c.kind === 'reply_draft' && c.status === 'pending')!;
}

const allEvents = (ctx: Ctx): MatterEvent[] => [...ctx.store.events.values()].flat();
const logged = () => JSON.stringify([(logger.info as jest.Mock).mock.calls, (logger.warn as jest.Mock).mock.calls, (logger.error as jest.Mock).mock.calls]);

beforeEach(() => jest.clearAllMocks());

describe('T9.1 sending only', () => {
  it('asks for Mail.Send, User.Read and offline_access, never Mail.Read; the code comes back in a POST body', () => {
    expect([...MAILBOX_SCOPES].sort()).toEqual(['https://graph.microsoft.com/Mail.Send', 'https://graph.microsoft.com/User.Read', 'offline_access']);
    const url = new URL(authorizeUrl({ clientId: 'c', redirectUri: 'https://r', state: 's'.repeat(32), verifier: 'v'.repeat(43) }));
    expect(url.searchParams.get('scope')).toBe(MAILBOX_SCOPES.join(' '));
    expect(url.searchParams.get('scope')).not.toMatch(/Mail\.Read/i);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('response_mode')).toBe('form_post');
  });

  it('the Graph code has no call that lists, searches or reads mail (this fails if one is added)', () => {
    // the code only: comments may name what is NOT asked for
    const source = readFileSync(join(__dirname, '../../src/matters/graph.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    const urls = source.match(/`\$\{(?:GRAPH_ROOT|MS_AUTHORITY)\}[^`]*`/g) ?? [];
    expect(urls.map((u) => u.replace(/\?.*$/, '`')).sort()).toEqual(['`${GRAPH_ROOT}/me/sendMail`', '`${GRAPH_ROOT}/me`', '`${MS_AUTHORITY}/authorize`', '`${MS_AUTHORITY}/token`'].sort());
    expect(source).not.toMatch(/mailFolders|\/messages|Mail\.Read\b|Mail\.ReadWrite/);
  });
});

describe('T9.2 the sign-in', () => {
  it('connects: a single-use state tied to the uid, PKCE, the owner\u2019s own address; the browser goes back to the app', async () => {
    const ctx = setup();
    const { started, done } = await connect(ctx);
    expect(started).toMatchObject({ available: true, connected: false, address: null });
    expect(done).toEqual({ result: 'connected', language: 'en' });
    expect(ctx.mailboxStore.records.get('u1')).toMatchObject({ uid: 'u1', provider: 'microsoft', address: MAILBOX, name: 'Ana Lopez' });
    expect(ctx.mailboxStore.states.size).toBe(0);
    await expect(handleMatterMailbox(CALLER, { action: 'status' }, ctx.deps)).resolves.toEqual({ available: true, connected: true, address: MAILBOX });
    const page = callbackPage('connected', 'en');
    expect(page).toContain('Your mailbox is connected.');
    expect(page).toContain(returnUrl('connected'));
    expect(returnUrl('connected')).toBe('meetingguardai://matters/mailbox?result=connected');
    expect(callbackPage('failed', 'es')).toContain('No se ha podido conectar tu buzón.');
  });

  it('a reused, unknown, malformed or expired state, a wrong verifier or a denial stores nothing', async () => {
    const ctx = setup();
    const { state } = await connect(ctx);
    ctx.mailboxStore.records.clear();
    // reused: the state was taken by the first callback
    await expect(handleMailboxCallback({ code: 'the-code', state }, ctx.deps)).resolves.toMatchObject({ result: 'expired' });
    await expect(handleMailboxCallback({ code: 'the-code', state: 'not-a-state' }, ctx.deps)).resolves.toMatchObject({ result: 'expired' });
    await expect(handleMailboxCallback({ code: 'the-code', state: 'a'.repeat(32) }, ctx.deps)).resolves.toMatchObject({ result: 'expired' });

    const late = await handleMatterMailbox(CALLER, { action: 'connect' }, ctx.deps);
    ctx.clock.now = new Date(NOW.getTime() + 11 * 60_000);
    await expect(handleMailboxCallback({ code: 'the-code', state: new URL(late.authUrl!).searchParams.get('state') }, ctx.deps)).resolves.toMatchObject({ result: 'expired' });
    ctx.clock.now = NOW;

    // the code redeemed with a verifier that does not match the link's challenge
    const other = await handleMatterMailbox(CALLER, { action: 'connect' }, ctx.deps);
    ctx.microsoft.challenge = 'not-the-challenge';
    await expect(handleMailboxCallback({ code: 'the-code', state: new URL(other.authUrl!).searchParams.get('state') }, ctx.deps)).resolves.toMatchObject({ result: 'failed' });

    const denied = await handleMatterMailbox(CALLER, { action: 'connect', language: 'es' }, ctx.deps);
    await expect(handleMailboxCallback({ error: 'access_denied', state: new URL(denied.authUrl!).searchParams.get('state') }, ctx.deps)).resolves.toEqual({ result: 'denied', language: 'es' });
    expect(ctx.mailboxStore.records.size).toBe(0);
  });

  it('a consent without Mail.Send is refused; connect needs the tester list and the switch on', async () => {
    const ctx = setup();
    ctx.microsoft.grantedScope = 'https://graph.microsoft.com/User.Read';
    await expect(connect(ctx)).resolves.toMatchObject({ done: { result: 'failed' } });
    expect(ctx.mailboxStore.records.size).toBe(0);
    await expect(handleMatterMailbox(CALLER, { action: 'connect' }, { ...ctx.deps, allowed: () => false })).rejects.toMatchObject({ details: { reason: 'not_configured' } });
    await expect(handleMatterMailbox(CALLER, { action: 'connect' }, { ...ctx.deps, enabled: false })).rejects.toMatchObject({ details: { reason: 'not_configured' } });
    // a sign-in started before the switch went off completes nothing
    const started = await handleMatterMailbox(CALLER, { action: 'connect' }, ctx.deps);
    await expect(handleMailboxCallback({ code: 'the-code', state: new URL(started.authUrl!).searchParams.get('state') }, { ...ctx.deps, enabled: false })).resolves.toMatchObject({ result: 'not_allowed' });
  });

  it('without a client id or a usable key the mailbox is unavailable', async () => {
    const off = setup();
    off.mailbox.available = false;
    await expect(handleMatterMailbox(CALLER, { action: 'status' }, off.deps)).resolves.toEqual({ available: false, connected: false, address: null });
    await expect(handleMatterMailbox(CALLER, { action: 'connect' }, off.deps)).rejects.toMatchObject({ details: { reason: 'not_configured' } });
    const weak = setup({}, 'a short password');
    await expect(handleMatterMailbox(CALLER, { action: 'status' }, weak.deps)).resolves.toMatchObject({ available: false });
  });
});

describe('T9.3 encryption at rest', () => {
  const keys = parseMailboxKeys(KEY_A);

  it('AES-256-GCM bound to the uid and mailbox; a changed byte or another place does not decrypt', () => {
    const sealed = sealSecret(REFRESH, mailboxAad('u1', MAILBOX), keys);
    expect(sealed.startsWith(`v1.${keys[0]!.id}.`)).toBe(true);
    expect(sealed).not.toContain(REFRESH);
    expect(openSecret(sealed, mailboxAad('u1', MAILBOX.toUpperCase()), keys)).toBe(REFRESH);
    expect(() => openSecret(sealed, mailboxAad('u2', MAILBOX), keys)).toThrow(MailboxCryptoError);
    expect(() => openSecret(sealed, mailboxAad('u1', 'other@outlook.com'), keys)).toThrow(MailboxCryptoError);
    const parts = sealed.split('.');
    const body = Buffer.from(parts[3]!, 'base64url');
    body[0] = body[0]! ^ 1;
    parts[3] = body.toString('base64url');
    expect(() => openSecret(parts.join('.'), mailboxAad('u1', MAILBOX), keys)).toThrow(/tampered/);
    // a fresh nonce every time
    expect(sealSecret(REFRESH, mailboxAad('u1', MAILBOX), keys)).not.toBe(sealed);
  });

  it('rotates: the first key encrypts, every listed key decrypts; a weak key is refused', () => {
    const old = sealSecret(REFRESH, 'aad', parseMailboxKeys(KEY_A));
    const rotated: MailboxKey[] = parseMailboxKeys(`${KEY_B},${KEY_A}`);
    expect(openSecret(old, 'aad', rotated)).toBe(REFRESH);
    expect(sealSecret(REFRESH, 'aad', rotated).split('.')[1]).toBe(keyIdOf(Buffer.from(KEY_B, 'hex')));
    expect(() => openSecret(old, 'aad', parseMailboxKeys(KEY_B))).toThrow(/unknown_key/);
    expect(() => parseMailboxKeys('')).toThrow(/no_key/);
    expect(() => parseMailboxKeys('password123')).toThrow(/no_key/);
  });
});

describe('T9.4 no token leaves the server', () => {
  it('not in the stored record, a response or a log line', async () => {
    const ctx = setup();
    const { started } = await connect(ctx);
    const matterId = await active(ctx);
    const stored = JSON.stringify([...ctx.mailboxStore.records.values()]);
    for (const secret of [REFRESH, ACCESS, 'the-code', 'client-secret']) {
      expect(stored).not.toContain(secret);
      expect(logged()).not.toContain(secret);
      expect(JSON.stringify(started)).not.toContain(secret);
      expect(JSON.stringify(await handleMatterMailbox(CALLER, { action: 'status' }, ctx.deps))).not.toContain(secret);
    }
    expect(JSON.stringify(await ctx.store.getMatter('u1', matterId))).not.toContain(REFRESH);
  });
});

describe('T9.5 sending from the mailbox', () => {
  it('a new draft sends from the connected mailbox; the read-back and the hash say so', async () => {
    const ctx = setup();
    await connect(ctx);
    const d = await draft(ctx);
    expect(d.sendFrom).toBe('mailbox');
    expect(d.firstEmail!.from).toBe(MAILBOX);
    expect(d.readBack).toContain(`from your mailbox ${MAILBOX}`);
    const doc = (await ctx.store.getMatter('u1', d.matterId))!;
    expect(d.draftHash).toBe(draftHash(doc.mandate!, doc.firstEmail!, doc.scheduling, MAILBOX));
    expect(d.draftHash).not.toBe(draftHash(doc.mandate!, doc.firstEmail!, doc.scheduling));

    // switching back to the assistant's address is a new version: the old hash is stale
    const back = await handleMatterMailbox(CALLER, { action: 'sendFrom', matterId: d.matterId, mailbox: false }, ctx.deps);
    expect(back.draft).toMatchObject({ sendFrom: 'assistant' });
    expect(back.draft!.firstEmail!.from).toBe(`"AI assistant for Ana Lopez" <assistant@${DOMAIN}>`);
    await expect(handleMatterConfirm(CALLER, { matterId: d.matterId, draftHash: d.draftHash }, ctx.deps)).rejects.toMatchObject({ details: { reason: 'stale_draft' } });
  });

  it('confirming sends through Graph with Reply-To the matter address; nothing goes through the assistant\u2019s address; the reply comes back as usual', async () => {
    const ctx = setup();
    await connect(ctx);
    const matterId = await active(ctx);
    expect(ctx.sender.sent).toHaveLength(0);
    expect(ctx.microsoft.sent).toHaveLength(1);
    const message = ctx.microsoft.sent[0]!.message as Record<string, unknown>;
    expect(message.replyTo).toEqual([{ emailAddress: { address: `m-${TOKEN}@${DOMAIN}` } }]);
    expect(message.toRecipients).toEqual([{ emailAddress: { address: 'carlos@example.com' } }]);
    expect((message.body as { content: string }).content).toContain('This email was written by AI');
    expect(ctx.microsoft.sent[0]!.saveToSentItems).toBe(true);
    const doc = (await ctx.store.getMatter('u1', matterId))!;
    expect(doc).toMatchObject({ status: 'active', sendFrom: 'mailbox', mailboxAddress: MAILBOX, firstSendState: 'sent' });
    // the contact answers the Reply-To: the reply reaches this matter through our inbound (T1)
    await reply(ctx);
    expect(ctx.store.messageList('u1', matterId).filter((m) => m.direction === 'inbound')).toHaveLength(1);
    // an approved reply goes out through the mailbox too
    const card = await replyCard(ctx, matterId);
    await expect(handleMatterDecide(CALLER, { matterId, target: 'approval', id: card.id, action: 'approve', draftHash: card.draftHash }, ctx.deps)).resolves.toMatchObject({ outcome: 'sent' });
    expect(ctx.microsoft.sent).toHaveLength(2);
    expect(ctx.sender.sent).toHaveLength(0);
  });

  it('a rotated refresh token replaces the stored one', async () => {
    const ctx = setup();
    await connect(ctx);
    ctx.microsoft.rotate = true;
    await active(ctx);
    const record = ctx.mailboxStore.records.get('u1')!;
    expect(openSecret(record.sealedRefresh, mailboxAad('u1', MAILBOX), parseMailboxKeys(KEY_A))).toBe(REFRESH_TWO);
  });

  it('the Graph message: plain text, recipients, copy and Reply-To', () => {
    expect(graphMessage({ from: MAILBOX, to: ['a@x.com'], cc: ['b@x.com'], replyTo: 'm@x.com', subject: 'S', text: 'T', messageId: '<m@x>', inReplyTo: null, references: [] })).toEqual({
      message: {
        subject: 'S',
        body: { contentType: 'Text', content: 'T' },
        toRecipients: [{ emailAddress: { address: 'a@x.com' } }],
        ccRecipients: [{ emailAddress: { address: 'b@x.com' } }],
        replyTo: [{ emailAddress: { address: 'm@x.com' } }],
      },
      saveToSentItems: true,
    });
  });
});

describe('T9.6 a draft can only send from a connected mailbox', () => {
  it('sendFrom needs a connection, and only a draft can change', async () => {
    const ctx = setup();
    const d = await draft(ctx);
    expect(d.sendFrom).toBe('assistant');
    await expect(handleMatterMailbox(CALLER, { action: 'sendFrom', matterId: d.matterId, mailbox: true }, ctx.deps)).rejects.toMatchObject({ details: { reason: 'not_allowed' } });
    await connect(ctx);
    const switched = await handleMatterMailbox(CALLER, { action: 'sendFrom', matterId: d.matterId, mailbox: true }, ctx.deps);
    expect(switched.draft).toMatchObject({ sendFrom: 'mailbox' });
    await handleMatterConfirm(CALLER, { matterId: d.matterId, draftHash: switched.draft!.draftHash }, ctx.deps);
    await expect(handleMatterMailbox(CALLER, { action: 'sendFrom', matterId: d.matterId, mailbox: false }, ctx.deps)).rejects.toMatchObject({ details: { reason: 'invalid_request' } });
  });
});

describe('T9.7 pause', () => {
  it('a paused matter sends nothing from the mailbox: no approved reply, no follow-up', async () => {
    const ctx = setup();
    await connect(ctx);
    const matterId = await active(ctx);
    const card = await replyCard(ctx, matterId);
    await handleMatterSetStatus(CALLER, { matterId, action: 'pause' }, ctx.deps);
    await expect(handleMatterDecide(CALLER, { matterId, target: 'approval', id: card.id, action: 'approve', draftHash: card.draftHash }, ctx.deps)).rejects.toBeDefined();
    ctx.clock.now = new Date(NOW.getTime() + 5 * 24 * HOUR);
    await runMatterTick(ctx.deps);
    expect(ctx.microsoft.sent).toHaveLength(1);
  });
});

describe('T9.8 disconnect', () => {
  it('deletes the access at once; a later send fails with a timeline entry, never from another address', async () => {
    const ctx = setup();
    await connect(ctx);
    const matterId = await active(ctx);
    const card = await replyCard(ctx, matterId);
    // the owner may always disconnect, even off the tester list
    await expect(handleMatterMailbox(CALLER, { action: 'disconnect' }, { ...ctx.deps, allowed: () => false })).resolves.toMatchObject({ connected: false });
    expect(ctx.mailboxStore.records.size).toBe(0);
    await expect(handleMatterDecide(CALLER, { matterId, target: 'approval', id: card.id, action: 'approve', draftHash: card.draftHash }, ctx.deps)).resolves.toMatchObject({ outcome: 'failed' });
    expect(ctx.sender.sent).toHaveLength(0);
    expect(ctx.microsoft.sent).toHaveLength(1);
    expect(allEvents(ctx).filter((e) => e.type === 'email_failed').map((e) => e.detail)).toEqual(['mailbox']);
    // follow-ups fail the same way, without calling Microsoft
    const before = ctx.microsoft.calls.length;
    ctx.clock.now = new Date(NOW.getTime() + 5 * 24 * HOUR);
    await runMatterTick(ctx.deps);
    expect(ctx.microsoft.calls.length).toBe(before);
    expect(ctx.sender.sent).toHaveLength(0);
  });

  it('another mailbox connected later never sends a matter confirmed for the first one', async () => {
    const ctx = setup();
    await connect(ctx);
    const matterId = await active(ctx);
    ctx.microsoft.me = { mail: 'someone.else@outlook.com', displayName: 'Other' };
    await connect(ctx);
    const doc = (await ctx.store.getMatter('u1', matterId))!;
    await expect(senderFor(ctx.deps, 'u1', doc).send({ from: MAILBOX, to: ['carlos@example.com'], cc: [], replyTo: 'm@x', subject: 'S', text: 'T', messageId: '<m@x>', inReplyTo: null, references: [] })).rejects.toMatchObject({ reason: 'changed' });
  });
});

describe('T9.9 Microsoft refuses the access', () => {
  it('invalid_grant is a disconnect: the access is deleted and not retried', async () => {
    const ctx = setup();
    await connect(ctx);
    const matterId = await active(ctx);
    const card = await replyCard(ctx, matterId);
    ctx.microsoft.tokenError = 'invalid_grant';
    await expect(handleMatterDecide(CALLER, { matterId, target: 'approval', id: card.id, action: 'approve', draftHash: card.draftHash }, ctx.deps)).resolves.toMatchObject({ outcome: 'failed' });
    expect(ctx.mailboxStore.records.size).toBe(0);
    const tokenCalls = ctx.microsoft.calls.filter((c) => c.url.endsWith('/token')).length;
    ctx.clock.now = new Date(NOW.getTime() + 5 * 24 * HOUR);
    await runMatterTick(ctx.deps);
    expect(ctx.microsoft.calls.filter((c) => c.url.endsWith('/token')).length).toBe(tokenCalls);
  });

  it('a refused send (401) also deletes the access; an expired client secret keeps it and fails safely', async () => {
    const ctx = setup();
    await connect(ctx);
    ctx.microsoft.sendStatus = 401;
    const first = await draft(ctx);
    await expect(handleMatterConfirm(CALLER, { matterId: first.matterId, draftHash: first.draftHash }, ctx.deps)).resolves.toMatchObject({ outcome: 'failed' });
    expect(ctx.mailboxStore.records.size).toBe(0);

    const other = setup();
    await connect(other);
    other.microsoft.tokenError = 'invalid_client';
    const d = await draft(other);
    await expect(handleMatterConfirm(CALLER, { matterId: d.matterId, draftHash: d.draftHash }, other.deps)).resolves.toMatchObject({ outcome: 'failed' });
    expect(other.mailboxStore.records.size).toBe(1);
    await expect(senderFor(other.deps, 'u1', { sendFrom: 'mailbox', mailboxAddress: MAILBOX }).send({ from: MAILBOX, to: ['carlos@example.com'], cc: [], replyTo: 'm@x', subject: 'S', text: 'T', messageId: '<m@x>', inReplyTo: null, references: [] })).rejects.toBeInstanceOf(MailboxSendError);
  });
});

describe('T9.10 the runtime switch', () => {
  it('off, nothing is sent from the mailbox', async () => {
    const ctx = setup();
    await connect(ctx);
    const matterId = await active(ctx);
    const card = await replyCard(ctx, matterId);
    const off = { ...ctx.deps, enabled: false };
    await expect(handleMatterDecide(CALLER, { matterId, target: 'approval', id: card.id, action: 'approve', draftHash: card.draftHash }, off)).rejects.toBeDefined();
    ctx.clock.now = new Date(NOW.getTime() + 5 * 24 * HOUR);
    await runMatterTick(off);
    expect(ctx.microsoft.sent).toHaveLength(1);
  });
});
