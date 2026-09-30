/**
 * AI area public API (owner: ai).
 *
 * Layer L5: imports core, i18n, format, the data and calendar barrels and src/config/firebase
 * (never the auth barrel). Contract: AI section of src/core/contracts.ts and
 * src/core/aiContract.ts (shared verbatim with /functions).
 *
 * - assistantClient.send(request): "assistant" callable, zod-validated both ways, AppError codes
 *   quota_exceeded (details.usage) | unauthenticated | invalid_input | upstream_error | offline |
 *   timeout (| not_configured when Firebase is not set up).
 * - actionExecutor.preview/execute(action): runs CONFIRMED actions only, idempotent per action.
 * - useAssistant({ followUpMeetingId }): persisted conversation, pending actions, confirm/reject,
 *   confirmAll, retry, reset.
 */
export { actionExecutor, assistantClient, getAssistantController } from './runtime';
export { useAssistant, useAssistantController } from './useAssistant';
export { createAssistantFormatter } from './formatter';
export {
  actionIconName,
  buildMailtoUrl,
  buildShareContent,
  computeUpdateDiff,
  describeAssistantError,
  describeBulk,
  describeDraft,
  describeMeeting,
  describeResult,
  describeScopeRow,
  describeShare,
  describeUsage,
  describeWarnings,
  formatRecurrence,
  formatShift,
  isDestructiveAction,
  isOccurrenceDelete,
} from './presentation';
export { recurrenceScopeText, recurrenceSummary, untilLocalDate } from './recurrenceText';
export type { BulkDescription, BulkItem, DetailRow, DiffRow, ErrorDescription, Feedback, UsageDescription } from './presentation';
export { MAX_REQUEST_MESSAGES, MAX_STORED_MESSAGES } from './conversation';
export type {
  AiActionPreview,
  AiActionResult,
  AssistantController,
  AssistantFormatter,
  AssistantHookResult,
  AssistantSnapshot,
  ChatMessage,
} from './types';
