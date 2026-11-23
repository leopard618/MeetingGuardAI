/** In-memory ports for the M13 bot-started messages (whatsapp/outbound*.ts, optin.ts, taps.ts). */
import type { AppLanguage } from '../../src/shared/aiContract';
import type { DayItem, OutboundReader, SummaryView, TaskView, UserPrefs } from '../../src/whatsapp/outbound';
import {
  emptyMessagesRecord,
  parseDebriefArm,
  type DebriefArm,
  type MessagesRecord,
  type OptedInUser,
  type OutboundStore,
  type SendRecord,
  type TemplateState,
} from '../../src/whatsapp/outboundStore';
import type { OutboundSender, TemplateMessage, WhatsappButton, WhatsappSender } from '../../src/whatsapp/send';

export class MemoryOutboundStore implements OutboundStore {
  records = new Map<string, MessagesRecord>();
  phones = new Map<string, string>();
  sends = new Map<string, SendRecord>();
  templates = new Map<string, TemplateState>();
  arms = new Map<string, DebriefArm | null>();

  link(uid: string, phone: string, record: Partial<MessagesRecord> = {}): void {
    this.phones.set(uid, phone);
    this.records.set(uid, { ...emptyMessagesRecord(), phoneE164: phone, ...record });
  }

  async getMessages(uid: string) {
    return { record: structuredClone(this.records.get(uid) ?? emptyMessagesRecord()), linkedPhone: this.phones.get(uid) ?? null };
  }
  async saveMessages(uid: string, record: MessagesRecord) {
    this.records.set(uid, structuredClone(record));
  }
  async patchMessages(uid: string, patch: Partial<MessagesRecord>) {
    this.records.set(uid, { ...(this.records.get(uid) ?? emptyMessagesRecord()), ...patch });
  }
  async listOptedIn(limit: number): Promise<OptedInUser[]> {
    return [...this.records.entries()]
      .filter(([, record]) => Object.values(record.switches).some(Boolean))
      .slice(0, limit)
      .map(([uid, record]) => ({ uid, linkedPhone: this.phones.get(uid) ?? null, record: structuredClone(record) }));
  }
  async queue(send: SendRecord) {
    if (this.sends.has(send.sendId)) return false;
    this.sends.set(send.sendId, structuredClone(send));
    return true;
  }
  async upsertQueued(send: SendRecord) {
    const current = this.sends.get(send.sendId);
    if (current && current.status !== 'queued') return;
    this.sends.set(send.sendId, structuredClone(send));
  }
  async dropQueued(sendId: string) {
    if (this.sends.get(sendId)?.status === 'queued') this.sends.delete(sendId);
  }
  async dropQueuedForUid(uid: string, kinds?: readonly string[]) {
    let dropped = 0;
    for (const [id, send] of this.sends) {
      if (send.uid === uid && send.status === 'queued' && (kinds === undefined || kinds.includes(send.kind))) {
        this.sends.delete(id);
        dropped += 1;
      }
    }
    return dropped;
  }
  async listDue(nowIso: string, limit: number) {
    return [...this.sends.values()]
      .filter((send) => send.queuedDueAt !== null && send.queuedDueAt <= nowIso)
      .sort((a, b) => (a.queuedDueAt! < b.queuedDueAt! ? -1 : 1))
      .slice(0, limit)
      .map((send) => structuredClone(send));
  }
  async claim(sendId: string, nowIso: string) {
    const send = this.sends.get(sendId);
    if (!send || send.status !== 'queued' || send.queuedDueAt === null || send.queuedDueAt > nowIso) return false;
    send.queuedDueAt = null;
    send.status = 'sent';
    send.sentAt = nowIso;
    return true;
  }
  async finish(sendId: string, patch: Partial<SendRecord>) {
    const send = this.sends.get(sendId);
    if (send) Object.assign(send, patch);
  }
  async get(sendId: string) {
    const send = this.sends.get(sendId);
    return send ? structuredClone(send) : null;
  }
  async updateStatusByWamid(wamid: string, status: SendRecord['status'], errorCode: number | null) {
    for (const send of this.sends.values()) {
      if (send.wamid === wamid) {
        send.status = status;
        if (errorCode !== null) send.errorCode = errorCode;
      }
    }
  }
  async getTemplate(name: string, language: string) {
    return this.templates.get(`${name}_${language}`) ?? null;
  }
  async setTemplate(name: string, language: string, state: Partial<TemplateState>) {
    const key = `${name}_${language}`;
    this.templates.set(key, { status: null, category: null, ttlSeconds: null, updatedAt: null, ...this.templates.get(key), ...state });
  }
  async armDebrief(phone: string, arm: DebriefArm) {
    this.arms.set(phone, structuredClone(arm));
  }
  async takeDebrief(phone: string, uid: string, now: Date) {
    const arm = parseDebriefArm(this.arms.get(phone));
    this.arms.set(phone, null);
    if (arm === null || arm.uid !== uid || Date.parse(arm.expiresAt) < now.getTime()) return null;
    return arm;
  }
}

export class MemoryReader implements OutboundReader {
  prefsByUid = new Map<string, UserPrefs>();
  items = new Map<string, DayItem[]>();
  tasks = new Map<string, TaskView[]>();
  summaries = new Map<string, SummaryView[]>();
  links = new Map<string, string>();
  allowance = true;
  pilot = new Set<string>();

  async prefs(uid: string): Promise<UserPrefs> {
    return this.prefsByUid.get(uid) ?? { uiLanguage: 'en', timezone: 'America/Costa_Rica', briefingTime: '08:00' };
  }
  async dayItems(uid: string, fromIso: string, toIso: string) {
    return (this.items.get(uid) ?? []).filter((item) => item.startAt >= fromIso && item.startAt < toIso);
  }
  async openTasks(uid: string) {
    return (this.tasks.get(uid) ?? []).filter((task) => task.status === 'open');
  }
  async task(uid: string, taskId: string) {
    return (this.tasks.get(uid) ?? []).find((task) => task.id === taskId) ?? null;
  }
  async meetingBlock(uid: string, meetingId: string, _language: AppLanguage) {
    const item = (this.items.get(uid) ?? []).find((entry) => entry.meetingId === meetingId);
    return item ? `*${item.title}*` : null;
  }
  async summary(uid: string, summaryId: string) {
    return (this.summaries.get(uid) ?? []).find((s) => s.summaryId === summaryId) ?? null;
  }
  async summariesAfter(uid: string, afterIso: string, limit: number) {
    return (this.summaries.get(uid) ?? []).filter((s) => s.receivedAt > afterIso).slice(0, limit);
  }
  async linkUid(phone: string) {
    return this.links.get(phone) ?? null;
  }
  async hasAllowance() {
    return this.allowance;
  }
  isCommitmentsPilot(uid: string) {
    return this.pilot.has(uid);
  }
}

export class RecordingSender implements WhatsappSender, OutboundSender {
  sent: { kind: 'text' | 'buttons' | 'template'; to: string; body?: string; buttons?: WhatsappButton[]; template?: TemplateMessage }[] = [];
  fail: Error | null = null;
  private next = 0;

  async sendText(to: string, body: string) {
    this.sent.push({ kind: 'text', to, body });
  }
  async sendButtons(to: string, body: string, buttons: readonly WhatsappButton[]) {
    this.sent.push({ kind: 'buttons', to, body, buttons: [...buttons] });
  }
  async sendTextWithId(to: string, body: string) {
    if (this.fail) throw this.fail;
    this.sent.push({ kind: 'text', to, body });
    return `wamid.${++this.next}`;
  }
  async sendButtonsWithId(to: string, body: string, buttons: readonly WhatsappButton[]) {
    if (this.fail) throw this.fail;
    this.sent.push({ kind: 'buttons', to, body, buttons: [...buttons] });
    return `wamid.${++this.next}`;
  }
  async sendTemplate(to: string, template: TemplateMessage) {
    if (this.fail) throw this.fail;
    this.sent.push({ kind: 'template', to, template });
    return `wamid.${++this.next}`;
  }
}
