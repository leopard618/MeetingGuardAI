/**
 * Connect Fathom (functions/src/summaries/fathom/*; docs/v2/FATHOM-CONNECT.md): signatures, the
 * recap text, fathomConnect, the fathomOAuth return step, the webhook pipeline end to end on the
 * in-memory Firestore fake, disconnect and account deletion. Fathom is a scripted fetch fake; the
 * logger is mocked and read back to prove no line carries a token, a secret or content.
 */
jest.mock('firebase-functions/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

import { createHmac } from 'node:crypto';

import * as logger from 'firebase-functions/logger';
import type { Firestore } from 'firebase-admin/firestore';

import { parseKeyring } from '../../src/shared/sealed';
import { newSummaryUserFields, tokenHash } from '../../src/summaries/address';
import { deleteSummaryDataForUid } from '../../src/summaries/accountDeletion';
import type { SummaryCallableAuth } from '../../src/summaries/callables';
import { loadCandidates } from '../../src/summaries/candidates';
import { FATHOM_API_BASE, FATHOM_AUTHORIZE_URL, FATHOM_TOKEN_URL, type FathomFetch } from '../../src/summaries/fathom/api';
import { deletionMarkerKey, summaryEventPath, summaryIdFor } from '../../src/summaries/model';
import { handleFathomConnect, handleFathomOAuth, type FathomConnectDeps } from '../../src/summaries/fathom/connect';
import { fathomMeetingSchema, recapTextOf } from '../../src/summaries/fathom/payload';
import { verifyFathomSignature } from '../../src/summaries/fathom/signature';
import { hookHashOf, openSecrets, sealSecrets } from '../../src/summaries/fathom/store';
import { handleFathomWebhook, type FathomWebhookDeps, type FathomWebhookRequest } from '../../src/summaries/fathom/webhook';
import { FakeFirestore } from './summariesFakeFirestore';

const UID = 'uidFathomDana001';
const EMAIL = 'dana@company.example';
const TOKEN = 'k3j5h7g2f4d6s2a3p5o7i2u4y6';
const TEMPLATE = '{token}@summaries.meetingguard.example';
const ADDRESS = `${TOKEN}@summaries.meetingguard.example`;
const DATA_KEY = `k1:${Buffer.alloc(32, 7).toString('base64')}`;
const KEYRING = parseKeyring(DATA_KEY);
const CLIENT_ID = 'fathom-client-id-test';
const CLIENT_SECRET = 'fathom-client-secret-test-9f2';
const REDIRECT_URI = 'https://us-central1-demo.cloudfunctions.net/fathomOAuth';
const WEBHOOK_URL = 'https://us-central1-demo.cloudfunctions.net/fathomWebhook';
const WEBHOOK_SECRET = `whsec_${Buffer.alloc(24, 3).toString('base64')}`;
const ACCESS_TOKEN = 'fathom-access-token-AAAA';
const REFRESH_TOKEN = 'fathom-refresh-token-BBBB';
const NOW = new Date('2026-11-10T15:30:00.000Z');
const MEETING_ID = 'mtgUrpayrollSync01';

function verifiedAuth(uid = UID): SummaryCallableAuth {
  return { uid, token: { email: EMAIL, email_verified: true, firebase: { sign_in_provider: 'password' } } };
}

function seedUser(fake: FakeFirestore, withAddress = true): void {
  fake.seed(`users/${UID}`, { createdAt: '2026-11-01T09:00:00.000Z' });
  fake.seed(`users/${UID}/settings/preferences`, { timezone: 'UTC' });
  if (withAddress) {
    fake.seed(`summaryAddresses/${tokenHash(TOKEN)}`, { uid: UID, createdAt: '2026-11-01T09:00:00.000Z' });
    fake.seed(`summaryUsers/${UID}`, newSummaryUserFields(TOKEN, ADDRESS, [EMAIL], '2026-11-01T09:00:00.000Z'));
  }
  fake.seed(`users/${UID}/meetings/${MEETING_ID}`, {
    allDay: false,
    status: 'scheduled',
    deletedAt: null,
    source: 'google',
    timezone: 'UTC',
    updatedAt: '2026-11-01T09:00:00.000Z',
    title: 'Urpayroll weekly sync',
    startAt: '2026-11-10T14:00:00.000Z',
    durationMinutes: 60,
  });
}

interface FetchCall {
  url: string;
  method: string;
  body: string | undefined;
  authorization: string | undefined;
}

/** A scripted Fathom: token grants, webhook create and delete, and for the sync GET /meetings and GET /recordings/{id}/summary. */
interface FakeFathomOptions {
  tokenStatus?: number;
  createStatus?: number;
  deleteStatus?: number;
  expiresIn?: number;
  /** GET /meetings items (one page). */
  meetings?: unknown[];
  meetingsStatus?: number;
  /** The whole GET /meetings body, in place of the default page. */
  meetingsBody?: unknown;
  /** GET /recordings/{id}/summary markdown by recording id; null or missing = no summary yet. */
  recordingSummaries?: Record<string, string | null>;
}

function fakeFathom(options: FakeFathomOptions = {}) {
  const calls: FetchCall[] = [];
  let webhookCounter = 0;
  let refreshCounter = 0;
  const fetch: FathomFetch = async (url, init) => {
    calls.push({ url, method: init.method, body: init.body, authorization: init.headers.authorization });
    const reply = (status: number, json: unknown) => ({ status, json: async () => json });
    if (url === FATHOM_TOKEN_URL) {
      const form = new URLSearchParams(init.body ?? '');
      if ((options.tokenStatus ?? 200) !== 200) return reply(options.tokenStatus ?? 400, { error: 'invalid_grant' });
      if (form.get('grant_type') === 'refresh_token') {
        refreshCounter += 1;
        return reply(200, { access_token: `${ACCESS_TOKEN}-r${refreshCounter}`, refresh_token: `${REFRESH_TOKEN}-r${refreshCounter}`, expires_in: 3600 });
      }
      return reply(200, { access_token: ACCESS_TOKEN, refresh_token: REFRESH_TOKEN, expires_in: options.expiresIn ?? 3600, token_type: 'Bearer' });
    }
    if (url.endsWith('/webhooks') && init.method === 'POST') {
      webhookCounter += 1;
      if ((options.createStatus ?? 201) !== 201) return reply(options.createStatus ?? 500, {});
      return reply(201, { id: `wh_${webhookCounter}`, secret: WEBHOOK_SECRET, url: 'x', created_at: NOW.toISOString() });
    }
    if (url.includes('/webhooks/') && init.method === 'DELETE') return reply(options.deleteStatus ?? 204, null);
    if (url.startsWith(`${FATHOM_API_BASE}/meetings?`) && init.method === 'GET') {
      if ((options.meetingsStatus ?? 200) !== 200) return reply(options.meetingsStatus ?? 500, {});
      return reply(200, options.meetingsBody ?? { limit: 10, next_cursor: null, items: options.meetings ?? [] });
    }
    const summaryMatch = /\/recordings\/(\d+)\/summary$/.exec(url);
    if (summaryMatch !== null && init.method === 'GET') {
      const markdown = options.recordingSummaries?.[summaryMatch[1] ?? ''] ?? null;
      return markdown === null ? reply(404, {}) : reply(200, { summary: { template_name: 'general', markdown_formatted: markdown } });
    }
    return reply(404, {});
  };
  return { fetch, calls };
}

interface Harness {
  fake: FakeFirestore;
  fathom: ReturnType<typeof fakeFathom>;
  deps: FathomConnectDeps;
  setNow(date: Date): void;
}

function harness(options: { withAddress?: boolean; fathom?: Parameters<typeof fakeFathom>[0]; clientId?: string } = {}): Harness {
  const fake = new FakeFirestore();
  seedUser(fake, options.withAddress !== false);
  const fathom = fakeFathom(options.fathom);
  let now = NOW;
  let counter = 0;
  const deps: FathomConnectDeps = {
    db: fake as unknown as Firestore,
    now: () => now,
    config: { enabled: true, pilotUids: '*', template: TEMPLATE, clientId: options.clientId ?? CLIENT_ID },
    clientSecret: () => CLIENT_SECRET,
    keyring: () => KEYRING,
    fetch: fathom.fetch,
    redirectUri: REDIRECT_URI,
    webhookUrl: WEBHOOK_URL,
    authUsers: { getUser: async (uid) => ({ exists: uid === UID, disabled: false, email: EMAIL, emailVerified: true }) },
    // Deterministic but distinct random tokens.
    random: (size) => {
      counter += 1;
      return Buffer.alloc(size, counter);
    },
    sleep: async () => undefined,
    candidates: loadCandidates,
  };
  return { fake, fathom, deps, setNow: (date) => (now = date) };
}

function stateOf(url: string): string {
  return new URL(url).searchParams.get('state') ?? '';
}

async function connect(h: Harness): Promise<string> {
  const started = await handleFathomConnect(verifiedAuth(), { op: 'start' }, h.deps);
  const state = stateOf(started.authorizeUrl ?? '');
  const back = await handleFathomOAuth({ method: 'GET', query: { code: 'auth-code-123', state } }, h.deps);
  expect(back.location).toBe('meetingguardai://fathom?result=connected');
  // The hook token is the ?k= of the created webhook.
  const create = h.fathom.calls.find((call) => call.method === 'POST' && call.url.endsWith('/webhooks'));
  const destination = JSON.parse(create?.body ?? '{}').destination_url as string;
  return new URL(destination).searchParams.get('k') ?? '';
}

function sign(body: string, id = 'msg_1', timestamp = Math.floor(NOW.getTime() / 1000)): Pick<FathomWebhookRequest, 'webhookId' | 'webhookTimestamp' | 'webhookSignature'> {
  const key = Buffer.from(WEBHOOK_SECRET.slice('whsec_'.length), 'base64');
  const signature = createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64');
  return { webhookId: id, webhookTimestamp: String(timestamp), webhookSignature: `v1,${signature}` };
}

const MEETING_PAYLOAD = {
  title: 'Urpayroll weekly sync',
  meeting_title: 'Urpayroll weekly sync',
  recording_id: 123456789,
  url: 'https://fathom.video/calls/123456789',
  share_url: 'https://fathom.video/share/abc',
  meeting_url: 'https://meet.google.com/abc-defg-hij',
  created_at: '2026-11-10T15:05:00Z',
  scheduled_start_time: '2026-11-10T14:00:00Z',
  scheduled_end_time: '2026-11-10T15:00:00Z',
  recording_start_time: '2026-11-10T14:01:00Z',
  recording_end_time: '2026-11-10T15:02:00Z',
  calendar_invitees_domains_type: 'one_or_more_external',
  transcript_language: 'en',
  recorded_by: { name: 'Dana', email: EMAIL, email_domain: 'company.example', team: null },
  calendar_invitees: [],
  default_summary: {
    template_name: 'general',
    markdown_formatted: [
      '## Meeting Purpose',
      '',
      'Review the **payroll export** before the release.',
      '',
      '## Key Takeaways',
      '',
      '- The export format stays CSV [0:35](https://fathom.video/share/abc?timestamp=35)',
      '- QA starts on Thursday',
      '',
      '## Next Steps',
      '',
      '- Dana: send the release checklist',
    ].join('\n'),
  },
  action_items: [
    { description: 'Provide APK access to Urpayroll', user_generated: false, completed: false, assignee: { name: 'Bish', email: null, team: null } },
    { description: 'Send the release checklist', user_generated: false, completed: false, assignee: { name: 'Dana', email: EMAIL, team: null } },
  ],
};

function webhookDeps(h: Harness): FathomWebhookDeps {
  return {
    enabled: () => true,
    pilotUids: () => '*',
    keyring: () => KEYRING,
    db: h.deps.db,
    authUsers: h.deps.authUsers!,
    candidates: loadCandidates,
    now: () => NOW,
  };
}

function deliver(h: Harness, hookToken: string, body: string, signed = sign(body)) {
  return handleFathomWebhook({ method: 'POST', hookToken, rawBody: Buffer.from(body, 'utf8'), ...signed }, webhookDeps(h));
}

function summaries(fake: FakeFirestore): Record<string, unknown>[] {
  return fake
    .paths()
    .filter((path) => path.startsWith(`users/${UID}/meetingSummaries/`) && !path.includes('/refused-'))
    .map((path) => fake.data(path) as Record<string, unknown>);
}

function allLogText(): string {
  return JSON.stringify([logger.info, logger.warn, logger.error].flatMap((fn) => (fn as unknown as jest.Mock).mock.calls));
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------------------------

describe('verifyFathomSignature', () => {
  const body = Buffer.from('{"a":1}', 'utf8');
  const nowMs = NOW.getTime();

  it('accepts a v1 signature over id.timestamp.body, among others', () => {
    const signed = sign('{"a":1}');
    expect(
      verifyFathomSignature({ id: signed.webhookId, timestamp: signed.webhookTimestamp, signature: `v1,AAAA ${signed.webhookSignature}`, rawBody: body, secret: WEBHOOK_SECRET, nowMs }),
    ).toBe('ok');
  });

  it('refuses a changed body, a stale timestamp, missing headers and a bad secret', () => {
    const signed = sign('{"a":1}');
    const base = { id: signed.webhookId, timestamp: signed.webhookTimestamp, signature: signed.webhookSignature, secret: WEBHOOK_SECRET, nowMs };
    expect(verifyFathomSignature({ ...base, rawBody: Buffer.from('{"a":2}') })).toBe('mismatch');
    expect(verifyFathomSignature({ ...base, rawBody: body, nowMs: nowMs + 6 * 60 * 1000 })).toBe('stale');
    expect(verifyFathomSignature({ ...base, rawBody: body, signature: undefined })).toBe('missing_headers');
    expect(verifyFathomSignature({ ...base, rawBody: body, secret: 'not-a-secret' })).toBe('bad_secret');
    expect(verifyFathomSignature({ ...base, rawBody: body, timestamp: 'soon' })).toBe('bad_timestamp');
  });
});

describe('recapTextOf', () => {
  it('builds the title, link, cleaned markdown and an Action Items section with owners', () => {
    const text = recapTextOf(fathomMeetingSchema.parse(MEETING_PAYLOAD));
    expect(text.split('\n').slice(0, 2)).toEqual(['Urpayroll weekly sync', 'Meeting link: https://meet.google.com/abc-defg-hij']);
    expect(text).toContain('Review the payroll export before the release.');
    expect(text).toContain('- The export format stays CSV');
    expect(text).not.toContain('timestamp=35');
    expect(text).toContain('## Action Items\n- Provide APK access to Urpayroll (owner: Bish)\n- Send the release checklist (owner: Dana)');
  });
});

describe('fathomConnect', () => {
  it('status: available and not connected for an allowed caller', async () => {
    const h = harness();
    const out = await handleFathomConnect(verifiedAuth(), { op: 'status' }, h.deps);
    expect(out.status).toEqual({ available: true, connected: false, connectedAt: null, lastEventAt: null });
  });

  it('status: unavailable without a client id or for a caller outside the pilot', async () => {
    expect((await handleFathomConnect(verifiedAuth(), { op: 'status' }, harness({ clientId: '' }).deps)).status.available).toBe(false);
    const h = harness();
    h.deps.config.pilotUids = 'someoneElse01';
    expect((await handleFathomConnect(verifiedAuth(), { op: 'status' }, h.deps)).status.available).toBe(false);
  });

  it('start: creates the private address when missing and answers the authorize URL with a single-use state', async () => {
    const h = harness({ withAddress: false });
    const out = await handleFathomConnect(verifiedAuth(), { op: 'start' }, h.deps);
    const url = new URL(out.authorizeUrl ?? '');
    expect(`${url.origin}${url.pathname}`).toBe(FATHOM_AUTHORIZE_URL);
    expect(url.searchParams.get('client_id')).toBe(CLIENT_ID);
    expect(url.searchParams.get('redirect_uri')).toBe(REDIRECT_URI);
    expect(url.searchParams.get('scope')).toBe('public_api');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(stateOf(out.authorizeUrl ?? '')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(h.fake.data(`summaryUsers/${UID}`)).toBeDefined();
    expect(h.fake.paths().filter((path) => path.startsWith('fathomOAuthStates/'))).toHaveLength(1);
  });

  it('start: refuses signed-out and unverified callers', async () => {
    const h = harness();
    await expect(handleFathomConnect(null, { op: 'start' }, h.deps)).rejects.toMatchObject({ details: { reason: 'unauthenticated' } });
    await expect(
      handleFathomConnect({ uid: UID, token: { email: EMAIL, email_verified: false, firebase: { sign_in_provider: 'password' } } }, { op: 'start' }, h.deps),
    ).rejects.toMatchObject({ details: { reason: 'unauthenticated' } });
  });
});

describe('fathomOAuth', () => {
  it('exchanges the code, creates the webhook for my_recordings and seals the secrets', async () => {
    const h = harness();
    const hookToken = await connect(h);
    const exchange = h.fathom.calls.find((call) => call.url === FATHOM_TOKEN_URL);
    const form = new URLSearchParams(exchange?.body ?? '');
    expect(form.get('grant_type')).toBe('authorization_code');
    expect(form.get('code')).toBe('auth-code-123');
    expect(form.get('redirect_uri')).toBe(REDIRECT_URI);
    expect(form.get('client_secret')).toBe(CLIENT_SECRET);
    const create = h.fathom.calls.find((call) => call.method === 'POST' && call.url.endsWith('/webhooks'));
    expect(create?.authorization).toBe(`Bearer ${ACCESS_TOKEN}`);
    expect(JSON.parse(create?.body ?? '{}')).toMatchObject({ triggered_for: ['my_recordings'], include_summary: true, include_action_items: true, include_transcript: false });
    expect(hookToken).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const connection = h.fake.data(`fathomConnections/${UID}`) as Record<string, unknown>;
    expect(connection.webhookId).toBe('wh_1');
    expect(JSON.stringify(connection)).not.toContain(ACCESS_TOKEN);
    expect(JSON.stringify(connection)).not.toContain(WEBHOOK_SECRET);
    expect(openSecrets(KEYRING, UID, connection.sealedSecrets as string)).toMatchObject({ refreshToken: REFRESH_TOKEN, webhookSecret: WEBHOOK_SECRET });
    expect(h.fake.data(`fathomHooks/${hookHashOf(hookToken)}`)).toMatchObject({ uid: UID });
    // The state is spent.
    expect(h.fake.paths().filter((path) => path.startsWith('fathomOAuthStates/'))).toHaveLength(0);

    const status = await handleFathomConnect(verifiedAuth(), { op: 'status' }, h.deps);
    expect(status.status.connected).toBe(true);
    expect(allLogText()).not.toMatch(/fathom-access-token|fathom-refresh-token|whsec_|auth-code-123/);
  });

  it('a reused, unknown or expired state never connects', async () => {
    const h = harness();
    const started = await handleFathomConnect(verifiedAuth(), { op: 'start' }, h.deps);
    const state = stateOf(started.authorizeUrl ?? '');
    h.setNow(new Date(NOW.getTime() + 11 * 60 * 1000));
    expect((await handleFathomOAuth({ method: 'GET', query: { code: 'c', state } }, h.deps)).location).toBe('meetingguardai://fathom?result=error&reason=expired');
    expect((await handleFathomOAuth({ method: 'GET', query: { code: 'c', state } }, h.deps)).location).toBe('meetingguardai://fathom?result=error&reason=expired');
    expect((await handleFathomOAuth({ method: 'GET', query: { code: 'c', state: 'x'.repeat(43) } }, h.deps)).location).toBe(
      'meetingguardai://fathom?result=error&reason=expired',
    );
    expect(h.fathom.calls).toHaveLength(0);
  });

  it('the user declining in Fathom returns cancelled', async () => {
    const h = harness();
    const started = await handleFathomConnect(verifiedAuth(), { op: 'start' }, h.deps);
    const out = await handleFathomOAuth({ method: 'GET', query: { error: 'access_denied', state: stateOf(started.authorizeUrl ?? '') } }, h.deps);
    expect(out.location).toBe('meetingguardai://fathom?result=cancelled');
  });

  it('a refused code returns fathom_refused and saves nothing', async () => {
    const h = harness({ fathom: { tokenStatus: 400 } });
    const started = await handleFathomConnect(verifiedAuth(), { op: 'start' }, h.deps);
    const out = await handleFathomOAuth({ method: 'GET', query: { code: 'bad', state: stateOf(started.authorizeUrl ?? '') } }, h.deps);
    expect(out.location).toBe('meetingguardai://fathom?result=error&reason=fathom_refused');
    expect(h.fake.data(`fathomConnections/${UID}`)).toBeUndefined();
  });
});

describe('fathomWebhook', () => {
  it('a signed delivery is filed to the matching meeting automatically', async () => {
    const h = harness();
    const hookToken = await connect(h);
    const body = JSON.stringify(MEETING_PAYLOAD);
    const out = await deliver(h, hookToken, body);
    expect(out.status).toBe(200);
    const stored = summaries(h.fake);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      status: 'matched',
      source: 'fathom_api',
      senderDomain: 'fathom.video',
      vendorDomain: 'fathom.video',
      trust: { tier: 'vendor_verified', recipientBound: true, fresh: true, anchorSource: 'signed_date' },
      match: { meetingId: MEETING_ID },
    });
    expect((h.fake.data(`fathomConnections/${UID}`) as Record<string, unknown>).lastEventAt).toBe(NOW.toISOString());
    // A redelivery (same recording) is a duplicate.
    await deliver(h, hookToken, body, sign(body, 'msg_2'));
    expect(summaries(h.fake)).toHaveLength(1);
    expect(allLogText()).not.toMatch(/Urpayroll|payroll export|whsec_/);
  });

  it('a bad signature is 401 and stores nothing', async () => {
    const h = harness();
    const hookToken = await connect(h);
    const body = JSON.stringify(MEETING_PAYLOAD);
    const out = await deliver(h, hookToken, body, { ...sign(body), webhookSignature: 'v1,AAAA' });
    expect(out.status).toBe(401);
    expect(summaries(h.fake)).toHaveLength(0);
  });

  it('an unknown hook or a malformed token is answered 200 and ignored', async () => {
    const h = harness();
    await connect(h);
    const body = JSON.stringify(MEETING_PAYLOAD);
    expect((await deliver(h, 'y'.repeat(43), body)).status).toBe(200);
    expect((await deliver(h, 'short', body)).status).toBe(200);
    expect(summaries(h.fake)).toHaveLength(0);
  });

  it('a delivery with no summary and no action items is ignored', async () => {
    const h = harness();
    const hookToken = await connect(h);
    const body = JSON.stringify({ ...MEETING_PAYLOAD, default_summary: null, action_items: [] });
    expect((await deliver(h, hookToken, body)).status).toBe(200);
    expect(summaries(h.fake)).toHaveLength(0);
  });

  it('after the email address is disconnected, deliveries are dropped', async () => {
    const h = harness();
    const hookToken = await connect(h);
    h.fake.seed(`summaryUsers/${UID}`, { ...(h.fake.data(`summaryUsers/${UID}`) as Record<string, unknown>), token: null, tokenHash: null });
    const body = JSON.stringify(MEETING_PAYLOAD);
    expect((await deliver(h, hookToken, body)).status).toBe(200);
    expect(summaries(h.fake)).toHaveLength(0);
  });
});

describe('disconnect', () => {
  it('refreshes an expired access token, deletes the webhook in Fathom and the documents', async () => {
    const h = harness({ fathom: { expiresIn: 30 } });
    const hookToken = await connect(h);
    h.setNow(new Date(NOW.getTime() + 60 * 60 * 1000));
    const out = await handleFathomConnect(verifiedAuth(), { op: 'disconnect' }, h.deps);
    expect(out.remoteRemoved).toBe(true);
    expect(out.status.connected).toBe(false);
    const refresh = h.fathom.calls.filter((call) => call.url === FATHOM_TOKEN_URL).map((call) => new URLSearchParams(call.body ?? '').get('grant_type'));
    expect(refresh).toEqual(['authorization_code', 'refresh_token']);
    const deleted = h.fathom.calls.find((call) => call.method === 'DELETE');
    expect(deleted?.url).toMatch(/\/webhooks\/wh_1$/);
    expect(deleted?.authorization).toBe(`Bearer ${ACCESS_TOKEN}-r1`);
    expect(h.fake.data(`fathomConnections/${UID}`)).toBeUndefined();
    expect(h.fake.data(`fathomHooks/${hookHashOf(hookToken)}`)).toBeUndefined();
  });

  it('still removes our side when Fathom cannot be told', async () => {
    const h = harness({ fathom: { deleteStatus: 500 } });
    await connect(h);
    const out = await handleFathomConnect(verifiedAuth(), { op: 'disconnect' }, h.deps);
    expect(out.remoteRemoved).toBe(false);
    expect(h.fake.data(`fathomConnections/${UID}`)).toBeUndefined();
  });

  it('account deletion removes the connection and its hook', async () => {
    const h = harness();
    const hookToken = await connect(h);
    await deleteSummaryDataForUid(UID, { db: h.deps.db, now: () => NOW });
    expect(h.fake.data(`fathomConnections/${UID}`)).toBeUndefined();
    expect(h.fake.data(`fathomHooks/${hookHashOf(hookToken)}`)).toBeUndefined();
  });
});

describe('sealed secrets', () => {
  it('a blob sealed for one uid does not open for another', () => {
    const blob = sealSecrets(KEYRING, UID, { accessToken: 'a', accessExpiresAtMs: 1, refreshToken: 'r', webhookSecret: null });
    expect(() => openSecrets(KEYRING, 'uidSomeoneElse01', blob)).toThrow();
  });
});

describe('fathomConnect sync (the backup to the webhook)', () => {
  const { default_summary: summaryOf, ...LISTED } = MEETING_PAYLOAD;
  const RECORDING = String(MEETING_PAYLOAD.recording_id);
  const MARKDOWN = summaryOf.markdown_formatted;
  const sync = (h: Harness) => handleFathomConnect(verifiedAuth(), { op: 'sync' }, h.deps);

  it('stores a recording the webhook never delivered, filed to its meeting', async () => {
    const h = harness({ fathom: { meetings: [LISTED], recordingSummaries: { [RECORDING]: MARKDOWN } } });
    await connect(h);
    const out = await sync(h);
    expect(out.synced).toEqual({ ran: true, imported: 1, pending: 0 });
    const stored = summaries(h.fake);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ status: 'matched', source: 'fathom_api', match: { meetingId: MEETING_ID } });
    // The list asks for action items (OAuth apps may not ask it for summaries) over the last 7 days.
    const list = h.fathom.calls.find((call) => call.url.startsWith(`${FATHOM_API_BASE}/meetings?`));
    const query = new URL(list?.url ?? 'https://x').searchParams;
    expect(query.get('include_action_items')).toBe('true');
    expect(query.get('include_summary')).toBeNull();
    expect(query.get('created_after')).toBe('2026-11-03T15:30:00Z');
    expect(list?.authorization).toBe(`Bearer ${ACCESS_TOKEN}`);
    expect(out.status.lastEventAt).toBe(NOW.toISOString());
    expect(allLogText()).not.toMatch(/Urpayroll|payroll export|fathom-access-token/);
  });

  it('runs at most once a minute, and never fetches a recording it already has', async () => {
    const h = harness({ fathom: { meetings: [LISTED], recordingSummaries: { [RECORDING]: MARKDOWN } } });
    await connect(h);
    await sync(h);
    expect((await sync(h)).synced).toEqual({ ran: false, imported: 0, pending: 0 });
    h.setNow(new Date(NOW.getTime() + 2 * 60 * 1000));
    const fetchesBefore = h.fathom.calls.filter((call) => call.url.endsWith('/summary')).length;
    expect((await sync(h)).synced).toEqual({ ran: true, imported: 0, pending: 0 });
    expect(h.fathom.calls.filter((call) => call.url.endsWith('/summary'))).toHaveLength(fetchesBefore);
    expect(summaries(h.fake)).toHaveLength(1);
  });

  it('a webhook delivery and a sync of the same recording are one summary', async () => {
    const h = harness({ fathom: { meetings: [LISTED], recordingSummaries: { [RECORDING]: MARKDOWN } } });
    const hookToken = await connect(h);
    const body = JSON.stringify(MEETING_PAYLOAD);
    await deliver(h, hookToken, body);
    expect((await sync(h)).synced).toEqual({ ran: true, imported: 0, pending: 0 });
    expect(summaries(h.fake)).toHaveLength(1);
    expect(h.fathom.calls.filter((call) => call.url.endsWith('/summary'))).toHaveLength(0);
  });

  it('a recording with no summary yet is pending and stores nothing', async () => {
    const h = harness({ fathom: { meetings: [LISTED], recordingSummaries: {} } });
    await connect(h);
    expect((await sync(h)).synced).toEqual({ ran: true, imported: 0, pending: 1 });
    expect(summaries(h.fake)).toHaveLength(0);
  });

  it('never brings back a summary the user deleted', async () => {
    const h = harness({ fathom: { meetings: [LISTED], recordingSummaries: { [RECORDING]: MARKDOWN } } });
    await connect(h);
    const summaryId = summaryIdFor(UID, `fathom:rec:${RECORDING}`);
    h.fake.seed(summaryEventPath(deletionMarkerKey(UID, summaryId)), { expiresAt: '2026-12-15T00:00:00.000Z' });
    expect((await sync(h)).synced).toEqual({ ran: true, imported: 0, pending: 0 });
    expect(summaries(h.fake)).toHaveLength(0);
  });

  it('reads a page whose cursor is empty or not a string, with fields it does not know', async () => {
    const h = harness({
      fathom: { meetingsBody: { limit: null, next_cursor: '', items: [LISTED], extra: { any: true } }, recordingSummaries: { [RECORDING]: MARKDOWN } },
    });
    await connect(h);
    expect((await sync(h)).synced).toEqual({ ran: true, imported: 1, pending: 0 });
  });

  it('a page it cannot read logs which field, by name only, and stores nothing', async () => {
    const h = harness({ fathom: { meetingsBody: { items: 'not a list', next_cursor: 'abc' } } });
    await connect(h);
    expect((await sync(h)).synced).toEqual({ ran: true, imported: 0, pending: 0 });
    const line = (logger.info as unknown as jest.Mock).mock.calls.find(([message, fields]) => message === 'summaries.fathom_sync' && (fields as { outcome?: string }).outcome === 'fathom_failed');
    expect(line?.[1]).toMatchObject({ failure: 'shape', failureDetail: 'meetings:items' });
    expect(allLogText()).not.toContain('not a list');
  });

  it('not connected: skipped; Fathom refusing the list: no error, nothing stored', async () => {
    const off = harness({ fathom: { meetings: [LISTED] } });
    expect((await sync(off)).synced).toEqual({ ran: false, imported: 0, pending: 0 });

    const h = harness({ fathom: { meetings: [LISTED], meetingsStatus: 401 } });
    await connect(h);
    const out = await sync(h);
    expect(out.synced).toEqual({ ran: true, imported: 0, pending: 0 });
    expect(summaries(h.fake)).toHaveLength(0);
    expect(allLogText()).toContain('fathom_failed');
  });
});
