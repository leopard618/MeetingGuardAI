/**
 * M10 private summary address (docs/v2/M10-DESIGN.md section 3, section 4 step 4, red-team
 * findings 12 and 15).
 *
 * - Token: 16 random bytes as lowercase RFC 4648 base32 without padding, 26 characters of
 *   [a-z2-7]. Lowercase because forwarders may case-fold local parts. Never derived from the uid,
 *   the email or the time; never the WhatsApp link code.
 * - summaryAddresses/{tokenHash} = {uid, createdAt}, tokenHash = sha256 hex of
 *   "mg-summary-address:v1:" + token (the hashLinkCode shape). summaryUsers/{uid} keeps the plain
 *   token so the user can re-read the address, plus the rotation and refusal counters and the
 *   mailboxes. Both collections are server-only (the rules catch-all denies them).
 * - Routing reads ONLY envelope data: Postmark OriginalRecipient, or MailboxHash on the
 *   development template when OriginalRecipient is absent. Header addresses (To, Cc,
 *   Delivered-To) never route mail to an account (finding 15).
 * - resolveToken also requires summaryUsers/{uid}.tokenHash to name the same hash, so a stale or
 *   restored index doc that the user doc no longer points at resolves to nobody.
 * - Every write runs in ONE transaction (the mintCode shape, functions/src/whatsapp/link.ts).
 *   Regenerate deletes the old index doc, so mail to the old address is dropped from then on, and
 *   logs summaries.address.rotated {uid, oldTok8} so a database restore can be followed by
 *   re-rotating (finding 12).
 * - Disconnect leaves a tombstone in summaryUsers/{uid} with only {rotationDay, rotationsToday,
 *   updatedAt}, so disconnect plus create cannot reset the per-UTC-day rotation cap: a create on a
 *   tombstone counts as a rotation. A tombstone is "no address" everywhere (status, resolve,
 *   set_mailboxes, regenerate). Account deletion removes the document completely.
 * - Every mailbox and every rendered address parses with the contract's summaryAddrSpecSchema
 *   (functions/src/shared/aiContract.ts), so summaryStatus and summaryAction responses always parse
 *   in the app.
 * - Logs carry the uid and tok8 (first 8 hex of tokenHash) only. Never an address, a token, a
 *   mailbox or the template (the development template holds the Postmark server hash).
 */
import { createHash, randomBytes } from 'node:crypto';
import { domainToASCII } from 'node:url';

import * as logger from 'firebase-functions/logger';
import type { DocumentReference, DocumentSnapshot, Firestore, Transaction } from 'firebase-admin/firestore';

import { summaryAddrSpecSchema } from '../shared/aiContract';

export const SUMMARY_ADDRESSES_COLLECTION = 'summaryAddresses';
export const SUMMARY_USERS_COLLECTION = 'summaryUsers';

/** Fixed limits from section 3 (not tunable without a design change). */
export const SUMMARY_ADDRESS_LIMITS = {
  tokenBytes: 16,
  tokenLength: 26,
  rotationsPerUtcDay: 5,
  mailboxes: 5,
} as const;

export const SUMMARY_TOKEN_HASH_PREFIX = 'mg-summary-address:v1:';
export const ADDRESS_TEMPLATE_PLACEHOLDER = '{token}';

const BASE32_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';
const TOKEN_PATTERN = /^[a-z2-7]{26}$/;
const TOKEN_HASH_PATTERN = /^[0-9a-f]{64}$/;
/** Firebase uids never contain '/', so a uid can never splice extra Firestore path segments. */
const UID_PATTERN = /^[^/]{1,128}$/;

// ---------------------------------------------------------------------------------------------
// Token
// ---------------------------------------------------------------------------------------------

/** Lowercase RFC 4648 base32, no padding. */
function base32Lower(bytes: Uint8Array): string {
  let out = '';
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = ((buffer << 8) | byte) & 0xffff;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET.charAt((buffer >>> (bits - 5)) & 31);
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET.charAt((buffer << (5 - bits)) & 31);
  return out;
}

export type RandomSource = (size: number) => Uint8Array;

const defaultRandom: RandomSource = (size) => randomBytes(size);

/** A fresh 128-bit address token: 26 characters of [a-z2-7]. */
export function generateToken(random: RandomSource = defaultRandom): string {
  const bytes = random(SUMMARY_ADDRESS_LIMITS.tokenBytes);
  if (!(bytes instanceof Uint8Array) || bytes.length !== SUMMARY_ADDRESS_LIMITS.tokenBytes) {
    throw new Error('summaries.address: the random source returned the wrong number of bytes');
  }
  return base32Lower(bytes);
}

/** True for a well-formed (already lowercased) address token. */
export function isToken(value: unknown): value is string {
  return typeof value === 'string' && TOKEN_PATTERN.test(value);
}

/** summaryAddresses doc id: sha256 hex of the versioned prefix plus the token. */
export function tokenHash(token: string): string {
  return createHash('sha256').update(`${SUMMARY_TOKEN_HASH_PREFIX}${token}`, 'utf8').digest('hex');
}

/** True for a 64-character lowercase hex tokenHash. */
export function isTokenHash(value: unknown): value is string {
  return typeof value === 'string' && TOKEN_HASH_PATTERN.test(value);
}

/**
 * The only token-derived value that may appear in logs: the first 8 hex characters of tokenHash.
 * Accepts a tokenHash or a token (hashed first) and never echoes token characters; anything
 * else gives 'invalid'.
 */
export function tok8(tokenOrHash: string): string {
  if (isTokenHash(tokenOrHash)) return tokenOrHash.slice(0, 8);
  if (isToken(tokenOrHash)) return tokenHash(tokenOrHash).slice(0, 8);
  return 'invalid';
}

// ---------------------------------------------------------------------------------------------
// Mailbox and domain syntax
// ---------------------------------------------------------------------------------------------

/** Whitespace, C0/C1 controls and DEL. */
function hasSpaceOrControl(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x20 || code === 0x7f || (code >= 0x80 && code <= 0x9f)) return true;
  }
  return /\s/u.test(value);
}

const DNS_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const ASCII_DOMAIN_CHAR = /^[A-Za-z0-9.-]$/;

/**
 * Before IDNA conversion: letters, digits, dot, hyphen or non-ASCII only. Keeps the WHATWG host
 * parser from percent-decoding or accepting brackets, colons or backslashes.
 */
function hasOnlyRawDomainChars(raw: string): boolean {
  for (const char of raw) {
    if ((char.codePointAt(0) ?? 0) >= 0x80) continue;
    if (!ASCII_DOMAIN_CHAR.test(char)) return false;
  }
  return true;
}

/**
 * A host name as lowercase IDNA ASCII, or null. At least two labels, LDH labels of 1 to 63
 * characters, no trailing dot, no address literal, no all-numeric top label.
 */
function normalizeDomain(raw: string): string | null {
  if (raw.length === 0 || raw.length > 255 || !hasOnlyRawDomainChars(raw)) return null;
  const ascii = domainToASCII(raw.toLowerCase()).toLowerCase();
  if (ascii.length === 0 || ascii.length > 253) return null;
  const labels = ascii.split('.');
  if (labels.length < 2 || !labels.every((label) => DNS_LABEL.test(label))) return null;
  const top = labels[labels.length - 1] ?? '';
  if (/^[0-9]+$/.test(top)) return null;
  return ascii;
}

/** RFC 5322 dot-atom over lowercase ASCII atext: no quotes, no comments, no spaces. */
const DOT_ATOM_LOCAL = /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/;

function isPlainLocalPart(local: string): boolean {
  if (local.length === 0 || local.length > 64) return false;
  if (!DOT_ATOM_LOCAL.test(local)) return false;
  // No RFC 2047 encoded-word lookalikes in an address.
  return !local.includes('=?');
}

/** True when every UTF-16 code unit is ASCII. */
function isAscii(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) > 0x7f) return false;
  }
  return true;
}

/**
 * True when `address` parses with the contract's summaryAddrSpecSchema, the schema the app applies
 * to summaryStatus (address, mailboxes) and summaryAction responses. One pattern for both sides.
 */
function parsesAsContractAddrSpec(address: string): boolean {
  return summaryAddrSpecSchema.safeParse(address).success;
}

/**
 * A strict addr-spec, lowercased, with the domain as IDNA ASCII; null for anything else.
 * Outer whitespace is trimmed. Display names, angle brackets, comments, quoted local parts,
 * groups, route syntax, address literals and a second "@" are all refused. A non-ASCII local
 * part is refused BEFORE lowercasing (toLowerCase turns KELVIN SIGN into a plain "k"). The result
 * always parses with the contract's summaryAddrSpecSchema; anything that would not is refused.
 */
export function normalizeMailbox(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (trimmed.length === 0 || trimmed.length > 320 || hasSpaceOrControl(trimmed)) return null;
  const at = trimmed.indexOf('@');
  if (at <= 0 || at !== trimmed.lastIndexOf('@')) return null;
  const rawLocal = trimmed.slice(0, at);
  if (!isAscii(rawLocal)) return null;
  const local = rawLocal.toLowerCase();
  if (!isPlainLocalPart(local)) return null;
  const domain = normalizeDomain(trimmed.slice(at + 1));
  if (domain === null) return null;
  const address = `${local}@${domain}`;
  return parsesAsContractAddrSpec(address) ? address : null;
}

export type MailboxRejection = 'too_many' | 'invalid_mailbox' | 'reserved_mailbox';

export type MailboxValidation =
  | { ok: true; mailboxes: string[] }
  | { ok: false; reason: MailboxRejection; /** Position in the input list, when one entry is at fault. */ index: number | null };

/**
 * The mailboxes where the user's recaps arrive (set_mailboxes): each a strict addr-spec,
 * normalized, deduplicated in input order, at most 5. An empty list is allowed (the verified
 * account email still binds, section 5). Ownership is not proven and need not be: a listed mailbox
 * only lets mail addressed to it into THIS user's account. The verified sign-in email is an
 * ordinary allowed entry. A mailbox on the private-address domain itself (from `template`) is
 * refused as reserved, so a private address can never be listed as a mailbox.
 */
export function validateMailboxes(input: unknown, options: { template?: string | null } = {}): MailboxValidation {
  if (!Array.isArray(input)) return { ok: false, reason: 'invalid_mailbox', index: null };
  // Bound the work before normalizing; duplicates may still collapse to 5 below.
  if (input.length > SUMMARY_ADDRESS_LIMITS.mailboxes * 4) return { ok: false, reason: 'too_many', index: null };
  const reservedDomain = parseAddressTemplate(options.template)?.domain ?? null;
  const mailboxes: string[] = [];
  for (let index = 0; index < input.length; index += 1) {
    const mailbox = normalizeMailbox(input[index]);
    if (mailbox === null) return { ok: false, reason: 'invalid_mailbox', index };
    if (reservedDomain !== null && mailbox.slice(mailbox.indexOf('@') + 1) === reservedDomain) {
      return { ok: false, reason: 'reserved_mailbox', index };
    }
    if (!mailboxes.includes(mailbox)) mailboxes.push(mailbox);
  }
  if (mailboxes.length > SUMMARY_ADDRESS_LIMITS.mailboxes) return { ok: false, reason: 'too_many', index: null };
  return { ok: true, mailboxes };
}

// ---------------------------------------------------------------------------------------------
// Template and envelope routing
// ---------------------------------------------------------------------------------------------

/**
 * SUMMARIES_ADDRESS_TEMPLATE, parsed. Two shapes only:
 * - production `{token}@summaries.meetingguard.ai` (prefix null);
 * - development `<serverhash>+{token}@inbound.postmarkapp.com` (prefix = the server hash).
 */
export interface AddressTemplate {
  prefix: string | null;
  domain: string;
}

const TEMPLATE_PREFIX = /^[a-z0-9._-]{1,64}$/;

/**
 * Null when the template is empty ("being set up") or malformed: anything but exactly one
 * {token}, one "@", a valid domain, and a local part of `{token}` or `<prefix>+{token}`. Also null
 * when a rendered address would not parse with the contract's summaryAddrSpecSchema (a local part
 * over 64 characters or an address over 254), since summaryStatus returns it.
 */
export function parseAddressTemplate(template: string | null | undefined): AddressTemplate | null {
  if (typeof template !== 'string') return null;
  const trimmed = template.trim().toLowerCase();
  if (trimmed.length === 0) return null;
  if (trimmed.split(ADDRESS_TEMPLATE_PLACEHOLDER).length !== 2) return null;
  const at = trimmed.indexOf('@');
  if (at <= 0 || at !== trimmed.lastIndexOf('@')) return null;
  const local = trimmed.slice(0, at);
  const domain = normalizeDomain(trimmed.slice(at + 1));
  if (domain === null) return null;
  let parsed: AddressTemplate;
  if (local === ADDRESS_TEMPLATE_PLACEHOLDER) {
    parsed = { prefix: null, domain };
  } else {
    const suffix = `+${ADDRESS_TEMPLATE_PLACEHOLDER}`;
    if (!local.endsWith(suffix)) return null;
    const prefix = local.slice(0, -suffix.length);
    if (!TEMPLATE_PREFIX.test(prefix) || prefix.startsWith('.') || prefix.endsWith('.') || prefix.includes('..')) return null;
    parsed = { prefix, domain };
  }
  // Every token has the same length and alphabet, so one sample render decides for all of them.
  const sample = renderParsed(parsed, BASE32_ALPHABET.charAt(0).repeat(SUMMARY_ADDRESS_LIMITS.tokenLength));
  return parsesAsContractAddrSpec(sample) ? parsed : null;
}

function renderParsed(parsed: AddressTemplate, token: string): string {
  return parsed.prefix === null ? `${token}@${parsed.domain}` : `${parsed.prefix}+${token}@${parsed.domain}`;
}

/**
 * The private address for a token under SUMMARIES_ADDRESS_TEMPLATE, lowercase. Null when the
 * template is empty or malformed (not ready) or the token is not a valid token.
 */
export function renderAddress(template: string | null | undefined, token: string): string | null {
  const parsed = parseAddressTemplate(template);
  if (parsed === null || !isToken(token)) return null;
  return renderParsed(parsed, token);
}

/** The envelope data the provider adapter passes in. Nothing from the message headers. */
export interface EnvelopeRecipient {
  /** Postmark OriginalRecipient: the SMTP envelope recipient. */
  originalRecipient?: string | null;
  /** Postmark MailboxHash: the part after "+" of the inbound address (development only). */
  mailboxHash?: string | null;
}

/** A bare envelope address, optionally in one pair of angle brackets, lowercased; or null. */
function splitEnvelopeAddress(raw: string): { local: string; domain: string } | null {
  let value = raw.trim();
  if (value.startsWith('<') && value.endsWith('>')) value = value.slice(1, -1);
  if (value.length === 0 || value.length > 320 || hasSpaceOrControl(value)) return null;
  const lowered = value.toLowerCase();
  const at = lowered.indexOf('@');
  if (at <= 0 || at !== lowered.lastIndexOf('@')) return null;
  const domain = normalizeDomain(lowered.slice(at + 1));
  if (domain === null) return null;
  return { local: lowered.slice(0, at), domain };
}

function tokenOrNull(candidate: string): string | null {
  const lowered = candidate.trim().toLowerCase();
  return isToken(lowered) ? lowered : null;
}

/**
 * The address token named by the ENVELOPE, or null (section 3, finding 15). Never reads To, Cc
 * or Delivered-To: callers pass only the provider's envelope fields.
 *
 * - Production template: OriginalRecipient's local part must be exactly the token and its domain
 *   must equal the template's domain (case-insensitive). MailboxHash is ignored.
 * - Development template: when OriginalRecipient is present it alone decides: its domain must
 *   equal the template's, its local part must be `<serverhash>+<token>` with the template's
 *   server hash. Only when OriginalRecipient is absent or empty does MailboxHash decide.
 * Everything is lowercased before matching; anything that is not a valid token gives null.
 */
export function tokenFromEnvelope(envelope: EnvelopeRecipient, template: string | null | undefined): string | null {
  const parsed = parseAddressTemplate(template);
  if (parsed === null) return null;
  const recipient = typeof envelope.originalRecipient === 'string' ? envelope.originalRecipient.trim() : '';

  if (parsed.prefix === null) {
    if (recipient.length === 0) return null;
    const address = splitEnvelopeAddress(recipient);
    if (address === null || address.domain !== parsed.domain) return null;
    return tokenOrNull(address.local);
  }

  if (recipient.length > 0) {
    const address = splitEnvelopeAddress(recipient);
    if (address === null || address.domain !== parsed.domain) return null;
    const plus = address.local.indexOf('+');
    if (plus < 0 || address.local.slice(0, plus) !== parsed.prefix) return null;
    return tokenOrNull(address.local.slice(plus + 1));
  }
  return typeof envelope.mailboxHash === 'string' ? tokenOrNull(envelope.mailboxHash) : null;
}

// ---------------------------------------------------------------------------------------------
// Stored documents
// ---------------------------------------------------------------------------------------------

/** The summaryUsers/{uid} document, leniently read. */
export interface SummaryUserDoc {
  /** The plain token (valid format only). Never logged, never client-readable. */
  token: string | null;
  tokenHash: string | null;
  address: string | null;
  createdAt: string | null;
  /** UTC day (YYYY-MM-DD) of the last rotation. */
  rotationDay: string | null;
  rotationsToday: number;
  /** Normalized, deduplicated, at most 5. */
  mailboxes: string[];
  /** Owned by the Gmail confirmation step (max 3); passed through untouched. */
  gmailRequests: unknown[];
  refusedDay: string | null;
  refusedCount: number;
  lastReceivedAt: string | null;
  lastRefused: unknown;
  updatedAt: string | null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : 0;
}

export function parseSummaryUser(raw: unknown): SummaryUserDoc {
  const data = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const mailboxes: string[] = [];
  if (Array.isArray(data.mailboxes)) {
    for (const entry of data.mailboxes) {
      const mailbox = normalizeMailbox(entry);
      if (mailbox !== null && !mailboxes.includes(mailbox) && mailboxes.length < SUMMARY_ADDRESS_LIMITS.mailboxes) {
        mailboxes.push(mailbox);
      }
    }
  }
  return {
    token: isToken(data.token) ? data.token : null,
    tokenHash: isTokenHash(data.tokenHash) ? data.tokenHash : null,
    address: str(data.address),
    createdAt: str(data.createdAt),
    rotationDay: str(data.rotationDay),
    rotationsToday: count(data.rotationsToday),
    mailboxes,
    gmailRequests: Array.isArray(data.gmailRequests) ? [...(data.gmailRequests as unknown[])] : [],
    refusedDay: str(data.refusedDay),
    refusedCount: count(data.refusedCount),
    lastReceivedAt: str(data.lastReceivedAt),
    lastRefused: data.lastRefused ?? null,
    updatedAt: str(data.updatedAt),
  };
}

/** The stored token when it is well-formed AND matches the stored hash; else null. */
export function usableToken(user: SummaryUserDoc): { token: string; tokenHash: string } | null {
  if (user.token === null || user.tokenHash === null) return null;
  return tokenHash(user.token) === user.tokenHash ? { token: user.token, tokenHash: user.tokenHash } : null;
}

/** The user's current private address under the current template; null when not ready or none. */
export function addressFor(user: SummaryUserDoc, template: string | null | undefined): string | null {
  const usable = usableToken(user);
  return usable === null ? null : renderAddress(template, usable.token);
}

/**
 * True for a summaryUsers doc that names no address hash: the tombstone disconnect leaves
 * ({rotationDay, rotationsToday, updatedAt} only). It routes nothing and shows nothing; status,
 * resolve, set_mailboxes and regenerate treat it as "no address", and a create on it counts as a
 * rotation.
 */
export function isAddressTombstone(user: SummaryUserDoc): boolean {
  return user.tokenHash === null;
}

/** The only fields a disconnect tombstone keeps. */
const TOMBSTONE_FIELDS: readonly string[] = ['rotationDay', 'rotationsToday', 'updatedAt'];

/** The whole tombstone document disconnect writes (a full replacement, never a merge). */
export function tombstoneFields(user: SummaryUserDoc, nowIso: string): Record<string, unknown> {
  return { rotationDay: user.rotationDay, rotationsToday: user.rotationsToday, updatedAt: nowIso };
}

/** True when the raw doc holds nothing but the tombstone fields. */
function isCleanTombstone(raw: unknown): boolean {
  if (typeof raw !== 'object' || raw === null) return false;
  return Object.keys(raw).every((key) => TOMBSTONE_FIELDS.includes(key));
}

/**
 * The full summaryUsers document a create writes (section 3 fields). `rotation` is the counter a
 * create on a disconnect tombstone carries forward; a first create starts at 0.
 */
export function newSummaryUserFields(
  token: string,
  address: string,
  mailboxes: string[],
  nowIso: string,
  rotation: { rotationDay: string | null; rotationsToday: number } = { rotationDay: null, rotationsToday: 0 },
): Record<string, unknown> {
  return {
    token,
    tokenHash: tokenHash(token),
    address,
    createdAt: nowIso,
    rotationDay: rotation.rotationDay,
    rotationsToday: rotation.rotationsToday,
    mailboxes,
    gmailRequests: [],
    refusedDay: null,
    refusedCount: 0,
    lastReceivedAt: null,
    lastRefused: null,
    updatedAt: nowIso,
  };
}

function utcDayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export type RotationDecision = { allowed: false } | { allowed: true; rotationDay: string; rotationsToday: number };

/**
 * The cap check every regenerate runs INSIDE its transaction over the freshly read summaryUsers
 * doc: at most rotationsPerUtcDay rotations per UTC day. Pure.
 */
export function rotationDecision(rawUser: unknown, now: Date): RotationDecision {
  const user = parseSummaryUser(rawUser);
  const day = utcDayKey(now);
  const done = user.rotationDay === day ? user.rotationsToday : 0;
  if (done >= SUMMARY_ADDRESS_LIMITS.rotationsPerUtcDay) return { allowed: false };
  return { allowed: true, rotationDay: day, rotationsToday: done + 1 };
}

// ---------------------------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------------------------

export interface AddressLogger {
  info(event: string, fields: Record<string, unknown>): void;
}

const defaultLogger: AddressLogger = {
  info: (event, fields) => logger.info(event, fields),
};

export interface AddressDeps {
  db: Firestore;
  now: () => Date;
  /** SUMMARIES_ADDRESS_TEMPLATE; empty means "being set up". */
  template: string;
  /** Test seam; crypto randomBytes by default. */
  random?: RandomSource;
  /** Test seam; firebase-functions/logger by default. */
  logger?: AddressLogger;
}

export type CreateAddressResult =
  | { status: 'created' | 'existing'; address: string; mailboxes: string[] }
  /** A create after a disconnect counts as a rotation; this is the sixth in one UTC day. */
  | { status: 'rate_limited' }
  | { status: 'not_ready' };

export type RegenerateAddressResult =
  | { status: 'rotated'; address: string; rotationsToday: number }
  | { status: 'rate_limited' }
  | { status: 'no_address' }
  | { status: 'not_ready' };

export type SetMailboxesResult =
  | { status: 'saved'; mailboxes: string[] }
  | { status: 'invalid'; reason: MailboxRejection; index: number | null }
  | { status: 'no_address' };

function assertUid(uid: string): void {
  if (typeof uid !== 'string' || !UID_PATTERN.test(uid)) {
    throw new Error('summaries.address: invalid uid');
  }
}

function userRef(db: Firestore, uid: string): DocumentReference {
  return db.doc(`${SUMMARY_USERS_COLLECTION}/${uid}`);
}

function indexRef(db: Firestore, hash: string): DocumentReference {
  return db.doc(`${SUMMARY_ADDRESSES_COLLECTION}/${hash}`);
}

/** The uid an index snapshot maps to, or null (missing doc or malformed uid). */
function indexOwner(snapshot: DocumentSnapshot): string | null {
  if (!snapshot.exists) return null;
  const uid = (snapshot.data() ?? {}).uid;
  return typeof uid === 'string' && UID_PATTERN.test(uid) ? uid : null;
}

function logWith(deps: { logger?: AddressLogger }): AddressLogger {
  return deps.logger ?? defaultLogger;
}

/**
 * create_address: idempotent. A user with a consistent address (valid token, matching hash and
 * an index doc that maps back to the uid) gets that address back; the stored `address` field is
 * refreshed if the template changed. Otherwise ONE transaction writes summaryAddresses/{tokenHash}
 * = {uid, createdAt} and summaryUsers/{uid} with the section 3 fields; mailboxes start as the
 * verified sign-in email, or empty when there is none or it does not normalize (normalizeMailbox
 * refuses anything the contract would not parse), never a failure. A disconnect tombstone counts
 * as a rotation (rotationDecision, at most rotationsPerUtcDay a UTC day, else rate_limited with
 * nothing written) and is replaced by a whole new document. An inconsistent leftover (index
 * missing or owned elsewhere) is never revived: it gets a fresh token, keeping its mailboxes and
 * counters. Returns not_ready, writing nothing, while the template is empty or malformed.
 */
export async function createAddress(
  uid: string,
  verifiedEmail: string | null,
  deps: AddressDeps,
): Promise<CreateAddressResult> {
  assertUid(uid);
  const parsed = parseAddressTemplate(deps.template);
  if (parsed === null) return { status: 'not_ready' };
  const now = deps.now();
  const nowIso = now.toISOString();
  const candidate = generateToken(deps.random);
  const candidateHash = tokenHash(candidate);
  const firstMailbox = normalizeMailbox(verifiedEmail);
  const db = deps.db;

  const outcome = await db.runTransaction(async (tx: Transaction) => {
    const uRef = userRef(db, uid);
    const userSnap = await tx.get(uRef);
    const raw = userSnap.exists ? userSnap.data() : undefined;
    const user = userSnap.exists ? parseSummaryUser(raw) : null;
    const oldHash = user?.tokenHash ?? null;
    const oldIndexSnap = oldHash !== null ? await tx.get(indexRef(db, oldHash)) : null;
    const oldOwner = oldIndexSnap !== null ? indexOwner(oldIndexSnap) : null;
    const current = user !== null ? usableToken(user) : null;

    if (user !== null && current !== null && oldOwner === uid) {
      const address = renderParsed(parsed, current.token);
      if (user.address !== address) tx.set(uRef, { address, updatedAt: nowIso }, { merge: true });
      return { status: 'existing' as const, address, mailboxes: user.mailboxes, hash: current.tokenHash };
    }

    // After a disconnect the new address is a rotation, so disconnect plus create cannot reset the cap.
    const tombstone = user !== null && isAddressTombstone(user);
    const decision = tombstone ? rotationDecision(raw, now) : null;
    if (decision !== null && !decision.allowed) return { status: 'rate_limited' as const };

    const newIndex = indexRef(db, candidateHash);
    const newIndexSnap = await tx.get(newIndex);
    if (newIndexSnap.exists) throw new Error('summaries.address: token collision');
    const address = renderParsed(parsed, candidate);
    if (oldHash !== null && oldOwner === uid) tx.delete(indexRef(db, oldHash));
    tx.set(newIndex, { uid, createdAt: nowIso });
    if (user === null || decision !== null) {
      const mailboxes = firstMailbox !== null ? [firstMailbox] : [];
      const rotation = decision !== null ? { rotationDay: decision.rotationDay, rotationsToday: decision.rotationsToday } : undefined;
      // A full replacement: nothing from a tombstone survives but the rotation counter.
      tx.set(uRef, newSummaryUserFields(candidate, address, mailboxes, nowIso, rotation));
      return {
        status: 'created' as const,
        address,
        mailboxes,
        hash: candidateHash,
        rotationsToday: rotation?.rotationsToday ?? null,
      };
    }
    const mailboxes = user.mailboxes.length > 0 ? user.mailboxes : firstMailbox !== null ? [firstMailbox] : [];
    tx.set(
      uRef,
      {
        token: candidate,
        tokenHash: candidateHash,
        address,
        mailboxes,
        gmailRequests: [],
        createdAt: user.createdAt ?? nowIso,
        updatedAt: nowIso,
      },
      { merge: true },
    );
    return { status: 'created' as const, address, mailboxes, hash: candidateHash, rotationsToday: null };
  });

  const log = logWith(deps);
  if (outcome.status === 'rate_limited') {
    log.info('summaries.address.rotation_limited', { uid, afterDisconnect: true });
    return { status: 'rate_limited' };
  }
  if (outcome.status === 'created') {
    const fields: Record<string, unknown> = { uid, tok8: tok8(outcome.hash) };
    if (outcome.rotationsToday !== null) fields.rotationsToday = outcome.rotationsToday;
    log.info('summaries.address.created', fields);
  }
  return { status: outcome.status, address: outcome.address, mailboxes: outcome.mailboxes };
}

/**
 * regenerate_address: ONE transaction, at most rotationsPerUtcDay a UTC day. Deletes the old index
 * doc (mail to the old address is dropped from then on), writes the new one and the new token on
 * summaryUsers. Gmail confirmation requests and the refused-per-day counter belonged to the old
 * address and are reset. Logs summaries.address.rotated {uid, oldTok8} after the commit.
 */
export async function regenerateAddress(uid: string, deps: AddressDeps): Promise<RegenerateAddressResult> {
  assertUid(uid);
  const parsed = parseAddressTemplate(deps.template);
  if (parsed === null) return { status: 'not_ready' };
  const now = deps.now();
  const nowIso = now.toISOString();
  const candidate = generateToken(deps.random);
  const candidateHash = tokenHash(candidate);
  const db = deps.db;

  const outcome = await db.runTransaction(async (tx: Transaction) => {
    const uRef = userRef(db, uid);
    const userSnap = await tx.get(uRef);
    if (!userSnap.exists) return { status: 'no_address' as const };
    const raw = userSnap.data();
    const current = usableToken(parseSummaryUser(raw));
    if (current === null) return { status: 'no_address' as const };
    const decision = rotationDecision(raw, now);
    if (!decision.allowed) return { status: 'rate_limited' as const };

    const oldIndex = indexRef(db, current.tokenHash);
    const oldIndexSnap = await tx.get(oldIndex);
    const newIndex = indexRef(db, candidateHash);
    const newIndexSnap = await tx.get(newIndex);
    if (newIndexSnap.exists) throw new Error('summaries.address: token collision');

    const address = renderParsed(parsed, candidate);
    if (indexOwner(oldIndexSnap) === uid) tx.delete(oldIndex);
    tx.set(newIndex, { uid, createdAt: nowIso });
    tx.set(
      uRef,
      {
        token: candidate,
        tokenHash: candidateHash,
        address,
        rotationDay: decision.rotationDay,
        rotationsToday: decision.rotationsToday,
        gmailRequests: [],
        refusedDay: null,
        refusedCount: 0,
        updatedAt: nowIso,
      },
      { merge: true },
    );
    return {
      status: 'rotated' as const,
      address,
      rotationsToday: decision.rotationsToday,
      oldHash: current.tokenHash,
      newHash: candidateHash,
    };
  });

  const log = logWith(deps);
  if (outcome.status === 'rotated') {
    log.info('summaries.address.rotated', {
      uid,
      oldTok8: tok8(outcome.oldHash),
      tok8: tok8(outcome.newHash),
      rotationsToday: outcome.rotationsToday,
    });
    return { status: 'rotated', address: outcome.address, rotationsToday: outcome.rotationsToday };
  }
  if (outcome.status === 'rate_limited') log.info('summaries.address.rotation_limited', { uid });
  return { status: outcome.status };
}

/**
 * set_mailboxes: validates (validateMailboxes) and replaces the list in ONE transaction. Requires
 * an existing address; never creates summaryUsers on its own.
 */
export async function setMailboxes(uid: string, list: unknown, deps: AddressDeps): Promise<SetMailboxesResult> {
  assertUid(uid);
  const validation = validateMailboxes(list, { template: deps.template });
  if (!validation.ok) return { status: 'invalid', reason: validation.reason, index: validation.index };
  const nowIso = deps.now().toISOString();
  const db = deps.db;
  const outcome = await db.runTransaction(async (tx: Transaction) => {
    const uRef = userRef(db, uid);
    const userSnap = await tx.get(uRef);
    if (!userSnap.exists || usableToken(parseSummaryUser(userSnap.data())) === null) {
      return { status: 'no_address' as const };
    }
    tx.set(uRef, { mailboxes: validation.mailboxes, updatedAt: nowIso }, { merge: true });
    return { status: 'saved' as const, mailboxes: validation.mailboxes };
  });
  if (outcome.status === 'saved') {
    logWith(deps).info('summaries.mailboxes.saved', { uid, count: outcome.mailboxes.length });
  }
  return outcome;
}

/**
 * Shared by resolveToken and resolveTokenInTransaction: the index owner, cross-checked. A
 * disconnect tombstone names no hash, so it resolves to nobody even beside a restored index doc.
 */
function ownerIfCurrent(indexSnap: DocumentSnapshot, userSnap: DocumentSnapshot | null, hash: string): string | null {
  if (userSnap === null || !userSnap.exists) return null;
  const user = parseSummaryUser(userSnap.data());
  if (isAddressTombstone(user)) return null;
  return user.tokenHash === hash ? indexOwner(indexSnap) : null;
}

/**
 * The uid a tokenHash routes to, or null: summaryAddresses/{tokenHash} must exist with a valid
 * uid AND summaryUsers/{uid}.tokenHash must still name this hash (a regenerated, disconnected or
 * stale restored address resolves to nobody). Pilot, Auth and users/{uid} checks are the
 * caller's (section 4 step 4).
 */
export async function resolveToken(hash: string, deps: Pick<AddressDeps, 'db'>): Promise<string | null> {
  if (!isTokenHash(hash)) return null;
  const indexSnap = await indexRef(deps.db, hash).get();
  const owner = indexOwner(indexSnap);
  if (owner === null) return null;
  const userSnap = await userRef(deps.db, owner).get();
  return ownerIfCurrent(indexSnap, userSnap, hash);
}

/**
 * resolveToken inside the caller's transaction (section 4 step 15 re-read). Reads only, so it can
 * run before the caller's writes.
 */
export async function resolveTokenInTransaction(tx: Transaction, db: Firestore, hash: string): Promise<string | null> {
  if (!isTokenHash(hash)) return null;
  const indexSnap = await tx.get(indexRef(db, hash));
  const owner = indexOwner(indexSnap);
  if (owner === null) return null;
  const userSnap = await tx.get(userRef(db, owner));
  return ownerIfCurrent(indexSnap, userSnap, hash);
}

/**
 * summaryUsers/{uid} parsed, or null when missing or a disconnect tombstone (for summaryStatus: a
 * tombstone is "no address", with no mailboxes, Gmail requests or refusal to show).
 */
export async function readSummaryUser(uid: string, deps: Pick<AddressDeps, 'db'>): Promise<SummaryUserDoc | null> {
  assertUid(uid);
  const snapshot = await userRef(deps.db, uid).get();
  if (!snapshot.exists) return null;
  const user = parseSummaryUser(snapshot.data());
  return isAddressTombstone(user) ? null : user;
}

/**
 * Required on every call, so the account deletion port can never get a tombstone by default:
 * - 'disconnect' (op disconnect): summaryUsers/{uid} is replaced by a tombstone
 *   {rotationDay, rotationsToday, updatedAt}, so a create later the same UTC day still counts
 *   against the rotation cap.
 * - 'account_deletion': summaryUsers/{uid} is deleted outright, tombstone included.
 */
export type DeleteAddressMode = 'disconnect' | 'account_deletion';

export interface DeleteAddressOptions {
  mode: DeleteAddressMode;
}

/**
 * Removes the private address in ONE transaction: the index doc summaryUsers/{uid} points at (only
 * when that doc maps back to the uid) and summaryUsers/{uid} itself, which disconnect replaces with
 * a tombstone (no token, hash, address or mailboxes) and account deletion deletes. Idempotent: a
 * repeat disconnect writes nothing. The summaries under users/{uid} are the caller's. Returns
 * whether an address existed (a tombstone is not one).
 */
export async function deleteAddressDocs(
  uid: string,
  deps: Pick<AddressDeps, 'db' | 'logger'> & Partial<Pick<AddressDeps, 'now'>>,
  options: DeleteAddressOptions,
): Promise<{ deleted: boolean }> {
  assertUid(uid);
  const mode: DeleteAddressMode = options.mode;
  const nowIso = (deps.now ?? (() => new Date()))().toISOString();
  const db = deps.db;
  const outcome = await db.runTransaction(async (tx: Transaction) => {
    const uRef = userRef(db, uid);
    const userSnap = await tx.get(uRef);
    if (!userSnap.exists) return { deleted: false, hash: null };
    const raw = userSnap.data();
    const user = parseSummaryUser(raw);
    const hash = user.tokenHash;
    const indexSnap = hash !== null ? await tx.get(indexRef(db, hash)) : null;
    if (hash !== null && indexSnap !== null && indexOwner(indexSnap) === uid) tx.delete(indexRef(db, hash));
    if (mode === 'account_deletion') {
      tx.delete(uRef);
    } else if (hash !== null || !isCleanTombstone(raw)) {
      tx.set(uRef, tombstoneFields(user, nowIso));
    }
    return { deleted: hash !== null, hash };
  });
  if (outcome.deleted && outcome.hash !== null) {
    logWith(deps).info('summaries.address.deleted', { uid, tok8: tok8(outcome.hash), mode });
  }
  return { deleted: outcome.deleted };
}
