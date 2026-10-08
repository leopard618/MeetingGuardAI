/**
 * Webhook authentication primitives (pure; no Firebase imports so they unit-test directly).
 *
 * - POST authenticity: `X-Hub-Signature-256: sha256=<hex>` is the HMAC-SHA256 of the RAW request
 *   body bytes keyed with the Meta App Secret. The digest MUST be computed over `req.rawBody`:
 *   Meta escapes non-ASCII characters when it serializes the payload, so re-serializing the
 *   parsed JSON produces different bytes and a false mismatch. Comparison is timing-safe.
 * - GET handshake: `hub.verify_token` must equal our configured verify token (timing-safe too).
 * - `phoneLogId` is the ONLY representation of a phone number that may appear in logs
 *   (docs/ARCHITECTURE.md §27 logging rule): sha256("wa:" + E.164 digits), first 16 hex chars.
 *   Unkeyed on purpose - the whatsapp* callables log too and bind no secrets - and treated as
 *   pseudonymous, not anonymous (the phone number space is small enough to brute-force), which
 *   is acceptable for access-controlled operational logs.
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const SIGNATURE_HEADER = 'x-hub-signature-256';
const SIGNATURE_PREFIX = 'sha256=';

/** Constant-time string comparison (hashes both sides so lengths never short-circuit). */
export function timingSafeStringEqual(a: string, b: string): boolean {
  const hashA = createHash('sha256').update(a, 'utf8').digest();
  const hashB = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(hashA, hashB);
}

/**
 * Verifies the X-Hub-Signature-256 header against the raw body bytes. False on a missing or
 * malformed header, an empty body or a mismatch - the webhook answers 401 then.
 */
export function verifyWebhookSignature(rawBody: Buffer | undefined, header: unknown, appSecret: string): boolean {
  if (!rawBody || rawBody.length === 0) return false;
  if (typeof header !== 'string' || !header.startsWith(SIGNATURE_PREFIX)) return false;
  const received = header.slice(SIGNATURE_PREFIX.length).trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(received)) return false;
  const expected = createHmac('sha256', appSecret).update(rawBody).digest('hex');
  return timingSafeStringEqual(received, expected);
}

/** The GET handshake: token match -> echo hub.challenge with 200; anything else -> 403. */
export function verifyHandshake(
  query: Record<string, unknown>,
  verifyToken: string,
): { status: 200; body: string } | { status: 403; body: string } {
  const mode = query['hub.mode'];
  const token = query['hub.verify_token'];
  const challenge = query['hub.challenge'];
  if (
    mode === 'subscribe' &&
    typeof token === 'string' &&
    verifyToken.length > 0 &&
    timingSafeStringEqual(token, verifyToken) &&
    typeof challenge === 'string'
  ) {
    return { status: 200, body: challenge };
  }
  return { status: 403, body: 'Forbidden' };
}

/** Pseudonymous phone id for logs (see the header). Never log the phone number itself. */
export function phoneLogId(phoneE164: string): string {
  return createHash('sha256').update(`wa:${phoneE164}`, 'utf8').digest('hex').slice(0, 16);
}

/** sha256 hex of a link code (whatsappLinkCodes doc id; the plain code is never stored). */
export function hashLinkCode(code: string): string {
  return createHash('sha256').update(code, 'utf8').digest('hex');
}

/** Firestore-safe dedupe doc id for a Meta message id (wamids may contain '/', '+', '='). */
export function eventDocId(wamid: string): string {
  return createHash('sha256').update(wamid, 'utf8').digest('hex');
}
