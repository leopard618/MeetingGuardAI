/**
 * Assistant conversation controller (framework-free; the React hook subscribes to it).
 *
 * One controller per app run, bound to the signed-in user:
 * - loads/persists the thread per uid (MAX_STORED_MESSAGES kept, MAX_REQUEST_MESSAGES sent);
 * - serializes requests (chat, post-meeting follow-up, spoken debrief) so replies never interleave;
 * - follow-up mode: a meeting's follow-up is requested once (remembered in the thread), even when
 *   the notification is opened again;
 * - executes CONFIRMED actions only (confirm / confirmAll), sharing one execution per action;
 * - drops responses/results that arrive after a reset or a user switch (generation counter);
 * - on session end: clears memory and deletes the stored thread after pending writes.
 */
import {
  AI_CONTRACT_VERSION,
  AI_LIMITS,
  MEETING_ID_PATTERN,
  type AiAction,
  type AssistantRequest,
  type Language,
} from '../../core/aiContract';
import type { ActionResult, AssistantClient, Unsubscribe } from '../../core/contracts';
import { AppError, toAppError } from '../../core/errors';
import { createLogger } from '../../core/logger';

import { quotaUsageFromError } from './assistantClient';
import type { AiActionExecutor } from './actionExecutor';
import {
  assignActionIds,
  buildRequestMessages,
  createEmptyThread,
  detectFailedRequest,
  selectLatestPendingActionIds,
  selectPendingActionIds,
  threadReducer,
  type ThreadEvent,
} from './conversation';
import { createLocalId } from './ids';
import type { ThreadStore } from './threadStore';
import type { AssistantController, AssistantSnapshot, ChatMessage, FailedRequest } from './types';

const log = createLogger('ai.controller');

export interface SessionSource {
  getActiveUid(): string | null;
  /** Called with the new uid on session start and null on session end. */
  subscribe(listener: (uid: string | null) => void): Unsubscribe;
}

export interface AssistantControllerDeps {
  client: AssistantClient;
  executor: Pick<AiActionExecutor, 'preview' | 'execute'>;
  store: ThreadStore;
  /** Request context at send time. */
  getContext(): { language: Language; timezone: string; now: Date };
  session?: SessionSource;
  createId?: (prefix: string) => string;
}

function initialSnapshot(uid: string | null): AssistantSnapshot {
  return {
    uid,
    isLoaded: false,
    thread: createEmptyThread(),
    isSending: false,
    error: null,
    failedRequest: null,
    followUpInFlight: null,
    debriefInFlight: null,
  };
}

export function createAssistantController(deps: AssistantControllerDeps): AssistantController {
  const createId = deps.createId ?? ((prefix: string) => createLocalId(prefix));
  const listeners = new Set<() => void>();
  let snapshot = initialSnapshot(null);
  /** Bumped on user switch / reset: late responses and results of an older generation are dropped. */
  let generation = 0;
  let saveChain: Promise<void> = Promise.resolve();
  let saveScheduled = false;
  let requestChain: Promise<void> = Promise.resolve();
  const executions = new Map<string, Promise<ActionResult>>();
  const followUpsInProgress = new Set<string>();
  let pendingFollowUp: string | null = null;
  /** Resolves when the thread of the current user is loaded (send() waits for it). */
  let loading: Promise<void> = Promise.resolve();

  function emit(): void {
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch (error) {
        log.error('assistant listener failed', error);
      }
    }
  }

  function update(patch: Partial<AssistantSnapshot>): void {
    snapshot = { ...snapshot, ...patch };
    emit();
  }

  function schedulePersist(): void {
    if (saveScheduled) return;
    saveScheduled = true;
    saveChain = saveChain
      .then(async () => {
        saveScheduled = false;
        const { uid, isLoaded, thread } = snapshot;
        if (!uid || !isLoaded) return;
        await deps.store.save(uid, thread);
      })
      .catch((error: unknown) => {
        saveScheduled = false;
        log.error('could not save the assistant thread', error);
      });
  }

  function apply(event: ThreadEvent, persist = true): void {
    const thread = threadReducer(snapshot.thread, event);
    if (thread === snapshot.thread) return;
    update({ thread });
    if (persist) schedulePersist();
  }

  function enqueue(task: () => Promise<void>): Promise<void> {
    const run = requestChain.then(task);
    requestChain = run.catch(() => undefined);
    return run;
  }

  async function previewAll(filter: (actionId: string) => boolean): Promise<void> {
    const gen = generation;
    const targets = Object.values(snapshot.thread.actions).filter(
      (state) => filter(state.action.id) && (state.status === 'proposed' || state.status === 'failed' || state.action.type === 'list'),
    );
    await Promise.all(
      targets.map(async (state) => {
        try {
          const preview = await deps.executor.preview(state.action);
          if (gen === generation) apply({ type: 'preview', actionId: state.action.id, preview }, false);
        } catch (error) {
          log.warn('could not preview an assistant action', { type: state.action.type, code: toAppError(error).code });
        }
      }),
    );
  }

  async function runRequest(kind: FailedRequest, userMessageId: string | null): Promise<void> {
    const gen = generation;
    if (!snapshot.uid) return;
    const followUpMeetingId = kind.mode === 'followup' ? kind.meetingId : null;
    const debriefMeetingId = kind.mode === 'debrief' ? kind.meetingId : null;
    apply({ type: 'request_started', userMessageId });
    update({ isSending: true, error: null, failedRequest: null, followUpInFlight: followUpMeetingId, debriefInFlight: debriefMeetingId });

    try {
      const context = deps.getContext();
      // v4: tell the server which proposals are still on screen, so plain consent ("yes I
      // confirm", in any wording) resolves them instead of producing duplicates.
      const pendingActions =
        kind.mode === 'chat'
          ? selectLatestPendingActionIds(snapshot.thread)
              .flatMap((actionId) => {
                const state = snapshot.thread.actions[actionId];
                return state && state.status === 'proposed' && state.action.summary.length > 0
                  ? [{ type: state.action.type, summary: state.action.summary.slice(0, AI_LIMITS.maxSummaryChars) }]
                  : [];
              })
              .slice(0, AI_LIMITS.maxActions)
          : [];
      // A debrief sends the transcript alone: the model turns that one message into tasks and
      // must not be steered by earlier chat turns.
      const debriefMessage = kind.mode === 'debrief' ? snapshot.thread.messages.find((m) => m.id === kind.userMessageId) : undefined;
      const request: AssistantRequest = {
        messages:
          kind.mode === 'chat'
            ? buildRequestMessages(snapshot.thread.messages)
            : debriefMessage
              ? buildRequestMessages([debriefMessage], 1)
              : [],
        language: context.language,
        timezone: context.timezone,
        nowIso: context.now.toISOString(),
        mode: kind.mode,
        // Follow-up and debrief both name the meeting that ended.
        followUpMeetingId: followUpMeetingId ?? debriefMeetingId,
        // v5: tells the server which capabilities this build can parse (task action types).
        contractVersion: AI_CONTRACT_VERSION,
        ...(pendingActions.length > 0 ? { pendingActions } : {}),
      };
      const response = await deps.client.send(request);
      if (gen !== generation) return;
      const replyId = createId('a_');
      const actions = assignActionIds(replyId, response.actions);
      const reply: ChatMessage = {
        id: replyId,
        role: 'assistant',
        content: response.reply,
        createdAt: new Date().toISOString(),
        actionIds: actions.map((a) => a.id),
        suggestions: response.suggestions,
        followUpMeetingId,
        ...(debriefMeetingId ? { debriefMeetingId } : {}),
      };
      apply({ type: 'request_succeeded', userMessageId, reply, actions, usage: response.usage, followUpMeetingId });
      update({ isSending: false, followUpInFlight: null, debriefInFlight: null });
      // v4: the model judged the message as plain consent/refusal of the pending proposals.
      // Only honored when we sent pending proposals and nothing new was proposed; the cards
      // then run through exactly the same paths as the on-screen buttons.
      const resolution = pendingActions.length > 0 && actions.length === 0 ? (response.resolution ?? null) : null;
      if (resolution === 'confirm') {
        await confirmLatest();
      } else if (resolution === 'reject') {
        for (const actionId of selectLatestPendingActionIds(snapshot.thread)) reject(actionId);
      }
      const newIds = new Set(actions.map((a) => a.id));
      void previewAll((id) => newIds.has(id));
    } catch (error) {
      if (gen !== generation) return;
      const appError = toAppError(error, 'upstream_error');
      apply({ type: 'request_failed', userMessageId, usage: quotaUsageFromError(appError) });
      update({ isSending: false, error: appError, failedRequest: kind, followUpInFlight: null, debriefInFlight: null });
    }
  }

  async function load(uid: string, gen: number): Promise<void> {
    let thread = createEmptyThread();
    try {
      thread = await deps.store.load(uid);
    } catch (error) {
      // Unreadable storage: continue with an empty thread (it replaces the stored one on the next save).
      log.warn('could not load the assistant thread', toAppError(error).code);
    }
    if (gen !== generation) return;
    update({ thread, isLoaded: true, failedRequest: detectFailedRequest(thread) });
    void previewAll(() => true);
    if (pendingFollowUp) {
      const meetingId = pendingFollowUp;
      pendingFollowUp = null;
      void startFollowUp(meetingId);
    }
  }

  async function setUid(uid: string | null): Promise<void> {
    if (uid === snapshot.uid) return;
    generation += 1;
    const gen = generation;
    executions.clear();
    followUpsInProgress.clear();
    snapshot = initialSnapshot(uid);
    emit();
    if (!uid) {
      loading = Promise.resolve();
      return;
    }
    loading = load(uid, gen);
    await loading;
  }

  async function endSession(): Promise<void> {
    const previousUid = snapshot.uid;
    pendingFollowUp = null;
    await setUid(null);
    if (!previousUid) return;
    // A save that was already running could re-create the key the data layer just wiped.
    await saveChain;
    try {
      await deps.store.clear(previousUid);
    } catch (error) {
      log.warn('could not delete the assistant thread', toAppError(error).code);
    }
  }

  async function send(text: string, options: { origin?: 'typed' | 'suggestion' } = {}): Promise<void> {
    const content = text.trim().slice(0, AI_LIMITS.maxMessageChars);
    if (content === '') return;
    if (!snapshot.uid) {
      update({ error: new AppError('unauthenticated', 'No active session') });
      return;
    }
    if (!snapshot.isLoaded) await loading;
    if (!snapshot.isLoaded || !snapshot.uid) {
      update({ error: new AppError('unauthenticated', 'No active session') });
      return;
    }
    const message: ChatMessage = {
      id: createId('u_'),
      role: 'user',
      content,
      createdAt: new Date().toISOString(),
      actionIds: [],
      suggestions: [],
      // Chip text is model-written: the server never treats it as typed by the user.
      ...(options.origin === 'suggestion' ? { origin: 'suggestion' as const } : {}),
    };
    apply({ type: 'user_message', message });
    await enqueue(() => runRequest({ mode: 'chat' }, message.id));
  }

  async function startFollowUp(meetingId: string): Promise<void> {
    if (!MEETING_ID_PATTERN.test(meetingId)) {
      log.warn('ignoring an invalid follow-up meeting id');
      return;
    }
    if (!snapshot.isLoaded) {
      pendingFollowUp = meetingId;
      return;
    }
    if (snapshot.thread.followUpsRequested.includes(meetingId) || followUpsInProgress.has(meetingId)) return;
    followUpsInProgress.add(meetingId);
    try {
      await enqueue(() => runRequest({ mode: 'followup', meetingId }, null));
    } finally {
      followUpsInProgress.delete(meetingId);
    }
  }

  /**
   * v7: a debrief of an ended meeting. The transcript is shown as the user's message (labelled
   * with the meeting) and sent alone in debrief mode; the reply's create_task proposals are
   * ordinary cards the user confirms one by one. A meeting can be debriefed any number of times.
   */
  async function startDebrief(meetingId: string, transcript: string): Promise<void> {
    if (!MEETING_ID_PATTERN.test(meetingId)) {
      log.warn('ignoring an invalid debrief meeting id');
      return;
    }
    const content = transcript.trim().slice(0, AI_LIMITS.maxMessageChars);
    if (content === '') return;
    if (!snapshot.isLoaded) await loading;
    if (!snapshot.isLoaded || !snapshot.uid) {
      update({ error: new AppError('unauthenticated', 'No active session') });
      return;
    }
    const message: ChatMessage = {
      id: createId('u_'),
      role: 'user',
      content,
      createdAt: new Date().toISOString(),
      actionIds: [],
      suggestions: [],
      debriefMeetingId: meetingId,
    };
    apply({ type: 'user_message', message });
    await enqueue(() => runRequest({ mode: 'debrief', meetingId, userMessageId: message.id }, message.id));
  }

  async function retry(): Promise<void> {
    const failed = snapshot.failedRequest;
    if (!failed || snapshot.isSending) return;
    if (failed.mode === 'followup') {
      update({ failedRequest: null, error: null });
      await startFollowUp(failed.meetingId);
      return;
    }
    if (failed.mode === 'debrief') {
      if (!snapshot.thread.messages.some((m) => m.id === failed.userMessageId)) {
        update({ failedRequest: null, error: null });
        return;
      }
      await enqueue(() => runRequest(failed, failed.userMessageId));
      return;
    }
    const lastUser = [...snapshot.thread.messages].reverse().find((m) => m.role === 'user');
    if (!lastUser) {
      update({ failedRequest: null, error: null });
      return;
    }
    await enqueue(() => runRequest({ mode: 'chat' }, lastUser.id));
  }

  /**
   * v6 combined requests: a create_task draft can point at the create_meeting action of the same
   * response (`meetingActionId`) because the server cannot know the id that meeting will get.
   * Resolve it here, where the executed results live, and return null when that meeting has not
   * run or did not produce one - the task is then created unlinked rather than refused. The value
   * travels beside the action, never inside it, so the idempotency key stays stable.
   */
  function resolveLinkedMeetingId(action: AiAction): string | null {
    if (action.type !== 'create_task') return null;
    // assignActionIds already remapped this to the sibling's thread-local id.
    const target = action.task.meetingActionId;
    if (target == null || action.task.meetingId !== null) return null;
    const source = snapshot.thread.actions[target];
    if (!source || source.action.type !== 'create_meeting') return null;
    if (source.status !== 'done' || source.result?.status !== 'done') return null;
    return source.result.meetingIds[0] ?? null;
  }

  function confirm(actionId: string): Promise<ActionResult> {
    const state = snapshot.thread.actions[actionId];
    if (!state) return Promise.reject(new AppError('not_found', 'Unknown assistant action'));
    const running = executions.get(actionId);
    if (running) return running;
    if (state.status === 'done' && state.result) return Promise.resolve(state.result);
    if (state.status === 'rejected') {
      return Promise.resolve({
        status: 'failed',
        actionId,
        type: state.action.type,
        error: new AppError('cancelled', 'The action was dismissed'),
      });
    }
    const gen = generation;
    apply({ type: 'execute_started', actionId });
    const promise = (async (): Promise<ActionResult> => {
      let result: ActionResult;
      try {
        result = await deps.executor.execute(state.action, {
          linkedMeetingId: resolveLinkedMeetingId(state.action),
        });
      } catch (error) {
        result = { status: 'failed', actionId, type: state.action.type, error: toAppError(error) };
      }
      if (gen === generation) {
        apply({ type: 'execute_finished', actionId, result });
        void previewAll((id) => id !== actionId);
      }
      return result;
    })().finally(() => {
      executions.delete(actionId);
    });
    executions.set(actionId, promise);
    return promise;
  }

  async function confirmAll(): Promise<ActionResult[]> {
    return confirmIds(selectPendingActionIds(snapshot.thread));
  }

  /** The newest reply's proposals only (plain consent, typed or spoken). */
  async function confirmLatest(): Promise<ActionResult[]> {
    return confirmIds(selectLatestPendingActionIds(snapshot.thread));
  }

  async function confirmIds(actionIds: readonly string[]): Promise<ActionResult[]> {
    const results: ActionResult[] = [];
    for (const actionId of actionIds) {
      // Sequential on purpose: later actions may depend on earlier ones (create, then share).
      const state = snapshot.thread.actions[actionId];
      if (!state || state.status !== 'proposed') continue;
      results.push(await confirm(actionId));
    }
    return results;
  }

  function reject(actionId: string): void {
    apply({ type: 'rejected', actionId });
  }

  async function reset(): Promise<void> {
    generation += 1;
    executions.clear();
    followUpsInProgress.clear();
    apply({ type: 'reset' });
    update({ isSending: false, error: null, failedRequest: null, followUpInFlight: null, debriefInFlight: null });
    await saveChain;
  }

  const controller: AssistantController = {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setUid,
    send,
    startFollowUp,
    startDebrief,
    retry,
    confirm,
    confirmAll,
    confirmLatest,
    reject,
    reset,
    refreshPreviews: () => previewAll(() => true),
  };

  if (deps.session) {
    deps.session.subscribe((uid) => {
      if (uid === null) void endSession();
      else void setUid(uid);
    });
    const initialUid = deps.session.getActiveUid();
    if (initialUid) void setUid(initialUid);
  }

  return controller;
}
