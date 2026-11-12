/**
 * Pure view model of the summary connect screen (route "SummaryConnect"; docs/v2/M10-DESIGN.md
 * section 9; owner: summaries-app): which view to show, the error messages, the mailbox list
 * editing and its validation (the contract's addr-spec, at most SUMMARY_LIMITS.maxMailboxes, never
 * on the private address's own domain), the Gmail code cards, the setup tab contents, when to
 * poll the status and when to show the Microsoft 365 hint. No React, no Firebase: unit tests
 * import this file directly.
 */
import {
  SUMMARY_LIMITS,
  summaryAddrSpecSchema,
  type SummaryGmailRequest,
  type SummaryLastRefused,
  type SummaryStatusResponse,
} from '../../core/aiContract';
import type { AppError } from '../../core/errors';
import { isSummariesAvailable, isSummariesUnavailableError, summaryErrorReason } from '../../services/summaries/summaryCore';
import { SUMMARY_MICROSOFT_HINT_AFTER_MS, SUMMARY_SETUP_LINKS, summaryErrorMessageKey, type SummarySetupTab } from './summaryText';

// ---- View ----------------------------------------------------------------------------------------

/**
 * - loading: the first status ask is in flight;
 * - error: it failed (offline, timeout, ...) and nothing is known; Retry;
 * - unavailable: the feature is off or this account is not in the pilot (nothing else is shown);
 * - not_ready: the server cannot hand out addresses yet ("being set up");
 * - create: no address yet;
 * - connected: the address, mailboxes, setup, activity.
 */
export type SummaryConnectView = 'loading' | 'error' | 'unavailable' | 'not_ready' | 'create' | 'connected';

/** Which view the screen shows for useSummaryStatus's answer (a known status wins over an error). */
export function connectView(status: SummaryStatusResponse | null, error: AppError | null): SummaryConnectView {
  if (status === null) {
    if (error === null) return 'loading';
    return isSummariesUnavailableError(error) ? 'unavailable' : 'error';
  }
  if (!isSummariesAvailable(status)) return 'unavailable';
  if (status.address !== null) return 'connected';
  return status.ready ? 'create' : 'not_ready';
}

/** i18n key for a failed status ask or action: not_ready reads "being set up", the rest as mapped. */
export function connectErrorKey(error: AppError): string {
  return summaryErrorReason(error) === 'not_ready' ? 'summaries:connect.notReady' : summaryErrorMessageKey(error);
}

/**
 * After these errors the cached status is out of date (the feature was switched off, the pilot
 * changed, the address template or the address itself is gone): ask summaryStatus again so the
 * screen shows the real state.
 */
export function refreshAfterError(error: AppError): boolean {
  const reason = summaryErrorReason(error);
  return reason === 'not_enabled' || reason === 'not_allowed' || reason === 'not_ready';
}

// ---- Mailboxes -----------------------------------------------------------------------------------

export type MailboxProblem = 'invalid' | 'reserved' | 'duplicate' | 'maxReached';

/** i18n key of a mailbox problem (maxReached takes {{max}}: SUMMARY_LIMITS.maxMailboxes). */
export function mailboxProblemKey(problem: MailboxProblem): string {
  return `summaries:connect.mailboxes.${problem}`;
}

/** What the server stores: trimmed and lowercased (local part and domain). */
export function normalizeMailboxInput(input: string): string {
  return input.trim().toLowerCase();
}

function domainOf(address: string): string {
  return address.slice(address.lastIndexOf('@') + 1).toLowerCase();
}

function sameAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

export type MailboxCheck = { ok: true; mailbox: string } | { ok: false; problem: MailboxProblem };

/**
 * One mailbox the user typed, checked before it joins the list: one plain addr-spec (the
 * contract's SUMMARY_ADDR_SPEC_PATTERN, at most 254 characters), not on the private address's
 * domain (the server refuses those as reserved: a private address can never be a mailbox), not
 * already listed, and room left under SUMMARY_LIMITS.maxMailboxes.
 */
export function checkNewMailbox(input: string, list: readonly string[], privateAddress: string | null): MailboxCheck {
  const mailbox = normalizeMailboxInput(input);
  if (!summaryAddrSpecSchema.safeParse(mailbox).success) return { ok: false, problem: 'invalid' };
  if (privateAddress !== null && domainOf(mailbox) === domainOf(privateAddress)) return { ok: false, problem: 'reserved' };
  if (list.some((entry) => sameAddress(entry, mailbox))) return { ok: false, problem: 'duplicate' };
  if (list.length >= SUMMARY_LIMITS.maxMailboxes) return { ok: false, problem: 'maxReached' };
  return { ok: true, mailbox };
}

/** The list is full: the screen hides the input and says so. */
export function mailboxesFull(list: readonly string[]): boolean {
  return list.length >= SUMMARY_LIMITS.maxMailboxes;
}

export function withMailbox(list: readonly string[], mailbox: string): string[] {
  return [...list, mailbox];
}

export function withoutMailbox(list: readonly string[], mailbox: string): string[] {
  return list.filter((entry) => entry !== mailbox);
}

/** Same entries in the same order (case-insensitive, like the server's lowercased list). */
export function sameMailboxes(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((entry, index) => sameAddress(entry, b[index] ?? ''));
}

export type MailboxSavePlan =
  | { kind: 'unchanged' }
  | { kind: 'save'; mailboxes: string[] }
  | { kind: 'problem'; problem: MailboxProblem };

/**
 * What Save does: the edited list (or the saved one), plus the address still in the input when
 * there is one (it is checked like Add). Nothing is sent when the result equals the saved list.
 */
export function planMailboxSave(
  saved: readonly string[],
  draft: readonly string[] | null,
  pending: string,
  privateAddress: string | null,
): MailboxSavePlan {
  let list = [...(draft ?? saved)];
  if (pending.trim() !== '') {
    const check = checkNewMailbox(pending, list, privateAddress);
    if (!check.ok) return { kind: 'problem', problem: check.problem };
    list = withMailbox(list, check.mailbox);
  }
  return sameMailboxes(list, saved) ? { kind: 'unchanged' } : { kind: 'save', mailboxes: list };
}

// ---- Gmail confirmation codes --------------------------------------------------------------------

export interface GmailCard {
  request: SummaryGmailRequest;
  /**
   * The requesting Gmail is one of the listed mailboxes: the code is shown big with Copy. Any
   * other requester gets "Someone else asked; ignore it" and no code (red team finding 14).
   */
  prominent: boolean;
  key: string;
}

/** Identifies one confirmation mail (a new code for the same Gmail is a new key). */
export function gmailRequestKey(request: SummaryGmailRequest): string {
  return `${request.gmailAddress.toLowerCase()}|${request.code}|${request.receivedAt}`;
}

/** The pending codes, listed mailboxes first, each group newest first (the server's order). */
export function gmailCards(status: Pick<SummaryStatusResponse, 'gmailRequests' | 'mailboxes'>): GmailCard[] {
  const listed = new Set(status.mailboxes.map((mailbox) => mailbox.toLowerCase()));
  const cards = status.gmailRequests.map((request) => ({
    request,
    prominent: listed.has(request.gmailAddress.toLowerCase()),
    key: gmailRequestKey(request),
  }));
  return [...cards.filter((card) => card.prominent), ...cards.filter((card) => !card.prominent)];
}

/** How long the screen keeps polling for a Gmail code after the user went to set one up. */
export const SUMMARY_GMAIL_WAIT_MS = 30 * 60 * 1000;

/** The user is setting up Gmail forwarding (opened its settings, or got a new address). */
export interface GmailWait {
  /** Device time when the wait started. */
  since: number;
  /** The codes already on screen then (gmailRequestKey); a code not among them ends the wait. */
  seen: readonly string[];
}

export function startGmailWait(status: SummaryStatusResponse | null, nowMs: number): GmailWait {
  return { since: nowMs, seen: (status?.gmailRequests ?? []).map(gmailRequestKey) };
}

/** Still waiting: no new code has arrived and the wait is not older than SUMMARY_GMAIL_WAIT_MS. */
export function gmailWaitActive(wait: GmailWait | null, status: SummaryStatusResponse | null, nowMs: number): boolean {
  if (wait === null || status === null) return false;
  if (nowMs - wait.since > SUMMARY_GMAIL_WAIT_MS) return false;
  const seen = new Set(wait.seen);
  return !status.gmailRequests.some((request) => !seen.has(gmailRequestKey(request)));
}

// ---- Polling -------------------------------------------------------------------------------------

/**
 * Poll summaryStatus (every SUMMARY_STATUS_POLL_MS, while focused and in the foreground) only
 * while an address exists and the screen waits for something: the first summary, or a Gmail code
 * after the user went to set one up.
 */
export function shouldPollStatus(status: SummaryStatusResponse | null, gmailWaiting: boolean): boolean {
  if (status === null || !isSummariesAvailable(status) || status.address === null) return false;
  return status.lastReceivedAt === null || gmailWaiting;
}

// ---- Microsoft 365 hint --------------------------------------------------------------------------

function timeOf(iso: string): number | null {
  const value = Date.parse(iso);
  return Number.isNaN(value) ? null : value;
}

/**
 * The earliest time the address is known to have been in use: the last refusal or a Gmail
 * confirmation mail (mail reached it then). summaryStatus does not say when the address was
 * created, so with no such mail the age is unknown and the hint stays hidden.
 */
export function addressInUseSince(status: Pick<SummaryStatusResponse, 'lastRefused' | 'gmailRequests'>): number | null {
  const times = [status.lastRefused?.at, ...status.gmailRequests.map((request) => request.receivedAt)]
    .filter((value): value is string => typeof value === 'string')
    .map(timeOf)
    .filter((value): value is number => value !== null);
  return times.length > 0 ? Math.min(...times) : null;
}

/**
 * "Nothing has arrived yet" with the Microsoft 365 administrator steps: an address exists, no
 * summary was ever received, and it has been in use for SUMMARY_MICROSOFT_HINT_AFTER_MS (24 h).
 */
export function showMicrosoftHint(status: SummaryStatusResponse | null, nowMs: number): boolean {
  if (status === null || status.address === null || status.lastReceivedAt !== null) return false;
  const since = addressInUseSince(status);
  return since !== null && nowMs - since >= SUMMARY_MICROSOFT_HINT_AFTER_MS;
}

// ---- Activity ------------------------------------------------------------------------------------

/** "From <domain>" only for a passing signature's domain; otherwise "From an unknown sender". */
export function refusedFromText(lastRefused: SummaryLastRefused): { key: string; options?: { domain: string } } {
  return lastRefused.senderDomain !== null
    ? { key: 'summaries:common.refusedFrom', options: { domain: lastRefused.senderDomain } }
    : { key: 'summaries:common.refusedFromUnknown' };
}

// ---- Setup tabs ----------------------------------------------------------------------------------

const GMAIL_DOMAINS: ReadonlySet<string> = new Set(['gmail.com', 'googlemail.com']);
/** outlook.com, hotmail.es, live.com.mx, msn.com and the like. */
const MICROSOFT_CONSUMER_DOMAIN = /^(?:outlook|hotmail|live|msn)\.[a-z]{2,}(?:\.[a-z]{2,})?$/;

/**
 * The tab opened first: the mail service of the first listed mailbox that tells (Gmail, or a
 * Microsoft consumer domain); a company domain cannot tell, so Gmail, the first tab.
 */
export function defaultSetupTab(mailboxes: readonly string[]): SummarySetupTab {
  for (const mailbox of mailboxes) {
    const domain = domainOf(mailbox);
    if (GMAIL_DOMAINS.has(domain)) return 'gmail';
    if (MICROSOFT_CONSUMER_DOMAIN.test(domain)) return 'outlook';
  }
  return 'gmail';
}

export interface SetupLink {
  labelKey: string;
  /** A fixed https page from SUMMARY_SETUP_LINKS (nothing from a summary is ever opened). */
  url: string;
  /** Opening it starts a Gmail code wait (the screen polls until the code shows up). */
  waitsForGmailCode: boolean;
}

export interface SetupTabExtras {
  links: readonly SetupLink[];
  /** The note under the steps (Google Workspace, Microsoft 365 company mailbox). */
  noteKey: string | null;
  /** "Steps for your administrator" text to share ({{mailbox}}, {{address}}); null: none. */
  adminKey: string | null;
}

/** What each setup tab shows besides its numbered steps (SUMMARY_SETUP_STEP_KEYS). */
export const SUMMARY_SETUP_EXTRAS: Readonly<Record<SummarySetupTab, SetupTabExtras>> = {
  gmail: {
    links: [
      { labelKey: 'summaries:connect.setup.gmail.openForwarding', url: SUMMARY_SETUP_LINKS.gmailForwarding, waitsForGmailCode: true },
      { labelKey: 'summaries:connect.setup.gmail.openFilters', url: SUMMARY_SETUP_LINKS.gmailFilters, waitsForGmailCode: false },
    ],
    noteKey: 'summaries:connect.setup.gmail.workspace',
    adminKey: 'summaries:connect.setup.admin.google',
  },
  outlook: {
    links: [{ labelKey: 'summaries:connect.setup.outlook.openRules', url: SUMMARY_SETUP_LINKS.outlookRules, waitsForGmailCode: false }],
    noteKey: 'summaries:connect.setup.outlook.company',
    adminKey: 'summaries:connect.setup.admin.microsoft',
  },
  other: { links: [], noteKey: null, adminKey: null },
};

/** The Microsoft 365 administrator steps (the hint's action). */
export const SUMMARY_MICROSOFT_ADMIN_KEY = 'summaries:connect.setup.admin.microsoft';

/** The mailbox named in the administrator steps: the first listed one (null: "my mailbox"). */
export function adminMailbox(mailboxes: readonly string[]): string | null {
  return mailboxes[0] ?? null;
}
