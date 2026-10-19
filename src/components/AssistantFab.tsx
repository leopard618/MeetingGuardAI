/**
 * Floating assistant button, visible on every main screen (client request): one tap opens the
 * AI chat, where meetings and tasks are created and managed by voice or text. Bottom-LEFT on
 * purpose: the list screens keep their own "+" FAB bottom-right, so the two never collide.
 * Hidden on the chat itself. Full-screen editors use RN Modal, which covers it automatically.
 */
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useNavigation, useRoute, type NavigationProp } from '@react-navigation/native';
import type { ReactElement } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { RootStackParamList } from '../core/contracts';
import { useT } from '../i18n';
import { componentMetrics, radii, useAppTheme } from '../theme';

export function AssistantFab(): ReactElement | null {
  const t = useT();
  const { colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  // Rendered inside each main screen's layout, so the screen's own route is in context.
  const routeName = useRoute().name;

  if (routeName === 'AIChat') return null;

  return (
    <Pressable
      onPress={() => navigation.navigate('AIChat')}
      style={({ pressed }) => [
        styles.fab,
        {
          backgroundColor: colors.primary,
          bottom: insets.bottom + componentMetrics.screenGutter,
          left: insets.left + componentMetrics.screenGutter,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
      accessibilityRole="button"
      accessibilityLabel={t('shell:assistantFab')}
      testID="assistant-fab"
    >
      <MaterialCommunityIcons name="robot-outline" size={24} color={colors.onPrimary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    width: 52,
    height: 52,
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
  },
});
