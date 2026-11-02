/**
 * "Ask the assistant" banner at the bottom of the dashboard (the client's mockup): a deep-blue
 * card with the sparkles icon in a translucent square, a title and a one-line description, and a
 * white arrow square at the right. The whole banner opens the AI chat.
 */
import { LinearGradient } from 'expo-linear-gradient';
import type { ReactElement } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Icon, PressableScale } from '../../components/ui';
import { useT } from '../../i18n';
import { radii, softShadow, spacing, typography, useAppTheme, withAlpha } from '../../theme';

const ON_BANNER = '#FFFFFF';

export interface AssistantBannerProps {
  onPress(): void;
  testID?: string;
}

export function AssistantBanner({ onPress, testID = 'insights-ask-assistant' }: AssistantBannerProps): ReactElement {
  const t = useT();
  const { gradients, colors } = useAppTheme();
  return (
    <PressableScale
      onPress={onPress}
      style={styles.host}
      accessibilityRole="button"
      accessibilityLabel={`${t('home:assistantBanner.title')}. ${t('home:assistantBanner.body')}`}
      testID={testID}
    >
      <LinearGradient colors={gradients.hero} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.banner}>
        <View style={styles.iconBox}>
          <Icon name="ai" size={24} color={ON_BANNER} />
        </View>
        <View style={styles.texts}>
          <Text style={styles.title} numberOfLines={1} maxFontSizeMultiplier={1.3}>
            {t('home:assistantBanner.title')}
          </Text>
          <Text style={styles.body} numberOfLines={2} maxFontSizeMultiplier={1.3}>
            {t('home:assistantBanner.body')}
          </Text>
        </View>
        <View style={[styles.arrowBox, { backgroundColor: colors.surface }]}>
          <Icon name="forward" size={20} color={colors.primary} />
        </View>
      </LinearGradient>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  host: {
    borderRadius: radii.xxl,
    marginTop: spacing.lg,
    ...softShadow,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: radii.xxl,
    padding: spacing.lg,
    overflow: 'hidden',
  },
  iconBox: {
    width: 48,
    height: 48,
    borderRadius: radii.lg,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha('#FFFFFF', 0.18),
  },
  texts: {
    flex: 1,
  },
  title: {
    ...typography.titleM,
    color: ON_BANNER,
  },
  body: {
    ...typography.bodyS,
    color: withAlpha('#FFFFFF', 0.82),
    marginTop: 2,
  },
  arrowBox: {
    width: 44,
    height: 44,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
