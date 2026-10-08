/**
 * React Native sharing: mail composer through a mailto: URL (Linking) and the OS share sheet.
 * Linking.openURL rejects when no app handles mailto: (the executor then falls back to Share).
 * Share.share reports `dismissedAction` on iOS only; Android always reports `sharedAction`.
 */
import { Linking, Share } from 'react-native';

import type { ShareAdapter } from './types';

export const reactNativeShareAdapter: ShareAdapter = {
  async openMailComposer(url: string): Promise<void> {
    await Linking.openURL(url);
  },
  async shareText({ title, message }): Promise<'shared' | 'dismissed'> {
    const result = await Share.share({ title, message }, { subject: title, dialogTitle: title });
    return result.action === Share.dismissedAction ? 'dismissed' : 'shared';
  },
};
