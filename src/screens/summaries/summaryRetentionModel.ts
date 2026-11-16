/**
 * Pure model of "How long we keep summaries" and of Disconnect (docs/v2/M11-DESIGN.md section 5):
 * the retention lines in their fixed order, the "kept until" date of one summary, the copy of the
 * connect screen's create view after a disconnect, and which cached lists to ask again after one.
 * No React, no Firebase: unit tests import this file directly.
 *
 * The periods mirror the server's SUMMARY_RETENTION_DAYS (functions/src/summaries/model.ts:77,
 * summaryExpiresAt): filed or kept, 365 days from receipt; inbox, 60 days from receipt or from the
 * move back to the inbox, whichever is later. Francisco accepted them on Nov 12 2026 (M11 section
 * 12, decision 4); our email provider keeps its copy 45 days (decision 5,
 * SUMMARY_PROVIDER_RETENTION_DAYS).
 */
import type { SummaryListItem, SummaryListView } from '../../core/aiContract';

/** Days a summary is kept, counted from receivedAt (the server's SUMMARY_RETENTION_DAYS). */
export const SUMMARY_KEEP_DAYS = {
  filedOrKept: 365,
  inbox: 60,
} as const;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The lines of the retention card, in order (summaries:connect.retention.<key>). */
export const SUMMARY_RETENTION_KEYS = ['filed', 'inbox', 'refused', 'suggestions', 'tasks', 'deleting', 'openai', 'copies'] as const;
export type SummaryRetentionKey = (typeof SUMMARY_RETENTION_KEYS)[number];

/** i18n key of one retention line ('deleting' takes {{providerDays}}: SUMMARY_PROVIDER_RETENTION_DAYS). */
export function retentionLineKey(key: SummaryRetentionKey): string {
  return `summaries:connect.retention.${key}`;
}

/**
 * When a filed or kept summary is deleted by itself: 365 days after it arrived (the server sets
 * the same expiresAt on attach and keep). null for an inbox summary (the later of two dates, one
 * of which the app does not know) and for a refused row or an unreadable time.
 */
export function summaryKeptUntil(summary: Pick<SummaryListItem, 'status' | 'receivedAt'>): string | null {
  if (summary.status !== 'matched' && summary.status !== 'kept') return null;
  const received = Date.parse(summary.receivedAt);
  if (Number.isNaN(received)) return null;
  return new Date(received + SUMMARY_KEEP_DAYS.filedOrKept * DAY_MS).toISOString();
}

// ---- Disconnect ----------------------------------------------------------------------------------

/** What the user chose in "Stop receiving summaries": keep the summaries already here, or delete them. */
export type DisconnectChoice = 'keep' | 'delete';

/** The success toast. */
export function disconnectDoneKey(choice: DisconnectChoice): string {
  return choice === 'delete' ? 'summaries:connect.disconnect.doneDeleted' : 'summaries:connect.disconnect.doneKept';
}

export interface CreateViewCopy {
  /** The create button. */
  buttonKey: string;
  /** The notice above it after a disconnect on this screen, else null (takes {{providerDays}}). */
  noticeKey: string | null;
  /** The lines under the button. */
  hintKeys: readonly string[];
}

/**
 * The connect screen's create view: "Create my private address", or, right after a disconnect on
 * this screen, "Not connected ..." and "Create my private address again" with the reminder that a
 * new address counts toward the daily cap (M10 section 3; the server counts it as a rotation).
 */
export function createViewCopy(disconnected: DisconnectChoice | null): CreateViewCopy {
  if (disconnected === null) {
    return { buttonKey: 'summaries:connect.create', noticeKey: null, hintKeys: ['summaries:connect.createHint'] };
  }
  return {
    buttonKey: 'summaries:connect.disconnect.reconnect',
    noticeKey: 'summaries:connect.disconnect.disconnected',
    hintKeys: ['summaries:connect.createHint', 'summaries:connect.disconnect.reconnectHint'],
  };
}

/** The summaryRead list views a screen keeps cached (the 'meeting' views are asked by Meeting details itself). */
export type CachedSummaryListView = Exclude<SummaryListView, 'meeting'>;
export const CACHED_SUMMARY_LIST_VIEWS: readonly CachedSummaryListView[] = ['inbox', 'recent', 'refused'];

/**
 * The lists to ask again after a disconnect (best effort; the status and the Settings count come
 * with the disconnect answer itself). Always the inbox (its count and its re-match). After "Delete
 * them" also every list that was cached before the call: the service dropped them all, and a
 * summary inbox still open below this screen would otherwise show nothing.
 */
export function listsToRefreshAfterDisconnect(
  cachedBefore: readonly CachedSummaryListView[],
  choice: DisconnectChoice,
): CachedSummaryListView[] {
  const wanted = new Set<CachedSummaryListView>(['inbox']);
  if (choice === 'delete') for (const view of cachedBefore) wanted.add(view);
  return CACHED_SUMMARY_LIST_VIEWS.filter((view) => wanted.has(view));
}
