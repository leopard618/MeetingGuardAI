/**
 * "By continuing, you agree to our Terms of Service and Privacy Policy" with tappable links.
 * Shown on the Landing screen (before sign-in) and on the first onboarding step. Both screen
 * groups contain the Privacy and Terms routes.
 */
import { useNavigation } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import type { ReactElement } from 'react';
import { StyleSheet, type StyleProp, type TextStyle } from 'react-native';
import { Text, useTheme as usePaperTheme } from 'react-native-paper';

import type { RootStackParamList } from '../core/contracts';
import { useT } from '../i18n';

export interface ConsentNoticeProps {
  style?: StyleProp<TextStyle>;
  /** Text color override (e.g. on a dark background). */
  color?: string;
}

export function ConsentNotice({ style, color }: ConsentNoticeProps): ReactElement {
  const t = useT();
  const theme = usePaperTheme();
  const navigation = useNavigation<StackNavigationProp<RootStackParamList>>();
  const textColor = color ?? theme.colors.onSurfaceVariant;
  const linkColor = color ?? theme.colors.primary;

  return (
    <Text variant="bodySmall" style={[styles.text, { color: textColor }, style]}>
      {t('common:consent.prefix')}{' '}
      <Text
        variant="bodySmall"
        style={[styles.link, { color: linkColor }]}
        onPress={() => navigation.navigate('Terms')}
        accessibilityRole="link"
      >
        {t('common:consent.terms')}
      </Text>{' '}
      {t('common:consent.and')}{' '}
      <Text
        variant="bodySmall"
        style={[styles.link, { color: linkColor }]}
        onPress={() => navigation.navigate('Privacy')}
        accessibilityRole="link"
      >
        {t('common:consent.privacy')}
      </Text>
      .
    </Text>
  );
}

const styles = StyleSheet.create({
  text: {
    textAlign: 'center',
  },
  link: {
    textDecorationLine: 'underline',
    fontWeight: '600',
  },
});
