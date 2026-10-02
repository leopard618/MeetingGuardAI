/**
 * Webhook authentication primitives (functions/src/whatsapp/signature.ts): raw-body HMAC
 * verification vectors, the GET handshake, and the log/doc-id hashing helpers.
 */
import { createHmac } from 'node:crypto';

import {
  eventDocId,
  hashLinkCode,
  phoneLogId,
  timingSafeStringEqual,
  verifyHandshake,
  verifyWebhookSignature,
} from '../../src/whatsapp/signature';

const SECRET = 'test-app-secret';

function sign(body: Buffer, secret: string = SECRET): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

describe('verifyWebhookSignature', () => {
  const body = Buffer.from('{"object":"whatsapp_business_account","entry":[]}', 'utf8');

  it('accepts the HMAC-SHA256 of the raw body bytes', () => {
    expect(verifyWebhookSignature(body, sign(body), SECRET)).toBe(true);
  });

  it('accepts an upper-case hex digest (normalized)', () => {
    const header = sign(body);
    const upper = `sha256=${header.slice('sha256='.length).toUpperCase()}`;
    expect(verifyWebhookSignature(body, upper, SECRET)).toBe(true);
  });

  it('verifies the RAW bytes: escaped non-ASCII must match the bytes Meta sent, not re-serialized JSON', () => {
    // Meta escapes non-ASCII ("mañana"); re-serializing the parsed JSON yields different bytes.
    const escaped = Buffer.from('{"text":"ma\\u00f1ana"}', 'utf8');
    const reSerialized = Buffer.from(JSON.stringify(JSON.parse(escaped.toString('utf8'))), 'utf8');
    expect(verifyWebhookSignature(escaped, sign(escaped), SECRET)).toBe(true);
    expect(verifyWebhookSignature(reSerialized, sign(escaped), SECRET)).toBe(false);
  });

  it('rejects a wrong secret, a tampered body, and a truncated digest', () => {
    expect(verifyWebhookSignature(body, sign(body, 'other-secret'), SECRET)).toBe(false);
    expect(verifyWebhookSignature(Buffer.from('{"object":"x"}', 'utf8'), sign(body), SECRET)).toBe(false);
    expect(verifyWebhookSignature(body, sign(body).slice(0, 20), SECRET)).toBe(false);
  });

  it('rejects a missing or malformed header and an empty body', () => {
    expect(verifyWebhookSignature(body, undefined, SECRET)).toBe(false);
    expect(verifyWebhookSignature(body, '', SECRET)).toBe(false);
    expect(verifyWebhookSignature(body, 'sha1=abc', SECRET)).toBe(false);
    expect(verifyWebhookSignature(body, 'sha256=nothex', SECRET)).toBe(false);
    expect(verifyWebhookSignature(undefined, sign(body), SECRET)).toBe(false);
    expect(verifyWebhookSignature(Buffer.alloc(0), sign(Buffer.alloc(0)), SECRET)).toBe(false);
  });
});

describe('verifyHandshake', () => {
  const token = 'verify-me';

  it('echoes hub.challenge with 200 on a token match', () => {
    const result = verifyHandshake(
      { 'hub.mode': 'subscribe', 'hub.verify_token': token, 'hub.challenge': '1158201444' },
      token,
    );
    expect(result).toEqual({ status: 200, body: '1158201444' });
  });

  it('rejects a wrong token, a wrong mode, a missing challenge and an empty configured token', () => {
    expect(verifyHandshake({ 'hub.mode': 'subscribe', 'hub.verify_token': 'wrong', 'hub.challenge': 'c' }, token).status).toBe(403);
    expect(verifyHandshake({ 'hub.mode': 'unsubscribe', 'hub.verify_token': token, 'hub.challenge': 'c' }, token).status).toBe(403);
    expect(verifyHandshake({ 'hub.mode': 'subscribe', 'hub.verify_token': token }, token).status).toBe(403);
    expect(verifyHandshake({ 'hub.mode': 'subscribe', 'hub.verify_token': '', 'hub.challenge': 'c' }, '').status).toBe(403);
  });
});

describe('hashing helpers', () => {
  it('timingSafeStringEqual compares strings of different lengths without throwing', () => {
    expect(timingSafeStringEqual('abc', 'abc')).toBe(true);
    expect(timingSafeStringEqual('abc', 'abcd')).toBe(false);
    expect(timingSafeStringEqual('', '')).toBe(true);
  });

  it('phoneLogId is a stable 16-char hex pseudonym, never the number itself', () => {
    const id = phoneLogId('15551234567');
    expect(id).toMatch(/^[0-9a-f]{16}$/);
    expect(id).toBe(phoneLogId('15551234567'));
    expect(id).not.toContain('5551234567');
    expect(phoneLogId('15551234568')).not.toBe(id);
  });

  it('hashLinkCode and eventDocId are 64-char hex (Firestore-safe doc ids)', () => {
    expect(hashLinkCode('123456')).toMatch(/^[0-9a-f]{64}$/);
    expect(eventDocId('wamid.HBgLMTU1NTEyMzQ1NjcVAgARGBI5/QzRCRkY4RDc4+0Q9GQ==')).toMatch(/^[0-9a-f]{64}$/);
  });
});
