/**
 * summaryInbound: the pipeline (functions/src/summaries/inbound.ts) and its HTTPS shell
 * (functions/src/summaries/inboundFunction.ts). docs/v2/M10-DESIGN.md section 4 steps 1 to 16,
 * section 5 rows 0 to 16, section 12 (Inbound handler and Gating).
 *
 * Every message is synthetic and DKIM-signed in the test run (summariesFixtures.ts) behind a stub
 * resolver; Firestore is the in-memory fake (summariesFakeFirestore.ts); the logger is mocked and
 * read back to prove that no line carries message content.
 */
jest.mock('firebase-functions/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

import * as logger from 'firebase-functions/logger';
import type { Firestore } from 'firebase-admin/firestore';
import type { DNSResolver } from 'mailauth';

import { SealedError, parseKeyring } from '../../src/shared/sealed';
import { newSummaryUserFields, regenerateAddress, tokenHash } from '../../src/summaries/address';
import { loadCandidates } from '../../src/summaries/candidates';
import { summariesServiceAccountAtLoad } from '../../src/summaries/gate';
import {
  firebaseAuthUsers,
  handleInboundRequest,
  lazyKeyring,
  type CandidatesLoader,
  type InboundAuthUser,
  type InboundDeps,
  type InboundRequest,
} from '../../src/summaries/inbound';
import type * as InboundFunctionNamespace from '../../src/summaries/inboundFunction';
import {
  firstSeenKey,
  messageMarkerKey,
  openSummaryBody,
  openSummaryHead,
  parseRefusedRow,
  parseStoredSummary,
  refusalMarkerKey,
  refusedRowId,
  summaryIdFor,
  type StoredSummaryDoc,
} from '../../src/summaries/model';
import { SUMMARIES_MAX_BODY_BYTES } from '../../src/summaries/provider/postmark';
import { FakeFirestore } from './summariesFakeFirestore';
import {
  ATTACKER_ADDRESS,
  ATTACKER_DOMAIN,
  COLLEAGUE_ADDRESS,
  FRESH_DATE,
  GMAIL_CONFIRMATION,
  PRIVATE_ADDRESS,
  RECAP_BODY,
  RECEIVED_AT,
  SIX_HOURS_OLD_DATE,
  USER_DOMAIN,
  USER_MAILBOX,
  VENDOR_ADDRESS,
  VENDOR_DOMAIN,
  buildMessage,
  createFixtureDns,
  dkimRecord,
  fixtureKeys,
  replaceHeader,
  signMessage,
  vendorSigned,
  type FixtureDns,
  type MessageSpec,
} from './summariesFixtures';

jest.setTimeout(30_000);

// ---------------------------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------------------------

const UID = 'uidInboundDana01';
const TOKEN = PRIVATE_ADDRESS.slice(0, PRIVATE_ADDRESS.indexOf('@'));
const TEMPLATE = '{token}@summaries.meetingguard.example';
const SECRET = 'inbound-test-secret-7f3a9c';
const AUTHORIZATION = `Basic ${Buffer.from(`postmark:${SECRET}`, 'utf8').toString('base64')}`;
const DATA_KEY = `k1:${Buffer.alloc(32, 11).toString('base64')}`;
const KEYRING = parseKeyring(DATA_KEY);
const SEEDED_AT = '2026-11-01T09:00:00.000Z';
const MEETING_ID = 'mtgUrpayrollSync01';
const OTHER_MEETING_ID = 'mtgMarketingReview1';
const REAL_MESSAGE_ID = '<recap-0001@notetaker.example>';
const REAL_MESSAGE_KEY = 'mid:recap-0001@notetaker.example';
const GMAIL_REQUESTER = 'dana.personal@company.example';
const GMAIL_CODE = '861357924';
const CONTENT_TYPE_PLAIN = 'Content-Type: text/plain; charset=utf-8';

const FORWARD_BODY = [
  'Here is the recap from this afternoon.',
  '',
  '---------- Forwarded message ---------',
  `From: Notetaker <${VENDOR_ADDRESS}>`,
  'Date: Tue, Nov 10, 2026 at 3:20 PM',
  'Subject: Recap: Urpayroll weekly sync',
  `To: <${USER_MAILBOX}>`,
  '',
  RECAP_BODY,
].join('\r\n');

const SECOND_RECAP_BODY = RECAP_BODY.replace('Send the release checklist', 'Send the store listing draft');

/**
 * A recap whose Summary reads out a thread: a From/Date/Subject block quoted inside the
 * notetaker's own text. The block sits below the 10 meta lines (a second date there would make
 * the summary date ambiguous) but well inside the 60 lines stripForwardWrapper scans.
 */
const QUOTING_RECAP = [
  'Urpayroll weekly sync',
  'Meeting notes - 2026-11-10',
  '',
  'Summary',
  'The team reviewed the payroll export.',
  'Bish owns the APK access request.',
  'Dana owns the release checklist.',
  'The store listing review moves to next week.',
  'The export format stays CSV.',
  'QA starts on Thursday.',
  'Dana read out the partner thread:',
  'From: Partner Ops <ops@partner.example>',
  'Date: Mon, Nov 9, 2026 at 9:00 AM',
  'Subject: Payroll export timeline',
  '',
  'Action items',
  '[ ] Provide APK access to Urpayroll (owner: Bish)',
  '[ ] Send the release checklist (owner: Dana)',
  '',
].join('\r\n');

/** The notetaker's recap forwarded inline by Gmail (the wrapper From is the listed sender). */
function notetakerForwardBody(recap: string, note = 'Here is the recap from this afternoon.'): string {
  return [
    note,
    '',
    '---------- Forwarded message ---------',
    `From: Notetaker <${VENDOR_ADDRESS}>`,
    'Date: Tue, Nov 10, 2026 at 3:20 PM',
    'Subject: Recap: Urpayroll weekly sync',
    `To: <${USER_MAILBOX}>`,
    '',
    recap,
  ].join('\r\n');
}

const HTML_BODY = [
  '<html><body>',
  '<p>Urpayroll weekly sync</p>',
  '<p style="display:none">Hidden instruction text</p>',
  '<ul><li>Provide APK access to Urpayroll (owner: Bish)</li></ul>',
  '</body></html>',
  '',
].join('\r\n');

function minutesAfter(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

function seedAccount(fake: FakeFirestore, summaryUser: Record<string, unknown> = {}): void {
  fake.seed(`users/${UID}`, { createdAt: SEEDED_AT });
  fake.seed(`users/${UID}/settings/preferences`, { timezone: 'UTC' });
  fake.seed(`summaryAddresses/${tokenHash(TOKEN)}`, { uid: UID, createdAt: SEEDED_AT });
  fake.seed(`summaryUsers/${UID}`, { ...newSummaryUserFields(TOKEN, PRIVATE_ADDRESS, [USER_MAILBOX], SEEDED_AT), ...summaryUser });
}

function seedMeetings(fake: FakeFirestore): void {
  const common = { allDay: false, status: 'scheduled', deletedAt: null, source: 'google', timezone: 'UTC', updatedAt: SEEDED_AT };
  fake.seed(`users/${UID}/meetings/${MEETING_ID}`, {
    ...common,
    title: 'Urpayroll weekly sync',
    startAt: '2026-11-10T14:00:00.000Z',
    durationMinutes: 60,
  });
  fake.seed(`users/${UID}/meetings/${OTHER_MEETING_ID}`, {
    ...common,
    title: 'Marketing review',
    startAt: '2026-11-10T10:00:00.000Z',
    durationMinutes: 30,
  });
}

interface Harness {
  fake: FakeFirestore;
  dns: FixtureDns;
  deps: InboundDeps;
  authUser: InboundAuthUser;
  setNow(date: Date): void;
}

function harness(overrides: Partial<InboundDeps> = {}, options: { seed?: boolean } = {}): Harness {
  const fake = new FakeFirestore();
  if (options.seed !== false) {
    seedAccount(fake);
    seedMeetings(fake);
  }
  const dns = createFixtureDns();
  const authUser: InboundAuthUser = { exists: true, disabled: false, email: USER_MAILBOX, emailVerified: true };
  let now = RECEIVED_AT;
  const deps: InboundDeps = {
    enabled: () => true,
    webhookSecret: () => SECRET,
    pilotUids: () => `uidSomeoneElse01, ${UID}`,
    addressTemplate: () => TEMPLATE,
    senders: () => VENDOR_ADDRESS,
    keyring: lazyKeyring(() => DATA_KEY),
    db: fake as unknown as Firestore,
    authUsers: { getUser: async (uid) => (uid === UID ? { ...authUser } : { exists: false, disabled: false, email: null, emailVerified: false }) },
    candidates: loadCandidates,
    resolver: dns.resolver,
    now: () => now,
    ...overrides,
  };
  return {
    fake,
    dns,
    deps,
    authUser,
    setNow: (date) => {
      now = date;
    },
  };
}

let eventCounter = 0;

interface PostmarkOptions {
  messageId?: string;
  /** null leaves OriginalRecipient out. */
  recipient?: string | null;
  mailboxHash?: string;
  authorization?: string | undefined;
}

/** A Postmark-shaped inbound request carrying `raw` as RawEmail. */
function postmark(raw: string, options: PostmarkOptions = {}): InboundRequest {
  eventCounter += 1;
  const body: Record<string, unknown> = {
    MessageID: options.messageId ?? `pm-event-${eventCounter}`,
    MailboxHash: options.mailboxHash ?? '',
    RawEmail: raw,
    // Postmark's own parsed fields: never read by the adapter.
    From: VENDOR_ADDRESS,
    To: PRIVATE_ADDRESS,
    Subject: 'Recap: Urpayroll weekly sync',
  };
  if (options.recipient !== null) body.OriginalRecipient = options.recipient ?? PRIVATE_ADDRESS;
  return {
    method: 'POST',
    authorization: 'authorization' in options ? options.authorization : AUTHORIZATION,
    body,
    rawBodyBytes: Buffer.byteLength(JSON.stringify(body), 'utf8'),
  };
}

function userSigned(spec: MessageSpec): Promise<string> {
  return signMessage(buildMessage({ from: `Dana <${USER_MAILBOX}>`, to: PRIVATE_ADDRESS, ...spec }), {
    domain: USER_DOMAIN,
    selector: 's1',
    privateKey: fixtureKeys().user.privateKey,
  });
}

function userForward(): Promise<string> {
  return userSigned({ subject: 'Fwd: Recap: Urpayroll weekly sync', messageId: '<fwd-0001@company.example>', body: FORWARD_BODY });
}

function googleSigned(spec: MessageSpec): Promise<string> {
  return signMessage(
    buildMessage({ from: `Gmail Team <${GMAIL_CONFIRMATION}>`, to: PRIVATE_ADDRESS, messageId: '<gmail-0001@google.example>', ...spec }),
    { domain: 'google.com', selector: 's1', privateKey: fixtureKeys().google.privateKey },
  );
}

function gmailConfirmationFor(requester: string, code: string): Promise<string> {
  return googleSigned({
    subject: `(#${code}) Gmail Forwarding Confirmation - Receive Mail from ${requester}`,
    body: [`${requester} has requested to automatically forward mail to your email`, `address ${PRIVATE_ADDRESS}.`, `Confirmation code: ${code}`, ''].join(
      '\r\n',
    ),
  });
}

function gmailConfirmation(): Promise<string> {
  return gmailConfirmationFor(GMAIL_REQUESTER, GMAIL_CODE);
}

const MIX_BOUNDARY = 'mg-mix-0001';

/** A multipart/mixed body: one text/plain part, then each extra part (its headers, a blank line, its content). */
function mixedBody(text: string, extraParts: readonly string[]): string {
  const parts = [`Content-Type: text/plain; charset=utf-8\r\n\r\n${text}`, ...extraParts];
  return `${parts.map((part) => `--${MIX_BOUNDARY}\r\n${part}\r\n`).join('')}--${MIX_BOUNDARY}--\r\n`;
}

/** An attached message part (message/rfc822), as "forward as attachment" writes it. */
function attachedMessagePart(message: string, filename = 'recap.eml'): string {
  return `Content-Type: message/rfc822\r\nContent-Disposition: attachment; filename="${filename}"\r\n\r\n${message}`;
}

/** The user's own signed mail (row 10) with a multipart/mixed body. */
function userSignedMixed(spec: MessageSpec, body: string): Promise<string> {
  const message = replaceHeader(
    buildMessage({ from: `Dana <${USER_MAILBOX}>`, to: PRIVATE_ADDRESS, ...spec, body }),
    CONTENT_TYPE_PLAIN,
    `Content-Type: multipart/mixed; boundary="${MIX_BOUNDARY}"`,
  );
  return signMessage(message, { domain: USER_DOMAIN, selector: 's1', privateKey: fixtureKeys().user.privateKey });
}

/** The forwarder's own note above an attached recap (no inline forward wrapper). */
const ATTACHMENT_NOTE = ['Hi, the recap from this afternoon is attached.', '', 'Action items', '[ ] Read the attached recap (owner: Dana)', ''].join('\r\n');

function htmlOnlyRecap(): Promise<string> {
  const message = replaceHeader(buildMessage({ body: HTML_BODY }), CONTENT_TYPE_PLAIN, 'Content-Type: text/html; charset=utf-8');
  return signMessage(message, { domain: VENDOR_DOMAIN, selector: 's1', privateKey: fixtureKeys().vendor.privateKey });
}

/** From names the vendor, nothing signs it (row 13). */
function spoofedRecap(spec: MessageSpec = {}): string {
  return buildMessage(spec);
}

/** A stranger's own correctly signed mail (row 14). */
function attackerSigned(spec: MessageSpec = {}): Promise<string> {
  return signMessage(buildMessage({ from: `Notetaker <${ATTACKER_ADDRESS}>`, ...spec }), {
    domain: ATTACKER_DOMAIN,
    selector: 's1',
    privateKey: fixtureKeys().attacker.privateKey,
  });
}

function summaries(fake: FakeFirestore): { id: string; doc: StoredSummaryDoc }[] {
  return fake
    .paths(`users/${UID}/meetingSummaries/`)
    .map((path) => path.slice(path.lastIndexOf('/') + 1))
    .filter((id) => !id.startsWith('refused-'))
    .map((id) => {
      const doc = parseStoredSummary(fake.data(`users/${UID}/meetingSummaries/${id}`));
      if (doc === null) throw new Error('stored summary does not parse');
      return { id, doc };
    });
}

function refusedRow(fake: FakeFirestore, day = '2026-11-10') {
  return parseRefusedRow(fake.data(`users/${UID}/meetingSummaries/${refusedRowId(day)}`));
}

function summaryUser(fake: FakeFirestore): Record<string, unknown> {
  return fake.data(`summaryUsers/${UID}`) ?? {};
}

const loggerMocks = (): jest.Mock[] => [logger.debug, logger.info, logger.warn, logger.error] as unknown as jest.Mock[];

function inboundLines(): Record<string, unknown>[] {
  const lines: Record<string, unknown>[] = [];
  for (const mock of loggerMocks()) {
    for (const call of mock.mock.calls) {
      if (call[0] === 'summaries.inbound') lines.push(call[1] as Record<string, unknown>);
    }
  }
  return lines;
}

/** The fields of the most recent summaries.inbound line (any level). */
function lastLine(): Record<string, unknown> {
  const all: { order: number; fields: Record<string, unknown> }[] = [];
  for (const mock of loggerMocks()) {
    mock.mock.calls.forEach((call, index) => {
      if (call[0] === 'summaries.inbound') all.push({ order: mock.mock.invocationCallOrder[index] ?? 0, fields: call[1] as Record<string, unknown> });
    });
  }
  all.sort((a, b) => a.order - b.order);
  const last = all[all.length - 1];
  if (last === undefined) throw new Error('no summaries.inbound line');
  return last.fields;
}

beforeAll(() => {
  fixtureKeys();
}, 120_000);

// ---------------------------------------------------------------------------------------------
// Rows 0 to 2
// ---------------------------------------------------------------------------------------------

describe('rows 0 to 2: switch, method, Basic auth, payload', () => {
  it('404 while switched off, before anything is read', async () => {
    const h = harness({ enabled: () => false });
    const response = await handleInboundRequest(postmark(await vendorSigned()), h.deps);
    expect(response).toEqual({ status: 404, body: 'Not configured' });
    expect(h.fake.log).toEqual([]);
    expect(h.dns.lookups).toEqual([]);
  });

  it('405 for anything but POST', async () => {
    const h = harness();
    const response = await handleInboundRequest({ ...postmark(await vendorSigned()), method: 'GET' }, h.deps);
    expect(response.status).toBe(405);
    expect(h.fake.log).toEqual([]);
  });

  it('401 for a missing or wrong Authorization header, and for an empty or blank configured secret', async () => {
    const raw = await vendorSigned();
    const wrong = `Basic ${Buffer.from('postmark:not-the-secret').toString('base64')}`;
    const h = harness();
    expect((await handleInboundRequest(postmark(raw, { authorization: undefined }), h.deps)).status).toBe(401);
    expect((await handleInboundRequest(postmark(raw, { authorization: wrong }), h.deps)).status).toBe(401);
    for (const secret of ['', '   ']) {
      const empty = harness({ webhookSecret: () => secret });
      const matching = `Basic ${Buffer.from(`postmark:${secret}`).toString('base64')}`;
      expect((await handleInboundRequest(postmark(raw, { authorization: matching }), empty.deps)).status).toBe(401);
      expect(empty.fake.log).toEqual([]);
    }
    expect(h.fake.log).toEqual([]);
    expect(h.dns.lookups).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith('summaries.inbound_unauthorized', { hasHeader: false });
    expect(inboundLines()).toEqual([]);
  });

  it('Basic auth runs before the size and payload checks', async () => {
    const h = harness();
    const wrong = `Basic ${Buffer.from('postmark:not-the-secret').toString('base64')}`;
    const oversize = { ...postmark(await vendorSigned(), { authorization: wrong }), rawBodyBytes: SUMMARIES_MAX_BODY_BYTES + 1 };
    expect((await handleInboundRequest(oversize, h.deps)).status).toBe(401);
    const noRaw = { method: 'POST', authorization: wrong, body: { MessageID: 'pm-x' }, rawBodyBytes: 10 };
    expect((await handleInboundRequest(noRaw, h.deps)).status).toBe(401);
    expect(logger.error).not.toHaveBeenCalled();
    expect(inboundLines()).toEqual([]);
  });

  it('200 ignored for an oversize body, without reading it', async () => {
    const h = harness();
    const request = { ...postmark(await vendorSigned()), rawBodyBytes: SUMMARIES_MAX_BODY_BYTES + 1 };
    const response = await handleInboundRequest(request, h.deps);
    expect(response).toEqual({ status: 200, body: 'ok' });
    expect(h.fake.log).toEqual([]);
    expect(lastLine()).toMatchObject({ verdict: 'ignored', reason: 'body_too_large', uid: null, tok8: null });
  });

  it('200 ignored for an unparsable payload, and for a missing RawEmail (logged as a setup alarm)', async () => {
    const h = harness();
    for (const body of ['not json', [1, 2], null, { MessageID: 'pm-1', RawEmail: 42 }]) {
      const response = await handleInboundRequest({ method: 'POST', authorization: AUTHORIZATION, body, rawBodyBytes: 10 }, h.deps);
      expect(response).toEqual({ status: 200, body: 'ok' });
      expect(lastLine()).toMatchObject({ verdict: 'ignored', reason: 'invalid_payload' });
    }
    expect(logger.error).not.toHaveBeenCalledWith('summaries.setup_alarm', expect.anything());
    const noRaw = { MessageID: 'pm-2', OriginalRecipient: PRIVATE_ADDRESS };
    const response = await handleInboundRequest({ method: 'POST', authorization: AUTHORIZATION, body: noRaw, rawBodyBytes: 10 }, h.deps);
    expect(response.status).toBe(200);
    expect(lastLine()).toMatchObject({ verdict: 'ignored', reason: 'no_raw_email' });
    expect(logger.error).toHaveBeenCalledWith('summaries.setup_alarm', { reason: 'no_raw_email', detail: null });
    expect(h.fake.log).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// Row 3
// ---------------------------------------------------------------------------------------------

describe('row 3: envelope routing, pilot and Auth before any parsing', () => {
  async function expectDropped(h: Harness, request: InboundRequest, reason: string): Promise<void> {
    const writesBefore = h.fake.writeLog().length;
    const transactionsBefore = h.fake.transactions.length;
    const response = await handleInboundRequest(request, h.deps);
    expect(response).toEqual({ status: 200, body: 'ok' });
    expect(h.fake.writeLog().length).toBe(writesBefore);
    expect(h.fake.transactions.length).toBe(transactionsBefore);
    // Nothing was parsed: no DKIM lookup ran.
    expect(h.dns.lookups).toEqual([]);
    expect(lastLine()).toMatchObject({ verdict: 'dropped', reason });
  }

  it('an unknown token writes nothing', async () => {
    const h = harness();
    const unknown = `${'a'.repeat(26)}@summaries.meetingguard.example`;
    await expectDropped(h, postmark(await vendorSigned(), { recipient: unknown }), 'unknown_address');
  });

  it('a recipient that is not a token on the template domain, or no template at all, writes nothing', async () => {
    const h = harness();
    await expectDropped(h, postmark(await vendorSigned(), { recipient: 'someone@company.example' }), 'no_token');
    const unset = harness({ addressTemplate: () => '' });
    await expectDropped(unset, postmark(await vendorSigned()), 'template_not_set');
  });

  it('header addresses never route: the private address in To with another envelope recipient is dropped', async () => {
    const h = harness();
    const raw = await vendorSigned({ to: PRIVATE_ADDRESS, cc: PRIVATE_ADDRESS });
    await expectDropped(h, postmark(raw, { recipient: USER_MAILBOX }), 'no_token');
    await expectDropped(h, postmark(raw, { recipient: null }), 'no_token');
  });

  it('a regenerated token writes nothing', async () => {
    const h = harness();
    const rotated = await regenerateAddress(UID, {
      db: h.fake as unknown as Firestore,
      now: () => RECEIVED_AT,
      template: TEMPLATE,
      random: () => new Uint8Array(16).fill(5),
      logger: { info: () => undefined },
    });
    expect(rotated.status).toBe('rotated');
    await expectDropped(h, postmark(await vendorSigned()), 'unknown_address');
  });

  it('a deleted or disabled Auth user, and a uid outside the pilot list, write nothing', async () => {
    const deleted = harness({ authUsers: { getUser: async () => ({ exists: false, disabled: false, email: null, emailVerified: false }) } });
    await expectDropped(deleted, postmark(await vendorSigned()), 'user_missing');
    const disabled = harness({ authUsers: { getUser: async () => ({ exists: true, disabled: true, email: USER_MAILBOX, emailVerified: true }) } });
    await expectDropped(disabled, postmark(await vendorSigned()), 'user_disabled');
    const outside = harness({ pilotUids: () => 'uidSomeoneElse01,not a uid!' });
    await expectDropped(outside, postmark(await vendorSigned()), 'not_pilot');
    expect(lastLine()).toMatchObject({ uid: UID, pilotInvalid: 1 });
    const nobody = harness({ pilotUids: () => '' });
    await expectDropped(nobody, postmark(await vendorSigned()), 'not_pilot');
  });

  it('an Auth failure before routing answers 500, stores only the first-seen time, and the retry keeps it', async () => {
    let failing = true;
    const h = harness({
      authUsers: {
        getUser: async (uid) => {
          if (failing) throw Object.assign(new Error('auth backend unavailable'), { name: 'AuthUnavailable' });
          return uid === UID
            ? { exists: true, disabled: false, email: USER_MAILBOX, emailVerified: true }
            : { exists: false, disabled: false, email: null, emailVerified: false };
        },
      },
    });
    const raw = await vendorSigned();
    const response = await handleInboundRequest(postmark(raw, { messageId: 'pm-auth-1' }), h.deps);
    expect(response.status).toBe(500);
    expect(summaries(h.fake)).toEqual([]);
    // The only write is the first-seen record (no uid, no content), so a later retry, or a stale
    // redelivery of an older Gmail code, is measured from the original receipt.
    expect(h.fake.paths('summaryEvents/')).toEqual([`summaryEvents/${firstSeenKey('pm-auth-1')}`]);
    expect(lastLine()).toMatchObject({ verdict: 'error', reason: 'auth_user', errorName: 'AuthUnavailable' });

    failing = false;
    h.setNow(minutesAfter(RECEIVED_AT, 7));
    expect((await handleInboundRequest(postmark(raw, { messageId: 'pm-auth-1' }), h.deps)).status).toBe(200);
    const stored = summaries(h.fake);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.doc.receivedAt).toBe(RECEIVED_AT.toISOString());
  });
});

// ---------------------------------------------------------------------------------------------
// Rows 7 to 10, 15 and 16
// ---------------------------------------------------------------------------------------------

describe('rows 7 to 10: stored summaries', () => {
  it('a bound, fresh vendor recap is created and filed under the meeting (rule A)', async () => {
    const h = harness();
    const response = await handleInboundRequest(postmark(await vendorSigned()), h.deps);
    expect(response).toEqual({ status: 200, body: 'ok' });

    const stored = summaries(h.fake);
    expect(stored).toHaveLength(1);
    const [{ id, doc }] = stored as [{ id: string; doc: StoredSummaryDoc }];
    expect(id).toBe(summaryIdFor(UID, REAL_MESSAGE_KEY));
    expect(doc).toMatchObject({
      status: 'matched',
      inboxReason: null,
      trust: { tier: 'vendor_verified', recipientBound: true, fresh: true, anchorSource: 'signed_date', originalInboxReason: null },
      senderDomain: VENDOR_DOMAIN,
      vendorDomain: VENDOR_DOMAIN,
      receivedAt: RECEIVED_AT.toISOString(),
      sentAt: '2026-11-10T15:20:00.000Z',
      anchorAt: '2026-11-10T15:20:00.000Z',
      summaryDate: '2026-11-10',
      match: { meetingId: MEETING_ID, method: 'auto', occurrenceDate: null },
    });
    expect(doc.auth.dkim[0]).toMatchObject({ domain: VENDOR_DOMAIN, result: 'pass', aligned: true, signsTo: true, signsDate: true });

    const head = openSummaryHead(KEYRING, { uid: UID, summaryId: id }, doc.sealedHead);
    expect(head).toEqual({ subject: 'Recap: Urpayroll weekly sync', titleLine: 'Urpayroll weekly sync', dateLine: 'Meeting notes - 2026-11-10' });
    const body = openSummaryBody(KEYRING, { uid: UID, summaryId: id }, doc.sealedBody);
    expect(body).toMatchObject({ fromAddress: VENDOR_ADDRESS, fromName: null, forwardedBy: null });
    const actions = body.sections.find((section) => section.kind === 'action_items');
    expect(actions?.items.map((item) => item.owner)).toEqual(['Bish', 'Dana']);

    // Row 7 claims the Message-ID marker; the address doc records the receipt.
    expect(h.fake.has(`summaryEvents/${messageMarkerKey(UID, REAL_MESSAGE_KEY)}`)).toBe(true);
    expect(summaryUser(h.fake).lastReceivedAt).toBe(RECEIVED_AT.toISOString());
    expect(lastLine()).toMatchObject({
      uid: UID,
      tok8: tokenHash(TOKEN).slice(0, 8),
      verdict: 'stored',
      reason: 'filed',
      row: 7,
      tier: 'vendor_verified',
      outcome: 'created',
      matched: true,
    });
  });

  it('a redelivery of the same recap is a duplicate (row 16), still one summary', async () => {
    const h = harness();
    const raw = await vendorSigned();
    await handleInboundRequest(postmark(raw, { messageId: 'pm-same-1' }), h.deps);
    h.setNow(minutesAfter(RECEIVED_AT, 3));
    await handleInboundRequest(postmark(raw, { messageId: 'pm-same-1' }), h.deps);
    await handleInboundRequest(postmark(raw, { messageId: 'pm-other-2' }), h.deps);
    expect(summaries(h.fake)).toHaveLength(1);
    expect(lastLine()).toMatchObject({ verdict: 'stored', outcome: 'duplicate', detail: 'copy_exists' });
  });

  it('a user forward waits in the inbox with suggestions, anchored at the wrapper Date in the preferences zone', async () => {
    const h = harness();
    const response = await handleInboundRequest(postmark(await userForward()), h.deps);
    expect(response.status).toBe(200);
    const [{ id, doc }] = summaries(h.fake) as [{ id: string; doc: StoredSummaryDoc }];
    expect(doc).toMatchObject({
      status: 'inbox',
      inboxReason: 'user_forwarded',
      trust: { tier: 'user_forwarded', recipientBound: false, anchorSource: 'forward_wrapper', originalInboxReason: 'user_forwarded' },
      senderDomain: USER_DOMAIN,
      vendorDomain: null,
      anchorAt: '2026-11-10T15:20:00.000Z',
      match: null,
    });
    expect(doc.candidates.map((candidate) => candidate.meetingId)).toEqual([MEETING_ID]);
    const body = openSummaryBody(KEYRING, { uid: UID, summaryId: id }, doc.sealedBody);
    expect(body.forwardedBy).toBe(USER_MAILBOX);
    expect(body.text.startsWith('Urpayroll weekly sync')).toBe(true);
    expect(h.fake.has(`summaryEvents/${messageMarkerKey(UID, 'mid:fwd-0001@company.example')}`)).toBe(true);
    expect(lastLine()).toMatchObject({ verdict: 'stored', reason: 'user_forwarded', row: 10, outcome: 'created', matched: false });

    // The notetaker's own bound copy later upgrades the forward in place (same content digest).
    h.setNow(minutesAfter(RECEIVED_AT, 10));
    await handleInboundRequest(postmark(await vendorSigned()), h.deps);
    const after = summaries(h.fake);
    expect(after).toHaveLength(1);
    expect(after[0]?.id).toBe(id);
    expect(after[0]?.doc).toMatchObject({ status: 'matched', trust: { tier: 'vendor_verified', recipientBound: true }, receivedAt: RECEIVED_AT.toISOString() });
    const upgraded = openSummaryBody(KEYRING, { uid: UID, summaryId: id }, after[0]?.doc.sealedBody ?? '');
    expect(upgraded).toMatchObject({ fromAddress: VENDOR_ADDRESS, forwardedBy: null });
    expect(lastLine()).toMatchObject({ outcome: 'upgraded', matched: true });
  });

  it('a vendor recap (row 7) is used as signed: a From/Date/Subject block quoted in its Summary never cuts it', async () => {
    const h = harness();
    await handleInboundRequest(postmark(await vendorSigned({ body: QUOTING_RECAP })), h.deps);
    expect(lastLine()).toMatchObject({ verdict: 'stored', row: 7, outcome: 'created' });
    const [{ id, doc }] = summaries(h.fake) as [{ id: string; doc: StoredSummaryDoc }];
    const head = openSummaryHead(KEYRING, { uid: UID, summaryId: id }, doc.sealedHead);
    expect(head).toEqual({ subject: 'Recap: Urpayroll weekly sync', titleLine: 'Urpayroll weekly sync', dateLine: 'Meeting notes - 2026-11-10' });
    const body = openSummaryBody(KEYRING, { uid: UID, summaryId: id }, doc.sealedBody);
    // The full signed text, the quoted block included (sanitizeText only turns CRLF into LF).
    expect(body.text).toBe(QUOTING_RECAP.replace(/\r\n/g, '\n').trimEnd());
    expect(body.forwardedBy).toBeNull();
    expect(doc).toMatchObject({ summaryDate: '2026-11-10', anchorAt: '2026-11-10T15:20:00.000Z' });
  });

  it('row 10: a forward of that quoting recap keeps the notetaker text whole, so the bound vendor copy upgrades it (step 13), one summary', async () => {
    const h = harness();
    const forward = await userSigned({
      subject: 'Fwd: Recap: Urpayroll weekly sync',
      messageId: '<fwd-quote-0001@company.example>',
      body: notetakerForwardBody(QUOTING_RECAP),
    });
    await handleInboundRequest(postmark(forward), h.deps);
    expect(lastLine()).toMatchObject({ verdict: 'stored', reason: 'user_forwarded', row: 10, outcome: 'created' });
    const [{ id, doc }] = summaries(h.fake) as [{ id: string; doc: StoredSummaryDoc }];
    const expectedText = QUOTING_RECAP.replace(/\r\n/g, '\n').trimEnd();
    const forwarded = openSummaryBody(KEYRING, { uid: UID, summaryId: id }, doc.sealedBody);
    // Stripping stopped at the notetaker's wrapper: the quoted block stays in the recap, and the
    // anchor is the notetaker wrapper's Date (15:20), not the quoted 9:00 AM of the day before.
    expect(forwarded.text).toBe(expectedText);
    expect(forwarded.sections.map((section) => section.kind)).toContain('summary');
    expect(doc).toMatchObject({ status: 'inbox', anchorAt: '2026-11-10T15:20:00.000Z', summaryDate: '2026-11-10' });

    // The vendor's own bound copy of the same bytes: same digest, so the forward is upgraded in place.
    h.setNow(minutesAfter(RECEIVED_AT, 10));
    await handleInboundRequest(postmark(await vendorSigned({ body: QUOTING_RECAP })), h.deps);
    expect(lastLine()).toMatchObject({ verdict: 'stored', row: 7, outcome: 'upgraded', matched: true });
    const after = summaries(h.fake);
    expect(after).toHaveLength(1);
    expect(after[0]?.id).toBe(id);
    expect(after[0]?.doc).toMatchObject({ status: 'matched', trust: { tier: 'vendor_verified' } });
    const upgraded = openSummaryBody(KEYRING, { uid: UID, summaryId: id }, after[0]?.doc.sealedBody ?? '');
    expect(upgraded.text).toBe(expectedText);
    expect(upgraded.sections.map((section) => section.kind)).toContain('summary');
    expect(upgraded).toMatchObject({ fromAddress: VENDOR_ADDRESS, forwardedBy: null });
  });

  it('row 10: a forward that carries the recap only as an attached message is refused unreadable; nothing sealed, no marker', async () => {
    let keyringReads = 0;
    const h = harness({
      keyring: () => {
        keyringReads += 1;
        return KEYRING;
      },
    });
    const raw = await userSignedMixed(
      { subject: 'Fwd: Recap: Urpayroll weekly sync', messageId: '<fwd-att-0001@company.example>' },
      mixedBody(ATTACHMENT_NOTE, [attachedMessagePart(await vendorSigned())]),
    );
    const response = await handleInboundRequest(postmark(raw, { messageId: 'pm-att-1' }), h.deps);
    expect(response).toEqual({ status: 200, body: 'ok' });
    expect(summaries(h.fake)).toEqual([]);
    expect(keyringReads).toBe(0);
    // Only the refusal's own dedupe marker: no Message-ID or digest marker was claimed.
    expect(h.fake.paths('summaryEvents/')).toEqual([`summaryEvents/${refusalMarkerKey(UID, 'pm-att-1')}`]);
    expect(refusedRow(h.fake)).toMatchObject({ refusedReason: 'unreadable', count: 1 });
    expect(lastLine()).toMatchObject({ verdict: 'refused', reason: 'unreadable', detail: 'attached_message', row: 10 });
  });

  it('row 10: two forwards with the same note and an attached recap are both refused (no digest twin)', async () => {
    const h = harness();
    const first = await userSignedMixed(
      { subject: 'Fwd: Recap: Urpayroll weekly sync', messageId: '<fwd-att-0001@company.example>' },
      mixedBody(ATTACHMENT_NOTE, [attachedMessagePart(await vendorSigned())]),
    );
    const second = await userSignedMixed(
      { subject: 'Fwd: Recap: Marketing review', messageId: '<fwd-att-0002@company.example>' },
      mixedBody(ATTACHMENT_NOTE, [attachedMessagePart(await vendorSigned({ messageId: '<recap-0002@notetaker.example>', body: SECOND_RECAP_BODY }))]),
    );
    await handleInboundRequest(postmark(first, { messageId: 'pm-att-1' }), h.deps);
    expect(lastLine()).toMatchObject({ verdict: 'refused', reason: 'unreadable', detail: 'attached_message', outcome: 'recorded' });
    await handleInboundRequest(postmark(second, { messageId: 'pm-att-2' }), h.deps);
    expect(lastLine()).toMatchObject({ verdict: 'refused', reason: 'unreadable', detail: 'attached_message', outcome: 'recorded' });
    expect(summaries(h.fake)).toEqual([]);
    expect(refusedRow(h.fake)).toMatchObject({ refusedReason: 'unreadable', count: 2 });
    expect(h.fake.paths('summaryEvents/').sort()).toEqual(
      [`summaryEvents/${refusalMarkerKey(UID, 'pm-att-1')}`, `summaryEvents/${refusalMarkerKey(UID, 'pm-att-2')}`].sort(),
    );
  });

  it('row 10: a recap attached as an .eml file under application/octet-stream, or as an Outlook .msg, counts as an attached message', async () => {
    const recap = Buffer.from(await vendorSigned()).toString('base64');
    const parts = [
      `Content-Type: application/octet-stream; name="recap.eml"\r\nContent-Disposition: attachment; filename="recap.eml"\r\nContent-Transfer-Encoding: base64\r\n\r\n${recap}`,
      `Content-Type: application/vnd.ms-outlook; name="Recap.msg"\r\nContent-Disposition: attachment; filename="Recap.msg"\r\nContent-Transfer-Encoding: base64\r\n\r\n${Buffer.from('0123456789abcdef').toString('base64')}`,
    ];
    for (const [index, part] of parts.entries()) {
      const h = harness();
      const raw = await userSignedMixed({ subject: 'Fwd: Recap: Urpayroll weekly sync', messageId: `<fwd-file-000${index}@company.example>` }, mixedBody(ATTACHMENT_NOTE, [part]));
      await handleInboundRequest(postmark(raw), h.deps);
      expect([index, summaries(h.fake)]).toEqual([index, []]);
      expect(lastLine()).toMatchObject({ verdict: 'refused', reason: 'unreadable', detail: 'attached_message', row: 10 });
    }
  });

  it('row 10: an attached message with no text part at all is refused with the same detail', async () => {
    const h = harness();
    const body = `--${MIX_BOUNDARY}\r\n${attachedMessagePart(await vendorSigned())}\r\n--${MIX_BOUNDARY}--\r\n`;
    await handleInboundRequest(postmark(await userSignedMixed({ messageId: '<fwd-att-0003@company.example>' }, body)), h.deps);
    expect(summaries(h.fake)).toEqual([]);
    expect(lastLine()).toMatchObject({ verdict: 'refused', reason: 'unreadable', detail: 'attached_message', row: 10 });
  });

  it('row 10: an inline Gmail forward of the notetaker recap (wrapper From a listed sender) with an unrelated .eml attachment is stored as the forwarded recap', async () => {
    const h = harness();
    const unrelated = [`From: Lee <${COLLEAGUE_ADDRESS}>`, `To: ${USER_MAILBOX}`, 'Subject: Lunch on Friday', 'Content-Type: text/plain', '', 'Pizza at noon?', ''].join(
      '\r\n',
    );
    const raw = await userSignedMixed(
      { subject: 'Fwd: Recap: Urpayroll weekly sync', messageId: '<fwd-0001@company.example>' },
      mixedBody(FORWARD_BODY, [attachedMessagePart(unrelated, 'lunch.eml')]),
    );
    await handleInboundRequest(postmark(raw), h.deps);
    expect(lastLine()).toMatchObject({ verdict: 'stored', reason: 'user_forwarded', row: 10, outcome: 'created' });
    const [{ id, doc }] = summaries(h.fake) as [{ id: string; doc: StoredSummaryDoc }];
    expect(doc).toMatchObject({ status: 'inbox', inboxReason: 'user_forwarded', anchorAt: '2026-11-10T15:20:00.000Z' });
    expect(doc.candidates.map((candidate) => candidate.meetingId)).toEqual([MEETING_ID]);
    const body = openSummaryBody(KEYRING, { uid: UID, summaryId: id }, doc.sealedBody);
    expect(body.text.startsWith('Urpayroll weekly sync')).toBe(true);
    expect(body.text).not.toContain('Pizza');
    expect(body.forwardedBy).toBe(USER_MAILBOX);
  });

  it('row 10: the same forward with an attached message fails closed while SUMMARIES_SENDERS is empty or lists someone else', async () => {
    const unrelated = [`From: Lee <${COLLEAGUE_ADDRESS}>`, 'Subject: Lunch on Friday', 'Content-Type: text/plain', '', 'Pizza at noon?', ''].join('\r\n');
    for (const senders of ['', '  ', 'recaps@other-notetaker.example']) {
      const h = harness({ senders: () => senders });
      const raw = await userSignedMixed(
        { subject: 'Fwd: Recap: Urpayroll weekly sync', messageId: '<fwd-0001@company.example>' },
        mixedBody(FORWARD_BODY, [attachedMessagePart(unrelated, 'lunch.eml')]),
      );
      await handleInboundRequest(postmark(raw), h.deps);
      expect([senders, summaries(h.fake)]).toEqual([senders, []]);
      expect(lastLine()).toMatchObject({ verdict: 'refused', reason: 'unreadable', detail: 'attached_message', row: 10 });
      // Without an attached message the same inline forward is still stored.
      await handleInboundRequest(postmark(await userForward()), h.deps);
      expect(lastLine()).toMatchObject({ verdict: 'stored', reason: 'user_forwarded', row: 10, outcome: 'created' });
    }
  });

  /** A colleague's note above the user's inline Gmail forward; the colleague attached the recap. */
  const COLLEAGUE_FORWARD = [
    'FYI, see below.',
    '',
    '---------- Forwarded message ---------',
    `From: Lee <${COLLEAGUE_ADDRESS}>`,
    'Date: Tue, Nov 10, 2026 at 3:40 PM',
    'Subject: Fwd: Recap: Urpayroll weekly sync',
    `To: <${USER_MAILBOX}>`,
    '',
    'Hi Dana, the recap from this afternoon is attached.',
    '',
    'Action items',
    '[ ] Read the attached recap (owner: Dana)',
    '',
  ].join('\r\n');

  it('row 10: an inline forward of a colleague mail whose recap is attached is refused, and so is a second one (no digest twin)', async () => {
    const h = harness();
    const first = await userSignedMixed(
      { subject: 'Fwd: Fwd: Recap: Urpayroll weekly sync', messageId: '<fwd-col-0001@company.example>' },
      mixedBody(COLLEAGUE_FORWARD, [attachedMessagePart(await vendorSigned())]),
    );
    const second = await userSignedMixed(
      { subject: 'Fwd: Fwd: Recap: Marketing review', messageId: '<fwd-col-0002@company.example>' },
      mixedBody(COLLEAGUE_FORWARD, [attachedMessagePart(await vendorSigned({ messageId: '<recap-0002@notetaker.example>', body: SECOND_RECAP_BODY }))]),
    );
    await handleInboundRequest(postmark(first, { messageId: 'pm-col-1' }), h.deps);
    expect(lastLine()).toMatchObject({ verdict: 'refused', reason: 'unreadable', detail: 'attached_message', row: 10, outcome: 'recorded' });
    await handleInboundRequest(postmark(second, { messageId: 'pm-col-2' }), h.deps);
    expect(lastLine()).toMatchObject({ verdict: 'refused', reason: 'unreadable', detail: 'attached_message', row: 10, outcome: 'recorded' });
    expect(summaries(h.fake)).toEqual([]);
    expect(refusedRow(h.fake)).toMatchObject({ refusedReason: 'unreadable', count: 2 });
    expect(h.fake.paths('summaryEvents/').sort()).toEqual(
      [`summaryEvents/${refusalMarkerKey(UID, 'pm-col-1')}`, `summaryEvents/${refusalMarkerKey(UID, 'pm-col-2')}`].sort(),
    );
  });

  it('row 10: an Outlook reply whose quoted From/Sent/To/Subject block looks like a wrapper, with the recap attached, is refused', async () => {
    const h = harness();
    const reply = [
      'Hi Lee, the recap is attached.',
      '',
      `From: Lee <${COLLEAGUE_ADDRESS}>`,
      'Sent: Monday, November 9, 2026 9:00 AM',
      `To: Dana <${USER_MAILBOX}>`,
      'Subject: Can you send me the Urpayroll recap?',
      '',
      'Hi Dana, could you send me the recap of the sync?',
      '',
      'Action items',
      '[ ] Send the recap to Lee (owner: Dana)',
      '',
    ].join('\r\n');
    const raw = await userSignedMixed(
      { subject: 'RE: Can you send me the Urpayroll recap?', messageId: '<reply-0001@company.example>' },
      mixedBody(reply, [attachedMessagePart(await vendorSigned())]),
    );
    await handleInboundRequest(postmark(raw, { messageId: 'pm-reply-1' }), h.deps);
    expect(summaries(h.fake)).toEqual([]);
    expect(h.fake.paths('summaryEvents/')).toEqual([`summaryEvents/${refusalMarkerKey(UID, 'pm-reply-1')}`]);
    expect(lastLine()).toMatchObject({ verdict: 'refused', reason: 'unreadable', detail: 'attached_message', row: 10 });
  });

  it('row 10: a colleague forward of the notetaker recap, forwarded inline with an attachment, is stored from the notetaker wrapper down', async () => {
    const h = harness();
    const nested = [
      '---------- Forwarded message ---------',
      `From: Lee <${COLLEAGUE_ADDRESS}>`,
      'Date: Tue, Nov 10, 2026 at 3:40 PM',
      'Subject: Fwd: Recap: Urpayroll weekly sync',
      `To: <${USER_MAILBOX}>`,
      '',
      notetakerForwardBody(RECAP_BODY, 'Hi Dana, see below.'),
    ].join('\r\n');
    const unrelated = [`From: Lee <${COLLEAGUE_ADDRESS}>`, 'Subject: Slides', 'Content-Type: text/plain', '', 'Slides attached.', ''].join('\r\n');
    const raw = await userSignedMixed(
      { subject: 'Fwd: Fwd: Recap: Urpayroll weekly sync', messageId: '<fwd-col-0003@company.example>' },
      mixedBody(nested, [attachedMessagePart(unrelated, 'slides.eml')]),
    );
    await handleInboundRequest(postmark(raw), h.deps);
    expect(lastLine()).toMatchObject({ verdict: 'stored', reason: 'user_forwarded', row: 10, outcome: 'created' });
    const [{ id, doc }] = summaries(h.fake) as [{ id: string; doc: StoredSummaryDoc }];
    // The notetaker wrapper's Date (15:20), not the colleague's (15:40).
    expect(doc).toMatchObject({ status: 'inbox', anchorAt: '2026-11-10T15:20:00.000Z' });
    const body = openSummaryBody(KEYRING, { uid: UID, summaryId: id }, doc.sealedBody);
    expect(body.text).toBe(RECAP_BODY.replace(/\r\n/g, '\n').trimEnd());
  });

  it('a user forward without a usable preferences zone has no anchor (never guessed)', async () => {
    const h = harness();
    h.fake.seed(`users/${UID}/settings/preferences`, { timezone: 'Not/AZone' });
    await handleInboundRequest(postmark(await userForward()), h.deps);
    const [{ doc }] = summaries(h.fake) as [{ id: string; doc: StoredSummaryDoc }];
    expect(doc).toMatchObject({ anchorAt: null, trust: { anchorSource: null }, status: 'inbox' });
  });

  it('a forged message carrying a real recap Message-ID does not block the real one', async () => {
    const h = harness();
    expect((await handleInboundRequest(postmark(spoofedRecap({ messageId: REAL_MESSAGE_ID })), h.deps)).status).toBe(200);
    expect(lastLine()).toMatchObject({ verdict: 'refused', reason: 'sender_not_verified', row: 13 });
    expect((await handleInboundRequest(postmark(await attackerSigned({ messageId: REAL_MESSAGE_ID })), h.deps)).status).toBe(200);
    expect(lastLine()).toMatchObject({ verdict: 'refused', reason: 'not_from_your_notetaker', row: 14 });
    expect(summaries(h.fake)).toEqual([]);
    expect(h.fake.has(`summaryEvents/${messageMarkerKey(UID, REAL_MESSAGE_KEY)}`)).toBe(false);
    // The stranger's own signature passes for his own domain, so that verified domain is the one shown.
    expect(refusedRow(h.fake)).toMatchObject({ count: 2, refusedReason: 'not_from_your_notetaker', senderDomain: ATTACKER_DOMAIN });

    await handleInboundRequest(postmark(await vendorSigned()), h.deps);
    const stored = summaries(h.fake);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.doc.status).toBe('matched');
    expect(lastLine()).toMatchObject({ outcome: 'created', matched: true });
  });

  it('an inbox copy (row 9) is upgraded in place by a later bound copy (row 7)', async () => {
    const h = harness();
    h.setNow(new Date('2026-11-10T15:40:00Z'));
    await handleInboundRequest(postmark(await vendorSigned({ to: PRIVATE_ADDRESS })), h.deps);
    const first = summaries(h.fake);
    expect(first).toHaveLength(1);
    expect(first[0]?.doc).toMatchObject({
      status: 'inbox',
      inboxReason: 'not_addressed_to_you',
      trust: { recipientBound: false },
      candidates: [],
    });
    // Row 9 claims no marker, so it can never block the bound copy.
    expect(h.fake.has(`summaryEvents/${messageMarkerKey(UID, REAL_MESSAGE_KEY)}`)).toBe(false);
    expect(lastLine()).toMatchObject({ row: 9, reason: 'not_addressed_to_you', outcome: 'created' });

    h.setNow(RECEIVED_AT);
    await handleInboundRequest(postmark(await vendorSigned()), h.deps);
    const after = summaries(h.fake);
    expect(after).toHaveLength(1);
    expect(after[0]?.id).toBe(first[0]?.id);
    expect(after[0]?.doc).toMatchObject({
      status: 'matched',
      inboxReason: null,
      trust: { recipientBound: true, fresh: true },
      receivedAt: '2026-11-10T15:40:00.000Z',
      match: { meetingId: MEETING_ID },
    });
    expect(h.fake.has(`summaryEvents/${messageMarkerKey(UID, REAL_MESSAGE_KEY)}`)).toBe(true);
    expect(lastLine()).toMatchObject({ row: 7, outcome: 'upgraded', matched: true });
  });

  it('HTML-only mail is refused as unreadable (no regex tag stripping)', async () => {
    const h = harness();
    const response = await handleInboundRequest(postmark(await htmlOnlyRecap()), h.deps);
    expect(response.status).toBe(200);
    expect(summaries(h.fake)).toEqual([]);
    expect(refusedRow(h.fake)).toMatchObject({ refusedReason: 'unreadable', senderDomain: VENDOR_DOMAIN, count: 1 });
    expect(summaryUser(h.fake).lastRefused).toMatchObject({ reason: 'unreadable', senderDomain: VENDOR_DOMAIN });
    expect(lastLine()).toMatchObject({ verdict: 'refused', reason: 'unreadable', detail: 'html_only', row: 7 });
  });

  it('a recap whose text is empty after parsing is refused as unreadable (row 15)', async () => {
    const h = harness();
    await handleInboundRequest(postmark(await vendorSigned({ body: `${String.fromCharCode(0x200b)}\r\n\r\n` })), h.deps);
    expect(summaries(h.fake)).toEqual([]);
    expect(lastLine()).toMatchObject({ verdict: 'refused', reason: 'unreadable', detail: 'empty_text' });
  });

  it('a Firestore failure at commit answers 500 with no summary and no marker; the retry keeps the first receipt', async () => {
    const h = harness();
    const raw = await vendorSigned();
    h.fake.failNextCommit = Object.assign(new Error('synthetic outage'), { name: 'FirestoreUnavailable' });
    const response = await handleInboundRequest(postmark(raw, { messageId: 'pm-outage-1' }), h.deps);
    expect(response).toEqual({ status: 500, body: 'Internal Server Error' });
    expect(summaries(h.fake)).toEqual([]);
    expect(h.fake.paths('summaryEvents/')).toEqual([`summaryEvents/${firstSeenKey('pm-outage-1')}`]);
    expect(lastLine()).toMatchObject({ verdict: 'error', reason: 'commit', errorName: 'FirestoreUnavailable', uid: UID });

    h.setNow(minutesAfter(RECEIVED_AT, 7));
    expect((await handleInboundRequest(postmark(raw, { messageId: 'pm-outage-1' }), h.deps)).status).toBe(200);
    const stored = summaries(h.fake);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.doc.receivedAt).toBe(RECEIVED_AT.toISOString());
    expect(h.fake.has(`summaryEvents/${messageMarkerKey(UID, REAL_MESSAGE_KEY)}`)).toBe(true);
  });

  it('the address regenerated between lookup and commit gives dropped, nothing stored', async () => {
    const regenerateThenLoad: CandidatesLoader = async (db, uid, window, now, options) => {
      await regenerateAddress(UID, { db, now: () => RECEIVED_AT, template: TEMPLATE, random: () => new Uint8Array(16).fill(9), logger: { info: () => undefined } });
      return loadCandidates(db, uid, window, now, options);
    };
    const h = harness({ candidates: regenerateThenLoad });
    const response = await handleInboundRequest(postmark(await vendorSigned()), h.deps);
    expect(response).toEqual({ status: 200, body: 'ok' });
    expect(summaries(h.fake)).toEqual([]);
    expect(h.fake.has(`summaryEvents/${messageMarkerKey(UID, REAL_MESSAGE_KEY)}`)).toBe(false);
    expect(lastLine()).toMatchObject({ verdict: 'dropped', reason: 'address_changed', outcome: 'dropped' });
  });

  it('a malformed data key is a setup alarm and answers 500; nothing is sealed', async () => {
    const h = harness({ keyring: lazyKeyring(() => 'k1:not-base64!') });
    const response = await handleInboundRequest(postmark(await vendorSigned(), { messageId: 'pm-key-1' }), h.deps);
    expect(response.status).toBe(500);
    expect(summaries(h.fake)).toEqual([]);
    expect(logger.error).toHaveBeenCalledWith('summaries.setup_alarm', { reason: 'data_key_invalid', detail: 'keyring_bad_base64' });
    expect(h.fake.has(`summaryEvents/${firstSeenKey('pm-key-1')}`)).toBe(true);
    expect(lastLine()).toMatchObject({ verdict: 'error', reason: 'keyring', errorName: 'SealedError' });
  });
});

// ---------------------------------------------------------------------------------------------
// Row 5
// ---------------------------------------------------------------------------------------------

describe('row 5: DNS temperror on the deciding signature', () => {
  it('a fresh temperror answers 500 and records the first-seen time; the retry keeps it', async () => {
    const h = harness();
    const raw = await vendorSigned({}, { selector: 'slow' });
    const response = await handleInboundRequest(postmark(raw, { messageId: 'pm-slow-1' }), h.deps);
    expect(response.status).toBe(500);
    expect(summaries(h.fake)).toEqual([]);
    expect(h.fake.data(`summaryEvents/${firstSeenKey('pm-slow-1')}`)).toMatchObject({ firstSeenAt: RECEIVED_AT.toISOString() });
    expect(lastLine()).toMatchObject({ verdict: 'retry', reason: 'dns_temperror', row: 5 });
    expect(logger.warn).toHaveBeenCalledWith('summaries.inbound', expect.objectContaining({ verdict: 'retry' }));

    // DNS recovers; Postmark redelivers 30 minutes later.
    const healthy: DNSResolver = async (name, rrtype) =>
      name.toLowerCase() === `slow._domainkey.${VENDOR_DOMAIN}` ? [[dkimRecord(fixtureKeys().vendor)]] : h.dns.resolver(name, rrtype);
    h.deps.resolver = healthy;
    h.setNow(minutesAfter(RECEIVED_AT, 30));
    expect((await handleInboundRequest(postmark(raw, { messageId: 'pm-slow-1' }), h.deps)).status).toBe(200);
    const stored = summaries(h.fake);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.doc).toMatchObject({ status: 'matched', receivedAt: RECEIVED_AT.toISOString() });
  });

  it('an old message (Date 6 hours before receipt) is classified without the signature', async () => {
    const h = harness();
    const raw = await vendorSigned({ date: SIX_HOURS_OLD_DATE }, { selector: 'slow' });
    const response = await handleInboundRequest(postmark(raw, { messageId: 'pm-slow-old' }), h.deps);
    expect(response.status).toBe(200);
    expect(h.fake.has(`summaryEvents/${firstSeenKey('pm-slow-old')}`)).toBe(false);
    expect(refusedRow(h.fake)).toMatchObject({ refusedReason: 'sender_not_verified', count: 1 });
    expect(lastLine()).toMatchObject({ verdict: 'refused', reason: 'sender_not_verified', row: 13 });
  });
});

// ---------------------------------------------------------------------------------------------
// Rows 4, 6, 11 to 14
// ---------------------------------------------------------------------------------------------

describe('refusals and the Gmail code', () => {
  it('the refused cap counts refusals only, a redelivery once, and never caps accepted mail', async () => {
    const h = harness({}, { seed: false });
    seedAccount(h.fake, { refusedDay: '2026-11-10', refusedCount: 39 });
    seedMeetings(h.fake);

    await handleInboundRequest(postmark(await vendorSigned()), h.deps);
    expect(lastLine()).toMatchObject({ outcome: 'created' });
    expect(summaryUser(h.fake).refusedCount).toBe(39);

    const spoof = spoofedRecap({ messageId: '<junk-1@notetaker.example>' });
    await handleInboundRequest(postmark(spoof, { messageId: 'pm-junk-1' }), h.deps);
    expect(lastLine()).toMatchObject({ verdict: 'refused', outcome: 'recorded' });
    expect(summaryUser(h.fake).refusedCount).toBe(40);
    expect(h.fake.has(`summaryEvents/${refusalMarkerKey(UID, 'pm-junk-1')}`)).toBe(true);

    await handleInboundRequest(postmark(spoof, { messageId: 'pm-junk-1' }), h.deps);
    expect(lastLine()).toMatchObject({ verdict: 'refused', outcome: 'duplicate' });
    await handleInboundRequest(postmark(spoof, { messageId: 'pm-junk-2' }), h.deps);
    expect(lastLine()).toMatchObject({ verdict: 'refused', outcome: 'capped' });
    expect(summaryUser(h.fake).refusedCount).toBe(40);
    expect(refusedRow(h.fake)?.count).toBe(1);

    const second = await vendorSigned({ messageId: '<recap-0002@notetaker.example>', body: SECOND_RECAP_BODY });
    await handleInboundRequest(postmark(second), h.deps);
    expect(lastLine()).toMatchObject({ verdict: 'stored', outcome: 'created' });
    expect(summaries(h.fake)).toHaveLength(2);
  });

  it('row 4: a raw message over 5 MiB is refused too_large, a duplicate From malformed', async () => {
    const h = harness();
    const huge = buildMessage({ body: `${'x'.repeat(5 * 1024 * 1024 + 16)}\r\n` });
    await handleInboundRequest(postmark(huge), h.deps);
    expect(lastLine()).toMatchObject({ verdict: 'refused', reason: 'too_large', row: 4, detail: 'mime' });
    expect(h.dns.lookups).toEqual([]);

    const duplicateFrom = await vendorSigned({ extraHeaders: [`From: ${ATTACKER_ADDRESS}`] });
    await handleInboundRequest(postmark(duplicateFrom), h.deps);
    expect(lastLine()).toMatchObject({ verdict: 'refused', reason: 'malformed', row: 4 });
    expect(refusedRow(h.fake)).toMatchObject({ refusedReason: 'malformed', senderDomain: null, count: 2 });
    expect(summaries(h.fake)).toEqual([]);
  });

  it('row 4: parts nested deeper than 10 levels are refused too_large (the contract: 10 levels of nesting)', async () => {
    const h = harness();
    let part = `Content-Type: text/plain\r\n\r\n${RECAP_BODY}`;
    for (let level = 10; level >= 1; level -= 1) {
      part = `Content-Type: multipart/mixed; boundary="n${level}"\r\n\r\n--n${level}\r\n${part}\r\n--n${level}--\r\n`;
    }
    const deep = replaceHeader(buildMessage({ body: `--n0\r\n${part}\r\n--n0--\r\n` }), CONTENT_TYPE_PLAIN, 'Content-Type: multipart/mixed; boundary="n0"');
    await handleInboundRequest(postmark(deep), h.deps);
    expect(lastLine()).toMatchObject({ verdict: 'refused', reason: 'too_large', row: 4, detail: 'mime' });
    expect(refusedRow(h.fake)).toMatchObject({ refusedReason: 'too_large', senderDomain: null, count: 1 });
    expect(h.dns.lookups).toEqual([]);
    expect(summaries(h.fake)).toEqual([]);
  });

  it('row 12: a vendor recap changed after signing is refused changed_after_sending', async () => {
    const h = harness();
    const signed = await vendorSigned();
    const tampered = signed.replace('(owner: Bish)', '(owner: Mallory)');
    await handleInboundRequest(postmark(tampered), h.deps);
    expect(lastLine()).toMatchObject({ verdict: 'refused', reason: 'changed_after_sending', row: 12 });
    expect(summaries(h.fake)).toEqual([]);
  });

  it('row 6: the Gmail confirmation code is stored, keyed by the requesting address', async () => {
    const h = harness();
    const response = await handleInboundRequest(postmark(await gmailConfirmation()), h.deps);
    expect(response).toEqual({ status: 200, body: 'ok' });
    expect(summaryUser(h.fake).gmailRequests).toEqual([{ gmailAddress: GMAIL_REQUESTER, code: GMAIL_CODE, receivedAt: RECEIVED_AT.toISOString() }]);
    expect(refusedRow(h.fake)).toBeNull();
    expect(summaries(h.fake)).toEqual([]);
    expect(lastLine()).toMatchObject({ verdict: 'gmail', reason: 'gmail_confirmation', row: 6, outcome: 'stored', tier: 'gmail_confirmation' });
  });

  it('row 6: a request from the verified account email is never evicted by unlisted requesters; an unverified email does not count', async () => {
    const accountEmail = 'dana.account@gmail.example';
    const strangers = ['ann@stranger.example', 'bob@stranger.example', 'cyd@stranger.example'];
    const keptFor = async (emailVerified: boolean): Promise<string[]> => {
      // The Auth email in mixed case: the pipeline passes it lowercased.
      const user: InboundAuthUser = { exists: true, disabled: false, email: 'Dana.Account@Gmail.example', emailVerified };
      const h = harness({ authUsers: { getUser: async () => ({ ...user }) } });
      await handleInboundRequest(postmark(await gmailConfirmationFor(accountEmail, '111111111')), h.deps);
      for (const [index, stranger] of strangers.entries()) {
        h.setNow(minutesAfter(RECEIVED_AT, index + 1));
        await handleInboundRequest(postmark(await gmailConfirmationFor(stranger, `22222222${index}`)), h.deps);
        expect(lastLine()).toMatchObject({ verdict: 'gmail', reason: 'gmail_confirmation', outcome: 'stored' });
      }
      return (summaryUser(h.fake).gmailRequests as { gmailAddress: string }[]).map((request) => request.gmailAddress);
    };
    expect(await keptFor(true)).toEqual(['cyd@stranger.example', 'bob@stranger.example', accountEmail]);
    expect(await keptFor(false)).toEqual(['cyd@stranger.example', 'bob@stranger.example', 'ann@stranger.example']);
  });

  it('row 6: a confirmation that does not parse is answered 200 without a refused row', async () => {
    const h = harness();
    await handleInboundRequest(postmark(await googleSigned({ subject: 'Gmail Forwarding Confirmation', body: 'No code here.\r\n' })), h.deps);
    expect(summaryUser(h.fake).gmailRequests).toEqual([]);
    expect(refusedRow(h.fake)).toBeNull();
    expect(lastLine()).toMatchObject({ verdict: 'gmail', reason: 'gmail_unparsable' });
  });
});

// ---------------------------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------------------------

describe('logging', () => {
  it('one summaries.inbound line per authorized message, and no line carries content', async () => {
    const h = harness();
    const requests: InboundRequest[] = [
      postmark(await vendorSigned(), { messageId: 'pm-log-1' }),
      postmark(await userForward(), { messageId: 'pm-log-2' }),
      postmark(await gmailConfirmation(), { messageId: 'pm-log-3' }),
      postmark(spoofedRecap({ messageId: '<spoof-9@notetaker.example>' }), { messageId: 'pm-log-4' }),
      postmark(await attackerSigned({ messageId: '<atk-9@attacker.example>' }), { messageId: 'pm-log-5' }),
      postmark(await htmlOnlyRecap(), { messageId: 'pm-log-6' }),
      postmark(await vendorSigned({ messageId: '<slow-9@notetaker.example>' }, { selector: 'slow' }), { messageId: 'pm-log-7' }),
      postmark(await vendorSigned(), { messageId: 'pm-log-8', recipient: `${'b'.repeat(26)}@summaries.meetingguard.example` }),
    ];
    for (const [index, request] of requests.entries()) {
      const before = inboundLines().length;
      await handleInboundRequest(request, h.deps);
      expect([index, inboundLines().length - before]).toEqual([index, 1]);
    }
    h.fake.failNextCommit = Object.assign(new Error(`outage while writing ${USER_MAILBOX}`), { name: 'FirestoreUnavailable' });
    await handleInboundRequest(postmark(await vendorSigned({ messageId: '<recap-0003@notetaker.example>', body: SECOND_RECAP_BODY }), { messageId: 'pm-log-9' }), h.deps);
    await handleInboundRequest(postmark(await vendorSigned(), { authorization: 'Basic bm9wZTpub3Bl' }), h.deps);

    const calls = loggerMocks().flatMap((mock) => mock.mock.calls);
    expect(calls.length).toBeGreaterThan(requests.length);
    const text = calls.map((call) => JSON.stringify(call)).join('\n');
    const forbidden = [
      'Urpayroll',
      'Recap:',
      'Provide APK',
      'release checklist',
      'store listing',
      'Hidden instruction',
      'Gmail Forwarding',
      'Forwarded message',
      'outage while writing',
      '@',
      USER_DOMAIN,
      VENDOR_DOMAIN,
      ATTACKER_DOMAIN,
      'google.example',
      'meetingguard.example',
      TOKEN,
      tokenHash(TOKEN),
      GMAIL_CODE,
      'recap-0001',
      'spoof-9',
      FRESH_DATE,
      'Nov 2026',
      'pm-log-',
      SECRET,
      DATA_KEY.slice(3),
      'DKIM-Signature',
      'bh=',
    ];
    for (const needle of forbidden) {
      expect([needle, text.includes(needle)]).toEqual([needle, false]);
    }
    // tok8 is the only token-derived value, and it is there.
    expect(text).toContain(tokenHash(TOKEN).slice(0, 8));
  });
});

// ---------------------------------------------------------------------------------------------
// Production adapters
// ---------------------------------------------------------------------------------------------

describe('production adapters', () => {
  it('lazyKeyring parses once per secret value and never caches a malformed one', () => {
    let secret = 'k1:bad';
    let reads = 0;
    const keyring = lazyKeyring(() => {
      reads += 1;
      return secret;
    });
    expect(() => keyring()).toThrow(SealedError);
    secret = DATA_KEY;
    const first = keyring();
    expect(keyring()).toBe(first);
    expect(first.primaryId).toBe('k1');
    expect(reads).toBe(3);
  });

  it('firebaseAuthUsers maps a missing user and rethrows any other Auth failure', async () => {
    const users = firebaseAuthUsers({
      getUser: (async (uid: string) => {
        if (uid === 'gone') throw Object.assign(new Error('no user'), { code: 'auth/user-not-found' });
        if (uid === 'broken') throw Object.assign(new Error('backend'), { code: 'auth/internal-error' });
        return { uid, disabled: uid === 'off', email: USER_MAILBOX, emailVerified: true };
      }) as never,
    });
    await expect(users.getUser('gone')).resolves.toEqual({ exists: false, disabled: false, email: null, emailVerified: false });
    await expect(users.getUser('off')).resolves.toEqual({ exists: true, disabled: true, email: USER_MAILBOX, emailVerified: true });
    await expect(users.getUser('broken')).rejects.toThrow('backend');
  });
});

// ---------------------------------------------------------------------------------------------
// The HTTPS shell
// ---------------------------------------------------------------------------------------------

type InboundFunctionModule = typeof InboundFunctionNamespace;

interface FakeResponse {
  statusCode: number | null;
  body: unknown;
  headersSent: boolean;
  status(code: number): FakeResponse;
  send(body: unknown): FakeResponse;
  on(): FakeResponse;
}

function fakeResponse(): FakeResponse {
  const res: FakeResponse = {
    statusCode: null,
    body: undefined,
    headersSent: false,
    status(code) {
      res.statusCode = code;
      return res;
    },
    send(body) {
      res.body = body;
      res.headersSent = true;
      return res;
    },
    on() {
      return res;
    },
  };
  return res;
}

function fakeRequest(body: unknown, authorization: string | undefined): Record<string, unknown> {
  const rawBody = Buffer.from(JSON.stringify(body), 'utf8');
  const headers: Record<string, string> = { 'content-type': 'application/json', 'content-length': String(rawBody.length) };
  if (authorization !== undefined) headers.authorization = authorization;
  return {
    method: 'POST',
    headers,
    get: (name: string) => headers[name.toLowerCase()],
    body,
    rawBody,
  };
}

const SHELL_ENV = [
  'SUMMARIES_ENABLED',
  'SUMMARIES_WEBHOOK_AUTH',
  'SUMMARIES_DATA_KEY',
  'SUMMARIES_PILOT_UIDS',
  'SUMMARIES_ADDRESS_TEMPLATE',
  'SUMMARIES_SENDERS',
  'SUMMARIES_SERVICE_ACCOUNT',
] as const;

describe('makeSummaryInbound (HTTPS shell)', () => {
  const saved = new Map<string, string | undefined>(SHELL_ENV.map((name) => [name, process.env[name]]));
  const LAZY_MODULES = ['mailauth', 'postal-mime', '../../src/summaries/inbound', '../../src/firebase', 'node:dns'];

  afterEach(() => {
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    for (const name of LAZY_MODULES) jest.dontMock(name);
    jest.resetModules();
  });

  /** A fresh copy of the shell with the lazily loaded modules instrumented. */
  function loadShell(loaded: string[], fake?: FakeFirestore): InboundFunctionModule {
    jest.resetModules();
    jest.doMock('mailauth', () => {
      loaded.push('mailauth');
      return jest.requireActual('mailauth');
    });
    jest.doMock('postal-mime', () => {
      loaded.push('postal-mime');
      return jest.requireActual('postal-mime');
    });
    jest.doMock('../../src/summaries/inbound', () => {
      loaded.push('inbound');
      return jest.requireActual('../../src/summaries/inbound');
    });
    jest.doMock('../../src/firebase', () => ({
      adminDb: () => {
        loaded.push('adminDb');
        return fake;
      },
      adminAuth: () => {
        loaded.push('adminAuth');
        return { getUser: async (uid: string) => ({ uid, disabled: false, email: USER_MAILBOX, emailVerified: true }) };
      },
    }));
    // No network: any real DNS lookup fails loudly (an unsigned message needs none).
    jest.doMock('node:dns', () => {
      const actual = jest.requireActual('node:dns');
      class NoNetworkResolver {
        resolveTxt(): Promise<string[][]> {
          loaded.push('dns-lookup');
          return Promise.reject(Object.assign(new Error('no network in tests'), { code: 'ENOTFOUND' }));
        }
      }
      return { ...actual, promises: { ...actual.promises, Resolver: NoNetworkResolver } };
    });
    return jest.requireActual<InboundFunctionModule>('../../src/summaries/inboundFunction');
  }

  async function call(fn: unknown, req: Record<string, unknown>): Promise<FakeResponse> {
    const res = fakeResponse();
    await (fn as (request: unknown, response: unknown) => Promise<void>)(req, res);
    return res;
  }

  it('declares the design options: public invoker, both secrets, the inbound tuning', () => {
    const shell = loadShell([]);
    const endpoint = (shell.makeSummaryInbound() as unknown as { __endpoint: Record<string, unknown> }).__endpoint;
    expect(endpoint).toMatchObject({
      availableMemoryMb: 1024,
      cpu: 1,
      concurrency: 2,
      maxInstances: 3,
      timeoutSeconds: 60,
      httpsTrigger: { invoker: ['public'] },
    });
    const secrets = (endpoint.secretEnvironmentVariables as { key: string }[]).map((secret) => secret.key).sort();
    expect(secrets).toEqual(['SUMMARIES_DATA_KEY', 'SUMMARIES_WEBHOOK_AUTH']);
  });

  it('runs as SUMMARIES_SERVICE_ACCOUNT read at load (trimmed, shorthand expanded); unset or blank keeps the default account', () => {
    const account = 'summaries-runtime@demo-meetingguard.iam.gserviceaccount.com';
    // RESET_VALUE (the platform default) serializes to null, as the CLI manifest carries it.
    const wire = (fn: unknown): unknown => JSON.parse(JSON.stringify((fn as { __endpoint: { serviceAccountEmail: unknown } }).__endpoint.serviceAccountEmail));
    const savedProject = process.env.GCLOUD_PROJECT;
    try {
      for (const [value, project, expected] of [
        [`\t${account} `, 'demo-meetingguard', account],
        // The CLI grants secret access to the value as written, so the shorthand is expanded here.
        ['summaries-runtime@', ' demo-meetingguard ', account],
        ['summaries-runtime@', undefined, 'summaries-runtime@'],
        [undefined, 'demo-meetingguard', null],
        ['', 'demo-meetingguard', null],
        ['  ', 'demo-meetingguard', null],
      ] as const) {
        if (value === undefined) delete process.env.SUMMARIES_SERVICE_ACCOUNT;
        else process.env.SUMMARIES_SERVICE_ACCOUNT = value;
        if (project === undefined) delete process.env.GCLOUD_PROJECT;
        else process.env.GCLOUD_PROJECT = project;
        const shell = loadShell([]);
        // The reader lives in gate.ts (day 3's summaryRead imports it too); the shell uses it.
        expect([value, project, summariesServiceAccountAtLoad()]).toEqual([value, project, expected]);
        expect([value, project, wire(shell.makeSummaryInbound())]).toEqual([value, project, expected]);
      }
    } finally {
      if (savedProject === undefined) delete process.env.GCLOUD_PROJECT;
      else process.env.GCLOUD_PROJECT = savedProject;
    }
  });

  it('loads nothing at module load, answers 404 while switched off without loading, and loads the pipeline on the first request', async () => {
    const loaded: string[] = [];
    const shell = loadShell(loaded);
    const fn = shell.makeSummaryInbound();
    expect(loaded).toEqual([]);

    process.env.SUMMARIES_ENABLED = 'false';
    const off = await call(fn, fakeRequest({}, AUTHORIZATION));
    expect([off.statusCode, off.body]).toEqual([404, 'Not configured']);
    expect(loaded).toEqual([]);

    process.env.SUMMARIES_ENABLED = 'true';
    process.env.SUMMARIES_WEBHOOK_AUTH = SECRET;
    const unauthorized = await call(fn, fakeRequest({ RawEmail: 'x' }, 'Basic bm9wZTpub3Bl'));
    expect([unauthorized.statusCode, unauthorized.body]).toEqual([401, 'Unauthorized']);
    expect(loaded).toEqual(expect.arrayContaining(['inbound', 'mailauth', 'postal-mime']));
    // A 401 never touches the Admin SDK.
    expect(loaded).not.toContain('adminDb');
    expect(loaded).not.toContain('adminAuth');

    const count = loaded.length;
    await call(fn, fakeRequest({ RawEmail: 'x' }, undefined));
    expect(loaded.length).toBe(count);
  });

  it('runs the pipeline end to end through the shell (an unsigned spoof is refused, no DNS)', async () => {
    const fake = new FakeFirestore();
    seedAccount(fake);
    const loaded: string[] = [];
    const shell = loadShell(loaded, fake);
    process.env.SUMMARIES_ENABLED = 'true';
    process.env.SUMMARIES_WEBHOOK_AUTH = SECRET;
    process.env.SUMMARIES_DATA_KEY = DATA_KEY;
    process.env.SUMMARIES_PILOT_UIDS = UID;
    process.env.SUMMARIES_ADDRESS_TEMPLATE = TEMPLATE;
    process.env.SUMMARIES_SENDERS = VENDOR_ADDRESS;
    const fn = shell.makeSummaryInbound();
    const request = postmark(spoofedRecap(), { messageId: 'pm-shell-1' });
    const res = await call(fn, fakeRequest(request.body, AUTHORIZATION));
    expect([res.statusCode, res.body]).toEqual([200, 'ok']);
    expect(loaded).not.toContain('dns-lookup');
    const row = parseRefusedRow(fake.data(`users/${UID}/meetingSummaries/${refusedRowId(new Date().toISOString().slice(0, 10))}`));
    expect(row).toMatchObject({ refusedReason: 'sender_not_verified', count: 1 });
  });

  it('ignores a body whose declared Content-Length is over the limit', async () => {
    const fake = new FakeFirestore();
    seedAccount(fake);
    const shell = loadShell([], fake);
    process.env.SUMMARIES_ENABLED = 'true';
    process.env.SUMMARIES_WEBHOOK_AUTH = SECRET;
    process.env.SUMMARIES_ADDRESS_TEMPLATE = TEMPLATE;
    const fn = shell.makeSummaryInbound();
    const req = fakeRequest(postmark(spoofedRecap()).body, AUTHORIZATION);
    (req.headers as Record<string, string>)['content-length'] = String(SUMMARIES_MAX_BODY_BYTES + 1);
    const res = await call(fn, req);
    expect([res.statusCode, res.body]).toEqual([200, 'ok']);
    expect(fake.log).toEqual([]);
  });
});
