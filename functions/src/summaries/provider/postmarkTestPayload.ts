/**
 * Postmark-shaped test payloads for summaryInbound (docs/v2/M10-DESIGN.md section 11 step 4c and
 * the usage note at the end of section 11; docs/v2/M11-DESIGN.md section 10, "A summary in the
 * account before Postmark"). Used ONLY by functions/scripts/send-test-inbound.mjs, which loads the
 * compiled copy from lib/ (run `npm run build` first, as for replay-account-deletions.mjs). The
 * functions entry point never imports this module, so no deployed function loads it.
 *
 * - The payload carries the four fields ./postmark.ts parsePostmarkInbound picks (RawEmail,
 *   OriginalRecipient, MailboxHash, MessageID) plus the parsed fields a real Postmark inbound post
 *   has (From, FromName, FromFull, To, ToFull, Subject, Date, Headers and the rest), which the
 *   adapter never reads: routing uses the envelope recipient only and authenticity our own DKIM
 *   check. TextBody and HtmlBody are left out on purpose (they would only copy the content again).
 * - RawEmail is the .eml decoded as UTF-8, because the adapter re-encodes it with
 *   Buffer.from(RawEmail, 'utf8'). For a valid UTF-8 file that round trip is byte-exact; for a
 *   legacy-charset 8-bit file it is not (day-0 check 2), so the facts say utf8Exact false and a DKIM
 *   body hash over it will fail. Line endings are never touched.
 * - From, Subject and Date come from the .eml header block only (everything before the first empty
 *   line), unfolded and with whitespace collapsed; encoded words stay encoded. They only fill the
 *   JSON fields Postmark would show.
 * - --from-envelope has no field of its own in Postmark's inbound JSON; it is carried as a
 *   Return-Path entry of Headers. The pipeline never reads it (no SPF, decision 3).
 * - Basic auth: Postmark sends the URL credentials `postmark:<SUMMARIES_WEBHOOK_AUTH>` as
 *   `Authorization: Basic base64(...)` (./postmark.ts checkBasicAuth). The script reads that pair
 *   from the SUMMARIES_TEST_WEBHOOK_AUTH environment variable only, never from a file or an
 *   argument.
 *
 * Pure: no I/O, no logging, no clock, no randomness (the caller passes the MessageID). The .eml is
 * message content and the credentials are a secret: describeTestPayload and describeTestResponse
 * are the only views meant for a terminal. They carry lengths, counts, fixed codes and the routing
 * fields the owner typed, never the subject, the sender, a header value from the .eml, the body or
 * the credentials.
 */
import { POSTMARK_BASIC_AUTH_USER, POSTMARK_FIELD_LIMITS, SUMMARIES_MAX_BODY_BYTES } from './postmark';

/** The environment variable that holds `postmark:<secret>` for the test script. */
export const TEST_WEBHOOK_AUTH_ENV = 'SUMMARIES_TEST_WEBHOOK_AUTH';

/**
 * The raw size the pipeline refuses as too_large: SUMMARY_MIME_LIMITS.maxRawBytes of ../mime.ts,
 * repeated here because that module loads postal-mime (a test keeps the two equal).
 */
export const TEST_RAW_TOO_LARGE_BYTES = 5 * 1024 * 1024;

/** The largest .eml the script reads: a bigger file cannot fit a body the webhook accepts. */
export const TEST_MAX_EML_BYTES = SUMMARIES_MAX_BODY_BYTES;

/** An SMTP path is at most 256 octets with its angle brackets (RFC 5321 section 4.5.3.1.3). */
const MAX_ENVELOPE_ADDRESS_CHARS = 254;

/** A dot-atom local part and an LDH domain: the forms our private addresses and mailboxes use. */
const ENVELOPE_ADDRESS = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~.-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/;

/** The MessageID shape parsePostmarkInbound accepts. */
const MESSAGE_ID = /^[\x21-\x7e]+$/;

/** A header field line: a name of printable ASCII without ':' and space, then ':'. */
const HEADER_FIELD = /^([\x21-\x39\x3b-\x7e]+):(.*)$/;

/** The end of the header block: the first empty line, CRLF or bare LF. */
const HEADER_END = /\r?\n\r?\n/;

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

// ---------------------------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------------------------

export type TestAuthResult = { ok: true; authorization: string } | { ok: false; reason: 'missing' | 'bad_form' };

/**
 * The Authorization header for SUMMARIES_TEST_WEBHOOK_AUTH. missing: unset or empty. bad_form: not
 * `postmark:<secret>`, a blank secret, or a control character (a pasted line break would only
 * give a 401). The value itself is never part of a result the caller prints.
 */
export function testWebhookAuthorization(value: string | undefined): TestAuthResult {
  if (typeof value !== 'string' || value.length === 0) return { ok: false, reason: 'missing' };
  const prefix = `${POSTMARK_BASIC_AUTH_USER}:`;
  if (!value.startsWith(prefix) || value.slice(prefix.length).trim().length === 0) return { ok: false, reason: 'bad_form' };
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) return { ok: false, reason: 'bad_form' };
  }
  return { ok: true, authorization: `Basic ${Buffer.from(value, 'utf8').toString('base64')}` };
}

// ---------------------------------------------------------------------------------------------
// Target URL
// ---------------------------------------------------------------------------------------------

export type TestUrlResult = { ok: true; url: URL } | { ok: false; reason: 'invalid_url' | 'credentials_in_url' | 'insecure_http' };

/**
 * The function URL: https, or http to a loopback host only (the emulator), so the credentials never
 * cross a network in clear text. Credentials in the URL are refused: they belong in the
 * environment variable, never in an argument or the shell history.
 */
export function checkTestUrl(value: string): TestUrlResult {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, reason: 'invalid_url' };
  }
  if (url.username !== '' || url.password !== '') return { ok: false, reason: 'credentials_in_url' };
  if (url.protocol === 'https:') return { ok: true, url };
  if (url.protocol === 'http:') return LOOPBACK_HOSTS.has(url.hostname) ? { ok: true, url } : { ok: false, reason: 'insecure_http' };
  return { ok: false, reason: 'invalid_url' };
}

/** The URL without its query and fragment, for the terminal. */
export function printableUrl(url: URL): string {
  return `${url.origin}${url.pathname}`;
}

// ---------------------------------------------------------------------------------------------
// Header block
// ---------------------------------------------------------------------------------------------

export interface HeaderField {
  name: string;
  /** Unfolded: the line breaks of continuation lines removed, nothing else changed. */
  value: string;
}

export interface HeaderBlock {
  fields: HeaderField[];
  /** False when the file has no empty line, so everything was read as headers. */
  hasBodySeparator: boolean;
  /** The first line is an mbox "From " separator, not a header field. */
  mboxFromLine: boolean;
  /** Lines that are neither a field nor a continuation. */
  malformedLines: number;
}

/** The header block of a raw message, lenient (CRLF or bare LF). Pure. */
export function readHeaderBlock(raw: string): HeaderBlock {
  const startsEmpty = /^\r?\n/.test(raw);
  const end = startsEmpty ? null : HEADER_END.exec(raw);
  const block = startsEmpty ? '' : end === null ? raw : raw.slice(0, end.index);
  const result: HeaderBlock = {
    fields: [],
    hasBodySeparator: startsEmpty || end !== null,
    mboxFromLine: false,
    malformedLines: 0,
  };
  if (block.length === 0) return result;
  const lines = block.split(/\r?\n/);
  lines.forEach((line, index) => {
    if (line.startsWith(' ') || line.startsWith('\t')) {
      const last = result.fields[result.fields.length - 1];
      if (last === undefined) result.malformedLines += 1;
      else last.value += line;
      return;
    }
    const match = HEADER_FIELD.exec(line);
    if (match !== null && match[1] !== undefined && match[2] !== undefined) {
      result.fields.push({ name: match[1], value: match[2] });
      return;
    }
    if (index === 0 && line.startsWith('From ')) result.mboxFromLine = true;
    else result.malformedLines += 1;
  });
  return result;
}

function firstField(block: HeaderBlock, name: string): string | null {
  const lower = name.toLowerCase();
  const field = block.fields.find((candidate) => candidate.name.toLowerCase() === lower);
  return field === undefined ? null : collapse(field.value);
}

function countFields(block: HeaderBlock, name: string): number {
  const lower = name.toLowerCase();
  return block.fields.filter((field) => field.name.toLowerCase() === lower).length;
}

function collapse(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * The address and display name of a From value, as Postmark's From and FromName show them. Only
 * fills JSON fields the adapter never reads, so it is deliberately simple: `Name <addr>` or a bare
 * address with comments removed.
 */
export function splitMailbox(value: string): { email: string; name: string } {
  const angle = /<([^<>]*)>\s*$/.exec(value);
  if (angle !== null && angle[1] !== undefined) {
    const name = value
      .slice(0, angle.index)
      .trim()
      .replace(/^"(.*)"$/, '$1')
      .trim();
    return { email: angle[1].trim(), name };
  }
  return { email: collapse(value.replace(/\([^()]*\)/g, ' ')), name: '' };
}

// ---------------------------------------------------------------------------------------------
// Payload
// ---------------------------------------------------------------------------------------------

export interface PostmarkAddressFull {
  Email: string;
  Name: string;
  MailboxHash: string;
}

/** A Postmark inbound post, the fields of its documented example except the bodies and attachments' content. */
export interface PostmarkTestPayload {
  FromName: string;
  MessageStream: 'inbound';
  From: string;
  FromFull: PostmarkAddressFull;
  To: string;
  ToFull: PostmarkAddressFull[];
  Cc: string;
  CcFull: PostmarkAddressFull[];
  Bcc: string;
  BccFull: PostmarkAddressFull[];
  OriginalRecipient: string;
  Subject: string;
  MessageID: string;
  ReplyTo: string;
  MailboxHash: string;
  Date: string;
  Tag: string;
  Headers: Array<{ Name: string; Value: string }>;
  Attachments: never[];
  RawEmail: string;
}

/** Fixed codes the script explains; none of them stops the send (the pipeline decides). */
export type TestPayloadWarning =
  | 'not_utf8'
  | 'no_body_separator'
  | 'mbox_from_line'
  | 'malformed_header_lines'
  | 'from_not_exactly_one'
  | 'no_dkim_signature'
  | 'raw_too_large';

export const TEST_PAYLOAD_WARNING_TEXT: Readonly<Record<TestPayloadWarning, string>> = {
  not_utf8:
    'The .eml is not valid UTF-8, so RawEmail cannot carry its exact bytes (day-0 check 2): a DKIM body hash over it will fail (changed_after_sending).',
  no_body_separator: 'No empty line ends the header block: the whole file was read as headers.',
  mbox_from_line: 'The file starts with an mbox "From " line, which is not a header field: remove that first line for a realistic test.',
  malformed_header_lines: 'Some header lines are neither a field nor a continuation: the pipeline refuses such a message as malformed.',
  from_not_exactly_one: 'The header block does not hold exactly one From field: the pipeline refuses it as malformed.',
  no_dkim_signature: 'No DKIM-Signature field: the pipeline treats the message as unsigned.',
  raw_too_large: 'The message is over 5 MiB: the pipeline refuses it as too_large.',
};

export interface TestPayloadFacts {
  rawBytes: number;
  /** The JSON body size the script posts. */
  bodyBytes: number;
  /** True when RawEmail re-encodes to exactly the file's bytes. */
  utf8Exact: boolean;
  lineEndings: 'crlf' | 'lf' | 'mixed' | 'none';
  headerCounts: { from: number; to: number; date: number; subject: number; messageId: number; dkimSignature: number };
  warnings: TestPayloadWarning[];
}

export interface BuildTestPayloadInput {
  /** The exact bytes of the .eml file. */
  rawEmail: Buffer;
  /** The private address: OriginalRecipient, To and ToFull. */
  to: string;
  /** The SMTP envelope sender to claim (a Return-Path entry of Headers), or null. */
  fromEnvelope: string | null;
  /** A random UUID from the caller (crypto.randomUUID). */
  messageId: string;
}

export type BuildTestPayloadFailure = 'empty_eml' | 'invalid_to' | 'invalid_from_envelope' | 'invalid_message_id' | 'body_too_large';

export type BuildTestPayloadResult =
  | { ok: true; payload: PostmarkTestPayload; body: string; facts: TestPayloadFacts }
  | { ok: false; reason: BuildTestPayloadFailure };

/** True for an envelope address of the dot-atom form, at most 254 characters. */
export function isEnvelopeAddress(value: string): boolean {
  return value.length <= MAX_ENVELOPE_ADDRESS_CHARS && ENVELOPE_ADDRESS.test(value);
}

/** Postmark's MailboxHash: the part of the local part after the first "+", else empty. */
export function mailboxHashOf(address: string): string {
  const at = address.lastIndexOf('@');
  const local = at < 0 ? address : address.slice(0, at);
  const plus = local.indexOf('+');
  return plus < 0 ? '' : local.slice(plus + 1);
}

function lineEndingsOf(raw: Buffer): TestPayloadFacts['lineEndings'] {
  let crlf = 0;
  let bareLf = 0;
  for (let index = 0; index < raw.length; index += 1) {
    if (raw[index] !== 0x0a) continue;
    if (index > 0 && raw[index - 1] === 0x0d) crlf += 1;
    else bareLf += 1;
  }
  if (crlf === 0 && bareLf === 0) return 'none';
  if (bareLf === 0) return 'crlf';
  if (crlf === 0) return 'lf';
  return 'mixed';
}

/**
 * The Postmark-shaped payload for one .eml, its JSON body and the facts the script prints. Fails
 * only on inputs the script controls (addresses, the id) or a body the webhook would ignore (over
 * SUMMARIES_MAX_BODY_BYTES); anything about the message itself is a warning, because testing the
 * pipeline's refusals is part of the point.
 */
export function buildTestInboundPayload(input: BuildTestPayloadInput): BuildTestPayloadResult {
  if (!Buffer.isBuffer(input.rawEmail) || input.rawEmail.length === 0) return { ok: false, reason: 'empty_eml' };
  if (typeof input.to !== 'string' || !isEnvelopeAddress(input.to)) return { ok: false, reason: 'invalid_to' };
  if (input.fromEnvelope !== null && (typeof input.fromEnvelope !== 'string' || !isEnvelopeAddress(input.fromEnvelope))) {
    return { ok: false, reason: 'invalid_from_envelope' };
  }
  if (
    typeof input.messageId !== 'string' ||
    input.messageId.length > POSTMARK_FIELD_LIMITS.messageIdChars ||
    !MESSAGE_ID.test(input.messageId)
  ) {
    return { ok: false, reason: 'invalid_message_id' };
  }

  const rawEmail = input.rawEmail.toString('utf8');
  const utf8Exact = Buffer.from(rawEmail, 'utf8').equals(input.rawEmail);
  const block = readHeaderBlock(rawEmail);
  const fromValue = firstField(block, 'From') ?? '';
  const from = splitMailbox(fromValue);
  const mailboxHash = mailboxHashOf(input.to);

  const payload: PostmarkTestPayload = {
    FromName: from.name,
    MessageStream: 'inbound',
    From: from.email,
    FromFull: { Email: from.email, Name: from.name, MailboxHash: '' },
    To: input.to,
    ToFull: [{ Email: input.to, Name: '', MailboxHash: mailboxHash }],
    Cc: '',
    CcFull: [],
    Bcc: '',
    BccFull: [],
    OriginalRecipient: input.to,
    Subject: firstField(block, 'Subject') ?? '',
    MessageID: input.messageId,
    ReplyTo: '',
    MailboxHash: mailboxHash,
    Date: firstField(block, 'Date') ?? '',
    Tag: '',
    Headers: input.fromEnvelope === null ? [] : [{ Name: 'Return-Path', Value: `<${input.fromEnvelope}>` }],
    Attachments: [],
    RawEmail: rawEmail,
  };
  const body = JSON.stringify(payload);
  const bodyBytes = Buffer.byteLength(body, 'utf8');
  if (bodyBytes > SUMMARIES_MAX_BODY_BYTES) return { ok: false, reason: 'body_too_large' };

  const headerCounts = {
    from: countFields(block, 'From'),
    to: countFields(block, 'To'),
    date: countFields(block, 'Date'),
    subject: countFields(block, 'Subject'),
    messageId: countFields(block, 'Message-ID'),
    dkimSignature: countFields(block, 'DKIM-Signature'),
  };
  const warnings: TestPayloadWarning[] = [];
  if (!utf8Exact) warnings.push('not_utf8');
  if (!block.hasBodySeparator) warnings.push('no_body_separator');
  if (block.mboxFromLine) warnings.push('mbox_from_line');
  if (block.malformedLines > 0) warnings.push('malformed_header_lines');
  if (headerCounts.from !== 1) warnings.push('from_not_exactly_one');
  if (headerCounts.dkimSignature === 0) warnings.push('no_dkim_signature');
  if (input.rawEmail.length > TEST_RAW_TOO_LARGE_BYTES) warnings.push('raw_too_large');

  return {
    ok: true,
    payload,
    body,
    facts: {
      rawBytes: input.rawEmail.length,
      bodyBytes,
      utf8Exact,
      lineEndings: lineEndingsOf(input.rawEmail),
      headerCounts,
      warnings,
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Terminal views (no content, no credentials)
// ---------------------------------------------------------------------------------------------

function lengthOnly(value: string): string {
  return value.length === 0 ? '' : `<${value.length} characters>`;
}

function fullLengthOnly(full: PostmarkAddressFull): PostmarkAddressFull {
  return { Email: lengthOnly(full.Email), Name: lengthOnly(full.Name), MailboxHash: lengthOnly(full.MailboxHash) };
}

/**
 * The payload's shape for --dry-run: the routing fields the owner typed (To, OriginalRecipient,
 * MailboxHash, the Return-Path from --from-envelope), the random MessageID and the fixed fields as
 * they are; every value taken from the .eml (From, FromName, Subject, Date) as its length only;
 * RawEmail truncated to its length.
 */
export function describeTestPayload(payload: PostmarkTestPayload): Record<string, unknown> {
  return {
    FromName: lengthOnly(payload.FromName),
    MessageStream: payload.MessageStream,
    From: lengthOnly(payload.From),
    FromFull: fullLengthOnly(payload.FromFull),
    To: payload.To,
    ToFull: payload.ToFull,
    Cc: payload.Cc,
    CcFull: payload.CcFull,
    Bcc: payload.Bcc,
    BccFull: payload.BccFull,
    OriginalRecipient: payload.OriginalRecipient,
    Subject: lengthOnly(payload.Subject),
    MessageID: payload.MessageID,
    ReplyTo: payload.ReplyTo,
    MailboxHash: payload.MailboxHash,
    Date: lengthOnly(payload.Date),
    Tag: payload.Tag,
    Headers: payload.Headers,
    Attachments: payload.Attachments,
    RawEmail: `<${payload.RawEmail.length} characters, truncated>`,
  };
}

/** The fixed bodies of ../inbound.ts and ../inboundFunction.ts (the only text they answer). */
const FIXED_RESPONSE_BODIES = new Set(['ok', 'Not configured', 'Method Not Allowed', 'Unauthorized', 'Internal Server Error']);

/** Fields of a JSON answer that carry codes; only short code-like values are shown. */
const REASON_KEYS = ['verdict', 'reason', 'detail', 'outcome', 'status', 'code'] as const;

const CODE_LIKE = /^[A-Za-z0-9_.:-]{1,64}$/;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function codeFields(record: Record<string, unknown>, prefix: string): string[] {
  const out: string[] = [];
  for (const key of REASON_KEYS) {
    const field = record[key];
    if ((typeof field === 'string' && CODE_LIKE.test(field)) || (typeof field === 'number' && Number.isSafeInteger(field))) {
      out.push(`${prefix}${key}=${String(field)}`);
    }
  }
  return out;
}

function reasonFields(value: unknown): string[] {
  const record = asRecord(value);
  if (record === null) return [];
  // Google front ends answer {error: {code, status, message}}: the code and status only, never the message.
  const nested = asRecord(record.error);
  return [...codeFields(record, ''), ...(nested === null ? [] : codeFields(nested, 'error.'))];
}

const STATUS_HINTS: Readonly<Record<number, string>> = {
  200: 'Accepted by the webhook. It answers 200 for every deliberate outcome (stored, refused, dropped, ignored): the verdict and reason are in the summaries.inbound log line.',
  401: 'Basic auth failed: SUMMARIES_TEST_WEBHOOK_AUTH must be postmark:<the SUMMARIES_WEBHOOK_AUTH value>, exactly.',
  403: 'Refused before the function ran: check the URL and that summaryInbound is deployed with invoker public.',
  404: 'Not found: SUMMARIES_ENABLED is false, summaryInbound is not deployed, or the URL is wrong.',
  405: 'Method not allowed: the webhook takes POST only.',
  413: 'The front end refused the body as too large.',
  500: 'Retry answer (a DNS temperror on a deciding signature, or a Firestore or setup failure; Postmark would redeliver): see summaries.inbound and summaries.setup_alarm.',
};

/**
 * What the script prints about the answer: the status, the body only when it is one of the fixed
 * answers or code-like reason fields of a JSON object (otherwise its size), and a hint. Never the
 * body text itself.
 */
export function describeTestResponse(status: number, bodyText: string): { line: string; hint: string | null } {
  const trimmed = bodyText.trim();
  let shown: string;
  if (FIXED_RESPONSE_BODIES.has(trimmed)) {
    shown = trimmed;
  } else {
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      parsed = null;
    }
    const fields = reasonFields(parsed);
    shown = fields.length > 0 ? fields.join(' ') : `(body not shown, ${Buffer.byteLength(bodyText, 'utf8')} bytes)`;
  }
  let hint = STATUS_HINTS[status] ?? null;
  if (hint === null && status >= 300 && status < 400) hint = 'Redirect not followed: post to the function URL itself.';
  return { line: `HTTP ${status} ${shown}`, hint };
}
