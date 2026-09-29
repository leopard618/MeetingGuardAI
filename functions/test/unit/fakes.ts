import type { MeetingReader, MeetingRecord } from '../../src/assistant/context';
import type { QuotaStore, QuotaTransaction } from '../../src/assistant/quota';
import type { AiMeetingContextDoc } from '../../src/shared/aiContract';

/** In-memory quota store; transactions run one at a time like Firestore's document locks. */
export class FakeQuotaStore implements QuotaStore {
  readonly entitlements = new Map<string, unknown>();
  readonly usage = new Map<string, { count: number; updatedAt: string }>();
  transactions = 0;
  failNext: Error | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  runTransaction<T>(fn: (tx: QuotaTransaction) => Promise<T>): Promise<T> {
    const run = async (): Promise<T> => {
      this.transactions += 1;
      if (this.failNext) {
        const error = this.failNext;
        this.failNext = null;
        throw error;
      }
      const writes: (() => void)[] = [];
      const result = await fn({
        readEntitlement: async (uid) => this.entitlements.get(uid),
        readUsageCount: async (uid, day) => this.usage.get(`${uid}/${day}`)?.count ?? 0,
        writeUsageCount: (uid, day, count, updatedAt) => {
          writes.push(() => this.usage.set(`${uid}/${day}`, { count, updatedAt }));
        },
      });
      writes.forEach((write) => write());
      return result;
    };
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }

  count(uid: string, day: string): number {
    return this.usage.get(`${uid}/${day}`)?.count ?? 0;
  }
}

export function meetingDoc(overrides: Partial<AiMeetingContextDoc> = {}): AiMeetingContextDoc {
  return {
    title: 'Weekly sync',
    description: '',
    startAt: '2026-10-05T14:00:00.000Z',
    durationMinutes: 60,
    timezone: 'Europe/Madrid',
    allDay: false,
    status: 'scheduled',
    deletedAt: null,
    source: 'manual',
    participants: [],
    location: null,
    conference: null,
    ...overrides,
  };
}

export class FakeMeetingReader implements MeetingReader {
  readonly records = new Map<string, MeetingRecord>();
  rangeCalls: { fromIso: string; toIso: string; limit: number }[] = [];

  add(id: string, overrides: Partial<AiMeetingContextDoc> = {}): this {
    this.records.set(id, { id, doc: meetingDoc(overrides) });
    return this;
  }

  async listByStartRange(_uid: string, fromIso: string, toIso: string, limit: number): Promise<MeetingRecord[]> {
    this.rangeCalls.push({ fromIso, toIso, limit });
    return [...this.records.values()]
      .filter((record) => record.doc.startAt >= fromIso && record.doc.startAt <= toIso)
      .sort((a, b) => a.doc.startAt.localeCompare(b.doc.startAt))
      .slice(0, limit);
  }

  async get(_uid: string, meetingId: string): Promise<MeetingRecord | null> {
    return this.records.get(meetingId) ?? null;
  }
}
