/**
 * In-memory Firestore fake for the M10 summary tests (store, inbound, callables, read). Not a test
 * file itself (no *.test.ts suffix). It implements the slice of firebase-admin Firestore those
 * modules use, with real-Firestore behaviour where correctness depends on it; pass it to code under
 * test as `fake as unknown as Firestore`.
 *
 * Supported:
 * - db.doc(path), db.collection(path), db.collectionGroup(id), db.getAll(...refs, { fieldMask }),
 *   db.runTransaction(fn).
 * - DocumentReference: id, path, parent, collection(id), get(), set(data, { merge }), create(data)
 *   (fails with code 6 ALREADY_EXISTS), update(data) (fails with code 5 NOT_FOUND; top-level and
 *   dotted field paths each replace the whole value), delete().
 * - Queries (collection or collection group): where(field, op, value) with ==, !=, <, <=, >, >=,
 *   in, not-in, array-contains, array-contains-any (a document missing the field never matches,
 *   like Firestore; range filters compare numbers with numbers and strings with strings only),
 *   orderBy(field, 'asc' | 'desc') (documents missing the field are left out), limit(n),
 *   select(...fields) (field masks; select() returns empty data), get(), count().get().
 *   Results come in document path order unless ordered.
 * - Transactions run one at a time (like Firestore's locks). tx.get(ref | query), tx.getAll(...refs,
 *   { fieldMask }); tx.set / create / update / delete are buffered and applied atomically at commit.
 *   A read after a write throws (a real Firestore rule). create and update preconditions are
 *   checked at commit, so a failed precondition applies nothing. `failNextCommit` makes the next
 *   commit (transaction or single write) fail with that error and write nothing.
 * - Written data is deep-cloned; `undefined` anywhere in it throws, as the admin SDK does without
 *   ignoreUndefinedProperties. merge: true deep-merges maps (arrays are replaced).
 * - `log` records every operation: 'get:<path>', 'query:<collection>', 'count:<collection>',
 *   'set:<path>', 'create:<path>', 'update:<path>', 'delete:<path>', 'commit', 'abort'.
 *   `transactions` records each transaction's reads, writes and whether it committed.
 * Not supported: FieldValue sentinels, Timestamp values, cursors (startAt, startAfter), OR filters,
 * listeners, retries on contention.
 */

export type FakeData = Record<string, unknown>;

export const GRPC_NOT_FOUND = 5;
export const GRPC_ALREADY_EXISTS = 6;

/** Errors the fake throws for failed preconditions; `code` follows the gRPC codes of the admin SDK. */
export class FakeFirestoreError extends Error {
  readonly code: number;

  constructor(code: number, message: string) {
    super(message);
    this.name = 'FakeFirestoreError';
    this.code = code;
  }
}

export interface FakeDocumentSnapshot {
  exists: boolean;
  id: string;
  ref: FakeDocumentReference;
  data(): FakeData | undefined;
  get(field: string): unknown;
}

export interface FakeQuerySnapshot {
  docs: FakeDocumentSnapshot[];
  empty: boolean;
  size: number;
  forEach(callback: (snapshot: FakeDocumentSnapshot) => void): void;
}

export type FakeWhereOp = '==' | '!=' | '<' | '<=' | '>' | '>=' | 'in' | 'not-in' | 'array-contains' | 'array-contains-any';

interface Filter {
  field: string;
  op: FakeWhereOp;
  value: unknown;
}

interface Order {
  field: string;
  direction: 'asc' | 'desc';
}

type Write =
  | { kind: 'set'; path: string; data: FakeData; merge: boolean }
  | { kind: 'create'; path: string; data: FakeData }
  | { kind: 'update'; path: string; data: FakeData }
  | { kind: 'delete'; path: string };

export interface FakeTransactionLog {
  reads: string[];
  writes: string[];
  committed: boolean;
}

// ---------------------------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------------------------

function isPlainObject(value: unknown): value is FakeData {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date);
}

function assertNoUndefined(value: unknown, where: string): void {
  if (value === undefined) throw new Error(`Cannot use "undefined" as a Firestore value (found in field "${where}").`);
  if (Array.isArray(value)) value.forEach((entry, index) => assertNoUndefined(entry, `${where}.${index}`));
  else if (isPlainObject(value)) for (const [key, entry] of Object.entries(value)) assertNoUndefined(entry, where === '' ? key : `${where}.${key}`);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function deepMerge(base: FakeData, patch: FakeData): FakeData {
  const out: FakeData = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    const current = out[key];
    out[key] = isPlainObject(value) && isPlainObject(current) ? deepMerge(current, value) : clone(value);
  }
  return out;
}

function getField(data: FakeData | undefined, field: string): { found: boolean; value: unknown } {
  let current: unknown = data;
  for (const part of field.split('.')) {
    if (!isPlainObject(current) || !(part in current)) return { found: false, value: undefined };
    current = current[part];
  }
  return { found: true, value: current };
}

function setField(data: FakeData, field: string, value: unknown): void {
  const parts = field.split('.');
  let current: FakeData = data;
  for (let index = 0; index < parts.length - 1; index += 1) {
    const part = parts[index] as string;
    const next = current[part];
    if (!isPlainObject(next)) current[part] = {};
    current = current[part] as FakeData;
  }
  current[parts[parts.length - 1] as string] = clone(value);
}

function project(data: FakeData, fields: readonly string[]): FakeData {
  const out: FakeData = {};
  for (const field of fields) {
    const { found, value } = getField(data, field);
    if (found) setField(out, field, value);
  }
  return out;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((entry, index) => deepEqual(entry, b[index]));
  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every((key) => deepEqual(a[key], b[key]));
  }
  return false;
}

function comparable(a: unknown, b: unknown): boolean {
  return (typeof a === 'number' && typeof b === 'number') || (typeof a === 'string' && typeof b === 'string');
}

function compareValues(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  const x = String(a);
  const y = String(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

function matchesFilter(data: FakeData, filter: Filter): boolean {
  const { found, value } = getField(data, filter.field);
  if (!found) return false;
  const target = filter.value;
  switch (filter.op) {
    case '==':
      return deepEqual(value, target);
    case '!=':
      return value !== null && !deepEqual(value, target);
    case '<':
      return comparable(value, target) && compareValues(value, target) < 0;
    case '<=':
      return comparable(value, target) && compareValues(value, target) <= 0;
    case '>':
      return comparable(value, target) && compareValues(value, target) > 0;
    case '>=':
      return comparable(value, target) && compareValues(value, target) >= 0;
    case 'in':
      return Array.isArray(target) && target.some((entry) => deepEqual(value, entry));
    case 'not-in':
      return Array.isArray(target) && value !== null && !target.some((entry) => deepEqual(value, entry));
    case 'array-contains':
      return Array.isArray(value) && value.some((entry) => deepEqual(entry, target));
    case 'array-contains-any':
      return Array.isArray(value) && Array.isArray(target) && value.some((entry) => target.some((t) => deepEqual(entry, t)));
    default:
      return false;
  }
}

function segments(path: string): string[] {
  const parts = path.split('/');
  if (parts.some((part) => part.length === 0)) throw new Error(`Invalid Firestore path "${path}".`);
  return parts;
}

// ---------------------------------------------------------------------------------------------
// References and queries
// ---------------------------------------------------------------------------------------------

export class FakeDocumentReference {
  constructor(
    readonly firestore: FakeFirestore,
    readonly path: string,
  ) {
    if (segments(path).length % 2 !== 0) throw new Error(`"${path}" is not a document path.`);
  }

  get id(): string {
    return this.path.slice(this.path.lastIndexOf('/') + 1);
  }

  get parent(): FakeCollectionReference {
    return new FakeCollectionReference(this.firestore, this.path.slice(0, this.path.lastIndexOf('/')));
  }

  collection(id: string): FakeCollectionReference {
    return new FakeCollectionReference(this.firestore, `${this.path}/${id}`);
  }

  async get(): Promise<FakeDocumentSnapshot> {
    this.firestore.log.push(`get:${this.path}`);
    return this.firestore.snapshotOf(this.path);
  }

  async set(data: FakeData, options?: { merge?: boolean }): Promise<void> {
    this.firestore.commitWrites([{ kind: 'set', path: this.path, data: this.firestore.prepare(data), merge: options?.merge === true }]);
  }

  async create(data: FakeData): Promise<void> {
    this.firestore.commitWrites([{ kind: 'create', path: this.path, data: this.firestore.prepare(data) }]);
  }

  async update(data: FakeData): Promise<void> {
    this.firestore.commitWrites([{ kind: 'update', path: this.path, data: this.firestore.prepare(data) }]);
  }

  async delete(): Promise<void> {
    this.firestore.commitWrites([{ kind: 'delete', path: this.path }]);
  }
}

interface QuerySource {
  /** A collection path (direct children), or null for a collection group. */
  collectionPath: string | null;
  /** The collection id for a collection group. */
  groupId: string | null;
}

export class FakeQuery {
  constructor(
    readonly firestore: FakeFirestore,
    protected readonly source: QuerySource,
    protected readonly filters: readonly Filter[] = [],
    protected readonly orders: readonly Order[] = [],
    protected readonly limitCount: number | null = null,
    protected readonly fields: readonly string[] | null = null,
  ) {}

  where(field: string, op: FakeWhereOp, value: unknown): FakeQuery {
    return new FakeQuery(this.firestore, this.source, [...this.filters, { field, op, value }], this.orders, this.limitCount, this.fields);
  }

  orderBy(field: string, direction: 'asc' | 'desc' = 'asc'): FakeQuery {
    return new FakeQuery(this.firestore, this.source, this.filters, [...this.orders, { field, direction }], this.limitCount, this.fields);
  }

  limit(count: number): FakeQuery {
    return new FakeQuery(this.firestore, this.source, this.filters, this.orders, count, this.fields);
  }

  select(...fields: string[]): FakeQuery {
    return new FakeQuery(this.firestore, this.source, this.filters, this.orders, this.limitCount, fields);
  }

  count(): { get(): Promise<{ data(): { count: number } }> } {
    return {
      get: async () => {
        this.firestore.log.push(`count:${this.label()}`);
        const count = this.matchingPaths().length;
        return { data: () => ({ count }) };
      },
    };
  }

  async get(): Promise<FakeQuerySnapshot> {
    this.firestore.log.push(`query:${this.label()}`);
    return this.run();
  }

  /**
   * Query.stream() as an async iterable of snapshots (candidates.ts reads meetings this way). Logged
   * like get(). Added for the inbound tests; the result is taken when the stream starts.
   */
  stream(): AsyncIterable<FakeDocumentSnapshot> {
    this.firestore.log.push(`query:${this.label()}`);
    const docs = this.run().docs;
    return {
      async *[Symbol.asyncIterator]() {
        for (const doc of docs) yield doc;
      },
    };
  }

  /** The label used in logs: the collection path or `group:<id>`. */
  label(): string {
    return this.source.collectionPath ?? `group:${this.source.groupId ?? ''}`;
  }

  /** Runs the query against the current data (used by get and by transactions). */
  run(): FakeQuerySnapshot {
    const docs = this.matchingPaths().map((path) => this.firestore.snapshotOf(path, this.fields));
    return { docs, empty: docs.length === 0, size: docs.length, forEach: (callback) => docs.forEach(callback) };
  }

  private inSource(path: string): boolean {
    const parts = path.split('/');
    if (this.source.collectionPath !== null) return path.slice(0, path.lastIndexOf('/')) === this.source.collectionPath;
    return parts.length >= 2 && parts[parts.length - 2] === this.source.groupId;
  }

  private matchingPaths(): string[] {
    let paths = [...this.firestore.docs.keys()].filter((path) => this.inSource(path)).sort();
    paths = paths.filter((path) => {
      const data = this.firestore.docs.get(path) ?? {};
      return this.filters.every((filter) => matchesFilter(data, filter));
    });
    if (this.orders.length > 0) {
      paths = paths.filter((path) => this.orders.every((order) => getField(this.firestore.docs.get(path), order.field).found));
      paths.sort((a, b) => {
        for (const order of this.orders) {
          const x = getField(this.firestore.docs.get(a), order.field).value;
          const y = getField(this.firestore.docs.get(b), order.field).value;
          const diff = compareValues(x, y);
          if (diff !== 0) return order.direction === 'asc' ? diff : -diff;
        }
        return a < b ? -1 : a > b ? 1 : 0;
      });
    }
    return this.limitCount === null ? paths : paths.slice(0, this.limitCount);
  }
}

export class FakeCollectionReference extends FakeQuery {
  constructor(
    firestore: FakeFirestore,
    readonly path: string,
  ) {
    super(firestore, { collectionPath: path, groupId: null });
    if (segments(path).length % 2 !== 1) throw new Error(`"${path}" is not a collection path.`);
  }

  get id(): string {
    return this.path.slice(this.path.lastIndexOf('/') + 1);
  }

  doc(id?: string): FakeDocumentReference {
    const docId = id ?? `auto${(this.firestore.autoIds += 1).toString().padStart(16, '0')}`;
    return new FakeDocumentReference(this.firestore, `${this.path}/${docId}`);
  }
}

// ---------------------------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------------------------

type ReadOptions = { fieldMask?: string[] };

export class FakeTransaction {
  readonly writes: Write[] = [];

  constructor(
    private readonly firestore: FakeFirestore,
    private readonly record: FakeTransactionLog,
  ) {}

  private assertReadable(): void {
    if (this.writes.length > 0) throw new Error('Firestore transactions require all reads to be executed before all writes.');
  }

  async get(target: FakeDocumentReference | FakeQuery): Promise<FakeDocumentSnapshot | FakeQuerySnapshot> {
    this.assertReadable();
    if (target instanceof FakeDocumentReference) {
      this.record.reads.push(target.path);
      this.firestore.log.push(`get:${target.path}`);
      return this.firestore.snapshotOf(target.path);
    }
    this.record.reads.push(`query:${target.label()}`);
    this.firestore.log.push(`query:${target.label()}`);
    return target.run();
  }

  async getAll(...args: (FakeDocumentReference | ReadOptions)[]): Promise<FakeDocumentSnapshot[]> {
    this.assertReadable();
    return this.firestore.readAll(args, this.record);
  }

  set(ref: FakeDocumentReference, data: FakeData, options?: { merge?: boolean }): this {
    this.writes.push({ kind: 'set', path: ref.path, data: this.firestore.prepare(data), merge: options?.merge === true });
    this.record.writes.push(`set:${ref.path}`);
    return this;
  }

  create(ref: FakeDocumentReference, data: FakeData): this {
    this.writes.push({ kind: 'create', path: ref.path, data: this.firestore.prepare(data) });
    this.record.writes.push(`create:${ref.path}`);
    return this;
  }

  update(ref: FakeDocumentReference, data: FakeData): this {
    this.writes.push({ kind: 'update', path: ref.path, data: this.firestore.prepare(data) });
    this.record.writes.push(`update:${ref.path}`);
    return this;
  }

  delete(ref: FakeDocumentReference): this {
    this.writes.push({ kind: 'delete', path: ref.path });
    this.record.writes.push(`delete:${ref.path}`);
    return this;
  }
}

// ---------------------------------------------------------------------------------------------
// The database
// ---------------------------------------------------------------------------------------------

export class FakeFirestore {
  docs = new Map<string, FakeData>();
  readonly log: string[] = [];
  readonly transactions: FakeTransactionLog[] = [];
  /** The next commit (transaction or single write) fails with this error and writes nothing. */
  failNextCommit: Error | null = null;
  autoIds = 0;
  private queue: Promise<unknown> = Promise.resolve();

  doc(path: string): FakeDocumentReference {
    return new FakeDocumentReference(this, path);
  }

  collection(path: string): FakeCollectionReference {
    return new FakeCollectionReference(this, path);
  }

  collectionGroup(id: string): FakeQuery {
    if (id.includes('/')) throw new Error('A collection group id cannot contain "/".');
    return new FakeQuery(this, { collectionPath: null, groupId: id });
  }

  async getAll(...args: (FakeDocumentReference | ReadOptions)[]): Promise<FakeDocumentSnapshot[]> {
    return this.readAll(args, null);
  }

  runTransaction<T>(fn: (tx: FakeTransaction) => Promise<T>): Promise<T> {
    const run = async (): Promise<T> => {
      const record: FakeTransactionLog = { reads: [], writes: [], committed: false };
      this.transactions.push(record);
      const tx = new FakeTransaction(this, record);
      let value: T;
      try {
        value = await fn(tx);
      } catch (error) {
        this.log.push('abort');
        throw error;
      }
      this.commitWrites(tx.writes);
      record.committed = true;
      return value;
    };
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }

  // ---- Test helpers ----

  /** Writes a document directly (no log entry, no failNextCommit). */
  seed(path: string, data: FakeData): void {
    segments(path);
    this.docs.set(path, this.prepare(data));
  }

  /** A deep copy of a document's data, or undefined. */
  data(path: string): FakeData | undefined {
    const data = this.docs.get(path);
    return data === undefined ? undefined : clone(data);
  }

  has(path: string): boolean {
    return this.docs.has(path);
  }

  /** Document paths that start with `prefix`, sorted. */
  paths(prefix = ''): string[] {
    return [...this.docs.keys()].filter((path) => path.startsWith(prefix)).sort();
  }

  /** Writes recorded in the log (set, create, update, delete), in order. */
  writeLog(): string[] {
    return this.log.filter((entry) => /^(set|create|update|delete):/.test(entry));
  }

  // ---- Internals (used by references and transactions) ----

  prepare(data: FakeData): FakeData {
    if (!isPlainObject(data)) throw new Error('Firestore documents must be plain objects.');
    assertNoUndefined(data, '');
    return clone(data);
  }

  snapshotOf(path: string, fields: readonly string[] | null = null): FakeDocumentSnapshot {
    const stored = this.docs.get(path);
    const view = stored === undefined ? undefined : fields === null ? clone(stored) : project(stored, fields);
    return {
      exists: stored !== undefined,
      id: path.slice(path.lastIndexOf('/') + 1),
      ref: new FakeDocumentReference(this, path),
      data: () => (view === undefined ? undefined : clone(view)),
      get: (field: string) => (view === undefined ? undefined : clone(getField(view, field).value)),
    };
  }

  readAll(args: readonly (FakeDocumentReference | ReadOptions)[], record: FakeTransactionLog | null): FakeDocumentSnapshot[] {
    const refs = args.filter((arg): arg is FakeDocumentReference => arg instanceof FakeDocumentReference);
    const options = args.find((arg): arg is ReadOptions => !(arg instanceof FakeDocumentReference));
    return refs.map((ref) => {
      record?.reads.push(ref.path);
      this.log.push(`get:${ref.path}`);
      return this.snapshotOf(ref.path, options?.fieldMask ?? null);
    });
  }

  /** Applies writes atomically: every precondition is checked on a staged copy first. */
  commitWrites(writes: readonly Write[]): void {
    if (this.failNextCommit !== null) {
      const error = this.failNextCommit;
      this.failNextCommit = null;
      this.log.push('abort');
      throw error;
    }
    const staged = new Map(this.docs);
    for (const write of writes) {
      const current = staged.get(write.path);
      switch (write.kind) {
        case 'create':
          if (current !== undefined) {
            this.log.push('abort');
            throw new FakeFirestoreError(GRPC_ALREADY_EXISTS, `ALREADY_EXISTS: Document already exists: ${write.path}`);
          }
          staged.set(write.path, clone(write.data));
          break;
        case 'set':
          staged.set(write.path, write.merge && current !== undefined ? deepMerge(current, write.data) : clone(write.data));
          break;
        case 'update': {
          if (current === undefined) {
            this.log.push('abort');
            throw new FakeFirestoreError(GRPC_NOT_FOUND, `NOT_FOUND: No document to update: ${write.path}`);
          }
          const next = clone(current);
          for (const [field, value] of Object.entries(write.data)) setField(next, field, value);
          staged.set(write.path, next);
          break;
        }
        case 'delete':
          staged.delete(write.path);
          break;
      }
    }
    this.docs = staged;
    for (const write of writes) this.log.push(`${write.kind}:${write.path}`);
    this.log.push('commit');
  }
}
