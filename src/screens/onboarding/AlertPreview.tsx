/**
 * Static visual preview of the three alert intensities (what AlertHost shows in the app). It
 * does not play sound or schedule anything; the real alerts belong to the alerts area.
 *
 * The mockups are built from the mode-invariant `alertMax` / `alertMedium` / `alertLight` token
 * groups, so the preview matches the real overlays at card scale in both color schemes; the
 * device frame around the MEDIUM / LIGHT mockups is `surfaceVariant` + 1px `outlineVariant`.
 */
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useEffect, useState, type ReactElement } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';

import type { AlertIntensity } from '../../core/types';
import { useT } from '../../i18n';
import { alertLight, alertMax, alertMedium, componentMetrics, radii, spacing, typography, useAppTheme } from '../../theme';

function PulseDot(): ReactElement {
  const [opacity] = useState(() => new Animated.Value(1));
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.3, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return <Animated.View style={[styles.pulse, { opacity }]} />;
}

export function AlertPreview({ intensity }: { intensity: AlertIntensity }): ReactElement {
  const t = useT();
  const { colors } = useAppTheme();
  const frameStyle = { backgroundColor: colors.surfaceVariant, borderColor: colors.outlineVariant };

  if (intensity === 'max') {
    return (
      <View style={[styles.frame, styles.max]} accessibilityLabel={t('onboarding:alerts.preview.label')}>
        <MaterialCommunityIcons name="alarm-light" size={36} color={alertMax.title} />
        <Text variant="titleMedium" style={styles.maxTitle}>
          {t('onboarding:alerts.preview.meetingTitle')}
        </Text>
        <Text variant="bodyMedium" style={styles.maxBody}>
          {t('onboarding:alerts.preview.startsIn')}
        </Text>
        <View style={styles.maxActions}>
          <View style={[styles.fakeButton, styles.fakeButtonPrimary]}>
            <Text style={styles.fakeButtonPrimaryText}>{t('onboarding:alerts.preview.acknowledge')}</Text>
          </View>
          <View style={styles.fakeButton}>
            <Text style={styles.fakeButtonText}>{t('onboarding:alerts.preview.snooze')}</Text>
          </View>
        </View>
      </View>
    );
  }

  if (intensity === 'medium') {
    return (
      <View style={[styles.frame, styles.deviceFrame, frameStyle]} accessibilityLabel={t('onboarding:alerts.preview.label')}>
        <View style={styles.banner}>
          <View style={styles.bannerAccent} />
          <PulseDot />
          <View style={styles.bannerText}>
            <Text variant="titleSmall" style={styles.bannerTitle}>
              {t('onboarding:alerts.preview.meetingTitle')}
            </Text>
            <Text variant="bodySmall" style={styles.bannerBody}>
              {t('onboarding:alerts.preview.startsIn')}
            </Text>
          </View>
          <MaterialCommunityIcons name="chevron-up" size={22} color={alertMedium.body} />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.frame, styles.deviceFrame, styles.lightFrame, frameStyle]} accessibilityLabel={t('onboarding:alerts.preview.label')}>
      <View style={styles.toast}>
        <MaterialCommunityIcons name="bell-outline" size={18} color={alertLight.icon} />
        <Text variant="bodySmall" style={styles.toastText}>
          {t('onboarding:alerts.preview.lightText')}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    marginTop: spacing.md,
    borderRadius: radii.lg,
    minHeight: 150,
    overflow: 'hidden',
  },
  deviceFrame: {
    borderWidth: 1,
    padding: spacing.md,
  },
  max: {
    backgroundColor: alertMax.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  maxTitle: {
    color: alertMax.title,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  maxBody: {
    color: alertMax.when,
    marginTop: spacing.xs,
  },
  maxActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    marginTop: spacing.md,
  },
  fakeButton: {
    borderRadius: radii.sm,
    borderWidth: 1.5,
    borderColor: alertMax.snoozeBorder,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    marginHorizontal: spacing.xs,
    marginTop: spacing.xs,
  },
  fakeButtonPrimary: {
    backgroundColor: alertMax.ackBg,
    borderColor: alertMax.ackBg,
  },
  fakeButtonText: {
    ...typography.labelL,
    color: alertMax.snoozeText,
  },
  fakeButtonPrimaryText: {
    ...typography.labelL,
    color: alertMax.ackText,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: alertMedium.bg,
    borderRadius: radii.md,
    padding: spacing.md,
    overflow: 'hidden',
  },
  bannerAccent: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: componentMetrics.accentBarWidth,
    backgroundColor: alertMedium.accentBar,
  },
  pulse: {
    width: spacing.md,
    height: spacing.md,
    borderRadius: radii.full,
    backgroundColor: alertMedium.accentBar,
    marginLeft: spacing.xs,
    marginRight: spacing.md,
  },
  bannerText: {
    flex: 1,
  },
  bannerTitle: {
    color: alertMedium.title,
  },
  bannerBody: {
    color: alertMedium.body,
  },
  lightFrame: {
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: alertLight.bg,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  toastText: {
    color: alertLight.title,
    marginLeft: spacing.sm,
  },
});
