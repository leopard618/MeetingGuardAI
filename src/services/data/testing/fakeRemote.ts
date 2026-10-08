/**
 * In-memory RemoteStore for unit tests (not bundled: nothing in the app imports it).
 * Mimics the Firestore behaviours the engine relies on: asynchronous snapshots with docChanges,
 * `fromCache` snapshots while offline, transactions that read-then-write atomically, and
 * provider error codes ("unavailable", "permission-denied").
 */
import type { Unsubscribe } from '../../../core/events';
import type {
  CommitDecision,
  CommitResult,
  RemoteCollectionSnapshot,
  RemoteData,
  RemoteDocSnapshot,
  RemoteStore,
} from '../remote';

export class FakeProviderError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

interface CollectionListener {
  path: string;
  onNext: (snapshot: RemoteCollectionSnapshot) => void;
  onError: (error: never) => void;
  known: Map<string, string>;
  lastFromCache: boolean;
}

interface DocListener {
  path: string;
  onNext: (snapshot: RemoteDocSnapshot) => void;
  known: string | null | undefined;
}

function clone<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export class FakeRemote implements RemoteStore {
  isAvailable = true;
  online = true;
  readonly docs = new Map<string, RemoteData>();
  readonly commits: { path: string; decision: CommitDecision }[] = [];
  /** Errors thrown by the next commits (FIFO), e.g. new FakeProviderError('permission-denied'). */
  readonly commitFailures: unknown[] = [];
  /** Optional security-rules model: return false to reject a write with "permission-denied". */
  rules: ((path: string, before: RemoteData | null, after: RemoteData | null) => boolean) | null = null;
  private idCounter = 0;
  private readonly collectionListeners = new Set<CollectionListener>();
  private readonly docListeners = new Set<DocListener>();

  newId(): string {
    this.idCounter += 1;
    return `rid${this.idCounter}`;
  }

  private childIds(collectionPath: string): string[] {
    const prefix = `${collectionPath}/`;
    return [...this.docs.keys()]
      .filter((path) => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'))
      .map((path) => path.slice(prefix.length));
  }

  private emitCollection(listener: CollectionListener): void {
    if (!this.online) {
      if (!listener.lastFromCache) listener.onNext({ fromCache: true, ids: [...listener.known.keys()], changes: [] });
      listener.lastFromCache = true;
      return;
    }
    const ids = this.childIds(listener.path);
    const changes: RemoteCollectionSnapshot['changes'] = [];
    for (const id of ids) {
      const data = this.docs.get(`${listener.path}/${id}`) as RemoteData;
      const json = JSON.stringify(data);
      const previous = listener.known.get(id);
      if (previous === json) continue;
      changes.push({ type: previous === undefined ? 'added' : 'modified', id, data: clone(data) });
      listener.known.set(id, json);
    }
    for (const id of [...listener.known.keys()]) {
      if (!ids.includes(id)) {
        changes.push({ type: 'removed', id, data: null });
        listener.known.delete(id);
      }
    }
    if (changes.length > 0 || listener.lastFromCache) {
      listener.lastFromCache = false;
      listener.onNext({ fromCache: false, ids, changes });
    }
  }

  private emitDoc(listener: DocListener): void {
    if (!this.online) {
      listener.onNext({ fromCache: true, exists: false, data: null });
      return;
    }
    const data = this.docs.get(listener.path);
    const json = data === undefined ? null : JSON.stringify(data);
    if (listener.known === json) return;
    listener.known = json;
    listener.onNext({ fromCache: false, exists: data !== undefined, data: data === undefined ? null : clone(data) });
  }

  /** Delivers pending changes to every listener (like the SDK does after a server change). */
  notifyListeners(): void {
    for (const listener of this.collectionListeners) this.emitCollection(listener);
    for (const listener of this.docListeners) this.emitDoc(listener);
  }

  listenCollection(
    collectionPath: string,
    onNext: (snapshot: RemoteCollectionSnapshot) => void,
    onError: (error: never) => void,
  ): Unsubscribe {
    const listener: CollectionListener = { path: collectionPath, onNext, onError, known: new Map(), lastFromCache: false };
    this.collectionListeners.add(listener);
    void tick().then(() => {
      if (!this.collectionListeners.has(listener)) return;
      if (this.online) {
        const ids = this.childIds(collectionPath);
        const changes = ids.map((id) => {
          const data = this.docs.get(`${collectionPath}/${id}`) as RemoteData;
          listener.known.set(id, JSON.stringify(data));
          return { type: 'added' as const, id, data: clone(data) };
        });
        onNext({ fromCache: false, ids, changes });
      } else {
        listener.lastFromCache = true;
        onNext({ fromCache: true, ids: [], changes: [] });
      }
    });
    return () => {
      this.collectionListeners.delete(listener);
    };
  }

  listenDoc(docPath: string, onNext: (snapshot: RemoteDocSnapshot) => void): Unsubscribe {
    const listener: DocListener = { path: docPath, onNext, known: undefined };
    this.docListeners.add(listener);
    void tick().then(() => {
      if (this.docListeners.has(listener)) this.emitDoc(listener);
    });
    return () => {
      this.docListeners.delete(listener);
    };
  }

  private assertOnline(): void {
    if (!this.online) throw new FakeProviderError('unavailable');
  }

  async getDoc(docPath: string): Promise<{ exists: boolean; data: RemoteData | null }> {
    this.assertOnline();
    const data = this.docs.get(docPath);
    return { exists: data !== undefined, data: data === undefined ? null : clone(data) };
  }

  async getCollection(collectionPath: string): Promise<{ id: string; data: RemoteData }[]> {
    this.assertOnline();
    return this.childIds(collectionPath).map((id) => ({ id, data: clone(this.docs.get(`${collectionPath}/${id}`) as RemoteData) }));
  }

  async queryStartingFrom(collectionPath: string, fromIso: string): Promise<{ id: string; data: RemoteData }[]> {
    const all = await this.getCollection(collectionPath);
    return all.filter((item) => typeof item.data.startAt === 'string' && item.data.startAt >= fromIso);
  }

  async commit(docPath: string, decide: (current: RemoteData | null) => CommitDecision): Promise<CommitResult> {
    this.assertOnline();
    const failure = this.commitFailures.shift();
    if (failure !== undefined) throw failure;
    const stored = this.docs.get(docPath);
    const current = stored === undefined ? null : clone(stored);
    const decision = decide(current === null ? null : clone(current));
    let after: RemoteData | null | undefined;
    if (decision.type === 'write') after = clone(decision.data);
    else if (decision.type === 'merge') after = { ...(current ?? {}), ...clone(decision.data) };
    else if (decision.type === 'delete') after = null;
    if (after !== undefined) {
      if (this.rules && !this.rules(docPath, current, after)) throw new FakeProviderError('permission-denied');
      if (after === null) this.docs.delete(docPath);
      else this.docs.set(docPath, after);
    }
    this.commits.push({ path: docPath, decision });
    void tick().then(() => this.notifyListeners());
    return { current, decision };
  }

  /** Server-side change made "by another device". */
  serverSet(docPath: string, data: RemoteData): void {
    this.docs.set(docPath, clone(data));
    this.notifyListeners();
  }

  serverDelete(docPath: string): void {
    this.docs.delete(docPath);
    this.notifyListeners();
  }
}

const PROFILE_KEYS = ['uid', 'email', 'displayName', 'photoURL', 'createdAt', 'updatedAt', 'lastLoginAt', 'legacyMigratedAt'];
const PROFILE_PATH = /^users\/[^/]+$/;
const MEETING_PATH = /^users\/[^/]+\/meetings\/[^/]+$/;

/**
 * The parts of firestore.rules that shape client writes: profiles contain only the allowed keys
 * and are never deleted by clients; meeting updates keep userId/createdAt/source and produce a
 * current-shape document.
 */
export function strictRules(path: string, before: RemoteData | null, after: RemoteData | null): boolean {
  if (after === null) return !PROFILE_PATH.test(path);
  if (PROFILE_PATH.test(path)) return Object.keys(after).every((key) => PROFILE_KEYS.includes(key));
  if (MEETING_PATH.test(path)) {
    const valid = typeof after.startAt === 'string' && typeof after.userId === 'string' && typeof after.createdAt === 'string';
    if (!valid) return false;
    if (before === null) return true;
    return ['userId', 'createdAt', 'source'].every((key) => before[key] === after[key]);
  }
  return true;
}

/** Lets pending promises, microtasks and 0 ms timers run. */
export async function settle(rounds = 5): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    await tick();
  }
}
