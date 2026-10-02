/**
 * WHATSAPP link service (owner: whatsapp-app). Contract: WhatsAppService in
 * src/core/contracts.ts; design: docs/ARCHITECTURE.md §27.
 *
 * - Callables: whatsappLinkStatus / whatsappLinkStart / whatsappUnlink over the shared Firebase
 *   Functions instance (src/config/firebase.ts, pinned to env.functionsRegion, emulator-aware)
 *   with WHATSAPP_CALL_TIMEOUT_MS. Requests and responses are validated with the zod schemas;
 *   HttpsError.details.reason is mapped to AppError codes (invalid_request becomes
 *   invalid_input, rate_limited becomes quota_exceeded with details.reason kept).
 * - Session cache: the whatsappLinkStatus answer lives in module memory and is cleared on
 *   appEvents 'session:ended' (never persisted; a new session asks again). refreshStatus keeps
 *   the old answer visible until the new one arrives (no loading flicker on polls).
 * - NO phone numbers or codes in logs: error codes only.
 */
import NetInfo from '@react-native-community/netinfo';
import { httpsCallable } from 'firebase/functions';

import {
  CALLABLES,
  WHATSAPP_CALL_TIMEOUT_MS,
  whatsappErrorDetailsSchema,
  whatsappLinkStartRequestSchema,
  whatsappLinkStartResponseSchema,
  whatsappLinkStatusRequestSchema,
  whatsappLinkStatusResponseSchema,
  whatsappUnlinkRequestSchema,
  whatsappUnlinkResponseSchema,
  type WhatsappErrorCode,
} from '../../core/aiContract';
import type { WhatsAppLinkCode, WhatsAppLinkStatus, WhatsAppService } from '../../core/contracts';
import { AppError, isAppError, toAppError, type AppErrorCode } from '../../core/errors';
import { appEvents, type AppEventMap, type EventBus, type Unsubscribe } from '../../core/events';
import { createLogger } from '../../core/logger';
import { functions } from '../../config/firebase';

const log = createLogger('whatsapp');

/** The three whatsapp* callable names (CALLABLES in src/core/aiContract.ts). */
export type WhatsAppCallableName =
  | typeof CALLABLES.whatsappLinkStart
  | typeof CALLABLES.whatsappLinkStatus
  | typeof CALLABLES.whatsappUnlink;

/** Sends one request to a whatsapp* callable and resolves with the raw `data`. */
export interface WhatsAppTransport {
  call(name: WhatsAppCallableName, request: unknown, options: { timeoutMs: number }): Promise<unknown>;
}

export interface WhatsAppServiceDeps {
  /** null when Firebase is not configured in this build. */
  getTransport(): WhatsAppTransport | null;
  /** true only when the device is KNOWN to be offline (unknown => false). */
  connectivity?: { isOffline(): Promise<boolean> };
  /** When given, the session cache is cleared on its 'session:ended' event (appEvents). */
  events?: Pick<EventBus<AppEventMap>, 'on'>;
  timeoutMs?: number;
}

/** A config-less build behaves like a server that has the integration switched off. */
const DISABLED_STATUS: WhatsAppLinkStatus = {
  enabled: false,
  linked: false,
  displayNumber: null,
  deepLink: null,
};

const REASON_TO_APP_CODE: Readonly<Record<WhatsappErrorCode, AppErrorCode>> = {
  unauthenticated: 'unauthenticated',
  not_configured: 'not_configured',
  invalid_request: 'invalid_input',
  rate_limited: 'quota_exceeded',
  upstream_error: 'upstream_error',
};

function readCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

function readMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === 'string' ? error : '';
}

/** The Firebase callable client reports a fetch that never reached the server as "internal [0]". */
function isStatusZero(message: string): boolean {
  return /\[0\]\s*$/.test(message);
}

function isNetworkMessage(message: string): boolean {
  return /network request failed|failed to fetch|network error|internet connection appears to be offline/i.test(message);
}

/**
 * Normalizes anything a whatsapp* callable throws into an AppError. `offline` is the
 * connectivity probe's answer after the failure (improves status-0 "internal" mapping).
 * details.reason keeps the server taxonomy, so the UI can tell 'rate_limited' apart from other
 * quota errors.
 */
export function mapWhatsAppError(error: unknown, context: { offline?: boolean } = {}): AppError {
  if (isAppError(error)) return error;
  const providerCode = readCode(error);
  const message = readMessage(error);
  const rawDetails = typeof error === 'object' && error !== null ? (error as { details?: unknown }).details : undefined;
  const details = whatsappErrorDetailsSchema.safeParse(rawDetails);
  if (details.success) {
    return new AppError(REASON_TO_APP_CODE[details.data.reason], `whatsapp ${details.data.reason}`, {
      cause: error,
      details: { reason: details.data.reason, providerCode },
    });
  }
  if (providerCode !== null && providerCode.startsWith('functions/')) {
    const bare = providerCode.slice('functions/'.length);
    if (bare === 'deadline-exceeded') {
      return new AppError('timeout', 'whatsapp request timed out', { cause: error, details: { providerCode } });
    }
    if (bare === 'internal' && (isStatusZero(message) || context.offline === true)) {
      return new AppError('offline', 'whatsapp unreachable', { cause: error, details: { providerCode } });
    }
  }
  if (context.offline === true || isNetworkMessage(message)) {
    return new AppError('offline', 'whatsapp unreachable', { cause: error });
  }
  return toAppError(error, 'upstream_error');
}

/** The WhatsAppService contract plus the session plumbing the hook and tests use. */
export interface WhatsAppServiceInternal extends WhatsAppService {
  /** Re-asks whatsappLinkStatus, replacing the cache on success (useWhatsAppStatus().refresh). */
  refreshStatus(): Promise<WhatsAppLinkStatus>;
  /** Notifies whenever getKnownStatus() may have changed (hook re-renders). */
  subscribeStatus(listener: () => void): Unsubscribe;
  /** Session end: forget the status answer. */
  clearSessionCache(): void;
}

export function createWhatsAppService(deps: WhatsAppServiceDeps): WhatsAppServiceInternal {
  const timeoutMs = deps.timeoutMs ?? WHATSAPP_CALL_TIMEOUT_MS;
  /** whatsappLinkStatus answer this session; null = not known (unanswered or failed). */
  let known: WhatsAppLinkStatus | null = null;
  let statusPromise: Promise<WhatsAppLinkStatus> | null = null;
  /** Bumped on clearSessionCache so a stale in-flight answer is never cached cross-session. */
  let sessionEpoch = 0;
  const listeners = new Set<() => void>();

  function notify(): void {
    for (const listener of [...listeners]) listener();
  }

  function setKnown(value: WhatsAppLinkStatus | null): void {
    known = value;
    notify();
  }

  async function probeOffline(): Promise<boolean> {
    if (!deps.connectivity) return false;
    try {
      return await deps.connectivity.isOffline();
    } catch {
      return false;
    }
  }

  async function callValidated<T>(
    name: WhatsAppCallableName,
    request: unknown,
    parse: (raw: unknown) => { success: true; data: T } | { success: false },
  ): Promise<T> {
    const transport = deps.getTransport();
    if (!transport) throw new AppError('not_configured', 'Firebase is not configured in this build');
    if (await probeOffline()) throw new AppError('offline', 'Device is offline');
    let raw: unknown;
    try {
      raw = await transport.call(name, request, { timeoutMs });
    } catch (error) {
      const mapped = mapWhatsAppError(error, { offline: await probeOffline() });
      log.warn('whatsapp call failed', { name, code: mapped.code });
      throw mapped;
    }
    const parsed = parse(raw);
    if (!parsed.success) throw new AppError('upstream_error', `invalid ${name} response`);
    return parsed.data;
  }

  async function askStatus(): Promise<WhatsAppLinkStatus> {
    const epoch = sessionEpoch;
    if (!deps.getTransport()) return DISABLED_STATUS;
    const status = await callValidated(
      CALLABLES.whatsappLinkStatus,
      whatsappLinkStatusRequestSchema.parse({}),
      (raw) => whatsappLinkStatusResponseSchema.safeParse(raw),
    );
    if (epoch === sessionEpoch) setKnown(status);
    return status;
  }

  function getStatus(): Promise<WhatsAppLinkStatus> {
    if (known !== null) return Promise.resolve(known);
    if (statusPromise) return statusPromise;
    const promise = askStatus().finally(() => {
      if (statusPromise === promise) statusPromise = null;
    });
    statusPromise = promise;
    return promise;
  }

  async function startLink(): Promise<WhatsAppLinkCode> {
    return callValidated(
      CALLABLES.whatsappLinkStart,
      whatsappLinkStartRequestSchema.parse({}),
      (raw) => whatsappLinkStartResponseSchema.safeParse(raw),
    );
  }

  async function unlink(): Promise<void> {
    const epoch = sessionEpoch;
    await callValidated(
      CALLABLES.whatsappUnlink,
      whatsappUnlinkRequestSchema.parse({}),
      (raw) => whatsappUnlinkResponseSchema.safeParse(raw),
    );
    // The link is gone server-side; reflect it without another round trip.
    if (epoch === sessionEpoch && known !== null) setKnown({ ...known, linked: false });
  }

  function clearSessionCache(): void {
    sessionEpoch += 1;
    statusPromise = null;
    setKnown(null);
  }

  // The status answer belongs to ONE session (§27, mirroring §24).
  deps.events?.on('session:ended', () => clearSessionCache());

  return {
    getStatus,
    getKnownStatus(): WhatsAppLinkStatus | null {
      return known;
    },
    startLink,
    unlink,
    async refreshStatus(): Promise<WhatsAppLinkStatus> {
      // Unlike session end, a refresh keeps the old answer visible until the new one arrives.
      const promise = statusPromise ?? askStatus();
      statusPromise = promise;
      try {
        return await promise;
      } finally {
        if (statusPromise === promise) statusPromise = null;
      }
    },
    subscribeStatus(listener: () => void): Unsubscribe {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    clearSessionCache,
  };
}

function getDefaultTransport(): WhatsAppTransport | null {
  const instance = functions;
  if (!instance) return null;
  return {
    async call(name: WhatsAppCallableName, request: unknown, options: { timeoutMs: number }): Promise<unknown> {
      const callable = httpsCallable<unknown, unknown>(instance, name, { timeout: options.timeoutMs });
      const result = await callable(request);
      return result.data;
    },
  };
}

export const whatsappService: WhatsAppServiceInternal = createWhatsAppService({
  getTransport: getDefaultTransport,
  connectivity: {
    async isOffline(): Promise<boolean> {
      const state = await NetInfo.fetch();
      return state.isConnected === false;
    },
  },
  events: appEvents,
});
