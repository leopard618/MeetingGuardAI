/**
 * `assistant` callable (Cloud Functions v2).
 *
 * App Check: `enforceAppCheck` is false because the Firebase JS SDK used by the app has no device
 * attestation provider on React Native. To enforce it, add App Check to the app with
 * @react-native-firebase/app-check (Play Integrity / App Attest), register the apps in the
 * Firebase console, then set `enforceAppCheck: true` here and on `deleteAccount` and redeploy.
 */
import * as logger from 'firebase-functions/logger';
import { onCall } from 'firebase-functions/https';
import { FieldValue } from 'firebase-admin/firestore';

import {
  ASSISTANT_GLOBAL_DAILY_LIMIT,
  ASSISTANT_TUNING,
  FUNCTIONS_REGION,
  OPENAI_API_KEY,
  OPENAI_MODEL,
  OPENAI_REASONING_EFFORT,
  parseReasoningEffort,
} from '../config';
import { AI_STATS_SHARD_COUNT, adminStatsAiShardPath } from '../admin/schemas';
import { adminDb } from '../firebase';
import { instanceOpenAiKeyProvider, withKeyRetry } from '../openaiKey';
import type { AssistantResponse } from '../shared/aiContract';
import { firestoreMeetingReader } from './context';
import { createGlobalBudget, firestoreGlobalBudgetStore, type GlobalBudget } from './globalBudget';
import { handleAssistant, type AssistantCaller } from './handler';
import { createOpenAiClient } from './llm';
import { firestoreQuotaStore } from './quota';

/** One per instance (its short cache is what keeps the check cheap). */
let globalBudget: GlobalBudget | null = null;
function instanceGlobalBudget(): GlobalBudget {
  if (!globalBudget) {
    globalBudget = createGlobalBudget(firestoreGlobalBudgetStore(adminDb()), {
      limit: () => ASSISTANT_GLOBAL_DAILY_LIMIT.value(),
    });
  }
  return globalBudget;
}

function callerOf(auth: { uid: string; token: Record<string, unknown> } | undefined): AssistantCaller | null {
  if (!auth) return null;
  const firebaseClaims = auth.token.firebase as { sign_in_provider?: unknown } | undefined;
  return {
    uid: auth.uid,
    emailVerified: auth.token.email_verified === true,
    signInProvider: typeof firebaseClaims?.sign_in_provider === 'string' ? firebaseClaims.sign_in_provider : null,
  };
}

export const assistant = onCall(
  {
    region: FUNCTIONS_REGION,
    secrets: [OPENAI_API_KEY],
    enforceAppCheck: false,
    timeoutSeconds: ASSISTANT_TUNING.functionTimeoutSeconds,
    memory: ASSISTANT_TUNING.memory,
    cpu: ASSISTANT_TUNING.cpu,
    concurrency: ASSISTANT_TUNING.concurrency,
    maxInstances: ASSISTANT_TUNING.maxInstances,
  },
  async (request): Promise<AssistantResponse> => {
    const db = adminDb();
    const caller = callerOf(request.auth);
    const uid = caller?.uid ?? null;
    return handleAssistant(caller, request.data, {
      quota: firestoreQuotaStore(db),
      globalBudget: instanceGlobalBudget(),
      meetings: firestoreMeetingReader(db, (count, truncated) =>
        logger.warn('assistant.meetings_skipped', { uid, count, truncated }),
      ),
      llm: () => {
        const effortSetting = OPENAI_REASONING_EFFORT.value();
        const reasoningEffort = parseReasoningEffort(effortSetting);
        if (reasoningEffort === null && effortSetting.trim().toLowerCase() !== 'omit') {
          logger.warn('assistant.reasoning_effort_ignored', { value: effortSetting });
        }
        const model = OPENAI_MODEL.value();
        // The key comes from the runtime provider (Secret Manager REST with a 5-minute cache;
        // env-bound OPENAI_API_KEY as fallback). On an OpenAI 401 - the key was rotated from the
        // admin dashboard by another instance - the wrapper refetches once and retries once.
        return withKeyRetry(instanceOpenAiKeyProvider(), (apiKey) => createOpenAiClient({ apiKey, model, reasoningEffort }));
      },
      // Admin v2 stats: one merge-set with atomic increments (never a transaction; the handler
      // isolates failures so this write can never fail the user's request). Sharded over
      // AI_STATS_SHARD_COUNT random documents: a single hot day doc caps at ~1 sustained
      // write/s, so parallel assistant bursts would abort increments and undercount the charts.
      // adminGetStats sums the shards (plus the pre-shard legacy day doc) when reading.
      recordAiUsage: async (dayKey, tokens) => {
        const shard = Math.floor(Math.random() * AI_STATS_SHARD_COUNT);
        await db.doc(adminStatsAiShardPath(dayKey, shard)).set(
          {
            requests: FieldValue.increment(1),
            inputTokens: FieldValue.increment(tokens.inputTokens),
            outputTokens: FieldValue.increment(tokens.outputTokens),
            updatedAt: new Date().toISOString(),
          },
          { merge: true },
        );
      },
      now: () => new Date(),
    });
  },
);
