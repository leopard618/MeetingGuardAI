/** Loading / "meeting not found" state of the meeting screens (deep links can outrun the sync). */
import type { ReactElement } from 'react';
import { StyleSheet, View } from 'react-native';
import { ActivityIndicator, Text } from 'react-native-paper';

import { EmptyState } from '../../components/ui';
import { useT } from '../../i18n';
import { navigateToTopLevel } from '../../navigation/navigationService';
import { spacing, useAppTheme } from '../../theme';

export function MeetingStatus({ loading }: { loading: boolean }): ReactElement {
  const t = useT();
  const { colors } = useAppTheme();
  return (
    <View style={[styles.centered, { backgroundColor: colors.background }]}>
      {loading ? (
        <>
          <ActivityIndicator size="large" />
          <Text variant="bodyMedium" style={[styles.statusText, { color: colors.onSurfaceVariant }]}>
            {t('navigation:meeting.loading')}
          </Text>
        </>
      ) : (
        <EmptyState
          icon="calendar-remove-outline"
          title={t('navigation:meeting.notFoundTitle')}
          body={t('navigation:meeting.notFoundMessage')}
          action={{ label: t('navigation:meeting.backToDashboard'), onPress: () => navigateToTopLevel('Dashboard') }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xxxl,
  },
  statusText: {
    marginTop: spacing.md,
    textAlign: 'center',
  },
});
