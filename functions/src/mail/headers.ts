/**
 * Strict header parsing for inbound mail (M10 summaries, assistant matters; docs/v2/M10-DESIGN.md
 * section 4 step 6, section 5, red-team findings 1 and 8). Pure: no Firebase, no DNS, no logging.
 *
 * Shared by the meeting summaries (functions/src/summaries) and the assistant matters
 * (functions/src/matters, A2). It never imports mailauth, the logger or Firebase, so importing it
 * never loads mailauth (keep it that way; there is no barrel in functions/src/mail), and it never
 * logs addresses or content.
 *
 * One header splitter and ONE strict From parser, used everywhere a decision needs the author.
 * The splitter accepts only lines that every common parser reads the same way (mailauth's
 * parseHeaders included): a line either opens a field with `name:` (no whitespace before the
 * colon) or continues the field above with leading SP or HTAB. Anything else, a bare CR or a NUL
 * byte is malformed, so the DKIM verifier, the MIME parser and this module can never disagree
 * on which header row a value came from.
 *
 * Addresses are plain RFC 5322 addr-specs only: a dot-atom local part over the full atext set
 * ("?" included, as SUMMARY_ADDR_SPEC_PATTERN in the contract), no quoted local parts, never the
 * encoded-word opener "=?" anywhere, one "@", and a host-name domain of at least two plain ASCII
 * LDH labels (no domain literals, no route syntax, no Unicode: nothing is mapped, so a character
 * that lowercases or maps to ASCII never turns into a listed domain). Display names are skipped
 * and never returned. Everything is lowercased; compare only lowercased values.
 *
 * Nothing here returns or logs raw header text except the unfolded Date and Message-ID values
 * and the ARC key record names (arcKeyNames, for DNS routing only), which the caller treats as
 * message content (never logged).
 */
import { domainToASCII } from 'node:url';

/** Fields that may appear at most once (step 6). From must appear exactly once. */
export const SINGLE_FIELDS = ['to', 'cc', 'date', 'subject', 'message-id', 'sender'] as const;

/**
 * Caps on signature fields, checked before any DNS work. mailauth verifies DKIM-Signatures one
 * after another, top first, each with its own key lookup, so every extra field is extra waiting
 * an attacker can stack above the vendor's signature. Real notetaker mail carries one to three
 * (the vendor, its email service), and a forwarding hop (Microsoft 365, a company gateway) may
 * add one more each; ARC adds ARC-* fields, never DKIM-Signature. Five covers three plus two
 * hops; more is malformed. ARC-Seal keys are fetched in parallel, so their cap stays looser.
 */
export const HEADER_LIMITS = {
  maxDkimSignatures: 5,
  maxArcFieldsEach: 10,
} as const;

const ARC_FIELDS = ['arc-seal', 'arc-message-signature', 'arc-authentication-results'] as const;

export type HeaderFailureDetail =
  | 'bare_cr'
  | 'nul_byte'
  | 'bad_line'
  | 'empty_header'
  | 'from_missing'
  | 'from_duplicate'
  | 'from_invalid'
  | 'duplicate_field'
  | 'too_many_signatures';

export interface HeaderField {
  /** Lowercased field name, exactly as mailauth keys it. */
  name: string;
  /** Unfolded value (CRLF removed, leading whitespace of continuation lines kept), latin1 text. */
  value: string;
}

export interface HeaderFacts {
  ok: true;
  /** The strict From addr-spec, lowercased. */
  from: string;
  /** Domain part of `from`. */
  fromDomain: string;
  /** Lowercased addr-specs of the single To field; [] when absent or not strictly parseable. */
  to: string[];
  /** Lowercased addr-specs of the single Cc field; [] when absent or not strictly parseable. */
  cc: string[];
  /** Unfolded, trimmed Date value, or null when absent. Content: never log it. */
  date: string | null;
  /** Unfolded, trimmed Message-ID value, or null when absent. Content: never log it. */
  messageId: string | null;
  /** Lowercased field names in order, for the cross-check against the DKIM verifier's parse. */
  fieldNames: string[];
  /**
   * Key record names ("selector._domainkey.domain", lowercased, deduplicated) named by the d= and
   * s= of the ARC-Seal and ARC-Message-Signature fields, read before any DNS work so the
   * resolver can give the trusted sealers' ARC keys the priority budget. Only plain ASCII names;
   * any other is left out (its lookup then gets no priority by name and is routed by its
   * key-record domain alone, like any other lookup). Content: never log it.
   */
  arcKeyNames: string[];
}

export interface HeaderFailure {
  ok: false;
  reason: 'malformed';
  detail: HeaderFailureDetail;
  /** The lowercased field name for duplicate_field (a name, never a value). */
  field?: string;
}

export type HeaderCheck = HeaderFacts | HeaderFailure;

// RFC 5322 section 3.6.8 field-name: printable US-ASCII except ":" (0x3A), directly followed by
// the colon. mailauth also accepts whitespace before the colon; that obsolete form is refused.
const FIELD_LINE = /^([\x21-\x39\x3b-\x7e]+):/;
// RFC 5322 atext, "?" included (the contract's SUMMARY_ADDR_SPEC_PATTERN accepts it too).
const DOT_ATOM_LOCAL = /^[A-Za-z0-9!#$%&'*+\-/=?^_`{|}~]+(?:\.[A-Za-z0-9!#$%&'*+\-/=?^_`{|}~]+)*$/;
// RFC 2047 encoded words open with "=?"; refused anywhere in an address, so none can hide in it.
const ENCODED_WORD_OPENER = '=?';
// Plain ASCII LDH and dots, checked BEFORE lowercasing: toLowerCase maps some non-ASCII
// characters to ASCII letters (U+212A KELVIN SIGN becomes "k"), which must never yield a domain.
const ASCII_DOMAIN_CHARS = /^[A-Za-z0-9.-]+$/;
const DOMAIN_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
// An ARC s= value that names a key record as written (plain ASCII); d= goes through normalizeDomain.
const ARC_SELECTOR = /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/;
// Unquoted display-name characters: atext, "." (obs-phrase), whitespace and non-ASCII (raw
// UTF-8 bytes arrive here as latin1 characters; decoded strings may carry any code unit).
const PHRASE_CHAR = /[A-Za-z0-9!#$%&'*+\-/=?^_`{|}~. \t\u0080-\uffff]/;

function fail(detail: HeaderFailureDetail, field?: string): HeaderFailure {
  return field === undefined ? { ok: false, reason: 'malformed', detail } : { ok: false, reason: 'malformed', detail, field };
}

/**
 * Splits the header block off the raw message and unfolds it strictly. Bare LF line ends are
 * accepted (the DKIM verifier turns them into CRLF too); a CR that is not part of CRLF is not.
 */
export function parseHeaderFields(raw: Buffer): { ok: true; fields: HeaderField[] } | HeaderFailure {
  const text = raw.toString('latin1');
  const fields: HeaderField[] = [];
  let current: { name: string; parts: string[] } | null = null;
  let pos = 0;
  while (pos < text.length) {
    const lf = text.indexOf('\n', pos);
    let line = lf === -1 ? text.slice(pos) : text.slice(pos, lf);
    pos = lf === -1 ? text.length : lf + 1;
    if (line.endsWith('\r')) line = line.slice(0, -1);
    if (line === '') break; // the empty line ends the header block
    if (line.includes('\r')) return fail('bare_cr');
    if (line.includes('\0')) return fail('nul_byte');
    if (line.startsWith(' ') || line.startsWith('\t')) {
      if (!current) return fail('bad_line');
      current.parts.push(line);
      continue;
    }
    const match = FIELD_LINE.exec(line);
    if (!match || match[1] === undefined) return fail('bad_line');
    if (current) fields.push({ name: current.name, value: current.parts.join('') });
    current = { name: match[1].toLowerCase(), parts: [line.slice(match[0].length)] };
  }
  if (current) fields.push({ name: current.name, value: current.parts.join('') });
  if (fields.length === 0) return fail('empty_header');
  return { ok: true, fields };
}

/**
 * Lowercased domain if it is a host name of at least two plain ASCII LDH labels (A-labels
 * allowed, as written): letters, digits and "-", no label starting or ending with "-", at most
 * 63 characters a label and 253 in all, a top-level label that is not all digits. Nothing is
 * mapped: any non-ASCII character is refused before lowercasing.
 */
export function normalizeDomain(domain: string): string | null {
  if (domain.length === 0 || domain.length > 253 || !ASCII_DOMAIN_CHARS.test(domain)) return null;
  const lower = domain.toLowerCase();
  const labels = lower.split('.');
  if (labels.length < 2) return null;
  for (const label of labels) {
    if (!DOMAIN_LABEL.test(label)) return null;
  }
  const tld = labels[labels.length - 1] ?? '';
  if (/^[0-9]+$/.test(tld)) return null; // an IPv4-looking name is not a mail domain
  return lower;
}

/**
 * A plain addr-spec: dot-atom local part (atext, "?" included), never "=?" anywhere (so no
 * encoded word can hide in it), exactly one "@", a host-name domain. Returns it lowercased, or
 * null.
 */
export function parseAddrSpec(input: string): string | null {
  if (input.length === 0 || input.length > 254 || input.includes(ENCODED_WORD_OPENER)) return null;
  const at = input.indexOf('@');
  if (at <= 0 || at !== input.lastIndexOf('@')) return null;
  const local = input.slice(0, at);
  const domain = input.slice(at + 1);
  if (local.length > 64 || !DOT_ATOM_LOCAL.test(local)) return null;
  const normalizedDomain = normalizeDomain(domain);
  if (!normalizedDomain) return null;
  return `${local.toLowerCase()}@${normalizedDomain}`;
}

/**
 * Normalizes a configured address (SUMMARIES_SENDERS, a listed mailbox): trimmed, lowercased,
 * domain converted to IDNA ASCII, then validated as a plain addr-spec. Null when invalid,
 * including a bare domain (finding 6: senders are exact addresses).
 */
export function normalizeAddress(input: string): string | null {
  const trimmed = input.trim();
  const at = trimmed.lastIndexOf('@');
  if (at <= 0) return null;
  const local = trimmed.slice(0, at);
  const domainPart = trimmed.slice(at + 1);
  if (domainPart.length === 0) return null;
  const ascii = /^[\x21-\x7e]+$/.test(domainPart) ? domainPart.toLowerCase() : domainToASCII(domainPart);
  if (!ascii) return null;
  return parseAddrSpec(`${local}@${ascii}`);
}

/** Domain part of an already validated addr-spec. */
export function domainOf(address: string): string {
  return address.slice(address.lastIndexOf('@') + 1);
}

/**
 * Parses ONE mailbox: `addr-spec` or `[display-name] <addr-spec>`. Comments, groups, route
 * syntax, a second mailbox, an encoded word or quoted string in the address part, and a "<" or
 * ">" inside the display name are refused. The display name is skipped, never returned.
 */
export function parseStrictMailbox(value: string): string | null {
  const text = value.replace(/^[ \t]+|[ \t]+$/g, '');
  if (text.length === 0) return null;
  // Find the first "<" outside a quoted string.
  let inQuote = false;
  let angleStart = -1;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charAt(i);
    if (inQuote) {
      if (ch === '\\') i += 1;
      else if (ch === '"') inQuote = false;
      continue;
    }
    if (ch === '"') inQuote = true;
    else if (ch === '<') {
      angleStart = i;
      break;
    }
  }
  if (angleStart === -1) {
    // No angle-addr: the whole value must be a bare addr-spec (no display name, no comment).
    return parseAddrSpec(text);
  }
  if (!isStrictPhrase(text.slice(0, angleStart))) return null;
  const close = text.indexOf('>', angleStart + 1);
  if (close === -1 || close !== text.length - 1) return null; // nothing may follow the angle-addr
  return parseAddrSpec(text.slice(angleStart + 1, close));
}

/**
 * A display name that every parser skips the same way: atoms (encoded words included), "." and
 * whitespace outside quotes; quoted strings with backslash escapes. No comment, no group or list
 * separator, no "@" outside quotes, and no "<" or ">" anywhere (finding 8).
 */
function isStrictPhrase(phrase: string): boolean {
  let inQuote = false;
  for (let i = 0; i < phrase.length; i += 1) {
    const ch = phrase.charAt(i);
    if (ch === '\0' || ch === '<' || ch === '>') return false;
    if (inQuote) {
      if (ch === '\\') {
        const next = phrase.charAt(i + 1);
        if (next === '' || next === '\0' || next === '<' || next === '>') return false;
        i += 1;
      } else if (ch === '"') {
        inQuote = false;
      }
      continue;
    }
    if (ch === '"') {
      inQuote = true;
      continue;
    }
    if (!PHRASE_CHAR.test(ch)) return false; // ( ) , : ; @ [ ] \ and control characters
  }
  return !inQuote;
}

/**
 * Parses a To or Cc value as a comma-separated list of strict mailboxes. Null when any element
 * fails (groups included), so an ambiguous list never yields an address.
 */
export function parseAddressList(value: string): string[] | null {
  const elements: string[] = [];
  let inQuote = false;
  let inAngle = false;
  let start = 0;
  for (let i = 0; i < value.length; i += 1) {
    const ch = value.charAt(i);
    if (inQuote) {
      if (ch === '\\') i += 1;
      else if (ch === '"') inQuote = false;
      continue;
    }
    if (ch === '"') inQuote = true;
    else if (ch === '<') inAngle = true;
    else if (ch === '>') inAngle = false;
    else if (ch === ',' && !inAngle) {
      elements.push(value.slice(start, i));
      start = i + 1;
    }
  }
  if (inQuote || inAngle) return null;
  elements.push(value.slice(start));
  const addresses: string[] = [];
  for (const element of elements) {
    if (element.replace(/[ \t]/g, '') === '') continue; // obs-mbox-list allows empty elements
    const address = parseStrictMailbox(element);
    if (!address) return null;
    addresses.push(address);
  }
  return addresses;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const NAMED_ZONES: Record<string, number> = {
  ut: 0,
  utc: 0,
  gmt: 0,
  z: 0,
  est: -300,
  edt: -240,
  cst: -360,
  cdt: -300,
  mst: -420,
  mdt: -360,
  pst: -480,
  pdt: -420,
};
const DATE_PATTERN =
  /^(?:(?:mon|tue|wed|thu|fri|sat|sun)\s*,\s*)?(\d{1,2})\s+([a-z]{3})\s+(\d{4}|\d{2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([+-]\d{4}|[a-z]{1,3})$/;

/**
 * RFC 5322 date-time (with the common obsolete forms: two-digit years, named US zones, a
 * trailing comment such as "(UTC)"). Null when it does not parse or names an impossible date.
 */
export function parseMailDate(value: string): Date | null {
  let text = value.trim().toLowerCase();
  if (text.length > 200) return null;
  text = text.replace(/\s*\([^()]*\)\s*$/, '').trim();
  const match = DATE_PATTERN.exec(text);
  if (!match) return null;
  const [, dayText, monthText, yearText, hourText, minuteText, secondText, zoneText] = match;
  if (!dayText || !monthText || !yearText || !hourText || !minuteText || !zoneText) return null;
  const month = MONTHS.indexOf(monthText);
  if (month === -1) return null;
  let year = Number(yearText);
  if (yearText.length === 2) year += year < 50 ? 2000 : 1900;
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = secondText === undefined ? 0 : Number(secondText);
  if (hour > 23 || minute > 59 || second > 60) return null;
  let offsetMinutes: number;
  if (zoneText.startsWith('+') || zoneText.startsWith('-')) {
    const hh = Number(zoneText.slice(1, 3));
    const mm = Number(zoneText.slice(3, 5));
    if (mm > 59) return null;
    offsetMinutes = (hh * 60 + mm) * (zoneText.startsWith('-') ? -1 : 1);
  } else {
    const named = NAMED_ZONES[zoneText];
    if (named === undefined) return null;
    offsetMinutes = named;
  }
  const dayStart = Date.UTC(year, month, day);
  const check = new Date(dayStart);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month || check.getUTCDate() !== day) return null;
  const ms = dayStart + ((hour * 60 + minute) * 60 + Math.min(second, 59)) * 1000 - offsetMinutes * 60_000;
  return Number.isFinite(ms) ? new Date(ms) : null;
}

function trimValue(value: string): string {
  return value.replace(/^[ \t]+|[ \t]+$/g, '');
}

/**
 * The tags of a DKIM-style tag-list read the way mailauth's lenient parser reads them: split on
 * ";", the first "=" ends the name, names folded to lower case, whitespace inside a value
 * collapsed and trimmed, a later duplicate wins. Used only to name ARC key records for DNS
 * routing; if it ever reads a value differently, that lookup merely loses its priority by name
 * and is routed by its key-record domain alone.
 */
function tagList(value: string): Map<string, string> {
  const tags = new Map<string, string>();
  for (const segment of value.split(';')) {
    const eq = segment.indexOf('=');
    if (eq === -1) continue;
    const name = segment.slice(0, eq).replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '').toLowerCase();
    tags.set(name, segment.slice(eq + 1).replace(/\s+/g, ' ').trim());
  }
  return tags;
}

/** HeaderFacts.arcKeyNames: the key record names of the ARC-Seal and ARC-Message-Signature fields. */
function arcKeyNames(fields: readonly HeaderField[]): string[] {
  const names: string[] = [];
  for (const field of fields) {
    if (field.name !== 'arc-seal' && field.name !== 'arc-message-signature') continue;
    const tags = tagList(field.value);
    const selector = tags.get('s') ?? '';
    const signer = tags.get('d') ?? '';
    const domain = normalizeDomain(signer.endsWith('.') ? signer.slice(0, -1) : signer);
    if (!domain || !ARC_SELECTOR.test(selector)) continue;
    const name = `${selector.toLowerCase()}._domainkey.${domain}`;
    if (!names.includes(name)) names.push(name);
  }
  return names;
}

/**
 * Header sanity (step 6): exactly one From with exactly one strict mailbox; at most one To, Cc,
 * Date, Subject, Message-ID and Sender; bounded signature fields. Any failure is malformed. Also
 * returns the ARC key record names, so DNS routing is fixed before any lookup.
 */
export function checkHeaders(raw: Buffer): HeaderCheck {
  const parsed = parseHeaderFields(raw);
  if (!parsed.ok) return parsed;
  const counts = new Map<string, number>();
  for (const field of parsed.fields) counts.set(field.name, (counts.get(field.name) ?? 0) + 1);

  const fromCount = counts.get('from') ?? 0;
  if (fromCount === 0) return fail('from_missing');
  if (fromCount > 1) return fail('from_duplicate');
  for (const name of SINGLE_FIELDS) {
    if ((counts.get(name) ?? 0) > 1) return fail('duplicate_field', name);
  }
  if ((counts.get('dkim-signature') ?? 0) > HEADER_LIMITS.maxDkimSignatures) return fail('too_many_signatures');
  for (const name of ARC_FIELDS) {
    if ((counts.get(name) ?? 0) > HEADER_LIMITS.maxArcFieldsEach) return fail('too_many_signatures');
  }

  const valueOf = (name: string): string | null => {
    const field = parsed.fields.find((candidate) => candidate.name === name);
    return field ? field.value : null;
  };
  const fromValue = valueOf('from') ?? '';
  const from = parseStrictMailbox(fromValue);
  if (!from) return fail('from_invalid');

  const toValue = valueOf('to');
  const ccValue = valueOf('cc');
  const dateValue = valueOf('date');
  const messageIdValue = valueOf('message-id');
  return {
    ok: true,
    from,
    fromDomain: domainOf(from),
    to: toValue === null ? [] : (parseAddressList(toValue) ?? []),
    cc: ccValue === null ? [] : (parseAddressList(ccValue) ?? []),
    date: dateValue === null ? null : trimValue(dateValue),
    messageId: messageIdValue === null ? null : trimValue(messageIdValue),
    fieldNames: parsed.fields.map((field) => field.name),
    arcKeyNames: arcKeyNames(parsed.fields),
  };
}
