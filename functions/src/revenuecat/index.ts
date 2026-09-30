/**
 * RevenueCat webhook -> entitlements/{uid} writer (owner: billing; docs/ARCHITECTURE.md §20).
 *
 * v2 onRequest, POST only. Auth: the RevenueCat dashboard sends the configured "Authorization
 * header value" VERBATIM; it is compared timing-safe against the REVENUECAT_WEBHOOK_AUTH secret
 * (Cloud Secret Manager: `firebase functions:secrets:set REVENUECAT_WEBHOOK_AUTH`); 401 on
 * mismatch. Idempotency: revenuecatEvents/{event.id} is created IN THE SAME TRANSACTION as the
 * entitlement write(s); an existing marker => 200 no-op (RevenueCat retries reuse the event id).
 *
 * Responses: 200 for every handled OR deliberately ignored event (TEST, unknown types,
 * anonymous/invalid app_user_id, unmappable plan - never let RevenueCat retry a non-error),
 * 400 for a malformed body, 401 for a bad secret, 405 for non-POST, 500 only for real failures
 * (Firestore down), which RevenueCat retries.
 *
 * `app_user_id` IS the Firebase uid (the app calls Purchases.configure({ appUserID: uid })).
 * THE CLIENT NEVER WRITES entitlements/{uid}: this webhook and the admin callable are the only
 * writers (Admin SDK bypasses the Firestore rules, which allow no client writes there).
 */
import { createHash, timingSafeEqual } from 'node:crypto';

import * as logger from 'firebase-functions/logger';
import { onRequest } from 'firebase-functions/https';
import { defineSecret } from 'firebase-functions/params';

import { FUNCTIONS_REGION } from '../config';
import { adminDb } from '../firebase';
import {
  entitlementFromEvent,
  isAnonymousAppUserId,
  planFromEvent,
  revenueCatWebhookBodySchema,
  type EntitlementWrite,
  type RevenueCatEvent,
} from './mapping';

/** The exact Authorization header value RevenueCat is configured to send (never logged). */
export const REVENUECAT_WEBHOOK_AUTH = defineSecret('REVENUECAT_WEBHOOK_AUTH');

export const REVENUECAT_EVENTS_COLLECTION = 'revenuecatEvents';
export const ENTITLEMENTS_COLLECTION = 'entitlements';

// ---------------------------------------------------------------------------------------------
// Pure pieces (unit-tested without Firebase)
// ---------------------------------------------------------------------------------------------

/** Constant-time string comparison (hashes first: no length or prefix leak, any input sizes). */
export function timingSafeStringEqual(a: string, b: string): boolean {
  const hashA = createHash('sha256').update(a, 'utf8').digest();
  const hashB = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(hashA, hashB);
}

/** Firestore document ids we accept for uids and event ids (no '/', '.', '$' path tricks). */
const SAFE_DOC_ID = /^[A-Za-z0-9_-]{1,200}$/;

/** One entitlements/{uid} write. */
export interface EntitlementTarget {
  uid: string;
  write: EntitlementWrite;
}

export type WebhookDecision =
  | { kind: 'bad_request'; reason: string }
  | { kind: 'ignored'; reason: string; eventId: string | null; eventType: string | null }
  | {
      kind: 'apply';
      eventId: string;
      eventType: string;
      marker: Record<string, unknown>;
      writes: EntitlementTarget[];
    };

function firstUsableUid(ids: readonly string[] | null | undefined): string | null {
  for (const id of ids ?? []) {
    if (typeof id === 'string' && !isAnonymousAppUserId(id) && SAFE_DOC_ID.test(id)) return id;
  }
  return null;
}

function markerOf(event: RevenueCatEvent, now: Date): Record<string, unknown> {
  return {
    type: event.type,
    appUserId: event.app_user_id ?? null,
    environment: event.environment ?? null,
    store: event.store ?? null,
    eventTimestampMs: event.event_timestamp_ms ?? null,
    receivedAt: now.toISOString(),
  };
}

/**
 * Maps a request body to the writes to apply (pure; §20 decision table via entitlementFromEvent).
 * TRANSFER is resolved here because it writes TWO uids: `transferred_to` gains the plan,
 * `transferred_from` is expired.
 */
export function decideWebhook(body: unknown, now: Date): WebhookDecision {
  const parsed = revenueCatWebhookBodySchema.safeParse(body);
  if (!parsed.success) return { kind: 'bad_request', reason: 'malformed_body' };
  const event = parsed.data.event;
  const base = { eventId: event.id, eventType: event.type };

  if (!SAFE_DOC_ID.test(event.id)) return { kind: 'ignored', reason: 'unsafe_event_id', eventId: null, eventType: event.type };
  if (event.type === 'TEST') return { kind: 'ignored', reason: 'test_event', ...base };

  const updatedAt = now.toISOString();
  if (event.type === 'TRANSFER') {
    const plan = planFromEvent(event);
    const toUid = firstUsableUid(event.transferred_to);
    const fromUid = firstUsableUid(event.transferred_from);
    if (plan === null || toUid === null) {
      return { kind: 'ignored', reason: plan === null ? 'transfer_without_plan' : 'transfer_without_target', ...base };
    }
    const expiresAt =
      typeof event.expiration_at_ms === 'number' && Number.isFinite(event.expiration_at_ms)
        ? new Date(event.expiration_at_ms).toISOString()
        : null;
    const writes: EntitlementTarget[] = [
      { uid: toUid, write: { plan, status: 'active', expiresAt, source: 'revenuecat', updatedAt } },
    ];
    if (fromUid !== null && fromUid !== toUid) {
      writes.push({ uid: fromUid, write: { plan, status: 'expired', expiresAt, source: 'revenuecat', updatedAt } });
    }
    return { kind: 'apply', ...base, marker: markerOf(event, now), writes };
  }

  const appUserId = event.app_user_id ?? '';
  if (appUserId === '') return { kind: 'ignored', reason: 'missing_app_user_id', ...base };
  if (isAnonymousAppUserId(appUserId)) return { kind: 'ignored', reason: 'anonymous_app_user_id', ...base };
  if (!SAFE_DOC_ID.test(appUserId)) return { kind: 'ignored', reason: 'invalid_app_user_id', ...base };

  const write = entitlementFromEvent(event, now);
  if (write === null) return { kind: 'ignored', reason: 'unhandled_type_or_plan', ...base };
  return { kind: 'apply', ...base, marker: markerOf(event, now), writes: [{ uid: appUserId, write }] };
}

// ---------------------------------------------------------------------------------------------
// Handler over injectable ports (tests use fakes)
// ---------------------------------------------------------------------------------------------

export interface RevenueCatStore {
  /**
   * Transactionally creates revenuecatEvents/{eventId} and applies every entitlement write;
   * resolves 'duplicate' (and writes NOTHING) when the marker already exists.
   */
  applyOnce(eventId: string, marker: Record<string, unknown>, writes: readonly EntitlementTarget[]): Promise<'applied' | 'duplicate'>;
}

export interface WebhookRequestLike {
  method: string;
  /** Raw header value, e.g. req.get('authorization'). */
  header(name: string): string | undefined;
  body: unknown;
}

export interface WebhookResponseLike {
  status(code: number): { json(body: unknown): void };
}

export async function handleRevenueCatWebhook(
  req: WebhookRequestLike,
  res: WebhookResponseLike,
  deps: { store: () => RevenueCatStore; secret: () => string; now?: () => Date },
): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }
  const expected = deps.secret();
  const received = req.header('authorization') ?? '';
  if (expected === '' || !timingSafeStringEqual(received, expected)) {
    logger.warn('revenuecat.unauthorized', { hasHeader: received !== '' });
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  const decision = decideWebhook(req.body, deps.now ? deps.now() : new Date());
  if (decision.kind === 'bad_request') {
    logger.warn('revenuecat.bad_request', { reason: decision.reason });
    res.status(400).json({ error: decision.reason });
    return;
  }
  if (decision.kind === 'ignored') {
    logger.info('revenuecat.ignored', { reason: decision.reason, eventId: decision.eventId, type: decision.eventType });
    res.status(200).json({ received: true, ignored: decision.reason });
    return;
  }

  try {
    const outcome = await deps.store().applyOnce(decision.eventId, decision.marker, decision.writes);
    logger.info('revenuecat.processed', {
      eventId: decision.eventId,
      type: decision.eventType,
      outcome,
      uids: decision.writes.map((w) => w.uid),
      plan: decision.writes[0]?.write.plan,
      status: decision.writes[0]?.write.status,
    });
    res.status(200).json({ received: true, duplicate: outcome === 'duplicate' });
  } catch (error) {
    logger.error('revenuecat.failed', {
      eventId: decision.eventId,
      type: decision.eventType,
      errorName: error instanceof Error ? error.name : typeof error,
      errorMessage: error instanceof Error ? error.message.slice(0, 300) : '',
    });
    // 5xx makes RevenueCat retry with the same event id; the marker keeps it idempotent.
    res.status(500).json({ error: 'internal' });
  }
}

export function firestoreRevenueCatStore(): RevenueCatStore {
  const db = adminDb();
  return {
    async applyOnce(eventId, marker, writes) {
      const markerRef = db.collection(REVENUECAT_EVENTS_COLLECTION).doc(eventId);
      return db.runTransaction(async (tx) => {
        const existing = await tx.get(markerRef);
        if (existing.exists) return 'duplicate' as const;
        tx.set(markerRef, marker);
        for (const { uid, write } of writes) {
          tx.set(db.collection(ENTITLEMENTS_COLLECTION).doc(uid), write);
        }
        return 'applied' as const;
      });
    },
  };
}

export const revenuecatWebhook = onRequest(
  {
    region: FUNCTIONS_REGION,
    secrets: [REVENUECAT_WEBHOOK_AUTH],
    // Server-to-server webhook: publicly reachable, authenticated by the secret header.
    invoker: 'public',
    timeoutSeconds: 30,
    memory: '256MiB',
    maxInstances: 5,
  },
  (req, res) =>
    handleRevenueCatWebhook({ method: req.method, header: (name) => req.get(name), body: req.body }, res, {
      store: firestoreRevenueCatStore,
      secret: () => REVENUECAT_WEBHOOK_AUTH.value(),
    }),
);
