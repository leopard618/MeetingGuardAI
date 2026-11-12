/**
 * The real dependencies of summaryCommitments (docs/v2/M11-DESIGN.md sections 2.1 and 2.8),
 * loaded LAZILY by ./commitmentsFunction.ts on the first call together with the handler, so no
 * other function instance of the project carries the commitments path.
 *
 * - The params are read per call (never at load): SUMMARIES_ENABLED, SUMMARIES_PILOT_UIDS,
 *   OPENAI_MODEL, OPENAI_REASONING_EFFORT, ASSISTANT_GLOBAL_DAILY_LIMIT. No new param, no new secret
 *   (decision 13): the model and effort are the assistant's, the caps are COMMITMENTS_TUNING.
 * - The data key through read.ts lazyKeyring (parsed on the first open, kept while the value stays
 *   the same); the OpenAI key from the runtime provider (openaiKey.ts, Secret Manager REST with
 *   the env-bound value as fallback) with the assistant's one retry after a rotation 401.
 * - The quota store, the global budget (its own per-instance cache over the same shards as the
 *   assistant) and the admin AI stats shards are the assistant's, so one allowance and one daily
 *   cap cover both. The stats write is the assistant's recordAiUsage shape, repeated here instead
 *   of moved, so assistant/index.ts (bundled into every WhatsApp webhook deploy) stays as it is.
 * Nothing here logs content; the effort warning carries the configured value only (no secret).
 */
import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';

import {
  ASSISTANT_GLOBAL_DAILY_LIMIT,
  COMMITMENTS_TUNING,
  OPENAI_MODEL,
  OPENAI_REASONING_EFFORT,
  SUMMARIES_DATA_KEY,
  SUMMARIES_ENABLED,
  SUMMARIES_PILOT_UIDS,
  parseReasoningEffort,
} from '../config';
import { AI_STATS_SHARD_COUNT, adminStatsAiShardPath } from '../admin/schemas';
import { adminDb } from '../firebase';
import { createGlobalBudget, firestoreGlobalBudgetStore, type GlobalBudget } from '../assistant/globalBudget';
import { createOpenAiClient } from '../assistant/llm';
import { firestoreQuotaStore } from '../assistant/quota';
import { instanceOpenAiKeyProvider, withKeyRetry } from '../openaiKey';
import type { SummaryCommitmentsResponse } from '../shared/aiContract';
import type { Keyring } from '../shared/sealed';
import type { SummaryCallableAuth } from './callables';
import { handleSummaryCommitments, type CommitmentsDeps } from './commitmentsHandler';
import { lazyKeyring } from './read';

let keyringOnce: (() => Keyring) | null = null;
let globalBudget: GlobalBudget | null = null;

function instanceGlobalBudget(db: Firestore): GlobalBudget {
  if (globalBudget === null) {
    globalBudget = createGlobalBudget(firestoreGlobalBudgetStore(db), { limit: () => ASSISTANT_GLOBAL_DAILY_LIMIT.value() });
  }
  return globalBudget;
}

/** The deps of one call (see the module comment). */
export function commitmentsDeps(): CommitmentsDeps {
  if (keyringOnce === null) keyringOnce = lazyKeyring(() => SUMMARIES_DATA_KEY.value());
  const keyring = keyringOnce;
  let db: Firestore | null = null;
  const database = (): Firestore => {
    if (db === null) db = adminDb();
    return db;
  };
  return {
    get db() {
      return database();
    },
    get quota() {
      return firestoreQuotaStore(database());
    },
    get globalBudget() {
      return instanceGlobalBudget(database());
    },
    now: () => new Date(),
    config: { enabled: SUMMARIES_ENABLED.value() === true, pilotUids: SUMMARIES_PILOT_UIDS.value() },
    keyring,
    model: () => OPENAI_MODEL.value(),
    llm: () => {
      const effortSetting = OPENAI_REASONING_EFFORT.value();
      const reasoningEffort = parseReasoningEffort(effortSetting);
      if (reasoningEffort === null && effortSetting.trim().toLowerCase() !== 'omit') {
        logger.warn('summaries.commitments.reasoning_effort_ignored', { value: effortSetting });
      }
      const model = OPENAI_MODEL.value();
      const tuning = {
        requestTimeoutMs: COMMITMENTS_TUNING.openAiRequestTimeoutMs,
        deadlineMs: COMMITMENTS_TUNING.openAiDeadlineMs,
        maxRetries: COMMITMENTS_TUNING.openAiMaxRetries,
        maxCompletionTokens: COMMITMENTS_TUNING.maxCompletionTokens,
      };
      return withKeyRetry(instanceOpenAiKeyProvider(), (apiKey) => createOpenAiClient({ apiKey, model, reasoningEffort, tuning }));
    },
    // The assistant's admin stats write: one merge-set with increments on a random shard.
    recordAiUsage: async (dayKey, tokens) => {
      const shard = Math.floor(Math.random() * AI_STATS_SHARD_COUNT);
      await database()
        .doc(adminStatsAiShardPath(dayKey, shard))
        .set(
          {
            requests: FieldValue.increment(1),
            inputTokens: FieldValue.increment(tokens.inputTokens),
            outputTokens: FieldValue.increment(tokens.outputTokens),
            updatedAt: new Date().toISOString(),
          },
          { merge: true },
        );
    },
  };
}

/** One summaryCommitments call with the real deps. */
export function runSummaryCommitments(auth: SummaryCallableAuth, data: unknown): Promise<SummaryCommitmentsResponse> {
  return handleSummaryCommitments(auth, data, commitmentsDeps());
}
