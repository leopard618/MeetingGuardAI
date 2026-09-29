import { act, renderHook, waitFor } from '@testing-library/react-native';

import { AppError } from '../../../core/errors';
import type { AttachmentRecord } from '../../data';
import type { AttachmentService } from '../attachmentService';
import { useMeetingAttachments } from '../useMeetingAttachments';

function record(id: string, meetingId = 'm1'): AttachmentRecord {
  return {
    id,
    name: `${id}.pdf`,
    category: 'documents',
    mimeType: 'application/pdf',
    size: 1,
    uri: `file:///docs/${id}`,
    meetingId,
    createdAt: '2026-09-01T00:00:00.000Z',
    localOnly: true,
  };
}

function fakeService(initial: AttachmentRecord[]) {
  let items = [...initial];
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());
  const service = {
    listForMeeting: jest.fn(async (meetingId: string) => items.filter((item) => item.meetingId === meetingId)),
    add: jest.fn(async (_source: string, options?: { meetingId?: string | null }) => {
      const added = record(`new${items.length}`, options?.meetingId ?? 'm1');
      items = [...items, added];
      notify();
      return { cancelled: false, added: [added], failures: [] };
    }),
    remove: jest.fn(async (id: string) => {
      items = items.filter((item) => item.id !== id);
      notify();
    }),
    open: jest.fn(async () => undefined),
    subscribe: jest.fn((listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
  };
  return service as typeof service & AttachmentService;
}

it('loads the meeting’s attachments and follows changes', async () => {
  const service = fakeService([record('a'), record('b', 'other')]);
  const { result } = await renderHook(() => useMeetingAttachments('m1', service));
  await waitFor(() => expect(result.current.isLoading).toBe(false));
  expect(result.current.attachments.map((item) => item.id)).toEqual(['a']);

  await act(async () => {
    await result.current.add('document');
  });
  expect(service.add).toHaveBeenCalledWith('document', { meetingId: 'm1', multiple: true });
  await waitFor(() => expect(result.current.attachments).toHaveLength(2));
  expect(result.current.busy).toBe(false);

  await act(async () => {
    await result.current.remove('a');
  });
  await waitFor(() => expect(result.current.attachments.map((item) => item.id)).toEqual(['new2']));
});

it('adds a camera photo one at a time', async () => {
  const service = fakeService([]);
  const { result } = await renderHook(() => useMeetingAttachments('m1', service));
  await act(async () => {
    await result.current.add('camera');
  });
  expect(service.add).toHaveBeenCalledWith('camera', { meetingId: 'm1', multiple: false });
});

it('reports a failed read and retries on reload', async () => {
  const service = fakeService([record('a')]);
  service.listForMeeting.mockRejectedValueOnce(new AppError('unknown', 'broken'));
  const { result } = await renderHook(() => useMeetingAttachments('m1', service));
  await waitFor(() => expect(result.current.error?.code).toBe('unknown'));

  await act(async () => {
    result.current.reload();
  });
  await waitFor(() => expect(result.current.error).toBeNull());
  expect(result.current.attachments).toHaveLength(1);
});
