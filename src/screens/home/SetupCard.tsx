/**
 * Dashboard setup recommendation card (ARCHITECTURE section 34): shows the ONE next step from
 * setupSteps.ts with a single primary action and "Not now". i18n: home:setup.* (EN+ES).
 *
 * - verify_email: the same resend / "I verified" actions as VerifyEmailBanner (useEmailVerification).
 * - connect_calendar and sync_tasks: open Settings > Calendar sync.
 * - "Not now" snoozes the step on this phone for the signed-in account (useSetupStep).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';

import { Card, Icon, MGButton, type IconName } from '../../components/ui';
import { USER_STORAGE, userStorageKey } from '../../core/identifiers';
import { createLogger } from '../../core/logger';
import { useT } from '../../i18n';
import { useCalendarStatus } from '../../services/calendar';
import { componentMetrics, radii, spacing, typography, useAppTheme } from '../../theme';
import { useEmailVerification } from '../shared/VerifyEmailBanner';
import { nextSetupStep, parseSnoozes, snoozeStep, type SetupSnoozes, type SetupStep, type SetupStepId } from './setupSteps';

const log = createLogger('setup-card');

export function setupSnoozeKey(uid: string): string {
  return userStorageKey(uid, USER_STORAGE.setupSnooze);
}

export interface SetupStepResult {
  /** The step to show; null while the snoozes load, when nothing applies, or when snoozed. */
  step: SetupStep | null;
  /** The pending calendar step exists but is hidden by a snooze (the empty state shows its button). */
  calendarStepSnoozed: boolean;
  dismiss(id: SetupStepId): void;
}

/** The next setup step for the signed-in user (null uid = signed out). */
export function useSetupStep(uid: string | null, emailVerificationNeeded: boolean, now: Date): SetupStepResult {
  const status = useCalendarStatus();
  const [loaded, setLoaded] = useState<{ uid: string; snoozes: SetupSnoozes } | null>(null);

  useEffect(() => {
    // Signed out: nothing to load; a stale entry of the previous account is ignored by the uid guard below.
    if (uid === null) return;
    let cancelled = false;
    AsyncStorage.getItem(setupSnoozeKey(uid))
      .then((raw) => {
        if (!cancelled) setLoaded({ uid, snoozes: parseSnoozes(raw) });
      })
      .catch((error: unknown) => {
        log.warn(`setup snooze unreadable (${String(error)})`);
        if (!cancelled) setLoaded({ uid, snoozes: {} });
      });
    return () => {
      cancelled = true;
    };
  }, [uid]);

  const dismiss = useCallback(
    (id: SetupStepId) => {
      if (uid === null || loaded === null || loaded.uid !== uid) return;
      const snoozes = snoozeStep(loaded.snoozes, id, now);
      setLoaded({ uid, snoozes });
      AsyncStorage.setItem(setupSnoozeKey(uid), JSON.stringify(snoozes)).catch((error: unknown) => {
        log.warn(`setup snooze not saved (${String(error)})`);
      });
    },
    [uid, loaded, now],
  );

  if (uid === null || loaded === null || loaded.uid !== uid) return { step: null, calendarStepSnoozed: false, dismiss };
  const input = { emailVerificationNeeded, status, snoozes: loaded.snoozes, now };
  const step = nextSetupStep(input);
  const unsnoozed = nextSetupStep({ ...input, snoozes: {} });
  return { step, calendarStepSnoozed: step === null && unsnoozed?.id === 'connect_calendar', dismiss };
}

const ICONS: Record<SetupStepId, IconName> = { verify_email: 'mail', connect_calendar: 'calendar', sync_tasks: 'checkCircle' };

export interface SetupCardProps {
  step: SetupStep;
  /** 'above' the empty meetings card (explains why it is empty), 'below' the next meeting card. */
  placement: 'above' | 'below';
  onOpenCalendarSync(): void;
  onDismiss(id: SetupStepId): void;
}

export function SetupCard({ step, placement, onOpenCalendarSync, onDismiss }: SetupCardProps): ReactElement {
  const t = useT();
  const { colors } = useAppTheme();
  const verification = useEmailVerification();
  const provider = step.provider ?? 'todo';
  const body = step.id === 'sync_tasks' ? t(`home:setup.sync_tasks.body.${provider}`) : t(`home:setup.${step.id}.body`);

  return (
    <Card
      style={placement === 'above' ? styles.above : styles.below}
      testID="setup-card"
      accessibilityLabel={t('home:setup.a11y', { title: t(`home:setup.${step.id}.title`) })}
    >
      <View style={styles.row}>
        <View style={[styles.icon, { backgroundColor: colors.primaryContainer }]}>
          <Icon name={ICONS[step.id]} size={componentMetrics.iconInline} color={colors.primary} />
        </View>
        <View style={styles.texts}>
          <Text style={[styles.eyebrow, { color: colors.primary }]}>{t('home:setup.eyebrow')}</Text>
          <Text variant="titleMedium" testID="setup-card-title">
            {t(`home:setup.${step.id}.title`)}
          </Text>
          <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }} testID="setup-card-body">
            {body}
          </Text>
          {step.id === 'verify_email' && verification.note ? (
            <Text variant="bodySmall" style={[styles.note, { color: colors.onSurfaceVariant }]} testID="setup-card-note">
              {verification.note.text}
            </Text>
          ) : null}
        </View>
      </View>
      <View style={styles.actions}>
        {step.id === 'verify_email' ? (
          <>
            <MGButton
              variant="filled"
              size="sm"
              icon="send"
              disabled={verification.busy || verification.cooldown}
              onPress={() => {
                void verification.resend();
              }}
              testID="setup-card-action"
            >
              {t('auth:verify.resend')}
            </MGButton>
            <MGButton
              variant="outline"
              size="sm"
              disabled={verification.busy}
              onPress={() => {
                void verification.check();
              }}
              testID="setup-card-check"
            >
              {t('auth:verify.check')}
            </MGButton>
          </>
        ) : (
          // MGButton takes Material Community names ('check-circle'), not the app Icon names ('checkCircle', which drew "?").
          <MGButton variant="filled" size="sm" icon={step.id === 'connect_calendar' ? 'calendar' : 'check-circle'} onPress={onOpenCalendarSync} testID="setup-card-action">
            {t(`home:setup.${step.id}.action`)}
          </MGButton>
        )}
        <MGButton variant="ghost" size="sm" onPress={() => onDismiss(step.id)} testID="setup-card-dismiss">
          {t('home:setup.notNow')}
        </MGButton>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  above: {
    marginBottom: spacing.lg,
  },
  below: {
    marginTop: spacing.lg,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  icon: {
    width: componentMetrics.avatarSize,
    height: componentMetrics.avatarSize,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  texts: {
    flex: 1,
    gap: 2,
  },
  eyebrow: {
    ...typography.labelS,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  note: {
    marginTop: spacing.xs,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
});
