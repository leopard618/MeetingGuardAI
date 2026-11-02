/**
 * PURE reconcile diff (owner: alerts): what to cancel / schedule / keep so that the OS pending
 * notifications match the desired set. Never "cancel all then refill": unchanged notifications
 * (same identifier + same data.hash) are kept untouched.
 */
import { isMeetingGuardNotificationId, parseNotificationId } from '../../core/identifiers';
import { LEGACY_PERSISTENT_NOTIFICATION_ID } from './constants';
import { parseAlertData } from './content';
import type { AlertNotificationSpec, ScheduledNotificationRecord, StoredAlertData } from './types';

export interface ScheduledEntry {
  identifier: string;
  data: StoredAlertData | null;
  /** From data.fireAt, else the platform trigger date; null when unknown. */
  fireAt: string | null;
}

export interface ReconcileDiff {
  /** Identifiers to cancel (stale, changed, or invalid snoozes). */
  cancel: string[];
  /** Notifications to (re)schedule; a changed one appears in both `cancel` and `schedule`. */
  schedule: AlertNotificationSpec[];
  /** Identifiers left untouched. */
  keep: string[];
}

/** Meeting Guard entries of a getAllScheduledNotificationsAsync() result (others are ignored). */
export function toScheduledEntries(records: readonly ScheduledNotificationRecord[]): ScheduledEntry[] {
  const entries: ScheduledEntry[] = [];
  const seen = new Set<string>();
  for (const record of records) {
    if (!isMeetingGuardNotificationId(record.identifier) || seen.has(record.identifier)) continue;
    seen.add(record.identifier);
    const data = parseAlertData(record.data);
    const fireAt =
      data?.fireAt ??
      (record.triggerDate !== null && Number.isFinite(record.triggerDate)
        ? new Date(record.triggerDate).toISOString()
        : null);
    entries.push({ identifier: record.identifier, data, fireAt });
  }
  return entries;
}

/**
 * @param existing  Meeting Guard notifications currently pending (toScheduledEntries).
 * @param desired   Rendered plan (unique identifiers).
 * @param keepIds   Pending ids validated elsewhere and kept as they are (valid snoozes).
 */
export function diffNotifications(
  existing: readonly ScheduledEntry[],
  desired: readonly AlertNotificationSpec[],
  keepIds: ReadonlySet<string> = new Set(),
): ReconcileDiff {
  const desiredById = new Map<string, AlertNotificationSpec>();
  for (const spec of desired) {
    if (!desiredById.has(spec.identifier)) desiredById.set(spec.identifier, spec);
  }

  const cancel: string[] = [];
  const keep: string[] = [];
  const kept = new Set<string>();

  for (const entry of existing) {
    if (!isMeetingGuardNotificationId(entry.identifier)) continue;
    if (keepIds.has(entry.identifier)) {
      keep.push(entry.identifier);
      kept.add(entry.identifier);
      continue;
    }
    const wanted = desiredById.get(entry.identifier);
    if (wanted && entry.data !== null && entry.data.hash === wanted.data.hash) {
      keep.push(entry.identifier);
      kept.add(entry.identifier);
    } else {
      cancel.push(entry.identifier);
    }
  }

  const schedule = [...desiredById.values()].filter((spec) => !kept.has(spec.identifier));
  return { cancel, schedule, keep };
}

/** Pending snoozes (kind 'snooze') among the existing entries. */
export function snoozeEntries(existing: readonly ScheduledEntry[]): ScheduledEntry[] {
  return existing.filter((entry) => parseNotificationId(entry.identifier)?.kind === 'snooze');
}

/**
 * Notifications created by the pre-rebuild app (random ids; data.alertType / data.type 'persistent'
 * / the ongoing "persistent-meeting-notification"). They reference old data and are removed.
 */
export function isLegacyNotification(identifier: string, data: unknown): boolean {
  if (isMeetingGuardNotificationId(identifier)) return false;
  if (identifier === LEGACY_PERSISTENT_NOTIFICATION_ID) return true;
  let value = data;
  if (typeof data === 'string') {
    try {
      value = JSON.parse(data);
    } catch {
      return false;
    }
  }
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.alertType === 'string' || record.type === 'persistent';
}
