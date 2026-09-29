/**
 * "You're offline" banner. Connectivity comes from the data layer's sync state, which follows
 * NetInfo (the same signal that pauses and resumes the outbox), plus the number of local changes
 * still waiting to reach the server.
 */
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { ReactElement } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text, useTheme as usePaperTheme } from 'react-native-paper';

import { useT } from '../../i18n';
import { useSyncState } from '../../services/data';

export function OfflineBanner(): ReactElement | null {
  const t = useT();
  const theme = usePaperTheme();
  const { online, pendingWrites } = useSyncState();
  if (online) return null;
  return (
    <View
      style={[styles.banner, { backgroundColor: theme.colors.secondaryContainer }]}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      testID="offline-banner"
    >
      <MaterialCommunityIcons name="cloud-off-outline" size={22} color={theme.colors.onSecondaryContainer} style={styles.icon} />
      <View style={styles.flex}>
        <Text variant="titleSmall" style={{ color: theme.colors.onSecondaryContainer }}>
          {t('home:offline.title')}
        </Text>
        <Text variant="bodySmall" style={{ color: theme.colors.onSecondaryContainer }}>
          {t('home:offline.message')}
          {pendingWrites > 0 ? ` ${t('home:offline.pending', { count: pendingWrites })}` : ''}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  icon: {
    marginRight: 12,
    marginTop: 2,
  },
  flex: {
    flex: 1,
  },
});
