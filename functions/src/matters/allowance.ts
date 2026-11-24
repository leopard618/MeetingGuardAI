/**
 * A4: the monthly allowance of the Assistant plan and the usage meter (docs/v2/A4-THREAT-MODEL.md,
 * "cost abuse"; the numbers: MATTER_ALLOWANCES in the contract, MATTERS_MONTHLY_* on the server).
 *
 * Counted per UTC calendar month on usage/{uid}/months/{yyyy-mm} (server only; deleteAccount's
 * recursive delete of usage/{uid} removes it):
 * - matters: one when a matter's first email goes out (handlers.ts matterConfirm);
 * - emails: every email the assistant sends; replies, follow-ups and confirmations through
 *   claimSend, together with the day's send cap in one transaction; the first email with its matter;
 * - voiceSeconds: the natural voice (matterSpeak), from the characters spoken.
 * The device's own voice costs nothing and is not counted. A8 moves the month to the
 * subscription's anniversary; until then it is the calendar month.
 */
import {
  matterUsageRequestSchema,
  usageDayKey,
  type MatterUsageResponse,
} from '../shared/aiContract';
import { spendAllows } from './cost';
import { matterError, readable, requireCaller, type MatterCaller, type MatterDeps } from './handlers';
import { monthKeyOf, nextMonthIso } from './model';

/** The default MATTERS_USER_DAILY_SENDS (replies.ts DEFAULT_DAILY_SENDS). */
const DEFAULT_DAILY_SENDS = 30;

/**
 * Claims one assistant email: the day's send cap and (when metered) the month's emails, in one
 * transaction. 'daily' or 'monthly' = not claimed (nothing counted).
 */
export async function claimSend(deps: MatterDeps, uid: string, now: Date): Promise<'ok' | 'daily' | 'monthly'> {
  return deps.store.consumeSend(uid, usageDayKey(now), deps.dailySendLimit ?? DEFAULT_DAILY_SENDS, monthKeyOf(now), deps.monthly?.emails ?? null, now.toISOString());
}

/** Claims `seconds` of natural voice on the month's allowance; false = over it (nothing counted). */
export async function claimVoice(deps: MatterDeps, uid: string, now: Date, seconds: number): Promise<boolean> {
  if (!deps.monthly) return true;
  const over = await deps.store.consumeMonthly(uid, monthKeyOf(now), { voiceSeconds: seconds }, { voiceSeconds: deps.monthly.voiceMinutes * 60 }, now.toISOString());
  return over === null;
}

/** matterUsage: the usage meter (the month's allowance and today's limits). */
export function handleMatterUsage(callerIn: MatterCaller | null, data: unknown, deps: MatterDeps): Promise<MatterUsageResponse> {
  return readable(async () => {
    const caller = requireCaller(callerIn, deps);
    if (!matterUsageRequestSchema.safeParse(data ?? {}).success) throw matterError('invalid_request');
    const now = deps.now();
    const month = monthKeyOf(now);
    const [used, today, allows] = await Promise.all([deps.store.getMonthly(caller.uid, month), deps.store.getDaily(caller.uid, usageDayKey(now)), spendAllows(deps, caller.uid)]);
    const limits = deps.monthly ?? { matters: 0, emails: 0, voiceMinutes: 0 };
    return {
      month,
      resetsAt: nextMonthIso(now),
      matters: { used: used.matters, limit: limits.matters },
      emails: { used: used.emails, limit: limits.emails },
      voiceMinutes: { used: Math.ceil(used.voiceSeconds / 60), limit: limits.voiceMinutes },
      today: {
        drafts: { used: today.drafts, limit: deps.dailyLimit },
        sends: { used: today.sends, limit: deps.dailySendLimit ?? DEFAULT_DAILY_SENDS },
        capReached: !allows,
      },
    };
  });
}
