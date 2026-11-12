/**
 * Applies a ScopedMeetingWrite (runningLate.ts) through the meeting repository with origin
 * 'user': a one-off meeting is patched; one occurrence of a series gets a 'modified' override
 * (MeetingRecurrenceOps.updateOccurrence, section 16). Google / Outlook pushes and the alert
 * re-plan follow from the write like any other user edit.
 */
import type { MeetingRecurrenceOps, MeetingRepository } from '../../core/contracts';
import { AppError } from '../../core/errors';
import { meetingRepository } from '../../services/data';
import type { ScopedMeetingWrite } from './runningLate';

export async function applyScopedWrite(write: ScopedMeetingWrite): Promise<void> {
  if (write.scope === 'meeting') {
    await meetingRepository.update(write.meetingId, write.patch, { origin: 'user' });
    return;
  }
  const repository = meetingRepository as MeetingRepository & Partial<MeetingRecurrenceOps>;
  const op = repository.updateOccurrence;
  if (!op) throw new AppError('not_implemented', 'Recurring-meeting operations are not available');
  await op.call(repository, write.meetingId, write.localDateKey, write.patch, { origin: 'user' });
}
