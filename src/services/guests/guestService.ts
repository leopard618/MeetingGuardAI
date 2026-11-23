/**
 * M14: guest invitation links in the app (functions/src/guests; the page: public/g).
 *
 * - One reply link per meeting (guestLinkCreate is idempotent): the form puts it into the
 *   invitation text of a new meeting with guests before the first calendar push, and meeting
 *   details can add it later or share it. Nothing new is stored on the meeting document: the
 *   link is one line of the description, so calendars and older app versions carry it as text.
 * - The guests' answers live in users/{uid}/guestResponses (server written). The owner reads
 *   them and marks each one seen, approved or declined; approving a proposal moves the meeting
 *   through the normal meeting update (origin 'user'), so alarms and calendars follow.
 */
import { collection, doc, onSnapshot, query, updateDoc, where, type Firestore } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';

import {
  CALLABLES,
  GUEST_TOKEN_PATTERN,
  guestLinkCreateResponseSchema,
  guestResponseDocSchema,
  type GuestResponseDoc,
} from '../../core/aiContract';
import { AppError } from '../../core/errors';
import { createLogger } from '../../core/logger';
import { db, functions } from '../../config/firebase';
import { mapWhatsAppError } from '../whatsapp/whatsappService';

export { GUEST_PAGE_URL, guestLinkUrl, hasGuestLink, newMeetingId, withGuestLink, withoutGuestLink } from './guestLinks';

const log = createLogger('guests');

export interface GuestAnswer extends GuestResponseDoc {
  id: string;
}

export interface GuestService {
  createLink(meetingId: string): Promise<string>;
  revokeLink(meetingId: string): Promise<void>;
  subscribe(uid: string, meetingId: string | null, listener: (answers: GuestAnswer[]) => void): () => void;
  decide(uid: string, answerId: string, state: 'seen' | 'approved' | 'declined' | 'superseded'): Promise<void>;
}

export function createGuestService(deps: { getDb(): Firestore | null; call(name: string, data: unknown, timeoutMs: number): Promise<unknown> }): GuestService {
  return {
    async createLink(meetingId) {
      let raw: unknown;
      try {
        raw = await deps.call(CALLABLES.guestLinkCreate, { meetingId }, 8_000);
      } catch (error) {
        const mapped = mapWhatsAppError(error);
        log.warn('guestLinkCreate failed', { code: mapped.code });
        throw mapped;
      }
      const parsed = guestLinkCreateResponseSchema.safeParse(raw);
      if (!parsed.success || !GUEST_TOKEN_PATTERN.test(parsed.data.token)) throw new AppError('upstream_error', 'invalid guestLinkCreate response');
      return parsed.data.token;
    },
    async revokeLink(meetingId) {
      try {
        await deps.call(CALLABLES.guestLinkRevoke, { meetingId }, 8_000);
      } catch (error) {
        throw mapWhatsAppError(error);
      }
    },
    subscribe(uid, meetingId, listener) {
      const firestore = deps.getDb();
      if (!firestore) {
        listener([]);
        return () => undefined;
      }
      const base = collection(firestore, `users/${uid}/guestResponses`);
      const q = meetingId === null ? query(base, where('state', '==', 'new')) : query(base, where('meetingId', '==', meetingId));
      return onSnapshot(
        q,
        (snapshot) => {
          const answers: GuestAnswer[] = [];
          for (const item of snapshot.docs) {
            const parsed = guestResponseDocSchema.safeParse(item.data());
            if (parsed.success) answers.push({ ...parsed.data, id: item.id });
          }
          answers.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
          listener(answers);
        },
        (error) => {
          log.warn('guest answers listener failed', { code: (error as { code?: string }).code ?? 'unknown' });
          listener([]);
        },
      );
    },
    async decide(uid, answerId, state) {
      const firestore = deps.getDb();
      if (!firestore) throw new AppError('not_configured', 'Firebase is not configured in this build');
      const nowIso = new Date().toISOString();
      await updateDoc(doc(firestore, `users/${uid}/guestResponses/${answerId}`), {
        state,
        decidedAt: state === 'seen' ? null : nowIso,
        updatedAt: nowIso,
      });
    },
  };
}

export const guestService: GuestService = createGuestService({
  getDb: () => db,
  async call(name, data, timeoutMs) {
    if (!functions) throw new AppError('not_configured', 'Firebase is not configured in this build');
    return (await httpsCallable(functions, name, { timeout: timeoutMs })(data)).data;
  },
});
