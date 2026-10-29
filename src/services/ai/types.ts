/**
 * AI area types. Everything here EXTENDS the contracts in src/core/contracts.ts in a
 * backward-compatible way (extra optional fields / extra members), so the public exports still
 * satisfy AssistantClient, ActionExecutor and useAssistant's contract types.
 */
import type {
  AiAction,
  AssistantUsage,
  ConferenceDetails,
  Language,
} from '../../core/aiContract';
import type {
  ActionPreview,
  ActionResult,
  AssistantChatMessage,
  MeetingRecurrenceOps,
  MeetingRepository,
  ProposedActionState,
  TranslateFn,
  Unsubscribe,
  UseAssistantResult,
} from '../../core/contracts';
import type { AppError, AppErrorCode } from '../../core/errors';
import type { Meeting } from '../../core/types';

// ---------------------------------------------------------------------------------------------
// Conversation
// ---------------------------------------------------------------------------------------------

export interface ChatMessage extends AssistantChatMessage {
  /** User messages only: absent = delivered; 'sending' while the request runs; 'failed' when it did not go through. */
  delivery?: 'sending' | 'failed';
  /** Assistant replies produced in follow-up mode carry the meeting they follow up on. */
  followUpMeetingId?: string | null;
}

export interface ThreadState {
  /** Oldest first; at most MAX_STORED_MESSAGES. */
  messages: ChatMessage[];
  /** Proposed actions by (client-unique) action id. */
  actions: Record<string, ProposedActionState>;
  /** Last known assistant quota usage (from the last response or a quota error). */
  usage: AssistantUsage | null;
  /** Meetings whose post-meeting follow-up was already requested (never re-requested). */
  followUpsRequested: string[];
}

/** What to re-send on retry(). */
export type FailedRequest = { mode: 'chat' } | { mode: 'followup'; meetingId: string };

// ---------------------------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------------------------

/** ActionPreview plus the meetings a new time would overlap with (for the confirmation card). */
export interface AiActionPreview extends ActionPreview {
  overlapping: Meeting[];
  /** Whether Google Calendar is connected (null when not relevant / unknown). */
  calendarConnected: boolean | null;
  /**
   * share / update: addresses that are not participants of the meeting yet (warning 'new_people').
   * The confirmation card lists them so a proposal can never quietly add or mail someone new.
   */
  newPeople?: string[];
  /** create_task: the Microsoft To Do list the task will go to (null when the sync is off). */
  todoListName?: string | null;
}

type DoneResult = Extract<ActionResult, { status: 'done' }>;
type FailedResult = Extract<ActionResult, { status: 'failed' }>;

export type AiDoneResult = DoneResult & {
  /** bulk_update: meetings that were not changed (missing, or an all-day meeting shifted by a non-whole-day amount). */
  skippedMeetingIds?: string[];
  /** Why the requested Google Meet link was not created (meetLinkCreated === false). */
  meetLinkError?: AppErrorCode | null;
  /** share_meeting: who the email draft was addressed to. */
  recipients?: string[];
  /** update_task: the change completed the task (status flipped to done). */
  taskCompleted?: boolean;
};

export type AiActionResult = AiDoneResult | FailedResult;

/** How a shared meeting leaves the app (never claims delivery the app cannot verify). */
export interface ShareAdapter {
  /** Opens the mail composer for a mailto: URL. Throws when no mail app can handle it. */
  openMailComposer(url: string): Promise<void>;
  /** Opens the OS share sheet. 'dismissed' only when the platform reports it (iOS). */
  shareText(content: { title: string; message: string }): Promise<'shared' | 'dismissed'>;
}

/** Persistent idempotency records (mg:{uid}:assistant.executed). */
export interface ExecutedStore {
  getDone(uid: string, key: string): Promise<AiDoneResult | null>;
  markDone(uid: string, key: string, result: AiDoneResult): Promise<void>;
  /** Sub-steps of a multi-meeting action that already succeeded (bulk_update retries skip them). */
  getProgress(uid: string, key: string): Promise<string[]>;
  markProgress(uid: string, key: string, meetingId: string): Promise<void>;
}

export interface CalendarLinkPort {
  isConnected(): Promise<boolean>;
  createMeetLink(meetingId: string): Promise<ConferenceDetails>;
}

/**
 * The recurrence ops are optional so the executor keeps compiling (and failing loudly with
 * 'not_implemented' instead of crashing) while `meetingRepository` gains MeetingRecurrenceOps in
 * the same release; scoped actions on a repository without them resolve `failed`.
 */
export type MeetingsPort = Pick<MeetingRepository, 'get' | 'list' | 'create' | 'update' | 'remove'> &
  Partial<MeetingRecurrenceOps>;

// ---------------------------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------------------------

/** Formatting + translation used by the pure presentation / share builders. */
export interface AssistantFormatter {
  t: TranslateFn;
  language: Language;
  /** Zone used for display (device zone). */
  timeZone: string;
  meetingTime(meeting: Pick<Meeting, 'startAt' | 'durationMinutes' | 'allDay' | 'date'>): string;
  duration(minutes: number): string;
  dateTime(value: string): string;
  /** A calendar date without a time ("YYYY-MM-DD" or an instant), e.g. for recurrence end dates. */
  date(value: string): string;
  time(value: string): string;
  relative(value: string, now?: Date): string;
}

// ---------------------------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------------------------

export interface AssistantSnapshot {
  uid: string | null;
  /** false until the persisted thread of the current user was loaded. */
  isLoaded: boolean;
  thread: ThreadState;
  isSending: boolean;
  error: AppError | null;
  failedRequest: FailedRequest | null;
  /** Meeting whose follow-up request is running (for a dedicated loading text). */
  followUpInFlight: string | null;
}

export interface AssistantHookResult extends UseAssistantResult {
  messages: ChatMessage[];
  isLoaded: boolean;
  /** true when retry() has something to re-send. */
  canRetry: boolean;
  /** Proposed, mutating actions in conversation order (what "confirm all" runs). */
  pendingActionIds: string[];
  /** Confirms every pending action in order; resolves with each result. */
  confirmAll(): Promise<ActionResult[]>;
  followUpInFlight: string | null;
  /** Meetings whose follow-up was already requested (the start button is hidden for them). */
  followUpsRequested: string[];
}

export interface AssistantController {
  getSnapshot(): AssistantSnapshot;
  subscribe(listener: () => void): Unsubscribe;
  /** Switches to (or clears) the signed-in user; loads the persisted thread. */
  setUid(uid: string | null): Promise<void>;
  send(text: string, options?: { origin?: 'typed' | 'suggestion' }): Promise<void>;
  startFollowUp(meetingId: string): Promise<void>;
  retry(): Promise<void>;
  confirm(actionId: string): Promise<ActionResult>;
  confirmAll(): Promise<ActionResult[]>;
  reject(actionId: string): void;
  reset(): Promise<void>;
  /** Recomputes previews of actions that can still run (after data changes). */
  refreshPreviews(): Promise<void>;
}

export type { AiAction };
