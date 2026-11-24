/** M14: the guests' answers of one meeting, live while the screen is open. */
import { useEffect, useState } from 'react';

import { dataService } from '../data';
import { guestService, type GuestAnswer, type GuestService } from './guestService';

export function useGuestAnswers(meetingId: string | null, service: GuestService = guestService, getUid: () => string | null = () => dataService.getActiveUid()): GuestAnswer[] {
  const [answers, setAnswers] = useState<GuestAnswer[]>([]);
  const uid = getUid();
  useEffect(() => {
    if (meetingId === null || uid === null) return undefined;
    return service.subscribe(uid, meetingId, setAnswers);
  }, [meetingId, uid, service]);
  return meetingId === null || uid === null ? [] : answers;
}
