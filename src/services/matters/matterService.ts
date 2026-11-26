/**
 * MATTERS service (executive assistant prototype, A1; docs/v1/ARCHITECTURE.md section 36).
 *
 * - Callables matterDraft / matterRevise / matterConfirm / matterCancel over the shared Firebase
 *   Functions instance (src/config/firebase.ts) with MATTER_CALL_TIMEOUT_MS. Requests and
 *   responses are validated with the zod schemas of the shared contract.
 * - HttpsError.details.reason maps to AppError codes; the server reason is kept in
 *   details.reason so the screen can word 'stale_draft' and 'not_allowed' itself.
 * - Shown only when env.mattersEnabled (EXPO_PUBLIC_MATTERS_ENABLED); the server also gates it.
 * - Never logs the user's words, addresses or email text: error codes only.
 * - A2: matterDecide (approve or decline a card, accept or drop a commitment) and matterView (the
 *   open matters, or one matter with its pending cards and open commitments). The server reads
 *   them for the signed-in owner, so the app needs no Firestore rule for the cards.
 * - A3: matterSetStatus (pause, resume), matterChange (draft a change, then confirm it with its
 *   hash), matterAsk (a question or instruction by voice or text: the server only answers or
 *   names the action, the screen confirms it) and matterSpeak (the natural voice, demo only).
 * - A3 feedback: matterMessage (the owner's words become an email card to send) and matterMove (read the new
 *   time of the booked meeting, then move it on the time the owner confirmed). Neither sends: the
 *   owner sends the card with decide.
 * - A4: matterDelete (the owner removes a matter with its emails and history) and matterUsage (the
 *   usage meter). A rate_limited error keeps the limit it names in details.limit.
 * - A4 part 2: matterMailbox (the owner's Microsoft mailbox: status, connect, disconnect, and a
 *   draft sends from it or not). connectMailbox opens the server's sign-in link in the system
 *   browser (expo-web-browser, loaded lazily) and resolves once the browser comes back.
 *   matterWatch ("Watch this thread"): the forwards waiting, a draft from one (the usual draft,
 *   confirmed the usual way), or dismiss one.
 * - A5: matterSettings (the settings and the consent), matterDigest (the morning digest) and
 *   matterStream (answers and briefings streamed as they are written, matterStream.ts): streamAsk
 *   and streamBriefing call onText with each piece and resolve the done line; an error line becomes
 *   an AppError like the callables'. A stream that cannot start rejects with details.stream
 *   'unavailable' (askAnswer then asks the callable instead). consent_required maps to
 *   permission_denied with that reason, so the screen shows the consent.
 */
import { httpsCallable } from 'firebase/functions';

import {
  CALLABLES,
  MATTER_CALL_TIMEOUT_MS,
  matterCancelRequestSchema,
  matterCancelResponseSchema,
  matterDecideRequestSchema,
  matterDecideResponseSchema,
  matterViewRequestSchema,
  matterViewResponseSchema,
  matterAskRequestSchema,
  matterAskResponseSchema,
  matterChangeRequestSchema,
  matterSetStatusRequestSchema,
  matterSetStatusResponseSchema,
  matterSpeakRequestSchema,
  matterSpeakResponseSchema,
  matterMessageRequestSchema,
  matterMessageResponseSchema,
  matterMoveRequestSchema,
  matterMoveResponseSchema,
  matterDeleteRequestSchema,
  matterDeleteResponseSchema,
  matterUsageResponseSchema,
  matterMailboxRequestSchema,
  matterMailboxResponseSchema,
  matterWatchRequestSchema,
  matterWatchResponseSchema,
  matterSettingsRequestSchema,
  matterSettingsResponseSchema,
  matterDigestRequestSchema,
  matterDigestResponseSchema,
  matterStreamRequestSchema,
  type MatterAskResponse as StreamAskResponse,
  type MatterBriefing,
  type MatterDigestResponse,
  type MatterPrefs,
  type MatterSettingsResponse,
  MATTER_MAILBOX_RETURN_URL,
  matterConfirmRequestSchema,
  matterConfirmResponseSchema,
  matterDraftRequestSchema,
  matterDraftResponseSchema,
  matterErrorDetailsSchema,
  matterReviseRequestSchema,
  type Language,
  type MatterCancelResponse,
  type MatterConfirmResponse,
  type MatterDecideRequest,
  type MatterDecideResponse,
  type MatterDraftResponse,
  type MatterErrorCode,
  type MatterViewResponse,
  type MatterAskResponse,
  type MatterMessageResponse,
  type MatterMoveResponse,
  type MatterDeleteResponse,
  type MatterUsageResponse,
  type MatterMailboxResponse,
  type MatterWatchResponse,
  type MatterSetStatusResponse,
  type MatterSpeakResponse,
  type MatterStatusAction,
  type MatterStreamLine,
} from '../../core/aiContract';
import { AppError, isAppError, toAppError, type AppErrorCode } from '../../core/errors';
import { createLogger } from '../../core/logger';
import { env } from '../../config/env';
import { auth, functions } from '../../config/firebase';
import { createHttpStreamTransport, streamUrl, type FetchLike, type StreamTransport } from './matterStream';

const log = createLogger('matters');

export type MatterCallableName =
  | typeof CALLABLES.matterDraft
  | typeof CALLABLES.matterRevise
  | typeof CALLABLES.matterConfirm
  | typeof CALLABLES.matterCancel
  | typeof CALLABLES.matterDecide
  | typeof CALLABLES.matterView
  | typeof CALLABLES.matterSetStatus
  | typeof CALLABLES.matterChange
  | typeof CALLABLES.matterAsk
  | typeof CALLABLES.matterSpeak
  | typeof CALLABLES.matterMessage
  | typeof CALLABLES.matterMove
  | typeof CALLABLES.matterDelete
  | typeof CALLABLES.matterUsage
  | typeof CALLABLES.matterMailbox
  | typeof CALLABLES.matterWatch
  | typeof CALLABLES.matterSettings
  | typeof CALLABLES.matterDigest;

export interface MatterTransport {
  call(name: MatterCallableName, request: unknown, options: { timeoutMs: number }): Promise<unknown>;
}

export interface MatterService {
  /** Whether this build shows the assistant's matters at all. */
  isEnabled(): boolean;
  draft(input: { text: string; source: 'text' | 'voice'; language: Language; timeZone: string }): Promise<MatterDraftResponse>;
  revise(matterId: string, answer: string): Promise<MatterDraftResponse>;
  confirm(matterId: string, draftHash: string): Promise<MatterConfirmResponse>;
  cancel(matterId: string): Promise<MatterCancelResponse>;
  /** A2: approve or decline a card, accept or drop a proposed commitment. */
  decide(request: MatterDecideRequest): Promise<MatterDecideResponse>;
  /** A2: the signed-in user's active and paused matters, newest first (matterView). */
  listOpen(): Promise<MatterOpenItem[]>;
  /** A2: one matter with its pending cards and open commitments; null when it does not exist (matterView). */
  getPage(matterId: string): Promise<MatterPage | null>;
  /** A3: pause or resume a running matter. */
  setStatus(matterId: string, action: MatterStatusAction): Promise<MatterSetStatusResponse>;
  /** A3: draft a change of a running matter (or answer its questions); answers with its read-back and hash. */
  change(matterId: string, text: string): Promise<MatterDraftResponse>;
  /** A3: apply the drafted change the user read (its hash). */
  confirmChange(matterId: string, draftHash: string): Promise<MatterDraftResponse>;
  /** A3: a question or instruction about the matters, typed or spoken. */
  ask(input: { text: string; language: Language; matterId?: string }): Promise<MatterAskResponse>;
  /** A3: the natural voice (demo only): an MP3 of the text, base64. */
  speak(input: { text: string; language: Language; matterId?: string }): Promise<MatterSpeakResponse>;
  /** A3 feedback: the owner's words for an email to the contact: a card to send (or a question back). */
  message(matterId: string, text: string): Promise<MatterMessageResponse>;
  /** A3 feedback: reads the new time of the booked meeting from the owner's words; nothing changes. */
  readNewTime(matterId: string, text: string): Promise<MatterMoveResponse>;
  /** A3 feedback: moves the booked meeting to the time the owner confirmed; the email to the contact is a card. */
  moveMeeting(matterId: string, start: string): Promise<MatterMoveResponse>;
  /** A4: removes a matter with its emails and history (a running one stops first). */
  remove(matterId: string): Promise<MatterDeleteResponse>;
  /** A4: the usage meter (this month's allowance and today's limits). */
  usage(): Promise<MatterUsageResponse>;
  /** A4 part 2: whether a Microsoft mailbox is connected (and whether the server offers it). */
  mailboxStatus(): Promise<MatterMailboxResponse>;
  /** A4 part 2: the Microsoft sign-in link for "Connect your mailbox". */
  mailboxConnectLink(language: Language): Promise<MatterMailboxResponse>;
  /** A4 part 2: removes the stored mailbox access at once. */
  mailboxDisconnect(): Promise<MatterMailboxResponse>;
  /** A4 part 2: a draft sends from the connected mailbox (true) or from the assistant's address. */
  sendFrom(matterId: string, mailbox: boolean): Promise<MatterMailboxResponse>;
  /** A4 part 2, "Watch this thread": the forwarded emails waiting, and where to forward to. */
  watchList(): Promise<MatterWatchResponse>;
  /** Turns a waiting forward into a matter draft that answers it (response.draft). */
  watchDraft(watchId: string, language: Language, timeZone: string): Promise<MatterWatchResponse>;
  /** Deletes a waiting forward. */
  watchDismiss(watchId: string): Promise<MatterWatchResponse>;
  // ---- A5 ----
  settings(): Promise<MatterSettingsResponse>;
  /** applyToOpen: the follow-ups and the copy rule also go to the running matters. */
  saveSettings(prefs: MatterPrefs, timeZone: string, applyToOpen?: boolean): Promise<MatterSettingsResponse>;
  giveConsent(version: number, timeZone: string): Promise<MatterSettingsResponse>;
  digest(language: Language, timeZone: string): Promise<MatterDigestResponse>;
  /** A question streamed: onText gets the answer as it is written; resolves what code decided (and a briefing, for "brief me"). */
  streamAsk(input: { text: string; language: Language; matterId?: string; timeZone: string }, onText: (piece: string) => void): Promise<{ ask: StreamAskResponse; briefing: MatterBriefing | null }>;
  /** A briefing streamed: of a matter, or of the meeting the words name. */
  streamBriefing(input: { language: Language; matterId?: string; text?: string; timeZone: string }, onText: (piece: string) => void): Promise<MatterBriefing>;
}

export type MatterOpenItem = NonNullable<MatterViewResponse['matters']>[number];
export type MatterPage = NonNullable<MatterViewResponse['page']>;

const REASON_TO_APP_CODE: Readonly<Record<MatterErrorCode, AppErrorCode>> = {
  not_configured: 'not_configured',
  unauthenticated: 'unauthenticated',
  invalid_request: 'invalid_input',
  not_found: 'not_found',
  stale_draft: 'conflict',
  not_allowed: 'permission_denied',
  rate_limited: 'quota_exceeded',
  upstream_error: 'upstream_error',
  consent_required: 'permission_denied',
};

function readCode(error: unknown): string | null {
  const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : null;
  return typeof code === 'string' ? code : null;
}

/** Normalizes anything a matter* callable throws into an AppError (details.reason = the server reason). */
export function mapMatterError(error: unknown): AppError {
  if (isAppError(error)) return error;
  const providerCode = readCode(error);
  const rawDetails = typeof error === 'object' && error !== null ? (error as { details?: unknown }).details : undefined;
  const details = matterErrorDetailsSchema.safeParse(rawDetails);
  if (details.success) {
    return new AppError(REASON_TO_APP_CODE[details.data.reason], `matters ${details.data.reason}`, {
      cause: error,
      details: { reason: details.data.reason, providerCode, ...(details.data.limit ? { limit: details.data.limit } : {}) },
    });
  }
  if (providerCode === 'functions/deadline-exceeded') {
    return new AppError('timeout', 'matters request timed out', { cause: error, details: { providerCode } });
  }
  return toAppError(error, 'upstream_error');
}

export interface MatterServiceDeps {
  getTransport(): MatterTransport | null;
  enabled(): boolean;
  timeoutMs?: number;
  /** A5: matterStream (absent: streamed answers are not available). */
  getStream?(): StreamTransport | null;
}

export function createMatterService(deps: MatterServiceDeps): MatterService {
  const timeoutMs = deps.timeoutMs ?? MATTER_CALL_TIMEOUT_MS;

  async function call<T>(name: MatterCallableName, request: unknown, parse: (raw: unknown) => { success: true; data: T } | { success: false }): Promise<T> {
    if (!deps.enabled()) throw new AppError('not_configured', 'The assistant is off in this build');
    const transport = deps.getTransport();
    if (!transport) throw new AppError('not_configured', 'Firebase is not configured in this build');
    let raw: unknown;
    try {
      raw = await transport.call(name, request, { timeoutMs });
    } catch (error) {
      const mapped = mapMatterError(error);
      log.warn('matters call failed', { name, code: mapped.code });
      throw mapped;
    }
    const parsed = parse(raw);
    if (!parsed.success) throw new AppError('upstream_error', `invalid ${name} response`);
    return parsed.data;
  }

  function validated<S extends { safeParse(value: unknown): { success: boolean } }>(schema: S, value: unknown): unknown {
    if (!schema.safeParse(value).success) throw new AppError('invalid_input', 'invalid matter request');
    return value;
  }

  return {
    isEnabled: () => deps.enabled(),
    draft: async (input) =>
      call(CALLABLES.matterDraft, validated(matterDraftRequestSchema, { ...input, text: input.text.trim() }), (raw) => matterDraftResponseSchema.safeParse(raw)),
    revise: async (matterId, answer) =>
      call(CALLABLES.matterRevise, validated(matterReviseRequestSchema, { matterId, answer: answer.trim() }), (raw) => matterDraftResponseSchema.safeParse(raw)),
    confirm: async (matterId, draftHash) =>
      call(CALLABLES.matterConfirm, validated(matterConfirmRequestSchema, { matterId, draftHash }), (raw) => matterConfirmResponseSchema.safeParse(raw)),
    cancel: async (matterId) => call(CALLABLES.matterCancel, validated(matterCancelRequestSchema, { matterId }), (raw) => matterCancelResponseSchema.safeParse(raw)),
    decide: async (request) => call(CALLABLES.matterDecide, validated(matterDecideRequestSchema, request), (raw) => matterDecideResponseSchema.safeParse(raw)),
    listOpen: async () => (await call(CALLABLES.matterView, {}, (raw) => matterViewResponseSchema.safeParse(raw))).matters ?? [],
    getPage: async (matterId) =>
      (await call(CALLABLES.matterView, validated(matterViewRequestSchema, { matterId }), (raw) => matterViewResponseSchema.safeParse(raw))).page,
    setStatus: async (matterId, action) =>
      call(CALLABLES.matterSetStatus, validated(matterSetStatusRequestSchema, { matterId, action }), (raw) => matterSetStatusResponseSchema.safeParse(raw)),
    change: async (matterId, text) =>
      call(CALLABLES.matterChange, validated(matterChangeRequestSchema, { matterId, text: text.trim() }), (raw) => matterDraftResponseSchema.safeParse(raw)),
    confirmChange: async (matterId, draftHash) =>
      call(CALLABLES.matterChange, validated(matterChangeRequestSchema, { matterId, draftHash }), (raw) => matterDraftResponseSchema.safeParse(raw)),
    ask: async (input) =>
      call(CALLABLES.matterAsk, validated(matterAskRequestSchema, { ...input, text: input.text.trim() }), (raw) => matterAskResponseSchema.safeParse(raw)),
    speak: async (input) =>
      call(CALLABLES.matterSpeak, validated(matterSpeakRequestSchema, { ...input, text: input.text.trim() }), (raw) => matterSpeakResponseSchema.safeParse(raw)),
    message: async (matterId, text) =>
      call(CALLABLES.matterMessage, validated(matterMessageRequestSchema, { matterId, text: text.trim() }), (raw) => matterMessageResponseSchema.safeParse(raw)),
    readNewTime: async (matterId, text) =>
      call(CALLABLES.matterMove, validated(matterMoveRequestSchema, { matterId, text: text.trim() }), (raw) => matterMoveResponseSchema.safeParse(raw)),
    moveMeeting: async (matterId, start) =>
      call(CALLABLES.matterMove, validated(matterMoveRequestSchema, { matterId, start }), (raw) => matterMoveResponseSchema.safeParse(raw)),
    remove: async (matterId) => call(CALLABLES.matterDelete, validated(matterDeleteRequestSchema, { matterId }), (raw) => matterDeleteResponseSchema.safeParse(raw)),
    usage: async () => call(CALLABLES.matterUsage, {}, (raw) => matterUsageResponseSchema.safeParse(raw)),
    mailboxStatus: async () => call(CALLABLES.matterMailbox, { action: 'status' }, (raw) => matterMailboxResponseSchema.safeParse(raw)),
    mailboxConnectLink: async (language) =>
      call(CALLABLES.matterMailbox, validated(matterMailboxRequestSchema, { action: 'connect', language }), (raw) => matterMailboxResponseSchema.safeParse(raw)),
    mailboxDisconnect: async () => call(CALLABLES.matterMailbox, { action: 'disconnect' }, (raw) => matterMailboxResponseSchema.safeParse(raw)),
    sendFrom: async (matterId, mailbox) =>
      call(CALLABLES.matterMailbox, validated(matterMailboxRequestSchema, { action: 'sendFrom', matterId, mailbox }), (raw) => matterMailboxResponseSchema.safeParse(raw)),
    watchList: async () => call(CALLABLES.matterWatch, { action: 'list' }, (raw) => matterWatchResponseSchema.safeParse(raw)),
    watchDraft: async (watchId, language, timeZone) =>
      call(CALLABLES.matterWatch, validated(matterWatchRequestSchema, { action: 'draft', watchId, language, timeZone }), (raw) => matterWatchResponseSchema.safeParse(raw)),
    watchDismiss: async (watchId) =>
      call(CALLABLES.matterWatch, validated(matterWatchRequestSchema, { action: 'dismiss', watchId }), (raw) => matterWatchResponseSchema.safeParse(raw)),
    settings: async () => call(CALLABLES.matterSettings, { action: 'get' }, (raw) => matterSettingsResponseSchema.safeParse(raw)),
    saveSettings: async (prefs, timeZone, applyToOpen = false) =>
      call(
        CALLABLES.matterSettings,
        validated(matterSettingsRequestSchema, { action: 'save', prefs, timeZone, ...(applyToOpen ? { applyToOpen: true } : {}) }),
        (raw) => matterSettingsResponseSchema.safeParse(raw),
      ),
    giveConsent: async (version, timeZone) =>
      call(CALLABLES.matterSettings, validated(matterSettingsRequestSchema, { action: 'consent', version, timeZone }), (raw) => matterSettingsResponseSchema.safeParse(raw)),
    digest: async (language, timeZone) => call(CALLABLES.matterDigest, validated(matterDigestRequestSchema, { language, timeZone }), (raw) => matterDigestResponseSchema.safeParse(raw)),
    streamAsk: async (input, onText) => {
      const done = await streamCall({ kind: 'ask', ...input, text: input.text.trim() }, onText);
      if (!done.ask) throw new AppError('upstream_error', 'invalid matterStream answer');
      return { ask: done.ask, briefing: done.briefing ?? null };
    },
    streamBriefing: async (input, onText) => {
      const done = await streamCall({ kind: 'briefing', ...input, ...(input.text ? { text: input.text.trim() } : {}) }, onText);
      if (!done.briefing) throw new AppError('upstream_error', 'invalid matterStream answer');
      return done.briefing;
    },
  };

  /** One streamed call: text pieces to onText; the done line resolves; an error line rejects like a callable. */
  async function streamCall(request: unknown, onText: (piece: string) => void): Promise<Extract<MatterStreamLine, { t: 'done' }>> {
    if (!deps.enabled()) throw new AppError('not_configured', 'The assistant is off in this build');
    if (!matterStreamRequestSchema.safeParse(request).success) throw new AppError('invalid_input', 'invalid matter request');
    const stream = deps.getStream?.() ?? null;
    if (!stream) throw new AppError('not_configured', 'The streamed answers are not available.', { details: { stream: 'unavailable' } });
    let done: Extract<MatterStreamLine, { t: 'done' }> | null = null;
    let failed: Extract<MatterStreamLine, { t: 'error' }> | null = null;
    await stream.open(request, (line) => {
      if (line.t === 'text') onText(line.v);
      else if (line.t === 'done') done = line;
      else failed = line;
    });
    if (failed) throw mapMatterError({ details: { reason: (failed as { reason: string }).reason, ...((failed as { limit?: string }).limit ? { limit: (failed as { limit?: string }).limit } : {}) } });
    if (!done) throw new AppError('upstream_error', 'The streamed answer ended early.');
    return done;
  }
}

interface WebBrowserLike {
  openAuthSessionAsync?: (url: string, redirectUrl: string) => Promise<{ type: string }>;
  openBrowserAsync?: (url: string) => Promise<unknown>;
}

/**
 * A4 part 2: opens the server's Microsoft sign-in link and resolves when the browser is back
 * (the server's page sends it to MATTER_MAILBOX_RETURN_URL). The screen then asks for the status:
 * only the server knows whether the mailbox got connected. Never logs the link.
 */
export async function openMailboxSignIn(authUrl: string): Promise<void> {
  let browser: WebBrowserLike | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- optional native dependency, loaded lazily
    browser = require('expo-web-browser') as WebBrowserLike;
  } catch {
    browser = null;
  }
  if (browser?.openAuthSessionAsync) {
    await browser.openAuthSessionAsync(authUrl, MATTER_MAILBOX_RETURN_URL);
    return;
  }
  if (browser?.openBrowserAsync) {
    await browser.openBrowserAsync(authUrl);
    return;
  }
  log.warn('expo-web-browser is not available; the mailbox sign-in cannot open');
  throw new AppError('unsupported', 'The browser could not be opened.');
}

/** The real transport: httpsCallable on the shared Functions instance. */
function firebaseTransport(): MatterTransport | null {
  const instance = functions;
  if (!instance) return null;
  return {
    async call(name, request, options) {
      const callable = httpsCallable(instance, name, { timeout: options.timeoutMs });
      return (await callable(request)).data;
    },
  };
}

/** A5: matterStream over expo/fetch (a body read as it arrives), with the signed-in user's ID token. */
function firebaseStream(): StreamTransport | null {
  const instance = functions;
  if (!instance) return null;
  return createHttpStreamTransport({
    url: () => streamUrl(env.functionsRegion, instance.app.options.projectId),
    token: async () => (await auth?.currentUser?.getIdToken()) ?? null,
    fetch: (url, init) => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded on first use: the streaming fetch of Expo
      const expoFetch = (require('expo/fetch') as { fetch: FetchLike }).fetch;
      return expoFetch(url, init);
    },
  });
}

export const matterService: MatterService = createMatterService({
  getTransport: firebaseTransport,
  enabled: () => env.mattersEnabled,
  getStream: firebaseStream,
});
