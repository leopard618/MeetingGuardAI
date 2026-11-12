/**
 * The one-time AI notice of the summary commitments (owner: summaries-app; M11 decision 17,
 * docs/v2/M11-DESIGN.md sections 1 and 7). Before the first AI preparation on a phone, the review
 * screen says that the summary text goes to OpenAI through our server, with "Show the action items
 * as written" as the no-AI alternative.
 *
 * The ONE thing M11 stores on the phone: a boolean "notice seen", device-wide (once per phone, not
 * per account), under COMMITMENTS_AI_NOTICE_KEY. No content, no ids. Absent (or unreadable) means
 * not shown yet, so a broken storage shows the notice again rather than skipping it. Every read and
 * write is wrapped: a storage failure never fails the screen. Once marked in this run, the notice
 * stays seen for the rest of the run even if the write failed.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

import { createLogger } from '../../core/logger';

const log = createLogger('summaries.commitments');

/** Device-wide (survives sign-out, like the other mg:device keys); the value is '1' once seen. */
export const COMMITMENTS_AI_NOTICE_KEY = 'mg:device:summaries.commitments.aiNotice';
const SEEN_VALUE = '1';

/** The part of AsyncStorage the flag needs (tests inject a fake). */
export interface CommitmentsNoticeStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

/** Marked during this run (kept even when the write failed). */
let seenThisRun = false;

/** Whether the notice was seen on this phone. Never throws: an unreadable flag reads as not seen. */
export async function hasSeenCommitmentsAiNotice(storage: CommitmentsNoticeStorage = AsyncStorage): Promise<boolean> {
  if (seenThisRun) return true;
  try {
    return (await storage.getItem(COMMITMENTS_AI_NOTICE_KEY)) === SEEN_VALUE;
  } catch {
    log.warn('AI notice flag unreadable');
    return false;
  }
}

/** Records that the notice was seen (after Continue). Never throws. */
export async function markCommitmentsAiNoticeSeen(storage: CommitmentsNoticeStorage = AsyncStorage): Promise<void> {
  seenThisRun = true;
  try {
    await storage.setItem(COMMITMENTS_AI_NOTICE_KEY, SEEN_VALUE);
  } catch {
    log.warn('AI notice flag not saved');
  }
}

/** Tests only: forget the in-run mark. */
export function resetCommitmentsAiNoticeForTests(): void {
  seenThisRun = false;
}

export interface UseCommitmentsAiNoticeResult {
  /** null while the flag is read; then whether the notice was already seen on this phone. */
  seen: boolean | null;
  /** Records the notice as seen (Continue). Never throws. */
  markSeen(): Promise<void>;
}

/** The AI notice flag for a screen: read once on mount. */
export function useCommitmentsAiNotice(options: { storage?: CommitmentsNoticeStorage } = {}): UseCommitmentsAiNoticeResult {
  const storage = options.storage ?? AsyncStorage;
  const [seen, setSeen] = useState<boolean | null>(seenThisRun ? true : null);

  useEffect(() => {
    let active = true;
    void hasSeenCommitmentsAiNotice(storage).then((value) => {
      if (active) setSeen((current) => (current === true ? true : value));
    });
    return () => {
      active = false;
    };
  }, [storage]);

  const markSeen = useCallback(async (): Promise<void> => {
    setSeen(true);
    await markCommitmentsAiNoticeSeen(storage);
  }, [storage]);

  return { seen, markSeen };
}
