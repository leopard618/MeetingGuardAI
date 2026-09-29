/** Loading / "meeting not found" state of the meeting screens (deep links can outrun the sync). */
import type { ReactElement } from 'react';
import { StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, Text, useTheme as usePaperTheme } from 'react-native-paper';

import { useT } from '../../i18n';
import { navigateToTopLevel } from '../../navigation/navigationService';

export function MeetingStatus({ loading }: { loading: boolean }): ReactElement {
  const t = useT();
  const theme = usePaperTheme();
  return (
    <View style={[styles.centered, { backgroundColor: theme.colors.background }]}>
      {loading ? (
        <>
          <ActivityIndicator size="large" />
          <Text variant="bodyMedium" style={styles.statusText}>
            {t('navigation:meeting.loading')}
          </Text>
        </>
      ) : (
        <>
          <Text variant="titleMedium" style={styles.statusText} accessibilityRole="header">
            {t('navigation:meeting.notFoundTitle')}
          </Text>
          <Text variant="bodyMedium" style={styles.statusText}>
            {t('navigation:meeting.notFoundMessage')}
          </Text>
          <Button mode="contained" style={styles.statusButton} onPress={() => navigateToTopLevel('Dashboard')}>
            {t('navigation:meeting.backToDashboard')}
          </Button>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  statusText: {
    marginTop: 12,
    textAlign: 'center',
  },
  statusButton: {
    marginTop: 20,
  },
});
