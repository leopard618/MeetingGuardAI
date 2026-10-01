/**
 * Deploy-time parameters, secrets and tuning constants.
 *
 * - Secrets (OPENAI_API_KEY) live in Cloud Secret Manager: `firebase functions:secrets:set OPENAI_API_KEY`.
 *   `.value()` may only be read inside a function invocation.
 * - String params come from `functions/.env.<projectId>`. The defaults below are only what the CLI
 *   offers: without that file an interactive `firebase deploy` asks for every param and a
 *   non-interactive deploy (CI) fails, so create the file once per project (functions/README.md,
 *   docs/SETUP.md §6.3).
 */
import { defineInt, defineSecret, defineString } from 'firebase-functions/params';

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
  /** Firestore read cap before filtering tombstones. */
  queryLimit: 400,
  maxTitleChars: 120,
  maxAddressChars: 160,
  maxParticipantsListed: 10,
  maxParticipantNameChars: 80,
  maxParticipantEmailChars: 254,
  /** Description is only sent for the follow-up meeting. */
  maxFollowUpDescriptionChars: 1_000,
  /**
   * Load budget (serialized characters of the field-masked documents). A normal meeting is well
   * under 4 KB, so 400 meetings fit; oversized (abusive) documents are skipped, and reading stops
   * at the total.
   */
  maxDocumentBytes: 64 * 1024,
  maxContextBytes: 2 * 1024 * 1024,
} as const;

export const REASONING_EFFORTS = ['none', 'minimal', 'low', 'medium', 'high'] as const;
export type ReasoningEffortSetting = (typeof REASONING_EFFORTS)[number];

/** Parses the OPENAI_REASONING_EFFORT param; null = do not send the parameter. */
export function parseReasoningEffort(value: string): ReasoningEffortSetting | null {
  const normalized = value.trim().toLowerCase();
  return (REASONING_EFFORTS as readonly string[]).includes(normalized) ? (normalized as ReasoningEffortSetting) : null;
}
