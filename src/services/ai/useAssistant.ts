/**
 * useAssistant(): React binding of the conversation controller.
 * The conversation lives in the app-wide controller (it survives leaving the chat screen and
 * finishes in-flight requests); the hook only subscribes and starts follow-up mode.
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

  useEffect(() => {
    if (followUpMeetingId) void controller.startFollowUp(followUpMeetingId);
  }, [controller, followUpMeetingId]);

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
      send: controller.send,
      confirm: controller.confirm,
      confirmAll: controller.confirmAll,
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
