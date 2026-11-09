/**
 * Deploy-time parameters, secrets and tuning constants.
 *
 * - Secrets (OPENAI_API_KEY) live in Cloud Secret Manager: `firebase functions:secrets:set OPENAI_API_KEY`.
 *   `.value()` may only be read inside a function invocation.
 * - String params come from `functions/.env.<projectId>`. The defaults below are only what the CLI
 *   offers: without that file an interactive `firebase deploy` asks for every param and a
 *   non-interactive deploy (CI) fails, so create the file once per project (functions/README.md,
 *   docs/v1/SETUP.md §6.3).
 */
import { defineBoolean, defineInt, defineSecret, defineString } from 'firebase-functions/params';

import { DEFAULT_CALLABLE_REGION } from './shared/aiContract';

/** Region of every callable. Must equal EXPO_PUBLIC_FUNCTIONS_REGION in the app. */
export const FUNCTIONS_REGION = defineString('FUNCTIONS_REGION', {
  default: DEFAULT_CALLABLE_REGION,
  description: 'Cloud Functions region for the callables. Must match EXPO_PUBLIC_FUNCTIONS_REGION in the app.',
});

/** OpenAI chat model used by the assistant (tool calling + strict schemas required). */
export const OPENAI_MODEL = defineString('OPENAI_MODEL', {
  default: 'gpt-5.4-mini',
  description: 'OpenAI model for the assistant callable (must support tool calling with strict schemas).',
});

/**
 * `reasoning_effort` sent to the model. "omit" sends nothing (use it for non-reasoning models such
 * as gpt-4.1-mini, which reject the parameter).
 */
export const OPENAI_REASONING_EFFORT = defineString('OPENAI_REASONING_EFFORT', {
  default: 'low',
  description: 'reasoning_effort for the assistant model: omit | none | minimal | low | medium | high.',
});

/**
 * Project-wide cap on assistant requests per UTC day that reach OpenAI (spend safeguard on top of
 * the per-user plan quota). 0 disables it. Keep an OpenAI usage limit / GCP budget alert as well.
 */
export const ASSISTANT_GLOBAL_DAILY_LIMIT = defineInt('ASSISTANT_GLOBAL_DAILY_LIMIT', {
  default: 5000,
  description: 'Maximum assistant requests per UTC day for the whole project (0 = no cap).',
});

/** OpenAI API key (Secret Manager). Never logged, never returned. */
export const OPENAI_API_KEY = defineSecret('OPENAI_API_KEY');

/**
 * Azure "Application (client) ID" of the Meeting Guard AI registration (docs/v1/SETUP.md §10).
 * Empty = Sign in with Microsoft disabled (the callable answers failed-precondition).
 */
export const MICROSOFT_CLIENT_ID = defineString('MICROSOFT_CLIENT_ID', {
  default: '',
  description: 'Azure app registration client id for Sign in with Microsoft (empty disables it). Must equal EXPO_PUBLIC_MSAL_CLIENT_ID in the app.',
});

/** Accepted tenant: common | organizations | consumers | a tenant GUID. Must equal EXPO_PUBLIC_MSAL_TENANT in the app. */
export const MICROSOFT_TENANT = defineString('MICROSOFT_TENANT', {
  default: 'common',
  description: 'Microsoft tenant accepted by Sign in with Microsoft: common | organizations | consumers | a tenant GUID. Must equal EXPO_PUBLIC_MSAL_TENANT in the app.',
});

/**
 * OpenAI pricing for the admin dashboard's estimated-cost tile, in USD per MILLION tokens
 * (numeric strings; defineString because params have no float type). "0" on either side of the
 * pair that a token kind needs means "pricing not configured": adminGetStats then returns
 * estCostUsd: null and the dashboard hides the cost tile. Display-only: nothing is enforced
 * from these values. Update them when the model (OPENAI_MODEL) or its price changes.
 */
export const OPENAI_PRICE_IN_PER_M = defineString('OPENAI_PRICE_IN_PER_M', {
  default: '0',
  description: 'OpenAI input price in USD per 1M tokens (admin cost estimate; 0 hides the estimate).',
});

export const OPENAI_PRICE_OUT_PER_M = defineString('OPENAI_PRICE_OUT_PER_M', {
  default: '0',
  description: 'OpenAI output price in USD per 1M tokens (admin cost estimate; 0 hides the estimate).',
});

/** Parses a price param: a finite number >= 0, else 0 ("not configured"). */
export function parsePricePerM(value: string): number {
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

export const ASSISTANT_TUNING = {
  /** Function timeout (the app's callable timeout is ASSISTANT_CALL_TIMEOUT_MS = 70 s). */
  functionTimeoutSeconds: 60,
  /** Per-attempt OpenAI HTTP timeout. */
  openAiRequestTimeoutMs: 45_000,
  /** Hard stop for the whole OpenAI call including the retry, so the function never hits 60 s. */
  openAiDeadlineMs: 50_000,
  /** One retry only helps with fast failures (429 / 5xx); the deadline caps slow ones. */
  openAiMaxRetries: 1,
  /** Upper bound for reasoning + visible output tokens. */
  maxCompletionTokens: 3_000,
  /**
   * The handler mostly waits on OpenAI, so one instance serves many requests: 1 vCPU (needed for
   * concurrency > 1; 256 MiB would default to 0.167 vCPU and concurrency 1). Context loading is
   * byte-bounded (CONTEXT_WINDOW), and 20 concurrent requests per 512 MiB leave headroom.
   */
  memory: '512MiB',
  cpu: 1,
  concurrency: 20,
  maxInstances: 20,
} as const;

/** Meetings the assistant sees: [-7 d, +60 d] around now, at most 200 (closest to now first). */
export const CONTEXT_WINDOW = {
  pastDays: 7,
  futureDays: 60,
  maxMeetings: 200,
  /** v5: open tasks + recently completed ones the assistant sees (tasksContext.ts). */
  maxTasks: 100,
  /** Firestore read cap before filtering tombstones. */
  queryLimit: 400,
  maxTitleChars: 120,
  maxAddressChars: 160,
  maxParticipantsListed: 10,
  maxParticipantNameChars: 80,
  maxParticipantEmailChars: 254,
  /** Description is only sent for the follow-up meeting. */
  maxFollowUpDescriptionChars: 1_000,
  /** Agenda text sent for ordinary meetings, so "what should I prepare?" has something real. */
  maxPreparationChars: 300,
  /** Cancelled or moved occurrences listed per series (a series may carry up to 200). */
  maxOccurrenceExceptions: 8,
  /**
   * Load budget (serialized characters of the field-masked documents). A normal meeting is well
   * under 4 KB, so 400 meetings fit; oversized (abusive) documents are skipped, and reading stops
   * at the total.
   */
  maxDocumentBytes: 64 * 1024,
  maxContextBytes: 2 * 1024 * 1024,
} as const;

// ---------------------------------------------------------------------------------------------
// Zoom auto links (zoom* callables; docs/v1/ARCHITECTURE.md §24, docs/v1/SETUP.md §12)
// ---------------------------------------------------------------------------------------------

/**
 * Master switch of the Zoom integration. NON-SECRET on purpose: `zoomStatus` answers from this
 * param alone, so it deploys and runs while the ZOOM_* secrets do not exist yet. It also gates
 * the DEPLOYMENT of the three write callables (functions/src/zoom/index.ts reads the matching
 * process.env value at load time): with the default `false`, `firebase deploy --only functions`
 * never touches the secrets and cannot fail on them. Owner order (docs/v1/SETUP.md §12): set the
 * three secrets FIRST, then put ZOOM_ENABLED=true in functions/.env.<projectId>, then deploy.
 */
export const ZOOM_ENABLED = defineBoolean('ZOOM_ENABLED', {
  default: false,
  description: 'Enables the Zoom integration. Set the ZOOM_* secrets BEFORE setting this to true (SETUP 12).',
});

/** Per-user cap on Zoom meetings CREATED per UTC day (abuse guard; `usage/{uid}/days/{day}.zoomCreates`). */
export const ZOOM_USER_DAILY_LIMIT = defineInt('ZOOM_USER_DAILY_LIMIT', {
  default: 30,
  description: 'Maximum Zoom meetings one user may create per UTC day.',
});

/**
 * Zoom Server-to-Server OAuth app credentials (Secret Manager; docs/v1/SETUP.md §12). Bound ONLY to
 * the zoom write callables - no other function may reference them, or a deploy without them
 * breaks the whole project.
 */
export const ZOOM_ACCOUNT_ID = defineSecret('ZOOM_ACCOUNT_ID');
export const ZOOM_CLIENT_ID = defineSecret('ZOOM_CLIENT_ID');
export const ZOOM_CLIENT_SECRET = defineSecret('ZOOM_CLIENT_SECRET');

export const ZOOM_TUNING = {
  /** The app's client-side timeout is ZOOM_CALL_TIMEOUT_MS = 20 s (shared/aiContract.ts). */
  functionTimeoutSeconds: 20,
  /** Per-request timeout against zoom.us / api.zoom.us (token mint and REST call each). */
  zoomRequestTimeoutMs: 10_000,
  /** Refresh the cached S2S token this many seconds before Zoom's expires_in. */
  tokenSafetyWindowSeconds: 60,
  /** Multiplier on ZOOM_USER_DAILY_LIMIT for the cheap sync/delete operations (`zoomOps`). */
  opsLimitMultiplier: 10,
  memory: '256MiB',
  maxInstances: 10,
} as const;

// ---------------------------------------------------------------------------------------------
// WhatsApp bot (whatsappWebhook + whatsapp* callables; docs/v1/ARCHITECTURE.md §27, docs/v1/SETUP.md §14)
// ---------------------------------------------------------------------------------------------

/**
 * Master switch of the WhatsApp bot. NON-SECRET on purpose, exactly like ZOOM_ENABLED: the
 * whatsapp* callables answer from this param alone, so they deploy and run while the WHATSAPP_*
 * secrets do not exist yet. It also gates the DEPLOYMENT of the webhook
 * (functions/src/whatsapp/index.ts reads the matching process.env value at load time): with the
 * default `false`, `firebase deploy --only functions` never touches the secrets and cannot fail
 * on them. Owner order (docs/v1/SETUP.md §14): set the three secrets FIRST, then put
 * WHATSAPP_ENABLED=true in functions/.env.<projectId>, then deploy.
 */
export const WHATSAPP_ENABLED = defineBoolean('WHATSAPP_ENABLED', {
  default: false,
  description: 'Enables the WhatsApp bot. Set the WHATSAPP_* secrets BEFORE setting this to true (SETUP 14).',
});

/**
 * Cloud API sender: the phone_number_id of the Meta phone number the bot sends FROM (test number
 * during development; the client's own number after go-live - swapping these two values plus the
 * access token is the whole migration, docs/v1/SETUP.md §14).
 */
export const WHATSAPP_PHONE_NUMBER_ID = defineString('WHATSAPP_PHONE_NUMBER_ID', {
  default: '',
  description: 'WhatsApp Cloud API phone_number_id the bot sends from (Meta > WhatsApp > API Setup).',
});

/** The bot number as users dial it: E.164 DIGITS ONLY (no +). Shown in-app and used for wa.me links. */
export const WHATSAPP_DISPLAY_NUMBER = defineString('WHATSAPP_DISPLAY_NUMBER', {
  default: '',
  description: 'Human-readable bot number, digits only (for the in-app wa.me deep link).',
});

/**
 * Per-PHONE cap on inbound WhatsApp messages processed per UTC day (counted on
 * whatsappSessions/{phone}.counts). On top of AI_ALLOWANCES, which caps only paid LLM
 * calls per uid: this bounds Graph sends and Firestore work from non-assistant traffic
 * (unlinked spam, repeated buttons, code guessing), and it is keyed by phone so unlinked
 * abusers are bounded too. Over the cap: one bilingual notice, then silent drop.
 */
export const WHATSAPP_USER_DAILY_LIMIT = defineInt('WHATSAPP_USER_DAILY_LIMIT', {
  default: 50,
  description: 'Maximum inbound WhatsApp messages processed per phone number per UTC day.',
});

/** WhatsApp Cloud API credentials (Secret Manager; docs/v1/SETUP.md §14). Bound ONLY on whatsappWebhook. */
export const WHATSAPP_ACCESS_TOKEN = defineSecret('WHATSAPP_ACCESS_TOKEN');
export const WHATSAPP_APP_SECRET = defineSecret('WHATSAPP_APP_SECRET');
export const WHATSAPP_VERIFY_TOKEN = defineSecret('WHATSAPP_VERIFY_TOKEN');

export const WHATSAPP_TUNING = {
  /**
   * The webhook processes inline (no task queue); the assistant deadline is 50 s (§27). The
   * budget covers a WHOLE Meta batch (several assistant-bound messages in one POST), so a slow
   * batch is never killed mid-message after the dedupe claim: Meta gets its answer late (it may
   * retry meanwhile; dedupe absorbs that) but every claimed message finishes and gets its reply.
   */
  functionTimeoutSeconds: 300,
  /**
   * processWebhookPayload stops claiming FURTHER messages of a batch once this much of the
   * budget is spent (the remainder is answered 500 so Meta redelivers it; processed wamids are
   * absorbed by dedupe). Leaves one worst-case message (50 s assistant + sends) of headroom.
   */
  inlineBudgetMs: 240_000,
  /** Same reasoning as ASSISTANT_TUNING: mostly waiting on OpenAI / Graph. */
  memory: '512MiB',
  cpu: 1,
  concurrency: 10,
  maxInstances: 5,
  /** Graph API version for https://graph.facebook.com/<version>/<phone_number_id>/messages. */
  graphVersion: 'v21.0',
  /** Per-request timeout against graph.facebook.com. */
  graphRequestTimeoutMs: 10_000,
  /** Idle conversation context: turns reset after this much silence (counts are kept). */
  sessionTtlMinutes: 15,
  /** Proposed actions expire this long after the confirm prompt. */
  actionsTtlMinutes: 15,
  /** Link codes expire this long after whatsappLinkStart mints them. */
  codeTtlMinutes: 10,
  /** Max link codes one uid may mint per UTC day. */
  codesPerUidPerDay: 5,
  /** Stored conversation turns per session (oldest dropped first). */
  maxTurns: 10,
  /** "Link your account" replies per unlinked phone per UTC day (then silent drop). */
  unlinkedRepliesPerDay: 3,
  /**
   * Failed link-code redemptions (invalid or expired) per phone per UTC day; past the cap the
   * webhook stops even TRYING to redeem (silent drop). This is the hard ceiling on brute-forcing
   * the 6-digit code space, independent of the general inbound cap.
   */
  codeFailuresPerPhonePerDay: 10,
  /** Webhook dedupe markers (whatsappEvents) are purged this many days after creation. */
  eventTtlDays: 7,
  /** Sessions idle longer than this are purged by dailyMaintenance. */
  sessionPurgeDays: 30,
} as const;

export const REASONING_EFFORTS = ['none', 'minimal', 'low', 'medium', 'high'] as const;
export type ReasoningEffortSetting = (typeof REASONING_EFFORTS)[number];

/** Parses the OPENAI_REASONING_EFFORT param; null = do not send the parameter. */
export function parseReasoningEffort(value: string): ReasoningEffortSetting | null {
  const normalized = value.trim().toLowerCase();
  return (REASONING_EFFORTS as readonly string[]).includes(normalized) ? (normalized as ReasoningEffortSetting) : null;
}
