/**
 * M10 stored summary model and inbound write transactions (functions/src/summaries/model.ts and
 * store.ts; docs/v2/M10-DESIGN.md section 4 steps 9 to 16, sections 5, 7 and 8, findings 5, 7 and
 * 10). Firestore is the in-memory fake in summariesFakeFirestore.ts. All data is synthetic.
 */
jest.mock('firebase-functions/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import * as functionsLogger from 'firebase-functions/logger';
import type { Firestore } from 'firebase-admin/firestore';

import {
  SUMMARY_ID_PATTERN,
  SUMMARY_LIMITS,
  summaryDetailSchema,
  summaryStatusResponseSchema,
  type SummaryRefusedReason,
} from '../../src/shared/aiContract';
import { SealedError, parseKeyring, type Keyring } from '../../src/shared/sealed';
import { deleteSummary } from '../../src/summaries/actions';
import { createAddress, deleteAddressDocs, parseSummaryUser, regenerateAddress, resolveToken } from '../../src/summaries/address';
import { decide, type MatchCandidate, type MatchRecord } from '../../src/summaries/match';
import {
  FIRESTORE_MAX_DOC_BYTES,
  MAX_MERGED_LINKS,
  SUMMARY_DOC_SAFE_BYTES,
  SUMMARY_REFUSALS_PER_UTC_DAY,
  SUMMARY_RETENTION_DAYS,
  SUMMARY_SCHEMA_VERSION,
  addDaysIso,
  buildSummaryDoc,
  claimsMarkers,
  deletionMarkerKey,
  digestMarkerKey,
  estimateDocBytes,
  firstSeenKey,
  messageKeyFor,
  messageMarkerKey,
  normalizeMessageId,
  openSummaryBody,
  openSummaryHead,
  parseRefusedRow,
  parseStoredSummary,
  parseSummaryRecord,
  refusalMarkerKey,
  refusedRowId,
  sealSummaryContent,
  storedSummarySchema,
  summaryDocPath,
  summaryIdFor,
  trustRank,
  trustRankOf,
  trustRowOf,
  type BuildSummaryDocInput,
  type BuiltSummary,
  type StoredAuth,
} from '../../src/summaries/model';
import { extractSummaryMeta, parseSections, type ParsedSections, type SummarySection } from '../../src/summaries/sections';
import {
  activeGmailRequests,
  commitSummary,
  countInbox,
  isAlreadyExists,
  mergedLinksPatch,
  readFirstSeen,
  recordFirstSeen,
  recordRefusal,
  storeGmailRequest,
  type CommitSummaryInput,
} from '../../src/summaries/store';
import { FakeFirestore } from './summariesFakeFirestore';

// ---------------------------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------------------------

const KEYRING: Keyring = parseKeyring(`k1:${Buffer.alloc(32, 7).toString('base64')}`);
const UID = 'uid-test-dana';
const OTHER_UID = 'uid-test-lee';
const TEMPLATE = '{token}@summaries.meetingguard.example';
const VENDOR_ADDRESS = 'recaps@notetaker.example';
const VENDOR_DOMAIN = 'notetaker.example';
const USER_MAILBOX = 'dana@company.example';
const RECEIVED_AT = new Date('2026-10-16T15:25:00.000Z');
const SIGNED_DATE = new Date('2026-10-16T15:20:00.000Z');
const NOW = RECEIVED_AT;

const RECAP_TEXT = [
  'Atlas launch sync',
  'Oct 16, 2026',
  '',
  'Action items',
  '- Dana ships the release notes (owner: Dana)',
  '- Lee checks the store listing (owner: Lee)',
  '',
  'Decisions',
  '- Use the new onboarding flow',
].join('\n');
const VENDOR_SUBJECT = 'Your notes: Atlas launch sync';

const MEETING: MatchCandidate = {
  meetingId: 'meet-atlas-1',
  occurrenceDate: null,
  title: 'Atlas launch sync',
  startAt: '2026-10-16T14:00:00.000Z',
  endAt: '2026-10-16T15:00:00.000Z',
  timezone: 'UTC',
  allDay: false,
  cancelled: false,
  deleted: false,
  source: 'google',
  conferenceUrl: null,
};

const AUTH: StoredAuth = {
  dkim: [{ domain: VENDOR_DOMAIN, result: 'pass', aligned: true, signsTo: true, signsDate: true }],
  arc: { result: 'none', sealer: null },
  verifier: 'mailauth@8.0.4',
};

type Row = 7 | 8 | 9 | 10;

const CLASSIFICATIONS: Record<Row, BuildSummaryDocInput['classification']> = {
  7: { row: 7, tier: 'vendor_verified', recipientBound: true, fresh: true, senderDomain: VENDOR_DOMAIN, anchorAt: SIGNED_DATE, anchorSource: 'signed_date' },
  8: { row: 8, tier: 'vendor_verified', recipientBound: true, fresh: false, senderDomain: VENDOR_DOMAIN, anchorAt: SIGNED_DATE, anchorSource: 'signed_date' },
  9: { row: 9, tier: 'vendor_verified', recipientBound: false, fresh: true, senderDomain: VENDOR_DOMAIN, anchorAt: SIGNED_DATE, anchorSource: 'signed_date' },
  10: { row: 10, tier: 'user_forwarded', recipientBound: false, fresh: true, senderDomain: 'company.example', anchorAt: null, anchorSource: null },
};

interface DocSpec {
  row: Row;
  messageId?: string;
  text?: string;
  subject?: string;
  receivedAt?: Date;
  now?: Date;
  uid?: string;
  sections?: ParsedSections;
  safeBytes?: number;
  forwardAnchorAt?: Date | null;
}

interface Built {
  built: BuiltSummary;
  summaryId: string;
  messageKey: string;
  uid: string;
}

function matchFor(row: Row, text: string, subject: string, now: Date): MatchRecord {
  const meta = extractSummaryMeta(text, subject);
  const facts = CLASSIFICATIONS[row];
  return decide({
    tier: facts.tier === 'user_forwarded' ? 'user_forwarded' : 'vendor_verified',
    recipientBound: facts.recipientBound,
    fresh: facts.fresh,
    titleLine: meta.titleLine,
    subjectClean: meta.subjectClean,
    summaryDate: meta.summaryDate,
    anchor: facts.anchorAt === null ? null : { at: facts.anchorAt.toISOString(), signed: true },
    text,
    preferencesTimeZone: 'UTC',
    rejectedMeetingIds: [],
    candidates: [MEETING],
    now,
  });
}

function buildFor(spec: DocSpec): Built {
  const uid = spec.uid ?? UID;
  const text = spec.text ?? RECAP_TEXT;
  const row = spec.row;
  const subject = spec.subject ?? (row === 10 ? `Fwd: ${VENDOR_SUBJECT}` : VENDOR_SUBJECT);
  const now = spec.now ?? NOW;
  const messageKey = messageKeyFor({
    messageIdHeader: spec.messageId ?? '<recap-1@notetaker.example>',
    decidingSignatureValue: null,
    raw: Buffer.from(text),
  });
  const summaryId = summaryIdFor(uid, messageKey);
  const meta = extractSummaryMeta(text, subject);
  const built = buildSummaryDoc({
    keyring: KEYRING,
    uid,
    summaryId,
    classification: CLASSIFICATIONS[row],
    match: matchFor(row, text, subject, now),
    sections: spec.sections ?? parseSections(text),
    meta,
    text,
    textTruncated: false,
    subject,
    fromAddress: row === 10 ? USER_MAILBOX : VENDOR_ADDRESS,
    fromName: row === 10 ? 'Dana Tester' : 'Notetaker Recaps',
    auth: AUTH,
    sentAt: SIGNED_DATE,
    forwardAnchorAt: spec.forwardAnchorAt ?? null,
    receivedAt: spec.receivedAt ?? RECEIVED_AT,
    now,
    safeBytes: spec.safeBytes,
  });
  return { built, summaryId, messageKey, uid };
}

interface Harness {
  fake: FakeFirestore;
  db: Firestore;
  tokenHash: string;
}

async function harness(options: { withUser?: boolean } = {}): Promise<Harness> {
  const fake = new FakeFirestore();
  const db = fake as unknown as Firestore;
  if (options.withUser !== false) fake.seed(`users/${UID}`, { createdAt: '2026-09-01T00:00:00.000Z' });
  await createAddress(UID, USER_MAILBOX, { db, now: () => new Date('2026-10-01T00:00:00.000Z'), template: TEMPLATE });
  const tokenHash = parseSummaryUser(fake.data(`summaryUsers/${UID}`)).tokenHash;
  if (tokenHash === null) throw new Error('fixture: no tokenHash');
  return { fake, db, tokenHash };
}

function commitInput(h: Harness, b: Built, now: Date = NOW): CommitSummaryInput {
  return {
    uid: b.uid,
    tokenHash: h.tokenHash,
    summaryId: b.summaryId,
    doc: b.built.doc,
    reseal: b.built.reseal,
    claimMarkers: b.built.claimMarkers,
    messageIdMarkerKey: messageMarkerKey(b.uid, b.messageKey),
    digestMarkerKey: digestMarkerKey(b.uid, b.built.doc.contentDigest),
    rank: b.built.rank,
    now,
  };
}

function summaryPath(summaryId: string, uid = UID): string {
  return summaryDocPath(uid, summaryId);
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

const CJK = String.fromCharCode(0x4e2d);

/** 100,000 characters: 1,000 lines of 99 CJK characters (3 UTF-8 bytes each), newline separated, plus one. */
function bigText(): string {
  const line = CJK.repeat(99);
  return Array.from({ length: 1000 }, () => line).join('\n') + CJK;
}

/** 400 overlapping items of 1,000 characters each, all exact slices of `text`. */
function bigSections(text: string): ParsedSections {
  const items = Array.from({ length: 400 }, (_, index) => {
    const start = index * 240;
    const end = start + 1000;
    return {
      id: `i_${index.toString(16).padStart(12, '0')}`,
      text: text.slice(start, end),
      start,
      end,
      checked: null,
      owner: null,
      dueText: null,
      flags: [],
    };
  });
  const section: SummarySection = {
    id: 's_000000000001',
    kind: 'action_items',
    heading: null,
    derived: false,
    start: 0,
    end: text.length,
    flags: [],
    items,
  };
  return { parserVersion: 1, sections: [section], truncated: false, possibleInstruction: false, counts: { sections: 1, items: 400 } };
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------------------------
// model: ids and keys
// ---------------------------------------------------------------------------------------------

describe('model: ids and keys', () => {
  it('normalizeMessageId trims, removes one pair of angle brackets and keeps the case', () => {
    expect(normalizeMessageId('<recap-1@notetaker.example>')).toBe('recap-1@notetaker.example');
    expect(normalizeMessageId('  <CAKx9Zq.Ab+cD@Mail.Notetaker.Example>  ')).toBe('CAKx9Zq.Ab+cD@Mail.Notetaker.Example');
    expect(normalizeMessageId('bare-id@notetaker.example')).toBe('bare-id@notetaker.example');
    expect(normalizeMessageId('< spaced@notetaker.example >')).toBe('spaced@notetaker.example');
  });

  it('normalizeMessageId refuses empty, oversized, multiple, whitespace and non-ASCII ids', () => {
    expect(normalizeMessageId('<>')).toBeNull();
    expect(normalizeMessageId('   ')).toBeNull();
    expect(normalizeMessageId(null)).toBeNull();
    expect(normalizeMessageId(`<${'a'.repeat(999)}@x.example>`)).toBeNull();
    expect(normalizeMessageId('<a@x.example> <b@x.example>')).toBeNull();
    expect(normalizeMessageId('<a b@x.example>')).toBeNull();
    expect(normalizeMessageId('<<a@x.example>>')).toBeNull();
    expect(normalizeMessageId(`<a${String.fromCharCode(0xe9)}@x.example>`)).toBeNull();
  });

  it('messageKeyFor prefers the Message-ID, then the deciding b= value, then sha256 of the raw bytes', () => {
    const raw = Buffer.from('raw message bytes');
    expect(messageKeyFor({ messageIdHeader: '<m1@notetaker.example>', decidingSignatureValue: 'QUJD', raw })).toBe('mid:m1@notetaker.example');
    expect(messageKeyFor({ messageIdHeader: null, decidingSignatureValue: ' QUJD\r\n RUZH= ', raw })).toBe('sig:QUJDRUZH=');
    expect(messageKeyFor({ messageIdHeader: '<bad id>', decidingSignatureValue: 'not base64!', raw })).toBe(
      `raw:${createHash('sha256').update(raw).digest('hex')}`,
    );
  });

  it('the source prefix keeps a Message-ID from ever equalling a signature or raw key', () => {
    const raw = Buffer.from('x');
    const fromId = messageKeyFor({ messageIdHeader: 'QUJD', decidingSignatureValue: null, raw });
    const fromSig = messageKeyFor({ messageIdHeader: null, decidingSignatureValue: 'QUJD', raw });
    expect(fromId).not.toBe(fromSig);
    expect(summaryIdFor(UID, fromId)).not.toBe(summaryIdFor(UID, fromSig));
  });

  it('summaryIdFor is sha256 hex of mg-sum:v1:uid:messageKey, per uid, and a valid contract id', () => {
    const key = 'mid:m1@notetaker.example';
    const id = summaryIdFor(UID, key);
    expect(id).toBe(sha256(`mg-sum:v1:${UID}:${key}`));
    expect(id).toMatch(/^[0-9a-f]{64}$/);
    expect(SUMMARY_ID_PATTERN.test(id)).toBe(true);
    expect(summaryIdFor(OTHER_UID, key)).not.toBe(id);
    expect(() => summaryIdFor('a/b', key)).toThrow('invalid uid');
  });

  it('refusedRowId names one row per UTC day and satisfies the contract id pattern', () => {
    expect(refusedRowId('2026-11-12')).toBe('refused-2026-11-12');
    expect(SUMMARY_ID_PATTERN.test(refusedRowId('2026-11-12'))).toBe(true);
    expect(() => refusedRowId('2026-11-12T00:00')).toThrow('invalid UTC day');
  });

  it('marker keys are sha256 hex with one versioned prefix per kind, so the kinds never collide', () => {
    expect(firstSeenKey('pm-1')).toBe(sha256('mg-seen:v1:pm-1'));
    expect(refusalMarkerKey(UID, 'pm-1')).toBe(sha256(`mg-ref:v1:${UID}:pm-1`));
    expect(messageMarkerKey(UID, 'mid:m1')).toBe(sha256(`mg-mid:v1:${UID}:mid:m1`));
    expect(digestMarkerKey(UID, 'ab'.repeat(32))).toBe(sha256(`mg-dig:v1:${UID}:${'ab'.repeat(32)}`));
    expect(deletionMarkerKey(UID, 'ab'.repeat(32))).toBe(sha256(`mg-del:v1:${UID}:${'ab'.repeat(32)}`));
    const keys = new Set([
      firstSeenKey('x'),
      refusalMarkerKey(UID, 'x'),
      messageMarkerKey(UID, 'x'),
      digestMarkerKey(UID, 'x'),
      deletionMarkerKey(UID, 'x'),
    ]);
    expect(keys.size).toBe(5);
    expect(deletionMarkerKey(OTHER_UID, 'x')).not.toBe(deletionMarkerKey(UID, 'x'));
  });
});

// ---------------------------------------------------------------------------------------------
// model: trust ranks
// ---------------------------------------------------------------------------------------------

describe('model: trust ranks', () => {
  it('ranks row 7 over 8 over 10 over 9, and every other row below all of them', () => {
    expect(trustRank(7)).toBeGreaterThan(trustRank(8));
    expect(trustRank(8)).toBeGreaterThan(trustRank(10));
    expect(trustRank(10)).toBeGreaterThan(trustRank(9));
    expect(trustRank(9)).toBeGreaterThan(0);
    for (const row of [4, 5, 6, 11, 12, 13, 14]) expect(trustRank(row)).toBe(0);
  });

  it('only rows 7 and 10 claim markers', () => {
    expect([7, 8, 9, 10, 14].map(claimsMarkers)).toEqual([true, false, false, true, false]);
  });

  it('the stored trust facts give back the decision row and its rank', () => {
    for (const row of [7, 8, 9, 10] as const) {
      const { built } = buildFor({ row });
      expect(trustRowOf(built.doc.trust)).toBe(row);
      expect(trustRankOf(built.doc.trust)).toBe(trustRank(row));
      expect(built.rank).toBe(trustRank(row));
      expect(built.claimMarkers).toBe(row === 7 || row === 10);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// model: the stored document and sealing
// ---------------------------------------------------------------------------------------------

describe('model: buildSummaryDoc and sealing', () => {
  it('builds a filed row 7 summary with immutable trust facts and only structure in plaintext', () => {
    const { built, summaryId } = buildFor({ row: 7 });
    const doc = built.doc;
    expect(storedSummarySchema.safeParse(doc).success).toBe(true);
    expect(doc).toMatchObject({
      schemaVersion: SUMMARY_SCHEMA_VERSION,
      status: 'matched',
      inboxReason: null,
      refusedReason: null,
      trust: { tier: 'vendor_verified', recipientBound: true, fresh: true, anchorSource: 'signed_date', originalInboxReason: null },
      senderDomain: VENDOR_DOMAIN,
      vendorDomain: VENDOR_DOMAIN,
      receivedAt: RECEIVED_AT.toISOString(),
      sentAt: SIGNED_DATE.toISOString(),
      anchorAt: SIGNED_DATE.toISOString(),
      summaryDate: '2026-10-16',
      userAction: null,
      extraction: null,
      counts: { sections: 3, items: 3, textChars: RECAP_TEXT.length },
      flags: { truncated: false, textCutForSize: false, itemTextFromOffsets: false, possibleInstruction: false },
      expiresAt: addDaysIso(RECEIVED_AT, SUMMARY_RETENTION_DAYS.filedOrKept),
    });
    expect(doc.match).toMatchObject({ meetingId: MEETING.meetingId, method: 'auto' });
    expect(built.degradation).toBe('none');
    // No content in plaintext: no body line, no subject, no From address, no display name.
    const plain = JSON.stringify({ ...doc, sealedHead: null, sealedBody: null });
    for (const secret of ['Dana ships', 'onboarding', 'Your notes', VENDOR_ADDRESS, 'Notetaker Recaps', 'Oct 16, 2026']) {
      expect(plain).not.toContain(secret);
    }
    expect(doc.sealedHead).not.toContain('Atlas');
    expect(summaryId).toMatch(/^[0-9a-f]{64}$/);
  });

  it('an inbox summary expires after 60 days; filed or kept ones after 365', () => {
    const { built } = buildFor({ row: 9 });
    expect(built.doc.status).toBe('inbox');
    expect(built.doc.inboxReason).toBe('not_addressed_to_you');
    expect(built.doc.trust.originalInboxReason).toBe('not_addressed_to_you');
    expect(built.doc.candidates).toEqual([]);
    expect(built.doc.expiresAt).toBe(addDaysIso(RECEIVED_AT, 60));
  });

  it('stores only a row 7 copy as filed and never gives row 9 suggestions, even from a mismatched match record', () => {
    const filedRecord = matchFor(7, RECAP_TEXT, VENDOR_SUBJECT, NOW);
    expect(filedRecord.status).toBe('matched');
    const b = buildFor({ row: 9 });
    const forced = buildSummaryDoc({
      keyring: KEYRING,
      uid: UID,
      summaryId: b.summaryId,
      classification: CLASSIFICATIONS[9],
      match: filedRecord,
      sections: parseSections(RECAP_TEXT),
      meta: extractSummaryMeta(RECAP_TEXT, VENDOR_SUBJECT),
      text: RECAP_TEXT,
      textTruncated: false,
      subject: VENDOR_SUBJECT,
      fromAddress: VENDOR_ADDRESS,
      fromName: null,
      auth: AUTH,
      sentAt: null,
      receivedAt: RECEIVED_AT,
      now: NOW,
    });
    expect(forced.doc).toMatchObject({ status: 'inbox', inboxReason: 'not_addressed_to_you', match: null, candidates: [] });
    expect(forced.doc.trust.originalInboxReason).toBe('not_addressed_to_you');
  });

  it('a user forward names the forwarding mailbox and anchors on the wrapper date (unsigned)', () => {
    const wrapperDate = new Date('2026-10-16T15:21:00.000Z');
    const { built, summaryId } = buildFor({ row: 10, forwardAnchorAt: wrapperDate });
    expect(built.doc.trust).toMatchObject({ tier: 'user_forwarded', anchorSource: 'forward_wrapper' });
    expect(built.doc.anchorAt).toBe(wrapperDate.toISOString());
    expect(built.doc.vendorDomain).toBeNull();
    expect(built.doc.status).toBe('inbox');
    const body = openSummaryBody(KEYRING, { uid: UID, summaryId }, built.doc.sealedBody);
    expect(body.fromAddress).toBe(USER_MAILBOX);
    expect(body.forwardedBy).toBe(USER_MAILBOX);
  });

  it('round-trips both sealed fields, and the opened body parses as the contract detail', () => {
    const { built, summaryId } = buildFor({ row: 7 });
    const ref = { uid: UID, summaryId };
    expect(openSummaryHead(KEYRING, ref, built.doc.sealedHead)).toEqual({
      subject: VENDOR_SUBJECT,
      titleLine: 'Atlas launch sync',
      dateLine: 'Oct 16, 2026',
    });
    const body = openSummaryBody(KEYRING, ref, built.doc.sealedBody);
    expect(body.text).toBe(RECAP_TEXT);
    expect(body.fromAddress).toBe(VENDOR_ADDRESS);
    expect(body.fromName).toBe('Notetaker Recaps');
    expect(body.forwardedBy).toBeNull();
    expect(body.itemTextFromOffsets).toBe(false);
    expect(body.sections).toEqual(parseSections(RECAP_TEXT).sections);
    const detail = summaryDetailSchema.safeParse({
      summaryId,
      status: built.doc.status,
      title: 'Atlas launch sync',
      summaryDate: built.doc.summaryDate,
      receivedAt: built.doc.receivedAt,
      tier: built.doc.trust.tier,
      recipientBound: built.doc.trust.recipientBound,
      fresh: built.doc.trust.fresh,
      inboxReason: built.doc.inboxReason,
      refusedReason: null,
      senderDomain: built.doc.senderDomain,
      count: null,
      match: null,
      suggestions: [],
      subject: VENDOR_SUBJECT,
      titleLine: 'Atlas launch sync',
      fromAddress: body.fromAddress,
      forwardedBy: body.forwardedBy,
      text: body.text,
      sections: body.sections,
    });
    expect(detail.success).toBe(true);
  });

  it('a head opened as a body, a body opened as a head, or a blob moved to another summary or user fails to open', () => {
    const { built, summaryId } = buildFor({ row: 7 });
    const ref = { uid: UID, summaryId };
    const expectOpenFailed = (fn: () => unknown): void => {
      try {
        fn();
        throw new Error('expected open to fail');
      } catch (error) {
        expect(error).toBeInstanceOf(SealedError);
        expect((error as SealedError).reason).toBe('open_failed');
      }
    };
    expectOpenFailed(() => openSummaryBody(KEYRING, ref, built.doc.sealedHead));
    expectOpenFailed(() => openSummaryHead(KEYRING, ref, built.doc.sealedBody));
    expectOpenFailed(() => openSummaryHead(KEYRING, { uid: UID, summaryId: 'f'.repeat(64) }, built.doc.sealedHead));
    expectOpenFailed(() => openSummaryBody(KEYRING, { uid: OTHER_UID, summaryId }, built.doc.sealedBody));
  });

  it('reseal binds the same content to another summary id', () => {
    const { built, summaryId } = buildFor({ row: 7 });
    const otherId = 'e'.repeat(64);
    const resealed = built.reseal(otherId);
    expect(openSummaryBody(KEYRING, { uid: UID, summaryId: otherId }, resealed.sealedBody).text).toBe(RECAP_TEXT);
    expect(openSummaryHead(KEYRING, { uid: UID, summaryId: otherId }, resealed.sealedHead).subject).toBe(VENDOR_SUBJECT);
    expect(() => openSummaryBody(KEYRING, { uid: UID, summaryId }, resealed.sealedBody)).toThrow(SealedError);
  });

  it('sealSummaryContent seals the plain content with the same AAD scheme', () => {
    const ref = { uid: UID, summaryId: 'a'.repeat(64) };
    const sealed = sealSummaryContent(KEYRING, ref, {
      head: { subject: 'Subject', titleLine: null, dateLine: null },
      body: { fromAddress: VENDOR_ADDRESS, fromName: null, forwardedBy: null, text: RECAP_TEXT, sections: parseSections(RECAP_TEXT).sections },
    });
    expect(openSummaryHead(KEYRING, ref, sealed.sealedHead)).toEqual({ subject: 'Subject', titleLine: null, dateLine: null });
    expect(openSummaryBody(KEYRING, ref, sealed.sealedBody).text).toBe(RECAP_TEXT);
  });

  it('refuses to build for a refused row or a tier that does not fit the row', () => {
    const base = buildFor({ row: 7 });
    const text = RECAP_TEXT;
    const input: BuildSummaryDocInput = {
      keyring: KEYRING,
      uid: UID,
      summaryId: base.summaryId,
      classification: { ...CLASSIFICATIONS[7], row: 12 as never },
      match: matchFor(7, text, VENDOR_SUBJECT, NOW),
      sections: parseSections(text),
      meta: extractSummaryMeta(text, VENDOR_SUBJECT),
      text,
      textTruncated: false,
      subject: VENDOR_SUBJECT,
      fromAddress: VENDOR_ADDRESS,
      fromName: null,
      auth: AUTH,
      sentAt: null,
      receivedAt: RECEIVED_AT,
      now: NOW,
    };
    expect(() => buildSummaryDoc(input)).toThrow('only rows 7 to 10');
    expect(() => buildSummaryDoc({ ...input, classification: { ...CLASSIFICATIONS[10], row: 7 } })).toThrow('tier does not fit');
    expect(() => buildSummaryDoc({ ...input, classification: CLASSIFICATIONS[7], text: '' })).toThrow('unreadable');
  });

  it('parseSummaryRecord tells summaries and refused rows apart and tolerates unknown fields', () => {
    const { built } = buildFor({ row: 7 });
    const withExtra = { ...built.doc, futureField: { nested: true } };
    const parsed = parseStoredSummary(withExtra);
    expect(parsed).not.toBeNull();
    expect((parsed as Record<string, unknown>).futureField).toEqual({ nested: true });
    expect(parseSummaryRecord(withExtra)?.kind).toBe('summary');
    const row = {
      status: 'refused',
      refusedReason: 'not_from_your_notetaker',
      senderDomain: null,
      firstAt: NOW.toISOString(),
      lastAt: NOW.toISOString(),
      count: 2,
      expiresAt: addDaysIso(NOW, 30),
      schemaVersion: 1,
    };
    expect(parseSummaryRecord(row)?.kind).toBe('refused');
    expect(parseStoredSummary(row)).toBeNull();
    expect(parseSummaryRecord({ status: 'inbox' })).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
// model: the 1 MiB document limit
// ---------------------------------------------------------------------------------------------

describe('model: size degradation', () => {
  it('a 100,000-character text with 400 long items drops item text in favour of offsets and stays under the safe bound', () => {
    const text = bigText();
    expect(text.length).toBe(100_000);
    const sections = bigSections(text);
    const { built, summaryId } = buildFor({ row: 9, text, subject: 'Big recap', sections });
    expect(built.degradation).toBe('item_text_from_offsets');
    expect(built.doc.flags).toMatchObject({ itemTextFromOffsets: true, textCutForSize: false, truncated: false });
    expect(built.estimatedBytes).toBeLessThanOrEqual(SUMMARY_DOC_SAFE_BYTES);
    expect(estimateDocBytes(summaryPath(summaryId), built.doc)).toBe(built.estimatedBytes);
    expect(built.doc.counts).toEqual({ sections: 1, items: 400, textChars: 100_000 });

    const body = openSummaryBody(KEYRING, { uid: UID, summaryId }, built.doc.sealedBody);
    expect(body.itemTextFromOffsets).toBe(true);
    expect(body.text).toBe(text);
    const items = body.sections[0]?.items ?? [];
    expect(items).toHaveLength(400);
    items.forEach((item, index) => {
      expect(item.text).toBe(sections.sections[0]?.items[index]?.text);
      expect(item.text).toBe(text.slice(item.start, item.end));
    });
  });

  it('without the fallback the same content would not fit (the test really exercises it)', () => {
    const text = bigText();
    const plainJson = JSON.stringify({ text, sections: bigSections(text).sections });
    expect((Buffer.byteLength(plainJson, 'utf8') * 4) / 3).toBeGreaterThan(SUMMARY_DOC_SAFE_BYTES);
  });

  it('when offsets alone are not enough, cuts the text at a line boundary and flags truncated, never failing', () => {
    const text = bigText();
    const sections = bigSections(text);
    const safeBytes = 200_000;
    const { built, summaryId } = buildFor({ row: 9, text, subject: 'Big recap', sections, safeBytes });
    expect(built.degradation).toBe('text_cut');
    expect(built.doc.flags).toMatchObject({ truncated: true, textCutForSize: true, itemTextFromOffsets: true });
    expect(built.estimatedBytes).toBeLessThanOrEqual(safeBytes);

    const body = openSummaryBody(KEYRING, { uid: UID, summaryId }, built.doc.sealedBody);
    expect(body.text.length).toBeGreaterThan(0);
    expect(body.text.length).toBeLessThan(text.length);
    expect(text.startsWith(body.text)).toBe(true);
    expect(text.charAt(body.text.length)).toBe('\n');
    expect(built.doc.counts.textChars).toBe(body.text.length);
    const section = body.sections[0];
    expect(section?.end).toBe(body.text.length);
    expect(section?.flags).toContain('truncated');
    const items = section?.items ?? [];
    expect(items.length).toBeGreaterThan(0);
    expect(items.length).toBeLessThan(400);
    expect(built.doc.counts.items).toBe(items.length);
    for (const item of items) {
      expect(item.end).toBeLessThanOrEqual(body.text.length);
      expect(item.text).toBe(text.slice(item.start, item.end));
    }
  });

  it('a normal summary is far below the limit', () => {
    const { built } = buildFor({ row: 7 });
    expect(built.estimatedBytes).toBeLessThan(FIRESTORE_MAX_DOC_BYTES / 50);
  });
});

// ---------------------------------------------------------------------------------------------
// store: first seen
// ---------------------------------------------------------------------------------------------

describe('store: first seen', () => {
  it('keeps the original receipt time across Postmark retries', async () => {
    const fake = new FakeFirestore();
    const db = fake as unknown as Firestore;
    const first = new Date('2026-10-16T15:25:00.000Z');
    const retry = new Date('2026-10-16T15:40:00.000Z');
    expect(await readFirstSeen(db, 'pm-event-1')).toBeNull();
    expect((await recordFirstSeen(db, 'pm-event-1', first)).toISOString()).toBe(first.toISOString());
    expect((await recordFirstSeen(db, 'pm-event-1', retry)).toISOString()).toBe(first.toISOString());
    expect((await readFirstSeen(db, 'pm-event-1'))?.toISOString()).toBe(first.toISOString());
    expect(fake.data(`summaryEvents/${firstSeenKey('pm-event-1')}`)).toEqual({
      firstSeenAt: first.toISOString(),
      expiresAt: addDaysIso(first, 2),
    });
    // Only the hash of the provider id is a path.
    expect(fake.paths().join(' ')).not.toContain('pm-event-1');
  });

  it('an invalid provider id records nothing and returns now', async () => {
    const fake = new FakeFirestore();
    const db = fake as unknown as Firestore;
    expect((await recordFirstSeen(db, 'has space', NOW)).toISOString()).toBe(NOW.toISOString());
    expect(await readFirstSeen(db, null)).toBeNull();
    expect(fake.paths()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// store: refusals
// ---------------------------------------------------------------------------------------------

describe('store: recordRefusal', () => {
  const DAY = '2026-10-16';
  const refusal = (providerEventId: string | null, now: Date = NOW, reason: SummaryRefusedReason = 'not_from_your_notetaker') => ({
    uid: UID,
    reason,
    senderDomain: null,
    providerEventId,
    now,
  });

  it('records one refused row per UTC day with no content, the counter and lastRefused', async () => {
    const h = await harness();
    expect(await recordRefusal(h.db, { ...refusal('pm-1'), senderDomain: 'mailer.example' })).toBe('recorded');
    const rowPath = summaryPath(refusedRowId(DAY));
    expect(h.fake.data(rowPath)).toEqual({
      status: 'refused',
      refusedReason: 'not_from_your_notetaker',
      senderDomain: 'mailer.example',
      firstAt: NOW.toISOString(),
      lastAt: NOW.toISOString(),
      count: 1,
      expiresAt: addDaysIso(NOW, SUMMARY_RETENTION_DAYS.refused),
      schemaVersion: SUMMARY_SCHEMA_VERSION,
    });
    expect(parseRefusedRow(h.fake.data(rowPath))).not.toBeNull();
    const user = parseSummaryUser(h.fake.data(`summaryUsers/${UID}`));
    expect(user.refusedDay).toBe(DAY);
    expect(user.refusedCount).toBe(1);
    expect(user.lastRefused).toEqual({ reason: 'not_from_your_notetaker', at: NOW.toISOString(), senderDomain: 'mailer.example' });
    expect(h.fake.data(`summaryEvents/${refusalMarkerKey(UID, 'pm-1')}`)).toEqual({ expiresAt: addDaysIso(NOW, 35) });

    const later = new Date('2026-10-16T18:00:00.000Z');
    expect(await recordRefusal(h.db, refusal('pm-2', later, 'changed_after_sending'))).toBe('recorded');
    expect(h.fake.data(rowPath)).toMatchObject({
      refusedReason: 'changed_after_sending',
      senderDomain: null,
      firstAt: NOW.toISOString(),
      lastAt: later.toISOString(),
      count: 2,
    });
  });

  it('dedupes a redelivery by the provider event id', async () => {
    const h = await harness();
    expect(await recordRefusal(h.db, refusal('pm-1'))).toBe('recorded');
    expect(await recordRefusal(h.db, refusal('pm-1'))).toBe('duplicate');
    expect(h.fake.data(summaryPath(refusedRowId(DAY)))?.count).toBe(1);
    expect(parseSummaryUser(h.fake.data(`summaryUsers/${UID}`)).refusedCount).toBe(1);
  });

  it('the cap is the contract value, so summaryStatus refusedToday.capped agrees with it', () => {
    expect(SUMMARY_LIMITS.maxRefusalsPerDay).toBe(40);
    expect(SUMMARY_REFUSALS_PER_UTC_DAY).toBe(SUMMARY_LIMITS.maxRefusalsPerDay);
  });

  it('the 41st refusal of a UTC day writes nothing', async () => {
    const h = await harness();
    for (let index = 1; index <= SUMMARY_REFUSALS_PER_UTC_DAY; index += 1) {
      expect(await recordRefusal(h.db, refusal(`pm-${index}`))).toBe('recorded');
    }
    const before = h.fake.paths();
    const userBefore = h.fake.data(`summaryUsers/${UID}`);
    const rowBefore = h.fake.data(summaryPath(refusedRowId(DAY)));
    expect(await recordRefusal(h.db, refusal('pm-41'))).toBe('capped');
    expect(h.fake.paths()).toEqual(before);
    expect(h.fake.data(`summaryUsers/${UID}`)).toEqual(userBefore);
    expect(h.fake.data(summaryPath(refusedRowId(DAY)))).toEqual(rowBefore);
    expect(rowBefore?.count).toBe(SUMMARY_REFUSALS_PER_UTC_DAY);
    expect(h.fake.has(`summaryEvents/${refusalMarkerKey(UID, 'pm-41')}`)).toBe(false);
  });

  it('a new UTC day resets the cap and starts a new row', async () => {
    const h = await harness();
    for (let index = 1; index <= SUMMARY_REFUSALS_PER_UTC_DAY; index += 1) await recordRefusal(h.db, refusal(`pm-${index}`));
    const nextDay = new Date('2026-10-17T00:00:01.000Z');
    expect(await recordRefusal(h.db, refusal('pm-41', nextDay))).toBe('recorded');
    const user = parseSummaryUser(h.fake.data(`summaryUsers/${UID}`));
    expect(user.refusedDay).toBe('2026-10-17');
    expect(user.refusedCount).toBe(1);
    expect(h.fake.data(summaryPath(refusedRowId('2026-10-17')))?.count).toBe(1);
    expect(h.fake.data(summaryPath(refusedRowId(DAY)))?.count).toBe(SUMMARY_REFUSALS_PER_UTC_DAY);
  });

  it('is dropped without an address and never creates summaryUsers', async () => {
    const fake = new FakeFirestore();
    const db = fake as unknown as Firestore;
    fake.seed(`users/${UID}`, {});
    expect(await recordRefusal(db, refusal('pm-1'))).toBe('dropped');
    expect(fake.paths()).toEqual([`users/${UID}`]);
  });

  it('is dropped after a disconnect (tombstone) or once users/{uid} is gone', async () => {
    const h = await harness();
    await deleteAddressDocs(UID, { db: h.db }, { mode: 'disconnect' });
    const before = h.fake.paths();
    expect(await recordRefusal(h.db, refusal('pm-1'))).toBe('dropped');
    expect(h.fake.paths()).toEqual(before);

    const h2 = await harness({ withUser: false });
    expect(await recordRefusal(h2.db, refusal('pm-1'))).toBe('dropped');
    expect(h2.fake.paths().some((path) => path.startsWith('summaryEvents/'))).toBe(false);
  });

  it('with a tokenHash, a refusal for a regenerated address is dropped', async () => {
    const h = await harness();
    await regenerateAddress(UID, { db: h.db, now: () => NOW, template: TEMPLATE });
    expect(await recordRefusal(h.db, { ...refusal('pm-1'), tokenHash: h.tokenHash })).toBe('dropped');
    expect(h.fake.has(summaryPath(refusedRowId(DAY)))).toBe(false);
  });

  it('stores a sender domain only when it is a plain domain', async () => {
    const h = await harness();
    await recordRefusal(h.db, { ...refusal('pm-1'), senderDomain: 'not a domain <x>' });
    expect(h.fake.data(summaryPath(refusedRowId(DAY)))?.senderDomain).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
// store: Gmail confirmation requests
// ---------------------------------------------------------------------------------------------

describe('store: Gmail requests', () => {
  const request = (gmailAddress: string, code: string, receivedAt: Date, now: Date = receivedAt, accountEmail: string | null = null) => ({
    uid: UID,
    gmailAddress,
    code,
    accountEmail,
    receivedAt,
    now,
  });
  const at = (minutes: number): Date => new Date(NOW.getTime() + minutes * 60_000);
  const pending = (h: Harness, now: Date): string[] =>
    activeGmailRequests(parseSummaryUser(h.fake.data(`summaryUsers/${UID}`)), now).map((entry) => entry.gmailAddress);
  /** Synthetic Gmail addresses the user listed as mailboxes (plus the one from the harness). */
  const LISTED_GMAIL = 'dana.tester@gmail.example';
  const LISTED_GMAIL_2 = 'dana.home@gmail.example';
  const ACCOUNT_GMAIL = 'dana.account@gmail.example';
  const listMailboxes = (h: Harness, mailboxes: string[]): void => {
    const path = `summaryUsers/${UID}`;
    h.fake.seed(path, { ...(h.fake.data(path) ?? {}), mailboxes });
  };

  it('three unlisted requesters never push out the code of a listed mailbox (finding 14)', async () => {
    const h = await harness();
    listMailboxes(h, [USER_MAILBOX, LISTED_GMAIL]);
    expect(await storeGmailRequest(h.db, request(LISTED_GMAIL, 'OWN1', at(0)))).toBe('stored');
    for (let index = 1; index <= 3; index += 1) {
      expect(await storeGmailRequest(h.db, request(`stranger${index}@gmail.example`, `S${index}`, at(index)))).toBe('stored');
    }
    // The user's own code survives; the two newest strangers fill the other places.
    expect(pending(h, at(4))).toEqual(['stranger3@gmail.example', 'stranger2@gmail.example', LISTED_GMAIL]);
    expect(parseSummaryUser(h.fake.data(`summaryUsers/${UID}`)).gmailRequests).toHaveLength(SUMMARY_LIMITS.maxGmailRequests);
  });

  it('the verified account email ranks like a listed mailbox, and only when it is passed', async () => {
    const h = await harness();
    expect(await storeGmailRequest(h.db, request(ACCOUNT_GMAIL, 'ACC1', at(0), at(0), ACCOUNT_GMAIL))).toBe('stored');
    for (let index = 1; index <= 3; index += 1) {
      await storeGmailRequest(h.db, request(`stranger${index}@gmail.example`, `S${index}`, at(index), at(index), ACCOUNT_GMAIL));
    }
    expect(pending(h, at(4))).toContain(ACCOUNT_GMAIL);

    const h2 = await harness();
    await storeGmailRequest(h2.db, request(ACCOUNT_GMAIL, 'ACC1', at(0)));
    for (let index = 1; index <= 3; index += 1) {
      await storeGmailRequest(h2.db, request(`stranger${index}@gmail.example`, `S${index}`, at(index)));
    }
    expect(pending(h2, at(4))).not.toContain(ACCOUNT_GMAIL);
  });

  it('an unlisted request is crowded out by three listed ones and writes nothing', async () => {
    const h = await harness();
    listMailboxes(h, [USER_MAILBOX, LISTED_GMAIL, LISTED_GMAIL_2]);
    await storeGmailRequest(h.db, request(USER_MAILBOX, 'OWN1', at(0), at(0), ACCOUNT_GMAIL));
    await storeGmailRequest(h.db, request(LISTED_GMAIL, 'OWN2', at(1), at(1), ACCOUNT_GMAIL));
    await storeGmailRequest(h.db, request(ACCOUNT_GMAIL, 'OWN3', at(2), at(2), ACCOUNT_GMAIL));
    const before = h.fake.data(`summaryUsers/${UID}`);
    const writes = h.fake.writeLog().length;
    expect(await storeGmailRequest(h.db, request('stranger@gmail.example', 'S1', at(3), at(3), ACCOUNT_GMAIL))).toBe('crowded_out');
    expect(h.fake.data(`summaryUsers/${UID}`)).toEqual(before);
    expect(h.fake.writeLog()).toHaveLength(writes);
    // A listed request may still replace an older listed one (newest first among the listed).
    expect(await storeGmailRequest(h.db, request(LISTED_GMAIL_2, 'OWN4', at(4), at(4), ACCOUNT_GMAIL))).toBe('stored');
    expect(pending(h, at(5))).toEqual([LISTED_GMAIL_2, ACCOUNT_GMAIL, LISTED_GMAIL]);
  });

  it('a listed request pushes out an unlisted one, even when it is older than all of them', async () => {
    const h = await harness();
    listMailboxes(h, [USER_MAILBOX, LISTED_GMAIL]);
    for (let index = 1; index <= 3; index += 1) {
      await storeGmailRequest(h.db, request(`stranger${index}@gmail.example`, `S${index}`, at(index), at(10)));
    }
    expect(await storeGmailRequest(h.db, request(LISTED_GMAIL, 'OWN1', at(0), at(10)))).toBe('stored');
    // The oldest stranger leaves; the stored list stays newest first.
    expect(pending(h, at(10))).toEqual(['stranger3@gmail.example', 'stranger2@gmail.example', LISTED_GMAIL]);
    expect(parseSummaryUser(h.fake.data(`summaryUsers/${UID}`)).gmailRequests).toEqual([
      { gmailAddress: 'stranger3@gmail.example', code: 'S3', receivedAt: at(3).toISOString() },
      { gmailAddress: 'stranger2@gmail.example', code: 'S2', receivedAt: at(2).toISOString() },
      { gmailAddress: LISTED_GMAIL, code: 'OWN1', receivedAt: at(0).toISOString() },
    ]);
  });

  it('stores the contract shape and replaces an entry for the same Gmail address', async () => {
    const h = await harness();
    expect(await storeGmailRequest(h.db, request('Dana.Tester@Gmail.example', '123456789', at(0)))).toBe('stored');
    expect(await storeGmailRequest(h.db, request('dana.tester@gmail.example', '987654321', at(5)))).toBe('stored');
    const user = parseSummaryUser(h.fake.data(`summaryUsers/${UID}`));
    expect(user.gmailRequests).toEqual([{ gmailAddress: 'dana.tester@gmail.example', code: '987654321', receivedAt: at(5).toISOString() }]);
  });

  it('only a newer confirmation replaces the code of the same address: an older one is stale and writes nothing (both orders)', async () => {
    const path = `summaryUsers/${UID}`;
    const codeA = { gmailAddress: LISTED_GMAIL, code: 'CODEA1', receivedAt: at(0).toISOString() };
    const codeB = { gmailAddress: LISTED_GMAIL, code: 'CODEB2', receivedAt: at(10).toISOString() };

    // Code A, then code B ten minutes later, then a Postmark retry of the first delivery (it keeps
    // its first-seen receivedAt) one minute after B.
    const h = await harness();
    expect(await storeGmailRequest(h.db, request(LISTED_GMAIL, 'CODEA1', at(0)))).toBe('stored');
    expect(await storeGmailRequest(h.db, request(LISTED_GMAIL, 'CODEB2', at(10)))).toBe('stored');
    expect(parseSummaryUser(h.fake.data(path)).gmailRequests).toEqual([codeB]);
    const before = h.fake.data(path);
    const writes = h.fake.writeLog().length;
    expect(await storeGmailRequest(h.db, request(LISTED_GMAIL, 'CODEA1', at(0), at(11)))).toBe('stale');
    // The same delivery of B again (same receivedAt) is stale as well.
    expect(await storeGmailRequest(h.db, request(LISTED_GMAIL, 'CODEB2', at(10), at(12)))).toBe('stale');
    expect(h.fake.data(path)).toEqual(before);
    expect(h.fake.writeLog()).toHaveLength(writes);

    // Code B first, then code A delivered late: B stays; a newer code still replaces it.
    const h2 = await harness();
    expect(await storeGmailRequest(h2.db, request(LISTED_GMAIL, 'CODEB2', at(10)))).toBe('stored');
    expect(await storeGmailRequest(h2.db, request(LISTED_GMAIL, 'CODEA1', at(0), at(11)))).toBe('stale');
    expect(parseSummaryUser(h2.fake.data(path)).gmailRequests).toEqual([codeB]);
    expect(await storeGmailRequest(h2.db, request(LISTED_GMAIL, 'CODEC3', at(20)))).toBe('stored');
    expect(parseSummaryUser(h2.fake.data(path)).gmailRequests).toEqual([{ gmailAddress: LISTED_GMAIL, code: 'CODEC3', receivedAt: at(20).toISOString() }]);
    // Other addresses are unaffected by the check.
    expect(await storeGmailRequest(h2.db, request('person@gmail.example', 'CODED4', at(5), at(21)))).toBe('stored');
    expect(pending(h2, at(21))).toEqual([LISTED_GMAIL, 'person@gmail.example']);
    // codeA is only used to prove it never came back.
    expect(parseSummaryUser(h2.fake.data(path)).gmailRequests).not.toContainEqual(codeA);
  });

  it('keeps the newest 3, newest first', async () => {
    const h = await harness();
    for (let index = 0; index < 4; index += 1) {
      await storeGmailRequest(h.db, request(`person${index}@gmail.example`, `C${index}`, at(index)));
    }
    const active = activeGmailRequests(parseSummaryUser(h.fake.data(`summaryUsers/${UID}`)), at(4));
    expect(active.map((entry) => entry.gmailAddress)).toEqual(['person3@gmail.example', 'person2@gmail.example', 'person1@gmail.example']);
  });

  it('drops expired requests after 2 days, and refuses a late redelivery', async () => {
    const h = await harness();
    await storeGmailRequest(h.db, request('old@gmail.example', 'OLD1', at(0)));
    const later = new Date(NOW.getTime() + 2 * 24 * 60 * 60 * 1000 + 1);
    expect(activeGmailRequests(parseSummaryUser(h.fake.data(`summaryUsers/${UID}`)), later)).toEqual([]);
    await storeGmailRequest(h.db, request('new@gmail.example', 'NEW1', later));
    expect(parseSummaryUser(h.fake.data(`summaryUsers/${UID}`)).gmailRequests).toEqual([
      { gmailAddress: 'new@gmail.example', code: 'NEW1', receivedAt: later.toISOString() },
    ]);
    expect(await storeGmailRequest(h.db, request('late@gmail.example', 'LATE1', at(0), later))).toBe('expired');
  });

  it('refuses an invalid address or code, and drops without an address', async () => {
    const h = await harness();
    expect(await storeGmailRequest(h.db, request('not an address', 'ABC', at(0)))).toBe('invalid');
    expect(await storeGmailRequest(h.db, request('a@gmail.example', 'ABC-123', at(0)))).toBe('invalid');
    await deleteAddressDocs(UID, { db: h.db }, { mode: 'disconnect' });
    expect(await storeGmailRequest(h.db, request('a@gmail.example', 'ABC123', at(0)))).toBe('dropped');
  });

  it('activeGmailRequests skips malformed entries and its output fits summaryStatus', async () => {
    const user = parseSummaryUser({
      gmailRequests: [
        { gmailAddress: 'a@gmail.example', code: 'A1', receivedAt: at(1).toISOString() },
        { gmailAddress: 'a@gmail.example', code: 'A0', receivedAt: at(0).toISOString() },
        { gmailAddress: 'bad', code: 'X', receivedAt: at(2).toISOString() },
        'junk',
      ],
    });
    const active = activeGmailRequests(user, at(3));
    expect(active).toEqual([{ gmailAddress: 'a@gmail.example', code: 'A1', receivedAt: at(1).toISOString() }]);
    const status = summaryStatusResponseSchema.safeParse({
      enabled: true,
      allowed: true,
      ready: true,
      address: null,
      mailboxes: [],
      gmailRequests: active,
      inboxCount: 0,
      lastReceivedAt: null,
      lastRefused: null,
    });
    expect(status.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// store: commitSummary
// ---------------------------------------------------------------------------------------------

function eventPaths(fake: FakeFirestore): string[] {
  return fake.paths('summaryEvents/');
}

describe('store: commitSummary', () => {
  it('creates the summary, claims both markers with only expiresAt, and moves lastReceivedAt', async () => {
    const h = await harness();
    const b = buildFor({ row: 7 });
    const result = await commitSummary(h.db, commitInput(h, b));
    expect(result).toEqual({ outcome: 'created', reason: 'new', summaryId: b.summaryId, status: 'matched', markersClaimed: 2 });
    expect(parseStoredSummary(h.fake.data(summaryPath(b.summaryId)))).not.toBeNull();
    expect(eventPaths(h.fake).sort()).toEqual(
      [`summaryEvents/${messageMarkerKey(UID, b.messageKey)}`, `summaryEvents/${digestMarkerKey(UID, b.built.doc.contentDigest)}`].sort(),
    );
    for (const path of eventPaths(h.fake)) expect(h.fake.data(path)).toEqual({ expiresAt: addDaysIso(NOW, 35) });
    expect(parseSummaryUser(h.fake.data(`summaryUsers/${UID}`)).lastReceivedAt).toBe(RECEIVED_AT.toISOString());
    // Everything happened in one transaction, reads before writes.
    const tx = h.fake.transactions[h.fake.transactions.length - 1];
    expect(tx?.committed).toBe(true);
    expect(tx?.writes).toEqual(expect.arrayContaining([`create:${summaryPath(b.summaryId)}`]));
  });

  it('a redelivery of the same message is a duplicate and changes nothing', async () => {
    const h = await harness();
    const b = buildFor({ row: 7 });
    await commitSummary(h.db, commitInput(h, b));
    const stored = h.fake.data(summaryPath(b.summaryId));
    const again = buildFor({ row: 7 });
    const result = await commitSummary(h.db, commitInput(h, again, new Date(NOW.getTime() + 60_000)));
    expect(result).toMatchObject({ outcome: 'duplicate', reason: 'copy_exists', summaryId: b.summaryId, markersClaimed: 0 });
    expect(h.fake.data(summaryPath(b.summaryId))).toEqual(stored);
  });

  it('upgrades an inbox copy in place when a later bound vendor copy of the same message arrives', async () => {
    const h = await harness();
    const inbox = buildFor({ row: 9 });
    const first = await commitSummary(h.db, commitInput(h, inbox));
    expect(first).toMatchObject({ outcome: 'created', status: 'inbox', markersClaimed: 0 });
    expect(eventPaths(h.fake)).toEqual([]);

    const later = new Date(NOW.getTime() + 10 * 60_000);
    const bound = buildFor({ row: 7, now: later, receivedAt: later });
    expect(bound.summaryId).toBe(inbox.summaryId);
    const result = await commitSummary(h.db, commitInput(h, bound, later));
    expect(result).toEqual({ outcome: 'upgraded', reason: 'better_copy', summaryId: inbox.summaryId, status: 'matched', markersClaimed: 2 });
    const doc = parseStoredSummary(h.fake.data(summaryPath(inbox.summaryId)));
    expect(doc).toMatchObject({
      status: 'matched',
      inboxReason: null,
      trust: { tier: 'vendor_verified', recipientBound: true, fresh: true, originalInboxReason: null },
      createdAt: NOW.toISOString(),
      receivedAt: RECEIVED_AT.toISOString(),
      updatedAt: later.toISOString(),
      expiresAt: addDaysIso(RECEIVED_AT, 365),
    });
    expect(doc?.match?.meetingId).toBe(MEETING.meetingId);
    expect(openSummaryBody(KEYRING, { uid: UID, summaryId: inbox.summaryId }, doc?.sealedBody ?? '').text).toBe(RECAP_TEXT);
  });

  it('upgrades a digest twin with another Message-ID in place, resealed for its own id', async () => {
    const h = await harness();
    const inbox = buildFor({ row: 9, messageId: '<copy-a@notetaker.example>', subject: 'Atlas launch sync' });
    await commitSummary(h.db, commitInput(h, inbox));
    const bound = buildFor({ row: 7, messageId: '<copy-b@notetaker.example>' });
    expect(bound.summaryId).not.toBe(inbox.summaryId);
    const result = await commitSummary(h.db, commitInput(h, bound));
    expect(result).toMatchObject({ outcome: 'upgraded', summaryId: inbox.summaryId, status: 'matched' });
    expect(h.fake.has(summaryPath(bound.summaryId))).toBe(false);
    const doc = parseStoredSummary(h.fake.data(summaryPath(inbox.summaryId)));
    expect(openSummaryHead(KEYRING, { uid: UID, summaryId: inbox.summaryId }, doc?.sealedHead ?? '').subject).toBe(VENDOR_SUBJECT);
  });

  it('a lower-trust copy after a better one is a duplicate', async () => {
    const h = await harness();
    await commitSummary(h.db, commitInput(h, buildFor({ row: 7 })));
    const lower = buildFor({ row: 9, messageId: '<other-copy@notetaker.example>' });
    const result = await commitSummary(h.db, commitInput(h, lower));
    expect(result).toMatchObject({ outcome: 'duplicate', reason: 'copy_exists', status: 'matched' });
    expect(h.fake.has(summaryPath(lower.summaryId))).toBe(false);
  });

  it.each([
    ['kept', { status: 'kept', inboxReason: null, match: null, userAction: { kind: 'keep', at: NOW.toISOString() } }],
    [
      'attached',
      {
        status: 'matched',
        inboxReason: null,
        match: {
          meetingId: 'meet-other-7',
          occurrenceDate: null,
          duplicateMeetingIds: [],
          method: 'user',
          score: null,
          titleScore: null,
          timeScore: null,
          reasons: [],
          zoneUsed: null,
          matchedAt: NOW.toISOString(),
          meetingSnapshot: { title: 'Other meeting', startAt: MEETING.startAt, endAt: MEETING.endAt, timezone: 'UTC' },
        },
        userAction: { kind: 'attach', at: NOW.toISOString() },
      },
    ],
    ['detached', { status: 'inbox', inboxReason: 'weak', match: null, rejectedMeetingIds: ['meet-atlas-1'], userAction: { kind: 'detach', at: NOW.toISOString() } }],
  ])('never overrides a user action (%s): the better copy updates the trust facts, status and match stay', async (_label, action) => {
    const h = await harness();
    const inbox = buildFor({ row: 9 });
    await commitSummary(h.db, commitInput(h, inbox));
    const path = summaryPath(inbox.summaryId);
    h.fake.seed(path, { ...(h.fake.data(path) ?? {}), ...action });
    const before = parseStoredSummary(h.fake.data(path));
    expect(before).not.toBeNull();

    const result = await commitSummary(h.db, commitInput(h, buildFor({ row: 7 })));
    expect(result.outcome).toBe('upgraded');
    expect(result.status).toBe(before?.status);
    const after = parseStoredSummary(h.fake.data(path));
    expect(after?.status).toBe(before?.status);
    expect(after?.inboxReason).toBe(before?.inboxReason);
    expect(after?.match).toEqual(before?.match);
    expect(after?.candidates).toEqual(before?.candidates);
    expect(after?.userAction).toEqual(before?.userAction);
    expect(after?.rejectedMeetingIds).toEqual(before?.rejectedMeetingIds);
    expect(after?.expiresAt).toBe(before?.expiresAt);
    expect(after?.trust).toMatchObject({ tier: 'vendor_verified', recipientBound: true, fresh: true });
  });

  it('drops the commit when the address was regenerated between the lookup and the commit', async () => {
    const h = await harness();
    expect(await resolveToken(h.tokenHash, { db: h.db })).toBe(UID);
    await regenerateAddress(UID, { db: h.db, now: () => NOW, template: TEMPLATE });
    const b = buildFor({ row: 7 });
    const before = h.fake.paths();
    const result = await commitSummary(h.db, commitInput(h, b));
    expect(result).toEqual({ outcome: 'dropped', reason: 'address_changed', summaryId: null, status: null, markersClaimed: 0 });
    expect(h.fake.paths()).toEqual(before);
  });

  it('drops the commit when users/{uid} is gone', async () => {
    const h = await harness({ withUser: false });
    const result = await commitSummary(h.db, commitInput(h, buildFor({ row: 7 })));
    expect(result).toMatchObject({ outcome: 'dropped', reason: 'user_missing' });
    expect(h.fake.paths().filter((path) => !path.startsWith('summaryAddresses/') && !path.startsWith('summaryUsers/'))).toEqual([]);
  });

  it('a Firestore failure propagates and leaves no marker behind; the retry then creates it', async () => {
    const h = await harness();
    const b = buildFor({ row: 7 });
    const userBefore = h.fake.data(`summaryUsers/${UID}`);
    h.fake.failNextCommit = Object.assign(new Error('14 UNAVAILABLE: synthetic outage'), { code: 14 });
    await expect(commitSummary(h.db, commitInput(h, b))).rejects.toThrow('UNAVAILABLE');
    expect(eventPaths(h.fake)).toEqual([]);
    expect(h.fake.has(summaryPath(b.summaryId))).toBe(false);
    expect(h.fake.data(`summaryUsers/${UID}`)).toEqual(userBefore);
    expect((await commitSummary(h.db, commitInput(h, b))).outcome).toBe('created');
  });

  it('a forged message never reaches commitSummary, so it cannot pre-claim: the refused path writes no Message-ID marker and the real recap is created', async () => {
    const h = await harness();
    const real = buildFor({ row: 7 });
    // The forgery carries the real recap's Message-ID, is refused (row 14) and only counted.
    expect(await recordRefusal(h.db, { uid: UID, reason: 'not_from_your_notetaker', senderDomain: null, providerEventId: 'pm-forged', now: NOW })).toBe(
      'recorded',
    );
    expect(eventPaths(h.fake)).toEqual([`summaryEvents/${refusalMarkerKey(UID, 'pm-forged')}`]);
    expect(h.fake.has(`summaryEvents/${messageMarkerKey(UID, real.messageKey)}`)).toBe(false);
    expect(h.fake.has(`summaryEvents/${digestMarkerKey(UID, real.built.doc.contentDigest)}`)).toBe(false);
    const result = await commitSummary(h.db, commitInput(h, real));
    expect(result.outcome).toBe('created');
  });

  it('a deleted summary is not recreated by a redelivery (the markers outlive the delete)', async () => {
    const h = await harness();
    const b = buildFor({ row: 7 });
    await commitSummary(h.db, commitInput(h, b));
    h.fake.docs.delete(summaryPath(b.summaryId));
    const result = await commitSummary(h.db, commitInput(h, buildFor({ row: 7 })));
    expect(result).toMatchObject({ outcome: 'duplicate', reason: 'marker_claimed', summaryId: null });
    expect(h.fake.has(summaryPath(b.summaryId))).toBe(false);
  });

  it('an expired marker no longer blocks', async () => {
    const h = await harness();
    const b = buildFor({ row: 7 });
    h.fake.seed(`summaryEvents/${messageMarkerKey(UID, b.messageKey)}`, { expiresAt: addDaysIso(NOW, -1) });
    const result = await commitSummary(h.db, commitInput(h, b));
    expect(result).toMatchObject({ outcome: 'created', markersClaimed: 2 });
    expect(h.fake.data(`summaryEvents/${messageMarkerKey(UID, b.messageKey)}`)).toEqual({ expiresAt: addDaysIso(NOW, 35) });
  });

  it('only rows 7 and 10 claim markers, whatever the caller passes', async () => {
    const h = await harness();
    const b = buildFor({ row: 9 });
    const result = await commitSummary(h.db, { ...commitInput(h, b), claimMarkers: true });
    expect(result).toMatchObject({ outcome: 'created', markersClaimed: 0 });
    expect(eventPaths(h.fake)).toEqual([]);
  });

  it('a user forward claims markers and a later bound vendor copy still upgrades it', async () => {
    const h = await harness();
    const forward = buildFor({ row: 10, messageId: '<fwd-1@company.example>' });
    expect((await commitSummary(h.db, commitInput(h, forward))).markersClaimed).toBe(2);
    const vendor = buildFor({ row: 7 });
    const result = await commitSummary(h.db, commitInput(h, vendor));
    expect(result).toMatchObject({ outcome: 'upgraded', summaryId: forward.summaryId, status: 'matched' });
    const body = openSummaryBody(KEYRING, { uid: UID, summaryId: forward.summaryId }, h.fake.data(summaryPath(forward.summaryId))?.sealedBody as string);
    expect(body.forwardedBy).toBeNull();
    expect(body.fromAddress).toBe(VENDOR_ADDRESS);
  });

  it('lastReceivedAt never moves backwards', async () => {
    const h = await harness();
    const late = new Date(NOW.getTime() + 60 * 60_000);
    await commitSummary(h.db, commitInput(h, buildFor({ row: 7, messageId: '<late@notetaker.example>', receivedAt: late, now: late }), late));
    await commitSummary(
      h.db,
      commitInput(h, buildFor({ row: 9, messageId: '<early@notetaker.example>', text: `${RECAP_TEXT}\n- Another note`, receivedAt: NOW })),
    );
    expect(parseSummaryUser(h.fake.data(`summaryUsers/${UID}`)).lastReceivedAt).toBe(late.toISOString());
  });

  it('refuses a document that does not match the stored schema before touching Firestore', async () => {
    const h = await harness();
    const b = buildFor({ row: 7 });
    const count = h.fake.transactions.length;
    await expect(commitSummary(h.db, { ...commitInput(h, b), doc: { ...b.built.doc, status: 'refused' } as never })).rejects.toThrow(
      'does not match the stored schema',
    );
    expect(h.fake.transactions.length).toBe(count);
  });

  it('isAlreadyExists recognizes the admin SDK forms of ALREADY_EXISTS', () => {
    expect(isAlreadyExists({ code: 6 })).toBe(true);
    expect(isAlreadyExists({ code: 'already-exists' })).toBe(true);
    expect(isAlreadyExists({ code: 14 })).toBe(false);
    expect(isAlreadyExists(null)).toBe(false);
  });

  it('the store writes no log line at all (the handler logs ids and reasons only)', async () => {
    const h = await harness();
    jest.clearAllMocks();
    await recordFirstSeen(h.db, 'pm-log', NOW);
    await recordRefusal(h.db, { uid: UID, reason: 'malformed', senderDomain: null, providerEventId: 'pm-log', now: NOW });
    await storeGmailRequest(h.db, { uid: UID, gmailAddress: 'a@gmail.example', code: 'ABC123', accountEmail: null, receivedAt: NOW, now: NOW });
    await commitSummary(h.db, commitInput(h, buildFor({ row: 7 })));
    for (const fn of [functionsLogger.debug, functionsLogger.info, functionsLogger.warn, functionsLogger.error]) {
      expect(fn).not.toHaveBeenCalled();
    }
  });
});

// ---------------------------------------------------------------------------------------------
// store: a deleted summary stays deleted (design sections 7 and 14)
// ---------------------------------------------------------------------------------------------

describe('store: a deleted summary stays deleted', () => {
  const DELETE_AT = new Date(NOW.getTime() + 60 * 60_000);
  const LATER = new Date(NOW.getTime() + 2 * 24 * 60 * 60_000);

  async function createThenDelete(h: Harness, b: Built): Promise<void> {
    expect((await commitSummary(h.db, commitInput(h, b))).outcome).toBe('created');
    expect(await deleteSummary(h.db, UID, b.summaryId, DELETE_AT)).toEqual({ deleted: true });
    expect(h.fake.has(summaryPath(b.summaryId))).toBe(false);
  }

  async function deleteAndCheck(h: Harness, summaryId: string): Promise<void> {
    expect(await deleteSummary(h.db, UID, summaryId, DELETE_AT)).toEqual({ deleted: true });
    expect(h.fake.has(summaryPath(summaryId))).toBe(false);
  }

  it('the delete writes a deletion marker and the digest marker, {expiresAt} only, in its own transaction', async () => {
    const h = await harness();
    const b = buildFor({ row: 9 });
    expect((await commitSummary(h.db, commitInput(h, b))).markersClaimed).toBe(0);
    expect(eventPaths(h.fake)).toEqual([]);
    await deleteSummary(h.db, UID, b.summaryId, DELETE_AT);
    const deletion = `summaryEvents/${deletionMarkerKey(UID, b.summaryId)}`;
    const digest = `summaryEvents/${digestMarkerKey(UID, b.built.doc.contentDigest)}`;
    expect(eventPaths(h.fake)).toEqual([deletion, digest].sort());
    for (const path of [deletion, digest]) expect(h.fake.data(path)).toEqual({ expiresAt: addDaysIso(DELETE_AT, SUMMARY_RETENTION_DAYS.markers) });
    const tx = h.fake.transactions[h.fake.transactions.length - 1];
    expect(tx?.writes.sort()).toEqual([`delete:${summaryPath(b.summaryId)}`, `set:${deletion}`, `set:${digest}`].sort());
    expect(tx?.committed).toBe(true);
    // No uid and no content anywhere in a marker path or body.
    expect(JSON.stringify(eventPaths(h.fake).map((path) => [path, h.fake.data(path)]))).not.toContain(UID);
  });

  it('the same delivery retried after the delete is a duplicate, for a row that claims no markers', async () => {
    const h = await harness();
    const b = buildFor({ row: 9 });
    await createThenDelete(h, b);
    const markers = eventPaths(h.fake);
    const result = await commitSummary(h.db, commitInput(h, buildFor({ row: 9 }), LATER));
    expect(result).toEqual({ outcome: 'duplicate', reason: 'deleted_by_user', summaryId: null, status: null, markersClaimed: 0 });
    expect(h.fake.has(summaryPath(b.summaryId))).toBe(false);
    expect(eventPaths(h.fake)).toEqual(markers);
  });

  it('the same mail resent later at row 8 or 9 is not recreated, even when its text changed', async () => {
    const h = await harness();
    const b = buildFor({ row: 8 });
    await createThenDelete(h, b);
    // Same Message-ID, a changed footer: only the deletion marker can catch it.
    const edited = buildFor({ row: 8, text: `${RECAP_TEXT}\n- Sent again by the notetaker`, now: LATER, receivedAt: LATER });
    expect(edited.summaryId).toBe(b.summaryId);
    expect(edited.built.doc.contentDigest).not.toBe(b.built.doc.contentDigest);
    expect(await commitSummary(h.db, commitInput(h, edited, LATER))).toMatchObject({ outcome: 'duplicate', reason: 'deleted_by_user', markersClaimed: 0 });
    expect(await commitSummary(h.db, commitInput(h, buildFor({ row: 9, now: LATER, receivedAt: LATER }), LATER))).toMatchObject({
      outcome: 'duplicate',
      reason: 'deleted_by_user',
    });
    // The same content under another Message-ID: the digest marker the delete wrote catches it.
    const resent = buildFor({ row: 9, messageId: '<resent-1@notetaker.example>', now: LATER, receivedAt: LATER });
    expect(resent.summaryId).not.toBe(b.summaryId);
    expect(await commitSummary(h.db, commitInput(h, resent, LATER))).toMatchObject({ outcome: 'duplicate', reason: 'marker_claimed', markersClaimed: 0 });
    expect(h.fake.paths(`users/${UID}/meetingSummaries/`)).toEqual([]);
  });

  it('a better row 7 copy of the same message or the same content does not bring it back', async () => {
    const h = await harness();
    const b = buildFor({ row: 9 });
    await createThenDelete(h, b);
    const better = buildFor({ row: 7, now: LATER, receivedAt: LATER });
    expect(better.summaryId).toBe(b.summaryId);
    expect(await commitSummary(h.db, commitInput(h, better, LATER))).toMatchObject({ outcome: 'duplicate', reason: 'deleted_by_user', summaryId: null });
    const otherId = buildFor({ row: 7, messageId: '<better-copy@notetaker.example>', now: LATER, receivedAt: LATER });
    expect(await commitSummary(h.db, commitInput(h, otherId, LATER))).toMatchObject({ outcome: 'duplicate', reason: 'marker_claimed', summaryId: null });
    expect(h.fake.paths(`users/${UID}/meetingSummaries/`)).toEqual([]);
    expect(parseSummaryUser(h.fake.data(`summaryUsers/${UID}`)).lastReceivedAt).toBe(RECEIVED_AT.toISOString());
  });

  it('a deleted row 7 summary stays deleted too, and other mail still arrives', async () => {
    const h = await harness();
    const b = buildFor({ row: 7 });
    await createThenDelete(h, b);
    expect(await commitSummary(h.db, commitInput(h, buildFor({ row: 7 }), LATER))).toMatchObject({ outcome: 'duplicate', reason: 'deleted_by_user' });
    const other = buildFor({ row: 9, messageId: '<another-meeting@notetaker.example>', text: `${RECAP_TEXT}\n- A different meeting` });
    expect(await commitSummary(h.db, commitInput(h, other, LATER))).toMatchObject({ outcome: 'created', summaryId: other.summaryId });
  });

  const RESENT_TEXT = `${RECAP_TEXT}\n- Sent again by the notetaker`;

  it('a summary upgraded in place by a copy with another id stays deleted when that copy is resent with changed text', async () => {
    const h = await harness();
    const first = buildFor({ row: 9, messageId: '<m1@notetaker.example>' });
    const upgrader = buildFor({ row: 8, messageId: '<m2@notetaker.example>' });
    expect(upgrader.summaryId).not.toBe(first.summaryId);
    expect((await commitSummary(h.db, commitInput(h, first))).outcome).toBe('created');
    expect(await commitSummary(h.db, commitInput(h, upgrader))).toMatchObject({ outcome: 'upgraded', summaryId: first.summaryId });
    const upgraded = parseStoredSummary(h.fake.data(summaryPath(first.summaryId)));
    expect(upgraded?.mergedIds).toEqual([upgrader.summaryId]);
    expect(upgraded?.mergedDigests).toBeUndefined();

    expect(await deleteSummary(h.db, UID, first.summaryId, DELETE_AT)).toEqual({ deleted: true });
    const deletion = `summaryEvents/${deletionMarkerKey(UID, upgrader.summaryId)}`;
    expect(h.fake.data(deletion)).toEqual({ expiresAt: addDaysIso(DELETE_AT, SUMMARY_RETENTION_DAYS.markers) });
    const tx = h.fake.transactions[h.fake.transactions.length - 1];
    expect(tx?.writes).toContain(`set:${deletion}`);
    expect(tx?.writes).toContain(`delete:${summaryPath(first.summaryId)}`);

    // <m2> resent with a changed footer: its own id, a new digest, no Message-ID marker (rows 8
    // and 9 never claim one). Only the deletion marker of the merged id can catch it.
    for (const row of [8, 9] as const) {
      const resent = buildFor({ row, messageId: '<m2@notetaker.example>', text: RESENT_TEXT, now: LATER, receivedAt: LATER });
      expect(resent.summaryId).toBe(upgrader.summaryId);
      expect(resent.built.doc.contentDigest).not.toBe(first.built.doc.contentDigest);
      expect(await commitSummary(h.db, commitInput(h, resent, LATER))).toEqual({
        outcome: 'duplicate',
        reason: 'deleted_by_user',
        summaryId: null,
        status: null,
        markersClaimed: 0,
      });
    }
    expect(h.fake.paths(`users/${UID}/meetingSummaries/`)).toEqual([]);
  });

  it('a row 10 forward upgraded by a late row 8 original stays deleted when the original is resent at row 8 or 9', async () => {
    const h = await harness();
    const forward = buildFor({ row: 10, messageId: '<fwd-1@company.example>' });
    const original = buildFor({ row: 8, messageId: '<v1@notetaker.example>' });
    expect((await commitSummary(h.db, commitInput(h, forward))).outcome).toBe('created');
    expect(await commitSummary(h.db, commitInput(h, original))).toMatchObject({ outcome: 'upgraded', summaryId: forward.summaryId });
    expect(parseStoredSummary(h.fake.data(summaryPath(forward.summaryId)))?.mergedIds).toEqual([original.summaryId]);
    await deleteAndCheck(h, forward.summaryId);

    for (const row of [8, 9] as const) {
      const resent = buildFor({ row, messageId: '<v1@notetaker.example>', text: RESENT_TEXT, now: LATER, receivedAt: LATER });
      expect(resent.summaryId).toBe(original.summaryId);
      expect(await commitSummary(h.db, commitInput(h, resent, LATER))).toMatchObject({ outcome: 'duplicate', reason: 'deleted_by_user', summaryId: null });
    }
    expect(h.fake.paths(`users/${UID}/meetingSummaries/`)).toEqual([]);
  });

  it('a copy deduplicated against a summary (another id, same text) stays deleted when it is resent with changed text', async () => {
    const h = await harness();
    const kept = buildFor({ row: 7, messageId: '<kept-1@notetaker.example>' });
    const dup = buildFor({ row: 9, messageId: '<dup-1@notetaker.example>' });
    expect(dup.summaryId).not.toBe(kept.summaryId);
    expect((await commitSummary(h.db, commitInput(h, kept))).outcome).toBe('created');
    expect(await commitSummary(h.db, commitInput(h, dup))).toMatchObject({ outcome: 'duplicate', reason: 'copy_exists', summaryId: kept.summaryId });
    expect(parseStoredSummary(h.fake.data(summaryPath(kept.summaryId)))?.mergedIds).toEqual([dup.summaryId]);
    // A second identical duplicate adds no second link.
    await commitSummary(h.db, commitInput(h, dup));
    expect(parseStoredSummary(h.fake.data(summaryPath(kept.summaryId)))?.mergedIds).toEqual([dup.summaryId]);
    await deleteAndCheck(h, kept.summaryId);

    for (const row of [8, 9] as const) {
      const resent = buildFor({ row, messageId: '<dup-1@notetaker.example>', text: RESENT_TEXT, now: LATER, receivedAt: LATER });
      expect(resent.summaryId).toBe(dup.summaryId);
      expect(await commitSummary(h.db, commitInput(h, resent, LATER))).toMatchObject({ outcome: 'duplicate', reason: 'deleted_by_user', summaryId: null });
    }
    expect(h.fake.paths(`users/${UID}/meetingSummaries/`)).toEqual([]);
  });

  it('the content a same-id upgrade replaced stays deleted under another Message-ID', async () => {
    const h = await harness();
    const earlier = buildFor({ row: 9, messageId: '<m1@notetaker.example>' });
    const better = buildFor({ row: 7, messageId: '<m1@notetaker.example>', text: `${RECAP_TEXT}\n- Final version` });
    expect(better.summaryId).toBe(earlier.summaryId);
    expect(better.built.doc.contentDigest).not.toBe(earlier.built.doc.contentDigest);
    expect((await commitSummary(h.db, commitInput(h, earlier))).outcome).toBe('created');
    expect(await commitSummary(h.db, commitInput(h, better))).toMatchObject({ outcome: 'upgraded', summaryId: earlier.summaryId });
    const upgraded = parseStoredSummary(h.fake.data(summaryPath(earlier.summaryId)));
    expect(upgraded?.contentDigest).toBe(better.built.doc.contentDigest);
    expect(upgraded?.mergedDigests).toEqual([earlier.built.doc.contentDigest]);
    expect(upgraded?.mergedIds).toBeUndefined();
    await deleteAndCheck(h, earlier.summaryId);
    expect(h.fake.data(`summaryEvents/${digestMarkerKey(UID, earlier.built.doc.contentDigest)}`)).toEqual({
      expiresAt: addDaysIso(DELETE_AT, SUMMARY_RETENTION_DAYS.markers),
    });

    // The earlier content under another Message-ID at row 9 (no marker of its own): only the
    // digest marker of the replaced digest can catch it.
    const copy = buildFor({ row: 9, messageId: '<m3@notetaker.example>', now: LATER, receivedAt: LATER });
    expect(copy.built.doc.contentDigest).toBe(earlier.built.doc.contentDigest);
    expect(await commitSummary(h.db, commitInput(h, copy, LATER))).toMatchObject({ outcome: 'duplicate', reason: 'marker_claimed', summaryId: null });
    expect(h.fake.paths(`users/${UID}/meetingSummaries/`)).toEqual([]);
  });

  it('mergedLinksPatch adds only what changed, keeps the newest MAX_MERGED_LINKS, and a summary without links parses', () => {
    const { built } = buildFor({ row: 9 });
    const doc = built.doc;
    expect('mergedIds' in doc || 'mergedDigests' in doc).toBe(false);
    expect(parseStoredSummary(doc)).not.toBeNull();
    const own = 'a'.repeat(64);
    const other = 'b'.repeat(64);
    const newDigest = 'c'.repeat(64);
    expect(mergedLinksPatch(doc, own, own, doc.contentDigest)).toEqual({});
    expect(mergedLinksPatch(doc, own, other, doc.contentDigest)).toEqual({ mergedIds: [other] });
    expect(mergedLinksPatch(doc, own, own, newDigest)).toEqual({ mergedDigests: [doc.contentDigest] });
    expect(mergedLinksPatch({ ...doc, mergedIds: [other] }, own, other, doc.contentDigest)).toEqual({});
    const full = Array.from({ length: MAX_MERGED_LINKS }, (_, index) => (index + 1).toString(16).padStart(64, '0'));
    const patch = mergedLinksPatch({ ...doc, mergedIds: full, mergedDigests: full }, own, other, newDigest);
    expect(patch.mergedIds).toEqual([...full.slice(1), other]);
    expect(patch.mergedDigests).toEqual([...full.slice(1), doc.contentDigest]);
    expect(parseStoredSummary({ ...doc, ...patch })).not.toBeNull();
    expect(parseStoredSummary({ ...doc, mergedIds: [...full, other] })).toBeNull();
  });

  it('the markers hold for 35 days after the delete, then the mail may be stored again', async () => {
    const h = await harness();
    const b = buildFor({ row: 9 });
    await createThenDelete(h, b);
    const justBefore = new Date(DELETE_AT.getTime() + SUMMARY_RETENTION_DAYS.markers * 24 * 60 * 60_000 - 1);
    expect((await commitSummary(h.db, commitInput(h, buildFor({ row: 9 }), justBefore))).reason).toBe('deleted_by_user');
    const after = new Date(DELETE_AT.getTime() + SUMMARY_RETENTION_DAYS.markers * 24 * 60 * 60_000 + 1);
    expect((await commitSummary(h.db, commitInput(h, buildFor({ row: 9 }), after))).outcome).toBe('created');
  });
});

// ---------------------------------------------------------------------------------------------
// store: countInbox
// ---------------------------------------------------------------------------------------------

describe('firestore.indexes.json: meetingSummaries field overrides', () => {
  interface FieldOverride {
    collectionGroup: string;
    fieldPath: string;
    indexes: unknown[];
  }
  const overrides = (): FieldOverride[] => {
    const raw = readFileSync(join(__dirname, '..', '..', '..', 'firestore.indexes.json'), 'utf8');
    return (JSON.parse(raw) as { fieldOverrides: FieldOverride[] }).fieldOverrides.filter((entry) => entry.collectionGroup === 'meetingSummaries');
  };

  it('exempts the large sealed strings from indexing (they are never queried)', () => {
    for (const field of ['sealedHead', 'sealedBody']) {
      expect(overrides().find((entry) => entry.fieldPath === field)?.indexes).toEqual([]);
    }
  });

  it('keeps status and contentDigest indexed (countInbox and the commit digest query use them)', () => {
    for (const field of ['status', 'contentDigest']) {
      const entry = overrides().find((candidate) => candidate.fieldPath === field);
      expect(entry === undefined || entry.indexes.length > 0).toBe(true);
    }
    expect(overrides().find((entry) => entry.fieldPath === 'expiresAt')?.indexes.length).toBeGreaterThan(0);
  });
});

describe('store: countInbox', () => {
  it('counts only status inbox', async () => {
    const h = await harness();
    await commitSummary(h.db, commitInput(h, buildFor({ row: 9, messageId: '<a@notetaker.example>', text: `${RECAP_TEXT}\nA` })));
    await commitSummary(h.db, commitInput(h, buildFor({ row: 8, messageId: '<b@notetaker.example>', text: `${RECAP_TEXT}\nB` })));
    await commitSummary(h.db, commitInput(h, buildFor({ row: 7, messageId: '<c@notetaker.example>', text: `${RECAP_TEXT}\nC` })));
    await recordRefusal(h.db, { uid: UID, reason: 'malformed', senderDomain: null, providerEventId: 'pm-1', now: NOW });
    expect(await countInbox(h.db, UID)).toBe(2);
    expect(h.fake.log).toContain(`count:users/${UID}/meetingSummaries`);
    expect(await countInbox(h.db, OTHER_UID)).toBe(0);
  });
});
