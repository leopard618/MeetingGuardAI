/**
 * Postmark inbound adapter for summaryInbound (docs/v2/M10-DESIGN.md section 2, section 4 steps 2
 * and 3, decision table rows 1 and 2). The only Postmark-specific code: a provider switch replaces
 * this file and keeps the provider-neutral InboundEnvelope.
 *
 * - Postmark does not sign webhooks. The webhook URL carries Basic auth credentials,
 *   `https://postmark:<SUMMARIES_WEBHOOK_AUTH>@<host>/summaryInbound`, which Postmark sends as
 *   `Authorization: Basic base64("postmark:" + secret)`. checkBasicAuth compares the decoded
 *   credentials with the expected pair through the shared timing-safe helper; an empty or
 *   whitespace-only configured secret rejects every request. A leaked secret still cannot plant a
 *   vendor-signed recap: authenticity rests on our own DKIM check of the raw message.
 * - parsePostmarkInbound picks ONLY RawEmail, OriginalRecipient, MailboxHash and MessageID, with
 *   bounded lengths. Postmark's parsed From, To, Cc, Subject, headers, spam and SPF verdicts are
 *   never read: routing uses the envelope recipient only (finding 15) and authenticity our own
 *   DKIM check (decision 3).
 *
 * Pure: no Firebase imports, no logging. Every value here is message content or a credential:
 * callers never log the payload, the raw message, the recipients or the header.
 */
import { z } from 'zod';

import { timingSafeStringEqual } from '../../whatsapp/signature';

/** Request bodies over this are ignored with 200 (row 2), before anything is parsed. */
export const SUMMARIES_MAX_BODY_BYTES = 12 * 1024 * 1024;

/** The user part of the webhook URL credentials. */
export const POSTMARK_BASIC_AUTH_USER = 'postmark';

/** Bounds of the picked payload fields (characters). Anything longer is invalid_payload. */
export const POSTMARK_FIELD_LIMITS = {
  /** No string in a body of at most SUMMARIES_MAX_BODY_BYTES can be longer. */
  rawEmailChars: SUMMARIES_MAX_BODY_BYTES,
  /** An SMTP envelope address is at most 256 octets; this leaves room for odd forms. */
  originalRecipientChars: 1024,
  mailboxHashChars: 1024,
  /** Postmark MessageIDs are GUIDs (36 characters). */
  messageIdChars: 256,
} as const;

/** Longer Authorization headers are refused before any decoding. */
const MAX_AUTHORIZATION_CHARS = 4096;

// `Basic <token68>`: the scheme is case-insensitive (RFC 7235), SP or HTAB around the token.
const BASIC_AUTHORIZATION = /^[ \t]*basic[ \t]+([A-Za-z0-9+/]+={0,2})[ \t]*$/i;

/** The provider-neutral inbound message (design section 2, Fallbacks). */
export interface InboundEnvelope {
  provider: 'postmark';
  /**
   * Postmark MessageID: dedupes redeliveries in the refused counter (step 9). Printable ASCII
   * without spaces, at most 256 characters, but it may contain "/": hash it before using it in a
   * document id. Never logged.
   */
  providerEventId: string;
  /** The full RFC 822 message as Postmark relays it (RawEmail). Content: never logged. */
  rawMime: Buffer;
  /**
   * The ONLY routing input (functions/src/summaries/address.ts tokenFromEnvelope). Null when
   * Postmark sent nothing or an empty string. Never logged.
   */
  envelopeRecipient: { originalRecipient: string | null; mailboxHash: string | null };
}

export type PostmarkParseFailure = 'invalid_payload' | 'no_raw_email';

export type PostmarkParseResult = { ok: true; envelope: InboundEnvelope } | { ok: false; reason: PostmarkParseFailure };

/**
 * True when the request body is over SUMMARIES_MAX_BODY_BYTES, judged by the raw body the
 * framework kept (req.rawBody) and, when present, the Content-Length header. Either one over the
 * limit is enough.
 */
export function exceedsBodyLimit(rawBody: Buffer | undefined, contentLength?: string | undefined): boolean {
  if (Buffer.isBuffer(rawBody) && rawBody.length > SUMMARIES_MAX_BODY_BYTES) return true;
  if (typeof contentLength === 'string' && /^[ \t]*[0-9]+[ \t]*$/.test(contentLength)) {
    const declared = Number(contentLength.trim());
    if (!Number.isSafeInteger(declared) || declared > SUMMARIES_MAX_BODY_BYTES) return true;
  }
  return false;
}

/**
 * Basic auth of the webhook (step 2). True only for `Basic base64("postmark:" + secret)` with a
 * configured secret that is not empty or whitespace-only. The base64 token must be canonical
 * (padded, no stray bits); the decoded bytes are compared byte for byte, timing-safe, with the
 * UTF-8 bytes of the expected pair. Never throws, never logs.
 */
export function checkBasicAuth(authorizationHeader: string | undefined, secret: string): boolean {
  if (typeof secret !== 'string' || secret.trim().length === 0) return false;
  if (typeof authorizationHeader !== 'string' || authorizationHeader.length > MAX_AUTHORIZATION_CHARS) return false;
  const match = BASIC_AUTHORIZATION.exec(authorizationHeader);
  const token = match?.[1];
  if (token === undefined || token.length % 4 !== 0) return false;
  const decoded = Buffer.from(token, 'base64');
  if (decoded.length === 0 || decoded.toString('base64') !== token) return false;
  const expected = Buffer.from(`${POSTMARK_BASIC_AUTH_USER}:${secret}`, 'utf8');
  // latin1 maps each byte to one character, so equal strings mean equal bytes (an invalid UTF-8
  // sequence can never compare equal through a replacement character).
  return timingSafeStringEqual(decoded.toString('latin1'), expected.toString('latin1'));
}

const envelopeField = (max: number) => z.string().max(max).nullable().optional();

/**
 * The four fields read from Postmark's inbound JSON. z.object keeps only these keys; every other
 * field (From, To, Subject, Headers, SpamScore, SPF and the rest) is never read.
 */
const postmarkInboundSchema = z.object({
  RawEmail: z.string().max(POSTMARK_FIELD_LIMITS.rawEmailChars).nullable().optional(),
  OriginalRecipient: envelopeField(POSTMARK_FIELD_LIMITS.originalRecipientChars),
  MailboxHash: envelopeField(POSTMARK_FIELD_LIMITS.mailboxHashChars),
  MessageID: z
    .string()
    .min(1)
    .max(POSTMARK_FIELD_LIMITS.messageIdChars)
    .regex(/^[\x21-\x7e]+$/),
});

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && Object.prototype.toString.call(value) === '[object Object]';
}

function nonEmptyOrNull(value: string | null | undefined): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Picks the envelope out of the framework's parsed req.body (step 3). invalid_payload: not a JSON
 * object, a picked field of the wrong type or over its bound, or no usable MessageID.
 * no_raw_email: RawEmail absent, null or empty (the "Include raw email content in JSON payload"
 * setting is off: the handler logs that as a setup alarm). Both answer 200 ignored (row 2).
 */
export function parsePostmarkInbound(body: unknown): PostmarkParseResult {
  if (!isPlainObject(body)) return { ok: false, reason: 'invalid_payload' };
  const parsed = postmarkInboundSchema.safeParse(body);
  if (!parsed.success) return { ok: false, reason: 'invalid_payload' };
  const rawEmail = parsed.data.RawEmail;
  if (typeof rawEmail !== 'string' || rawEmail.length === 0) return { ok: false, reason: 'no_raw_email' };
  return {
    ok: true,
    envelope: {
      provider: 'postmark',
      providerEventId: parsed.data.MessageID,
      // RawEmail arrives as a JSON string, so its bytes are re-encoded as UTF-8 here. Whether
      // that is byte-exact for 8-bit mail (a body in a legacy charset sent without a transfer
      // encoding cannot survive a JSON string unchanged) and which line endings Postmark keeps
      // is day-0 check 2 (UNVERIFIED). Bare LF line endings alone do not break DKIM: mailauth
      // rewrites every bare LF to CRLF before it hashes headers and body
      // (mailauth dist/cjs/dkim/message-parser.js ensureLinebreaks), and mail/headers.ts accepts
      // them too.
      rawMime: Buffer.from(rawEmail, 'utf8'),
      envelopeRecipient: {
        originalRecipient: nonEmptyOrNull(parsed.data.OriginalRecipient),
        mailboxHash: nonEmptyOrNull(parsed.data.MailboxHash),
      },
    },
  };
}
