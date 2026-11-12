/**
 * useAssistant(): React binding of the conversation controller.
 * The conversation lives in the app-wide controller (it survives leaving the chat screen and
 * finishes in-flight requests); the hook subscribes, and starts follow-up mode by itself only when
 * `autoStartFollowUp` is set (the app's own follow-up notification). An external
 * meetingguardai://assistant?followup=<id> link must never spend a request without a tap.
 */
import { useEffect, useMemo, useSyncExternalStore } from 'react';

import type { UseAssistantOptions } from '../../core/contracts';

import { selectPendingActionIds } from './conversation';
import { getAssistantController } from './runtime';
import type { AssistantController, AssistantHookResult } from './types';

/** Hook over an explicit controller (tests / previews). */
export function useAssistantController(controller: AssistantController, options: UseAssistantOptions = {}): AssistantHookResult {
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const followUpMeetingId = options.followUpMeetingId ?? null;
  const autoStart = options.autoStartFollowUp === true;

  useEffect(() => {
    if (followUpMeetingId && autoStart) void controller.startFollowUp(followUpMeetingId);
  }, [autoStart, controller, followUpMeetingId]);

  const pendingActionIds = useMemo(() => selectPendingActionIds(snapshot.thread), [snapshot.thread]);

  return useMemo(
    () => ({
      messages: snapshot.thread.messages,
      actions: snapshot.thread.actions,
      isSending: snapshot.isSending,
      error: snapshot.error,
      usage: snapshot.thread.usage,
      isLoaded: snapshot.isLoaded,
      canRetry: snapshot.failedRequest !== null && !snapshot.isSending,
      pendingActionIds,
      followUpInFlight: snapshot.followUpInFlight,
      debriefInFlight: snapshot.debriefInFlight,
      followUpsRequested: snapshot.thread.followUpsRequested,
      send: controller.send,
      startFollowUp: controller.startFollowUp,
      startDebrief: controller.startDebrief,
      confirm: controller.confirm,
      confirmAll: controller.confirmAll,
      confirmLatest: controller.confirmLatest,
      reject: controller.reject,
      retry: controller.retry,
      reset: controller.reset,
    }),
    [controller, snapshot, pendingActionIds],
  );
}

/** Assistant conversation of the signed-in user. `followUpMeetingId` starts follow-up mode once. */
export function useAssistant(options: UseAssistantOptions = {}): AssistantHookResult {
  return useAssistantController(getAssistantController(), options);
}
