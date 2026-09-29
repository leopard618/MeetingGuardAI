/**
 * Static visual preview of the three alert intensities (what AlertHost shows in the app). It
 * does not play sound or schedule anything; the real alerts belong to the alerts area.
 */
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useEffect, useState, type ReactElement } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';

import type { AlertIntensity } from '../../core/types';
import { useT } from '../../i18n';

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

  if (intensity === 'max') {
    return (
      <View style={[styles.frame, styles.max]} accessibilityLabel={t('onboarding:alerts.preview.label')}>
        <MaterialCommunityIcons name="alarm-light" size={36} color="#FFFFFF" />
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
      <View style={[styles.frame, styles.mediumFrame]} accessibilityLabel={t('onboarding:alerts.preview.label')}>
        <View style={styles.banner}>
          <PulseDot />
          <View style={styles.bannerText}>
            <Text variant="titleSmall" style={styles.bannerTitle}>
              {t('onboarding:alerts.preview.meetingTitle')}
            </Text>
            <Text variant="bodySmall" style={styles.bannerBody}>
              {t('onboarding:alerts.preview.startsIn')}
            </Text>
          </View>
          <MaterialCommunityIcons name="chevron-up" size={22} color="#7C2D12" />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.frame, styles.lightFrame]} accessibilityLabel={t('onboarding:alerts.preview.label')}>
      <View style={styles.toast}>
        <MaterialCommunityIcons name="bell-outline" size={18} color="#F8FAFC" />
        <Text variant="bodySmall" style={styles.toastText}>
          {t('onboarding:alerts.preview.lightText')}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    marginTop: 12,
    borderRadius: 16,
    minHeight: 150,
    overflow: 'hidden',
  },
  max: {
    backgroundColor: '#B91C1C',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  maxTitle: {
    color: '#FFFFFF',
    fontWeight: '700',
    marginTop: 8,
    textAlign: 'center',
  },
  maxBody: {
    color: '#FEE2E2',
    marginTop: 4,
  },
  maxActions: {
    flexDirection: 'row',
    marginTop: 12,
  },
  fakeButton: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#FECACA',
    paddingHorizontal: 14,
    paddingVertical: 6,
    marginHorizontal: 4,
  },
  fakeButtonPrimary: {
    backgroundColor: '#FFFFFF',
    borderColor: '#FFFFFF',
  },
  fakeButtonText: {
    color: '#FFFFFF',
  },
  fakeButtonPrimaryText: {
    color: '#B91C1C',
    fontWeight: '700',
  },
  mediumFrame: {
    backgroundColor: '#E2E8F0',
    padding: 12,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FDBA74',
    borderRadius: 12,
    padding: 12,
  },
  pulse: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#C2410C',
    marginRight: 12,
  },
  bannerText: {
    flex: 1,
  },
  bannerTitle: {
    color: '#431407',
    fontWeight: '700',
  },
  bannerBody: {
    color: '#7C2D12',
  },
  lightFrame: {
    backgroundColor: '#E2E8F0',
    justifyContent: 'flex-end',
    alignItems: 'center',
    padding: 12,
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1E293B',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  toastText: {
    color: '#F8FAFC',
    marginLeft: 8,
  },
});
