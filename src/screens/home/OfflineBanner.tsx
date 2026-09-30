/**
 * "You're offline" banner. Connectivity comes from the data layer's sync state, which follows
 * NetInfo (the same signal that pauses and resumes the outbox), plus the number of local changes
 * still waiting to reach the server. Rendered as the kit's warning Banner (MG Indigo §5/§7).
 */
import type { ReactElement } from 'react';
import { StyleSheet } from 'react-native';

import { Banner } from '../../components/ui';
import { useT } from '../../i18n';
import { useSyncState } from '../../services/data';
import { spacing } from '../../theme';

export function OfflineBanner(): ReactElement | null {
  const t = useT();
  const { online, pendingWrites } = useSyncState();
  if (online) return null;
  const message =
    pendingWrites > 0
      ? `${t('home:offline.message')} ${t('home:offline.pending', { count: pendingWrites })}`
      : t('home:offline.message');
  return (
    <Banner
      tone="warning"
      icon="cloud-off-outline"
      text={`${t('home:offline.title')}. ${message}`}
      style={styles.banner}
      testID="offline-banner"
    />
  );
}

const styles = StyleSheet.create({
  banner: {
    marginBottom: spacing.md,
  },
});
