/**
 * A4: what the assistant costs per user and the day's spending cap (docs/v2/A4-THREAT-MODEL.md,
 * "cost abuse"). Pure apart from the store port; no Firebase import.
 *
 * Every model call of a matter (draft, revise, change, ask, write, move, the read of a reply)
 * first checks the user's spend of the UTC day against MATTERS_USER_DAILY_SPEND_CENTS
 * (checkSpend, inside acquireGlobalBudget), and afterwards adds its tokens, priced, to
 * matterSpend/{day}_{uid} (addModelSpend, inside recordUsage). The natural voice adds its
 * characters (addSpeechSpend). Emails are capped by count (the daily send cap and the monthly
 * allowance), not by this cap.
 *
 * Prices: OPENAI_PRICE_IN_PER_M / OPENAI_PRICE_OUT_PER_M when set, else FALLBACK_PRICES, which are
 * deliberately on the high side so the cap errs towards stopping early.
 */
import { usageDayKey } from '../shared/aiContract';
import type { MatterStore } from './store';

/** USD per million tokens when the price params are 0 (unknown). */
export const FALLBACK_PRICES = { inPerM: 1, outPerM: 6 } as const;

/** Speech and email rates (USD); the natural voice is priced per minute of speech. */
export const COST_RATES = { emailUsd: 0.0015, speechUsdPerMinute: 0.015, speechCharsPerMinute: 900 } as const;

export type Prices = { inPerM: number; outPerM: number };

/** The prices the cap uses: the configured ones when both are set, else the fallback. */
export function capPrices(prices: Prices | undefined): Prices {
  return prices && prices.inPerM > 0 && prices.outPerM > 0 ? prices : FALLBACK_PRICES;
}

/** One model call's cost in micro-dollars (rounded up). */
export function modelCostMicros(tokens: { promptTokens: number; completionTokens: number } | null, prices: Prices | undefined): number {
  if (!tokens) return 0;
  const p = capPrices(prices);
  return Math.ceil(tokens.promptTokens * p.inPerM + tokens.completionTokens * p.outPerM);
}

/** Speaking `chars` characters in the natural voice, in micro-dollars (rounded up). */
export function speechCostMicros(chars: number): number {
  return Math.ceil((chars / COST_RATES.speechCharsPerMinute) * COST_RATES.speechUsdPerMinute * 1_000_000);
}

/** Seconds of speech for `chars` characters (the monthly voice allowance; at least 1). */
export function speechSeconds(chars: number): number {
  return Math.max(1, Math.ceil((chars / COST_RATES.speechCharsPerMinute) * 60));
}

/** The user's spend of the day reached MATTERS_USER_DAILY_SPEND_CENTS: no model call. */
export class SpendCapReachedError extends Error {
  constructor() {
    super("Today's assistant spending cap for this user is reached.");
    this.name = 'SpendCapReachedError';
  }
}

export interface SpendDeps {
  store: MatterStore;
  now: () => Date;
  /** MATTERS_USER_DAILY_SPEND_CENTS; absent = no cap. */
  spendCapCents?: number;
  prices?: Prices;
}

/** Whether the user may still spend today (always true without a cap). */
export async function spendAllows(deps: SpendDeps, uid: string): Promise<boolean> {
  if (deps.spendCapCents === undefined) return true;
  const spent = await deps.store.getSpend(uid, usageDayKey(deps.now()));
  return spent < Math.max(0, deps.spendCapCents) * 10_000;
}

/** Throws SpendCapReachedError when the user's cap of the day is reached. */
export async function checkSpend(deps: SpendDeps, uid: string): Promise<void> {
  if (!(await spendAllows(deps, uid))) throw new SpendCapReachedError();
}

/** Adds one model call to the user's spend of the day. */
export async function addModelSpend(deps: SpendDeps, uid: string, tokens: { promptTokens: number; completionTokens: number } | null): Promise<void> {
  const now = deps.now();
  await deps.store.addSpend(
    uid,
    usageDayKey(now),
    { micros: modelCostMicros(tokens, deps.prices), modelCalls: 1, inputTokens: tokens?.promptTokens ?? 0, outputTokens: tokens?.completionTokens ?? 0 },
    now.toISOString(),
  );
}

/** Adds one natural-voice answer to the user's spend of the day. */
export async function addSpeechSpend(deps: SpendDeps, uid: string, chars: number): Promise<void> {
  const now = deps.now();
  await deps.store.addSpend(uid, usageDayKey(now), { micros: speechCostMicros(chars), speechChars: chars }, now.toISOString());
}
