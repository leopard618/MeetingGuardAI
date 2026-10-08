import { AppError } from '../../../core/errors';
import { createEventBus, type AppEventMap } from '../../../core/events';
import type { AttachmentRecord, AttachmentStore } from '../../data';
import {
  createAttachmentService,
  type AttachmentFileSystem,
  type AttachmentOpener,
  type AttachmentPickers,
  type AttachmentService,
  type PickedFile,
} from '../attachmentService';
import { MAX_ATTACHMENT_BYTES } from '../fileTypes';
import { wireAttachmentEvents } from '../wiring';

// Expected failures are logged as warnings (codes only); keep the test output readable.
beforeEach(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

/** In-memory AttachmentStore with the same contract as the data layer's store. */
function memoryStore(initial: AttachmentRecord[] = []): AttachmentStore & { items: Map<string, AttachmentRecord> } {
  const items = new Map(initial.map((item) => [item.id, item]));
  return {
    items,
    list: async () => [...items.values()],
    get: async (id) => items.get(id) ?? null,
    put: async (record) => {
      items.set(record.id, record);
      return record;
    },
    attachToMeeting: async (id, meetingId) => {
      const current = items.get(id);
      if (!current) throw new AppError('not_found');
      const next = { ...current, meetingId };
      items.set(id, next);
      return next;
    },
    forMeeting: async (meetingId) => [...items.values()].filter((item) => item.meetingId === meetingId),
    remove: async (id) => {
      const current = items.get(id) ?? null;
      items.delete(id);
      return current;
    },
  };
}

function fakeFiles(): AttachmentFileSystem & { stored: Set<string>; removedDirectories: string[]; failCopy: boolean } {
  const stored = new Set<string>();
  const fake = {
    stored,
    removedDirectories: [] as string[],
    failCopy: false,
    async copyIn(uid: string, file: PickedFile, fileName: string) {
      if (fake.failCopy) throw new Error('disk full');
      const uri = `file:///docs/attachments/${uid}/${fileName}`;
      stored.add(uri);
      return { uri, size: file.size ?? 1234 };
    },
    exists: (uri: string) => stored.has(uri),
    remove: (uri: string) => {
      stored.delete(uri);
    },
    removeUserDirectory(uid: string) {
      fake.removedDirectories.push(uid);
    },
  };
  return fake;
}

const PDF: PickedFile = { uri: 'file:///cache/a.pdf', name: 'Agenda.pdf', mimeType: 'application/pdf', size: 2048 };
const PHOTO: PickedFile = { uri: 'file:///cache/p.jpg', name: 'photo.jpg', mimeType: 'image/jpeg', size: 4096 };

function record(overrides: Partial<AttachmentRecord> = {}): AttachmentRecord {
  return {
    id: 'a1',
    name: 'Old.pdf',
    category: 'documents',
    mimeType: 'application/pdf',
    size: 10,
    uri: 'file:///docs/attachments/u1/a1_Old.pdf',
    meetingId: 'm1',
    createdAt: '2026-09-01T10:00:00.000Z',
    localOnly: true,
    ...overrides,
  };
}

interface Harness {
  service: AttachmentService;
  store: ReturnType<typeof memoryStore>;
  files: ReturnType<typeof fakeFiles>;
  pick: jest.Mock;
  open: jest.Mock;
  setUid(uid: string | null): void;
}

function setup(initial: AttachmentRecord[] = []): Harness {
  const store = memoryStore(initial);
  const files = fakeFiles();
  for (const item of initial) files.stored.add(item.uri);
  const pick = jest.fn();
  const open = jest.fn(async () => undefined);
  let uid: string | null = 'u1';
  let counter = 0;
  const pickers: AttachmentPickers = { pick };
  const opener: AttachmentOpener = { open };
  const service = createAttachmentService({
    store,
    getUid: () => uid,
    files,
    pickers,
    opener,
    newId: () => `att${++counter}`,
    now: () => new Date('2026-09-28T12:00:00.000Z'),
  });
  return { service, store, files, pick, open, setUid: (next) => (uid = next) };
}

describe('attachmentService.add / importFiles', () => {
  it('copies picked files, stores local-only metadata linked to the meeting and notifies', async () => {
    const h = setup();
    h.pick.mockResolvedValue([PDF, PHOTO]);
    const listener = jest.fn();
    h.service.subscribe(listener);

    const result = await h.service.add('document', { meetingId: 'm1', multiple: true });

    expect(h.pick).toHaveBeenCalledWith('document', { multiple: true });
    expect(result.cancelled).toBe(false);
    expect(result.failures).toEqual([]);
    expect(result.added.map((item) => [item.id, item.name, item.category, item.meetingId, item.localOnly])).toEqual([
      ['att1', 'Agenda.pdf', 'documents', 'm1', true],
      ['att2', 'photo.jpg', 'images', 'm1', true],
    ]);
    expect(result.added[0]?.uri).toBe('file:///docs/attachments/u1/att1_Agenda.pdf');
    expect(result.added[0]?.createdAt).toBe('2026-09-28T12:00:00.000Z');
    expect(h.store.items.size).toBe(2);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('reports a cancelled picker without touching anything', async () => {
    const h = setup();
    h.pick.mockResolvedValue(null);
    await expect(h.service.add('image')).resolves.toEqual({ cancelled: true, added: [], failures: [] });
    expect(h.store.items.size).toBe(0);
  });

  it('never asks the camera for several photos', async () => {
    const h = setup();
    h.pick.mockResolvedValue(null);
    await h.service.add('camera', { multiple: true });
    expect(h.pick).toHaveBeenCalledWith('camera', { multiple: false });
  });

  it('rejects unsupported and too large files per file, keeping the good ones', async () => {
    const h = setup();
    const result = await h.service.importFiles([
      { uri: 'file:///cache/x.exe', name: 'setup.exe', mimeType: 'application/x-msdownload', size: 10 },
      { ...PDF, size: MAX_ATTACHMENT_BYTES + 1 },
      PHOTO,
    ]);
    expect(result.failures).toEqual([
      { name: 'setup.exe', reason: 'unsupported_type', code: 'unsupported' },
      { name: 'Agenda.pdf', reason: 'too_large', code: 'invalid_input' },
    ]);
    expect(result.added.map((item) => item.name)).toEqual(['photo.jpg']);
    expect(result.added[0]?.meetingId).toBeNull();
  });

  it('uses the extension when the picker reports a generic type', async () => {
    const h = setup();
    const result = await h.service.importFiles([{ uri: 'file:///cache/s', name: 'Slides.pptx', mimeType: 'application/octet-stream', size: 1 }]);
    expect(result.added[0]?.mimeType).toBe('application/vnd.openxmlformats-officedocument.presentationml.presentation');
  });

  it('reports a failed copy and a failed metadata write (removing the orphan copy)', async () => {
    const h = setup();
    h.files.failCopy = true;
    const copyResult = await h.service.importFiles([PDF]);
    expect(copyResult.failures).toEqual([{ name: 'Agenda.pdf', reason: 'copy_failed', code: 'unknown' }]);

    h.files.failCopy = false;
    h.store.put = jest.fn(async () => {
      throw new AppError('unknown', 'storage full');
    });
    const saveResult = await h.service.importFiles([PDF]);
    expect(saveResult.failures).toEqual([{ name: 'Agenda.pdf', reason: 'save_failed', code: 'unknown' }]);
    expect(h.files.stored.size).toBe(0);
  });

  it('rejects when nobody is signed in', async () => {
    const h = setup();
    h.setUid(null);
    await expect(h.service.add('document')).rejects.toMatchObject({ code: 'unauthenticated' });
    expect(h.pick).not.toHaveBeenCalled();
  });

  it('passes a refused camera permission on as an AppError', async () => {
    const h = setup();
    h.pick.mockRejectedValue(new AppError('permission_denied'));
    await expect(h.service.add('camera')).rejects.toMatchObject({ code: 'permission_denied' });
  });
});

describe('attachmentService list / link / remove / open', () => {
  it('lists a meeting\'s attachments oldest first', async () => {
    const h = setup([
      record({ id: 'b', createdAt: '2026-09-03T00:00:00.000Z', uri: 'file:///docs/attachments/u1/b' }),
      record({ id: 'a', createdAt: '2026-09-02T00:00:00.000Z', uri: 'file:///docs/attachments/u1/a' }),
      record({ id: 'c', meetingId: 'other', uri: 'file:///docs/attachments/u1/c' }),
    ]);
    expect((await h.service.listForMeeting('m1')).map((item) => item.id)).toEqual(['a', 'b']);
  });

  it('links an attachment to a meeting', async () => {
    const h = setup([record({ meetingId: null })]);
    const listener = jest.fn();
    h.service.subscribe(listener);
    await expect(h.service.linkToMeeting('a1', 'm9')).resolves.toMatchObject({ meetingId: 'm9' });
    expect(listener).toHaveBeenCalled();
  });

  it('removes the file and then the metadata', async () => {
    const existing = record();
    const h = setup([existing]);
    await h.service.remove('a1');
    expect(h.files.stored.has(existing.uri)).toBe(false);
    expect(h.store.items.has('a1')).toBe(false);
    await expect(h.service.remove('a1')).rejects.toMatchObject({ code: 'not_found' });
  });

  it('keeps the metadata when the file cannot be deleted (so the user can retry)', async () => {
    const h = setup([record()]);
    h.files.remove = () => {
      throw new Error('busy');
    };
    await expect(h.service.remove('a1')).rejects.toBeInstanceOf(AppError);
    expect(h.store.items.has('a1')).toBe(true);
  });

  it('opens an existing file and reports a missing one as not_found', async () => {
    const existing = record();
    const h = setup([existing]);
    await h.service.open(existing);
    expect(h.open).toHaveBeenCalledWith(existing);
    await expect(h.service.open(record({ uri: 'file:///gone' }))).rejects.toMatchObject({ code: 'not_found' });
  });

  it('turns an "open with" failure into an AppError', async () => {
    const existing = record();
    const h = setup([existing]);
    h.open.mockRejectedValue(new Error('No Activity found to handle Intent'));
    await expect(h.service.open(existing)).rejects.toBeInstanceOf(AppError);
  });
});

describe('attachmentService cleanup', () => {
  it('removes every attachment of a deleted meeting', async () => {
    const h = setup([record({ id: 'a', uri: 'u:a' }), record({ id: 'b', uri: 'u:b' }), record({ id: 'c', meetingId: 'm2', uri: 'u:c' })]);
    await expect(h.service.removeForMeeting('m1')).resolves.toBe(2);
    expect([...h.store.items.keys()]).toEqual(['c']);
  });

  it('prunes old unlinked attachments only', async () => {
    const h = setup([
      record({ id: 'old', meetingId: null, createdAt: '2026-09-20T00:00:00.000Z', uri: 'u:old' }),
      record({ id: 'fresh', meetingId: null, createdAt: '2026-09-28T11:00:00.000Z', uri: 'u:fresh' }),
      record({ id: 'linked', meetingId: 'm1', createdAt: '2026-01-01T00:00:00.000Z', uri: 'u:linked' }),
    ]);
    await expect(h.service.pruneUnlinked()).resolves.toBe(1);
    expect([...h.store.items.keys()].sort()).toEqual(['fresh', 'linked']);
  });
});

describe('wireAttachmentEvents', () => {
  function wired(initial: AttachmentRecord[]) {
    const h = setup(initial);
    const bus = createEventBus<AppEventMap>();
    const unsubscribe = wireAttachmentEvents(h.service, bus);
    return { ...h, bus, unsubscribe };
  }

  const flush = () => new Promise((resolve) => setImmediate(resolve));

  it('deletes the user\'s files when the session ends', () => {
    const h = wired([]);
    h.bus.emit('session:ended', { uid: 'u1', reason: 'sign_out' });
    expect(h.files.removedDirectories).toEqual(['u1']);
  });

  it('removes the attachments of a meeting deleted on this device', async () => {
    const h = wired([record()]);
    h.bus.emit('meetings:changed', { uid: 'u1', changedIds: ['m1'], reason: 'deleted', origin: 'user' });
    await flush();
    expect(h.store.items.size).toBe(0);
  });

  it('ignores remote changes, imports and calendar-driven writes', async () => {
    const h = wired([record()]);
    h.bus.emit('meetings:changed', { uid: 'u1', changedIds: ['m1'], reason: 'remote' });
    h.bus.emit('meetings:changed', { uid: 'u1', changedIds: ['m1'], reason: 'deleted', origin: 'calendar_google' });
    await flush();
    expect(h.store.items.size).toBe(1);
  });

  it('prunes unlinked attachments when a session starts and stops listening after unsubscribe', async () => {
    const h = wired([record({ meetingId: null, createdAt: '2026-01-01T00:00:00.000Z' })]);
    h.unsubscribe();
    h.bus.emit('session:started', { uid: 'u1', restored: true });
    await flush();
    expect(h.store.items.size).toBe(1);

    wireAttachmentEvents(h.service, h.bus);
    h.bus.emit('session:started', { uid: 'u1', restored: true });
    await flush();
    expect(h.store.items.size).toBe(0);
  });
});
