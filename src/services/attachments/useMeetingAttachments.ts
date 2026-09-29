/**
 * React binding of a meeting's device-local attachments: the list (re-read after every change
 * made anywhere in the app), plus add / remove / open. Errors are AppErrors; the caller decides
 * how to show them.
 */
import { useCallback, useEffect, useState } from 'react';

import { toAppError, type AppError } from '../../core/errors';
import type { AttachmentRecord } from '../data';
import type { AttachmentAddResult, AttachmentService, AttachmentSource } from './attachmentService';

export interface UseMeetingAttachmentsResult {
  attachments: AttachmentRecord[];
  /** true until the first read for this meeting finished. */
  isLoading: boolean;
  /** The last read failed (the list may be stale or empty). */
  error: AppError | null;
  /** A picker / copy is in progress. */
  busy: boolean;
  reload(): void;
  add(source: AttachmentSource): Promise<AttachmentAddResult>;
  remove(id: string): Promise<void>;
  open(record: AttachmentRecord): Promise<void>;
}

interface ListState {
  meetingId: string;
  attachments: AttachmentRecord[];
  isLoading: boolean;
  error: AppError | null;
}

export function useMeetingAttachments(meetingId: string, service: AttachmentService): UseMeetingAttachmentsResult {
  const [state, setState] = useState<ListState>({ meetingId, attachments: [], isLoading: true, error: null });
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => service.subscribe(() => setVersion((current) => current + 1)), [service]);

  useEffect(() => {
    let active = true;
    service.listForMeeting(meetingId).then(
      (attachments) => {
        if (active) setState({ meetingId, attachments, isLoading: false, error: null });
      },
      (error: unknown) => {
        if (!active) return;
        setState((current) => ({
          meetingId,
          attachments: current.meetingId === meetingId ? current.attachments : [],
          isLoading: false,
          error: toAppError(error),
        }));
      },
    );
    return () => {
      active = false;
    };
  }, [service, meetingId, version]);

  const reload = useCallback(() => setVersion((current) => current + 1), []);

  const add = useCallback(
    async (source: AttachmentSource): Promise<AttachmentAddResult> => {
      setBusy(true);
      try {
        return await service.add(source, { meetingId, multiple: source !== 'camera' });
      } finally {
        setBusy(false);
      }
    },
    [service, meetingId],
  );

  const remove = useCallback((id: string) => service.remove(id), [service]);
  const open = useCallback((record: AttachmentRecord) => service.open(record), [service]);

  const current = state.meetingId === meetingId;
  return {
    attachments: current ? state.attachments : [],
    isLoading: current ? state.isLoading : true,
    error: current ? state.error : null,
    busy,
    reload,
    add,
    remove,
    open,
  };
}
