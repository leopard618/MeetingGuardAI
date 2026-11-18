/**
 * Fathom webhook signatures (developers.fathom.ai/webhooks, checked 2026-11-17). PURE.
 *
 * Every delivery carries webhook-id, webhook-timestamp (epoch seconds) and webhook-signature
 * ("v1,<base64>", several separated by spaces). The signature is HMAC-SHA256, base64, over
 * `${id}.${timestamp}.${rawBody}`, keyed with the base64-decoded part of the webhook's secret after
 * "whsec_". Deliveries older or newer than five minutes are refused (replay window).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export const FATHOM_SIGNATURE_TOLERANCE_SECONDS = 5 * 60;

export type FathomSignatureResult = 'ok' | 'missing_headers' | 'bad_timestamp' | 'stale' | 'bad_secret' | 'mismatch';

export interface FathomSignatureInput {
  id: string | undefined;
  timestamp: string | undefined;
  signature: string | undefined;
  rawBody: Buffer;
  /** The webhook's secret as Fathom returned it (whsec_...). */
  secret: string;
  nowMs: number;
}

function secretKey(secret: string): Buffer | null {
  if (typeof secret !== 'string' || !secret.startsWith('whsec_')) return null;
  const encoded = secret.slice('whsec_'.length);
  if (encoded.length === 0 || !/^[A-Za-z0-9+/=_-]+$/.test(encoded)) return null;
  const key = Buffer.from(encoded.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  return key.length > 0 ? key : null;
}

/** Verifies one delivery. Constant-time compare of every offered v1 signature. */
export function verifyFathomSignature(input: FathomSignatureInput): FathomSignatureResult {
  const { id, timestamp, signature } = input;
  if (!id || !timestamp || !signature || id.length > 200 || signature.length > 2000) return 'missing_headers';
  if (!/^[0-9]{1,12}$/.test(timestamp.trim())) return 'bad_timestamp';
  const seconds = Number(timestamp.trim());
  if (Math.abs(input.nowMs / 1000 - seconds) > FATHOM_SIGNATURE_TOLERANCE_SECONDS) return 'stale';
  const key = secretKey(input.secret);
  if (key === null) return 'bad_secret';
  const signed = Buffer.concat([Buffer.from(`${id}.${timestamp.trim()}.`, 'utf8'), input.rawBody]);
  const expected = createHmac('sha256', key).update(signed).digest();
  for (const entry of signature.trim().split(/\s+/)) {
    const comma = entry.indexOf(',');
    if (comma < 0 || entry.slice(0, comma) !== 'v1') continue;
    const offered = Buffer.from(entry.slice(comma + 1), 'base64');
    if (offered.length === expected.length && timingSafeEqual(offered, expected)) return 'ok';
  }
  return 'mismatch';
}
