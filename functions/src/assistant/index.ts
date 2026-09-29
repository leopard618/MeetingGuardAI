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

import {
  ASSISTANT_GLOBAL_DAILY_LIMIT,
  ASSISTANT_TUNING,
  FUNCTIONS_REGION,
  OPENAI_API_KEY,
  OPENAI_MODEL,
  OPENAI_REASONING_EFFORT,
  parseReasoningEffort,
} from '../config';
import { adminDb } from '../firebase';
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
        return createOpenAiClient({ apiKey: OPENAI_API_KEY.value(), model: OPENAI_MODEL.value(), reasoningEffort });
      },
      now: () => new Date(),
    });
  },
);
