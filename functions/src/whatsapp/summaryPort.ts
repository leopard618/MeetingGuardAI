/**
 * The webhook's port to the private summaryWhatsApp worker (docs/v2/M11-DESIGN.md section 4.3;
 * section 15 findings 12 and 16; section 13 hazards 16, 34 and 39).
 *
 * - The webhook never holds the data key: this file calls the worker over HTTPS with the webhook's
 *   own identity, an ID token for the worker's URL from the metadata server (a plain fetch, no new
 *   dependency), and gets back the text to send and the offer ids to store. It imports nothing that
 *   opens a summary (no sealing code, no data key, no reader).
 * - The port exists only when SUMMARIES_ENABLED is true at load, and it is used only for uids in
 *   SUMMARIES_PILOT_UIDS (read per call): everyone else, and these words from non-pilot users, reach
 *   the assistant exactly as before.
 * - Its timeout shrinks with the batch: min(95 s, what is left of the 240 s inline budget minus 15 s
 *   for the sends), never below 5 s. A message started late in a batch is never killed by the 300 s
 *   function limit after its dedupe claim; on a timeout the worker keeps running, finishes and stores
 *   its result for the next ask ("Still preparing").
 * - The URL: SUMMARIES_WHATSAPP_URL (a plain key, the run.app URL) when set, else the
 *   cloudfunctions.net URL of the worker in FUNCTIONS_REGION. Which audience Cloud Run accepts for
 *   the cloudfunctions.net URL is UNVERIFIED until deploy day (section 14 step 6).
 * - Redirects are not followed (the token is never sent elsewhere); the answer is read up to 64 KB
 *   and parsed with the protocol schema.
 * Logs: none here (the route logs outcomes); the token, the URL and the answer are never logged.
 */
import type { Firestore } from 'firebase-admin/firestore';

import { FUNCTIONS_REGION, SUMMARIES_ENABLED, SUMMARIES_PILOT_UIDS, SUMMARY_WHATSAPP_TUNING, WHATSAPP_TUNING } from '../config';
import { DEFAULT_CALLABLE_REGION } from '../shared/aiContract';
import { isPilotUid, summariesEnabledAtLoad, summariesWhatsAppUrlAtLoad } from '../summaries/gate';
import {
  SUMMARY_WHATSAPP_FUNCTION,
  summaryWhatsAppResponseSchema,
  type SummaryWhatsAppRequest,
  type SummaryWhatsAppResponse,
} from '../summaries/whatsappProtocol';
import { firestoreSummaryOfferStore, type SummaryOfferStore } from './session';

export type PortFailure = 'token' | 'network' | 'status' | 'bad_response';

export type PortResult =
  | { kind: 'ok'; response: SummaryWhatsAppResponse }
  | { kind: 'timeout' }
  | { kind: 'unreachable'; reason: PortFailure; status: number | null };

export interface SummaryPort {
  call(request: SummaryWhatsAppRequest, timeoutMs: number): Promise<PortResult>;
}

/** What the webhook's routing needs (WebhookDeps.summaries; absent while summaries are off at load). */
export interface SummaryRouteDeps {
  /** SUMMARIES_ENABLED.value() and the pilot list, read per call. */
  allowed(uid: string): boolean;
  port: SummaryPort;
  offers: SummaryOfferStore;
}

type PortTuning = Pick<typeof SUMMARY_WHATSAPP_TUNING, 'maxPortTimeoutMs' | 'sendsReserveMs' | 'minPortTimeoutMs'>;

/** min(95 s, the inline budget left minus the sends' reserve), never below the floor. */
export function portTimeoutMs(elapsedMs: number, tuning: PortTuning = SUMMARY_WHATSAPP_TUNING, inlineBudgetMs: number = WHATSAPP_TUNING.inlineBudgetMs): number {
  const left = inlineBudgetMs - Math.max(0, elapsedMs) - tuning.sendsReserveMs;
  return Math.max(tuning.minPortTimeoutMs, Math.min(tuning.maxPortTimeoutMs, left));
}

/** The worker's URL: the override when set, else https://<region>-<project>.cloudfunctions.net/summaryWhatsApp. */
export function summaryWorkerUrl(region: string, project: string | null | undefined, override: string | null): string | null {
  if (override !== null) return override;
  const r = region.trim();
  const p = (project ?? '').trim();
  if (!/^[a-z0-9-]{1,63}$/.test(r) || !/^[a-z0-9-]{1,63}$/.test(p)) return null;
  return `https://${r}-${p}.cloudfunctions.net/${SUMMARY_WHATSAPP_FUNCTION}`;
}

export type IdTokenSource = (audience: string) => Promise<string>;

const METADATA_IDENTITY_URL = 'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity';
/** A token is reused until this long before its expiry. */
const TOKEN_EARLY_REFRESH_MS = 5 * 60_000;
/** When the expiry cannot be read, a token is kept this long. */
const TOKEN_FALLBACK_TTL_MS = 10 * 60_000;

function expiryMsOf(token: string, nowMs: number): number {
  const payload = token.split('.')[1];
  if (payload === undefined) return nowMs + TOKEN_FALLBACK_TTL_MS;
  try {
    const exp = (JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { exp?: unknown }).exp;
    return typeof exp === 'number' && Number.isFinite(exp) ? exp * 1000 : nowMs + TOKEN_FALLBACK_TTL_MS;
  } catch {
    return nowMs + TOKEN_FALLBACK_TTL_MS;
  }
}

/**
 * ID tokens of the runtime account for an audience, from the metadata server, cached per audience
 * until shortly before they expire. Throws on any failure (the port answers 'token').
 */
export function metadataIdTokenSource(options: { fetchImpl?: typeof fetch; timeoutMs?: number; now?: () => number } = {}): IdTokenSource {
  const doFetch = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? SUMMARY_WHATSAPP_TUNING.idTokenTimeoutMs;
  const now = options.now ?? (() => Date.now());
  const cache = new Map<string, { token: string; expiresMs: number }>();
  return async (audience) => {
    const cached = cache.get(audience);
    if (cached !== undefined && cached.expiresMs - TOKEN_EARLY_REFRESH_MS > now()) return cached.token;
    const url = `${METADATA_IDENTITY_URL}?audience=${encodeURIComponent(audience)}&format=full`;
    const response = await doFetch(url, { headers: { 'Metadata-Flavor': 'Google' }, signal: AbortSignal.timeout(timeoutMs), redirect: 'manual' });
    const text = await response.text();
    if (!response.ok) throw new Error(`metadata identity ${response.status}`);
    const token = text.trim();
    if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) throw new Error('metadata identity malformed');
    cache.set(audience, { token, expiresMs: expiryMsOf(token, now()) });
    return token;
  };
}

function isTimeout(error: unknown): boolean {
  const name = error instanceof Error ? error.name : typeof error === 'object' && error !== null ? (error as { name?: unknown }).name : null;
  return name === 'TimeoutError' || name === 'AbortError';
}

export interface SummaryPortOptions {
  url: string;
  idToken: IdTokenSource;
  fetchImpl?: typeof fetch;
  maxResponseBytes?: number;
}

/** The HTTPS port (see the module comment). Never throws. */
export function createSummaryPort(options: SummaryPortOptions): SummaryPort {
  const doFetch = options.fetchImpl ?? fetch;
  const maxBytes = options.maxResponseBytes ?? SUMMARY_WHATSAPP_TUNING.maxResponseBytes;
  return {
    async call(request, timeoutMs) {
      let token: string;
      try {
        token = await options.idToken(options.url);
      } catch {
        return { kind: 'unreachable', reason: 'token', status: null };
      }
      let response: Response;
      let text: string;
      try {
        response = await doFetch(options.url, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(request),
          signal: AbortSignal.timeout(Math.max(1, Math.floor(timeoutMs))),
          redirect: 'manual',
        });
        text = await response.text();
      } catch (error) {
        return isTimeout(error) ? { kind: 'timeout' } : { kind: 'unreachable', reason: 'network', status: null };
      }
      if (response.status !== 200) return { kind: 'unreachable', reason: 'status', status: response.status };
      if (Buffer.byteLength(text, 'utf8') > maxBytes) return { kind: 'unreachable', reason: 'bad_response', status: 200 };
      let value: unknown;
      try {
        value = JSON.parse(text);
      } catch {
        return { kind: 'unreachable', reason: 'bad_response', status: 200 };
      }
      const parsed = summaryWhatsAppResponseSchema.safeParse(value);
      return parsed.success ? { kind: 'ok', response: parsed.data } : { kind: 'unreachable', reason: 'bad_response', status: 200 };
    },
  };
}

let instanceTokenSource: IdTokenSource | null = null;

/**
 * The webhook's summaries deps, or undefined while SUMMARIES_ENABLED is false at load or no worker
 * URL can be built (then "commitments" reaches the assistant as before).
 */
export function summaryRouteDepsAtLoad(db: Firestore): SummaryRouteDeps | undefined {
  if (!summariesEnabledAtLoad()) return undefined;
  const project = process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT ?? null;
  // The param's default when its value is not in the environment (as the callables' region).
  const region = FUNCTIONS_REGION.value() || DEFAULT_CALLABLE_REGION;
  const url = summaryWorkerUrl(region, project, summariesWhatsAppUrlAtLoad());
  if (url === null) return undefined;
  if (instanceTokenSource === null) instanceTokenSource = metadataIdTokenSource();
  return {
    allowed: (uid) => SUMMARIES_ENABLED.value() === true && isPilotUid(uid, SUMMARIES_PILOT_UIDS.value()),
    port: createSummaryPort({ url, idToken: instanceTokenSource }),
    offers: firestoreSummaryOfferStore(db),
  };
}
