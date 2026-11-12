/**
 * The one-time AI notice of the summary commitments (owner: summaries-app; M11 decision 17,
 * docs/v2/M11-DESIGN.md sections 1 and 7). Before an account's first AI preparation, the review
 * screen says that the summary text goes to OpenAI through our server, with "Show the action items
 * as written" as the no-AI alternative.
 *
 * The ONE thing M11 stores on the phone: a boolean "notice seen" PER ACCOUNT (Apple 5.1.2(i) asks
 * each person before their data goes to a third-party AI), under mg:{uid}:summaries.commitments.aiNotice
 * (USER_STORAGE.summariesAiNotice). No content, no ids. The data layer wipes it with every other
 * mg:{uid}:* key on sign-out, so the notice shows again after the next sign-in. Absent (or
 * unreadable) means not shown yet, so a broken storage shows the notice again rather than skipping
 * it. Every read and write is wrapped: a storage failure never fails the screen. Once an account
 * marks it in this run, the notice stays seen for that account for the rest of the run even if the
 * write failed; another account on the same phone still sees it.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

import { USER_STORAGE, userStorageKey } from '../../core/identifiers';
import { createLogger } from '../../core/logger';

const log = createLogger('summaries.commitments');

const SEEN_VALUE = '1';

/** The account's flag key: mg:{uid}:summaries.commitments.aiNotice; the value is '1' once seen. */
export function commitmentsAiNoticeKey(uid: string): string {
  return userStorageKey(uid, USER_STORAGE.summariesAiNotice);
}

/** The part of AsyncStorage the flag needs (tests inject a fake). */
export interface CommitmentsNoticeStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

/** Accounts marked during this run (kept even when the write failed). */
const seenThisRun = new Set<string>();

/** Whether this account saw the notice. Never throws: an unreadable flag reads as not seen. */
export async function hasSeenCommitmentsAiNotice(uid: string, storage: CommitmentsNoticeStorage = AsyncStorage): Promise<boolean> {
  if (seenThisRun.has(uid)) return true;
  try {
    return (await storage.getItem(commitmentsAiNoticeKey(uid))) === SEEN_VALUE;
  } catch {
    log.warn('AI notice flag unreadable');
    return false;
  }
}

/** Records that this account saw the notice (after Continue). Never throws. */
export async function markCommitmentsAiNoticeSeen(uid: string, storage: CommitmentsNoticeStorage = AsyncStorage): Promise<void> {
  seenThisRun.add(uid);
  try {
    await storage.setItem(commitmentsAiNoticeKey(uid), SEEN_VALUE);
  } catch {
    log.warn('AI notice flag not saved');
  }
}

/** Tests only: forget the in-run marks. */
export function resetCommitmentsAiNoticeForTests(): void {
  seenThisRun.clear();
}

export interface UseCommitmentsAiNoticeResult {
  /** null while the flag is read (or signed out); then whether this account already saw the notice. */
  seen: boolean | null;
  /** Records the notice as seen for this account (Continue). Never throws. */
  markSeen(): Promise<void>;
}

/**
 * The AI notice flag of the signed-in account for a screen: read on mount and again when the
 * account changes. A null uid (signed out) reads as null, and markSeen then stores nothing.
 */
export function useCommitmentsAiNotice(uid: string | null, options: { storage?: CommitmentsNoticeStorage } = {}): UseCommitmentsAiNoticeResult {
  const storage = options.storage ?? AsyncStorage;
  const [state, setState] = useState<{ uid: string; seen: boolean } | null>(() =>
    uid !== null && seenThisRun.has(uid) ? { uid, seen: true } : null,
  );

  useEffect(() => {
    if (uid === null) return;
    let active = true;
    void hasSeenCommitmentsAiNotice(uid, storage).then((value) => {
      if (!active) return;
      setState((current) => (current !== null && current.uid === uid && current.seen ? current : { uid, seen: value }));
    });
    return () => {
      active = false;
    };
  }, [uid, storage]);

  const markSeen = useCallback(async (): Promise<void> => {
    if (uid === null) return;
    setState({ uid, seen: true });
    await markCommitmentsAiNoticeSeen(uid, storage);
  }, [uid, storage]);

  // A value read for another account never counts for this one.
  const seen = uid !== null && state !== null && state.uid === uid ? state.seen : null;
  return { seen, markSeen };
}
