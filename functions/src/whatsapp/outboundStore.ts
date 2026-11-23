/**
 * M13: the state of the messages the bot starts (docs/v2/WhatsApp-Templates-2026-11-12.md
 * section 7). Server-only Firestore, like every whatsapp* collection (firestore.rules):
 *
 * - whatsappUsers/{uid}.messages: the opt-in record (switches, the phone it was given for, the
 *   STOP time, the device zone, the scheduler cursors). `messagesActive` (top level, single-field
 *   index) is true while at least one switch is on, so the scheduler finds opted-in users.
 * - whatsappSends/{sendId}: the send log AND the queue. sendId = sha256(dedupe key), so each
 *   message (one agenda per day, one debrief per occurrence, one reminder per fire time, one
 *   commitments message per summary) is created once. `queuedDueAt` is set while queued and null
 *   after; the scheduler reads `queuedDueAt <= now` (single-field range, no composite index).
 *   Taps carry `<prefix>:<sendId>` and are honoured only for the same uid and phone.
 * - whatsappTemplates/{name}_{language}: status, category and validity reported by Meta.
 */
import { createHash } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';

import { WHATSAPP_OUTBOUND_TUNING } from '../config';
import { WHATSAPP_MESSAGE_SWITCHES, type WhatsappMessageSwitches } from '../shared/aiContract';
import type { OutboundKind, TemplateLanguage } from './templates';

export const WHATSAPP_SENDS_COLLECTION = 'whatsappSends';
export const WHATSAPP_TEMPLATES_COLLECTION = 'whatsappTemplates';
const USERS = 'whatsappUsers';
const SESSIONS = 'whatsappSessions';

// ---------------------------------------------------------------------------------------------
// The opt-in record
// ---------------------------------------------------------------------------------------------

export interface MessagesRecord {
  phoneE164: string | null;
  switches: WhatsappMessageSwitches;
  wordingVersion: number;
  optedInAt: string | null;
  updatedAt: string | null;
  stoppedAt: string | null;
  deviceTimeZone: string | null;
  /** Local date of the last agenda sent (or skipped as empty). */
  lastAgendaDate: string | null;
  /** Debrief prompts are planned for occurrences ending after this instant. */
  debriefCursor: string | null;
  debriefDay: { date: string; count: number } | null;
}

export const NO_SWITCHES: WhatsappMessageSwitches = Object.freeze({
  agenda: false,
  debrief: false,
  confirmations: false,
  commitments: false,
  reminders: false,
});

export function emptyMessagesRecord(): MessagesRecord {
  return {
    phoneE164: null,
    switches: { ...NO_SWITCHES },
    wordingVersion: 0,
    optedInAt: null,
    updatedAt: null,
    stoppedAt: null,
    deviceTimeZone: null,
    lastAgendaDate: null,
    debriefCursor: null,
    debriefDay: null,
  };
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Lenient read of whatsappUsers/{uid}.messages (server-written; tolerate drift). */
export function parseMessagesRecord(raw: unknown): MessagesRecord {
  const record = emptyMessagesRecord();
  if (typeof raw !== 'object' || raw === null) return record;
  const data = raw as Record<string, unknown>;
  const switches = typeof data.switches === 'object' && data.switches !== null ? (data.switches as Record<string, unknown>) : {};
  for (const key of WHATSAPP_MESSAGE_SWITCHES) record.switches[key] = switches[key] === true;
  record.phoneE164 = str(data.phoneE164);
  record.wordingVersion = typeof data.wordingVersion === 'number' ? data.wordingVersion : 0;
  record.optedInAt = str(data.optedInAt);
  record.updatedAt = str(data.updatedAt);
  record.stoppedAt = str(data.stoppedAt);
  record.deviceTimeZone = str(data.deviceTimeZone);
  record.lastAgendaDate = str(data.lastAgendaDate);
  record.debriefCursor = str(data.debriefCursor);
  const day = data.debriefDay as Record<string, unknown> | null | undefined;
  record.debriefDay = day && typeof day.date === 'string' && typeof day.count === 'number' ? { date: day.date, count: day.count } : null;
  return record;
}

export function anySwitchOn(switches: WhatsappMessageSwitches): boolean {
  return WHATSAPP_MESSAGE_SWITCHES.some((key) => switches[key]);
}

export interface OptedInUser {
  uid: string;
  /** whatsappUsers/{uid}.phoneE164: the phone linked now. */
  linkedPhone: string | null;
  record: MessagesRecord;
}

// ---------------------------------------------------------------------------------------------
// The send log
// ---------------------------------------------------------------------------------------------

export type SendStatus = 'queued' | 'sent' | 'delivered' | 'read' | 'skipped' | 'failed';

export interface SendTarget {
  meetingId?: string;
  /** Series occurrence (original local date), null for a one-off. */
  occurrenceDate?: string | null;
  taskId?: string;
  summaryId?: string;
  /** Reminders: the fire time this entry was planned for (checked again at send), or 'snooze'. */
  fireAt?: string;
  /** Agenda: the local date it covers. */
  date?: string;
  /** Debrief: the occurrence title shown, for the tap reply. */
  title?: string;
}

export interface SendRecord {
  sendId: string;
  uid: string;
  kind: OutboundKind;
  status: SendStatus;
  target: SendTarget;
  queuedDueAt: string | null;
  createdAt: string;
  sentAt: string | null;
  phone: string | null;
  language: TemplateLanguage | null;
  wamid: string | null;
  errorCode: number | null;
  /** Why a send was skipped or failed (a code, never content). */
  reason: string | null;
  tapExpiresAt: string | null;
  /** Retention: dailyMaintenance deletes the entry after this. */
  expiresAt: string;
}

export function sendIdOf(dedupeKey: string): string {
  return createHash('sha256').update(`wa-send:v1:${dedupeKey}`).digest('hex').slice(0, 32);
}

function parseSend(sendId: string, raw: unknown): SendRecord | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const d = raw as Record<string, unknown>;
  if (typeof d.uid !== 'string' || typeof d.kind !== 'string' || typeof d.status !== 'string') return null;
  return {
    sendId,
    uid: d.uid,
    kind: d.kind as OutboundKind,
    status: d.status as SendStatus,
    target: (typeof d.target === 'object' && d.target !== null ? d.target : {}) as SendTarget,
    queuedDueAt: str(d.queuedDueAt),
    createdAt: str(d.createdAt) ?? '',
    sentAt: str(d.sentAt),
    phone: str(d.phone),
    language: d.language === 'es' || d.language === 'en' ? d.language : null,
    wamid: str(d.wamid),
    errorCode: typeof d.errorCode === 'number' ? d.errorCode : null,
    reason: str(d.reason),
    tapExpiresAt: str(d.tapExpiresAt),
    expiresAt: str(d.expiresAt) ?? '',
  };
}

export interface TemplateState {
  status: string | null;
  category: string | null;
  ttlSeconds: number | null;
  updatedAt: string | null;
}

export interface OutboundStore {
  getMessages(uid: string): Promise<{ record: MessagesRecord; linkedPhone: string | null }>;
  /** Merge-writes the record and the messagesActive flag. */
  saveMessages(uid: string, record: MessagesRecord): Promise<void>;
  /** Merge-writes some fields of the record (scheduler cursors), never the switches. */
  patchMessages(uid: string, patch: Partial<Pick<MessagesRecord, 'lastAgendaDate' | 'debriefCursor' | 'debriefDay' | 'deviceTimeZone'>>): Promise<void>;
  listOptedIn(limit: number): Promise<OptedInUser[]>;
  /** Creates the entry; false when it exists already (the dedupe). */
  queue(send: SendRecord): Promise<boolean>;
  /** Creates or replaces a still-queued entry (reminders move with their task); never a sent one. */
  upsertQueued(send: SendRecord): Promise<void>;
  /** Deletes the entry while it is still queued. */
  dropQueued(sendId: string): Promise<void>;
  /** Deletes every still-queued entry of the uid (all kinds, or only these). */
  dropQueuedForUid(uid: string, kinds?: readonly OutboundKind[]): Promise<number>;
  listDue(nowIso: string, limit: number): Promise<SendRecord[]>;
  /**
   * Takes a due entry for sending (a transaction): queuedDueAt cleared, status 'sent' provisional.
   * false when another tick took it or it is no longer queued.
   */
  claim(sendId: string, nowIso: string): Promise<boolean>;
  finish(sendId: string, patch: Partial<Pick<SendRecord, 'status' | 'queuedDueAt' | 'sentAt' | 'phone' | 'language' | 'wamid' | 'errorCode' | 'reason' | 'tapExpiresAt'>>): Promise<void>;
  get(sendId: string): Promise<SendRecord | null>;
  /** Delivery statuses from the webhook (by wamid). */
  updateStatusByWamid(wamid: string, status: SendStatus, errorCode: number | null): Promise<void>;
  getTemplate(name: string, language: TemplateLanguage): Promise<TemplateState | null>;
  setTemplate(name: string, language: string, state: Partial<TemplateState>): Promise<void>;
  /** "Debrief" tapped: the next message of this phone is the debrief (whatsappSessions/{phone}.debriefArm). */
  armDebrief(phoneE164: string, arm: DebriefArm): Promise<void>;
  /** Takes the armed debrief (a transaction): null when none, or expired, or for another uid. */
  takeDebrief(phoneE164: string, uid: string, now: Date): Promise<DebriefArm | null>;
}

export interface DebriefArm {
  uid: string;
  meetingId: string;
  occurrenceDate: string | null;
  title: string;
  expiresAt: string;
}

export function parseDebriefArm(raw: unknown): DebriefArm | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const d = raw as Record<string, unknown>;
  if (typeof d.uid !== 'string' || typeof d.meetingId !== 'string' || typeof d.expiresAt !== 'string') return null;
  return { uid: d.uid, meetingId: d.meetingId, occurrenceDate: str(d.occurrenceDate), title: typeof d.title === 'string' ? d.title : '', expiresAt: d.expiresAt };
}

export function firestoreOutboundStore(db: Firestore): OutboundStore {
  const userRef = (uid: string) => db.doc(`${USERS}/${uid}`);
  const sendRef = (sendId: string) => db.doc(`${WHATSAPP_SENDS_COLLECTION}/${sendId}`);
  const templateRef = (name: string, language: string) => db.doc(`${WHATSAPP_TEMPLATES_COLLECTION}/${name}_${language}`);

  function toDoc(send: SendRecord): Record<string, unknown> {
    const { sendId: _sendId, ...rest } = send;
    return { v: 1, ...rest };
  }

  return {
    async getMessages(uid) {
      const snapshot = await userRef(uid).get();
      const data = (snapshot.exists ? snapshot.data() : {}) as Record<string, unknown>;
      return { record: parseMessagesRecord(data.messages), linkedPhone: str(data.phoneE164) };
    },
    async saveMessages(uid, record) {
      await userRef(uid).set({ messages: { v: 1, ...record }, messagesActive: anySwitchOn(record.switches) }, { merge: true });
    },
    async patchMessages(uid, patch) {
      const fields: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(patch)) fields[`messages.${key}`] = value;
      if (Object.keys(fields).length > 0) await userRef(uid).update(fields);
    },
    async listOptedIn(limit) {
      const snapshot = await db.collection(USERS).where('messagesActive', '==', true).limit(limit).get();
      return snapshot.docs.map((doc) => {
        const data = doc.data() as Record<string, unknown>;
        return { uid: doc.id, linkedPhone: str(data.phoneE164), record: parseMessagesRecord(data.messages) };
      });
    },
    async queue(send) {
      try {
        await sendRef(send.sendId).create(toDoc(send));
        return true;
      } catch (error) {
        const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : null;
        if (code === 6 || code === 'already-exists') return false;
        throw error;
      }
    },
    upsertQueued(send) {
      return db.runTransaction(async (tx) => {
        const snapshot = await tx.get(sendRef(send.sendId));
        const current = snapshot.exists ? parseSend(send.sendId, snapshot.data()) : null;
        if (current !== null && current.status !== 'queued') return;
        tx.set(sendRef(send.sendId), toDoc(send));
      });
    },
    dropQueued(sendId) {
      return db.runTransaction(async (tx) => {
        const snapshot = await tx.get(sendRef(sendId));
        const current = snapshot.exists ? parseSend(sendId, snapshot.data()) : null;
        if (current !== null && current.status === 'queued') tx.delete(sendRef(sendId));
      });
    },
    async dropQueuedForUid(uid, kinds) {
      const snapshot = await db.collection(WHATSAPP_SENDS_COLLECTION).where('uid', '==', uid).limit(500).get();
      let dropped = 0;
      const batch = db.batch();
      for (const doc of snapshot.docs) {
        const send = parseSend(doc.id, doc.data());
        if (send === null || send.status !== 'queued') continue;
        if (kinds !== undefined && !kinds.includes(send.kind)) continue;
        batch.delete(doc.ref);
        dropped += 1;
      }
      if (dropped > 0) await batch.commit();
      return dropped;
    },
    async listDue(nowIso, limit) {
      const snapshot = await db.collection(WHATSAPP_SENDS_COLLECTION).where('queuedDueAt', '<=', nowIso).orderBy('queuedDueAt').limit(limit).get();
      return snapshot.docs.map((doc) => parseSend(doc.id, doc.data())).filter((send): send is SendRecord => send !== null);
    },
    claim(sendId, nowIso) {
      return db.runTransaction(async (tx) => {
        const snapshot = await tx.get(sendRef(sendId));
        const current = snapshot.exists ? parseSend(sendId, snapshot.data()) : null;
        if (current === null || current.status !== 'queued' || current.queuedDueAt === null || current.queuedDueAt > nowIso) return false;
        tx.update(sendRef(sendId), { queuedDueAt: null, status: 'sent', sentAt: nowIso });
        return true;
      });
    },
    async finish(sendId, patch) {
      await sendRef(sendId).set(patch, { merge: true });
    },
    async get(sendId) {
      const snapshot = await sendRef(sendId).get();
      return snapshot.exists ? parseSend(sendId, snapshot.data()) : null;
    },
    async updateStatusByWamid(wamid, status, errorCode) {
      const snapshot = await db.collection(WHATSAPP_SENDS_COLLECTION).where('wamid', '==', wamid).limit(1).get();
      const doc = snapshot.docs[0];
      if (!doc) return;
      const rank: Record<string, number> = { sent: 1, delivered: 2, read: 3 };
      const current = String((doc.data() as Record<string, unknown>).status ?? '');
      // Statuses can arrive out of order: never step back from read to delivered.
      if (status !== 'failed' && (rank[current] ?? 0) >= (rank[status] ?? 0)) return;
      await doc.ref.set({ status, ...(errorCode !== null ? { errorCode } : {}) }, { merge: true });
    },
    async getTemplate(name, language) {
      const snapshot = await templateRef(name, language).get();
      if (!snapshot.exists) return null;
      const d = snapshot.data() as Record<string, unknown>;
      return {
        status: str(d.status),
        category: str(d.category),
        ttlSeconds: typeof d.ttlSeconds === 'number' ? d.ttlSeconds : null,
        updatedAt: str(d.updatedAt),
      };
    },
    async setTemplate(name, language, state) {
      await templateRef(name, language).set({ name, language, ...state }, { merge: true });
    },
    async armDebrief(phoneE164, arm) {
      await db.doc(`${SESSIONS}/${phoneE164}`).set({ debriefArm: arm }, { merge: true });
    },
    takeDebrief(phoneE164, uid, now) {
      const ref = db.doc(`${SESSIONS}/${phoneE164}`);
      return db.runTransaction(async (tx) => {
        const snapshot = await tx.get(ref);
        if (!snapshot.exists) return null;
        const arm = parseDebriefArm((snapshot.data() as Record<string, unknown>).debriefArm);
        if (arm === null) return null;
        tx.set(ref, { debriefArm: null }, { merge: true });
        if (arm.uid !== uid || Date.parse(arm.expiresAt) < now.getTime()) return null;
        return arm;
      });
    },
  };
}

/** A fresh queued entry. */
export function newSend(input: {
  dedupeKey: string;
  uid: string;
  kind: OutboundKind;
  target: SendTarget;
  dueAt: string;
  now: Date;
}): SendRecord {
  return {
    sendId: sendIdOf(input.dedupeKey),
    uid: input.uid,
    kind: input.kind,
    status: 'queued',
    target: input.target,
    queuedDueAt: input.dueAt,
    createdAt: input.now.toISOString(),
    sentAt: null,
    phone: null,
    language: null,
    wamid: null,
    errorCode: null,
    reason: null,
    tapExpiresAt: null,
    expiresAt: new Date(Math.max(Date.parse(input.dueAt), input.now.getTime()) + WHATSAPP_OUTBOUND_TUNING.sendRetentionDays * 86_400_000).toISOString(),
  };
}
