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
import { handleAssistant } from './handler';
import { createOpenAiClient } from './llm';
import { firestoreQuotaStore } from './quota';

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
    const uid = request.auth?.uid ?? null;
    return handleAssistant(uid, request.data, {
      quota: firestoreQuotaStore(db),
      meetings: firestoreMeetingReader(db, (count) => logger.warn('assistant.meetings_invalid', { uid, count })),
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
