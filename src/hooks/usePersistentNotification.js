/**
 * COMPAT SHIM (owner: alerts; stage 3 removes it). Dashboard.jsx still calls
 * usePersistentNotification(nextMeeting).
 *
 * The ongoing "next meeting" tray notification was removed (it duplicated the scheduled alerts
 * and needed a polling timer); all alerts now come from the alert engine, which also removes the
 * old ongoing notification on start. The hook does nothing: `show` rejects with
 * AppError('unsupported'), `hide` has nothing to hide, `isActive` is always false.
 */
import { AppError } from '../core/errors';

const UNSUPPORTED_MESSAGE = 'The persistent next-meeting notification was removed';

export const usePersistentNotification = (_nextMeeting) => ({
  show: () => Promise.reject(new AppError('unsupported', UNSUPPORTED_MESSAGE)),
  hide: () => Promise.resolve(),
  isActive: () => false,
});

export default usePersistentNotification;
