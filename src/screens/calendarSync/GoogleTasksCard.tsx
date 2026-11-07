/**
 * Google Tasks card of the calendar sync screen (hidden when EXPO_PUBLIC_GOOGLE_TASKS_SYNC is
 * 'off'). The sync rides on the Google sign-in of this device: without a Google session the card
 * only says so. Turning it on asks for the Google Tasks permission (incremental consent) and which
 * list new tasks go to (the account's lists, loaded live); while on, the list can be changed and
 * the sync stopped. On without a list for new tasks (none could be restored), the card asks for
 * one instead of showing an empty list. Every state comes from the shared calendar status.
 */
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useState, type ReactElement } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import type { CalendarStatus, TaskListInfo, TranslateFn } from '../../core/contracts';
import { errorMessageKey, toAppError } from '../../core/errors';
import type { Language } from '../../core/types';
import { componentMetrics, radii, spacing, typography } from '../../theme/tokens';
import { gtasksStateView } from './calendarSyncModel';
import { InlineProgress, PrimaryButton, RadioRow, SyncLine, partStyles } from './CalendarSyncParts';
import { toneBadgeColors, type CalendarPalette } from './palette';

export type GtasksWork = 'enable' | 'disable' | null;

export interface GoogleTasksCardProps {
  gtasks: NonNullable<CalendarStatus['gtasks']>;
  /** Another action on the screen is running: lock the controls. */
  locked: boolean;
  working: GtasksWork;
  palette: CalendarPalette;
  t: TranslateFn;
  language: Language;
  now: Date;
  loadLists(): Promise<TaskListInfo[]>;
  onEnable(list: TaskListInfo): void;
  onChangeList(list: TaskListInfo): void;
  onDisable(): void;
}

interface Chooser {
  lists: TaskListInfo[];
  loading: boolean;
  error: string | null;
  selectedId: string | null;
}

export function GoogleTasksCard({
  gtasks,
  locked,
  working,
  palette,
  t,
  language,
  now,
  loadLists,
  onEnable,
  onChangeList,
  onDisable,
}: GoogleTasksCardProps): ReactElement {
  const state = gtasksStateView(gtasks);
  const stateBadge = toneBadgeColors(palette, state.tone);
  const [chooser, setChooser] = useState<Chooser | null>(null);
  const disabled = locked || working !== null;
  const connected = gtasks.connected;
  // On, but no list resolved for new tasks (erased on another device): they wait until one is chosen.
  const needsList = state.labelKey === 'calendar:gtasks.state.needsList';

  const openChooser = (): void => {
    setChooser({ lists: [], loading: true, error: null, selectedId: gtasks.listId });
    loadLists()
      .then((lists) => {
        const preferred = gtasks.listId ?? lists.find((list) => list.isDefault)?.id ?? lists[0]?.id ?? null;
        setChooser({ lists, loading: false, error: null, selectedId: preferred });
      })
      .catch((error: unknown) => {
        const code = toAppError(error).code;
        // Loading the lists asks for the Tasks permission: a decline gets the card's own words.
        const message =
          code === 'tasks_scope_missing' ? t('calendar:gtasks.scopeDenied') : t('calendar:gtasks.listsFailed', { error: t(errorMessageKey(code)) });
        setChooser({ lists: [], loading: false, error: message, selectedId: null });
      });
  };

  const selected = chooser?.lists.find((list) => list.id === chooser.selectedId) ?? null;

  const chooserView = chooser ? (
    <View style={styles.chooser} testID="calendar-gtasks-chooser">
      <Text style={[partStyles.body, { color: palette.text }]}>{t('calendar:gtasks.chooseList')}</Text>
      {chooser.loading ? <InlineProgress label={t('calendar:gtasks.loadingLists')} palette={palette} /> : null}
      {chooser.error !== null ? (
        <Text style={[partStyles.body, { color: palette.warning }]} testID="calendar-gtasks-lists-error">
          {chooser.error}
        </Text>
      ) : null}
      {chooser.lists.map((list) => (
        <RadioRow
          key={list.id}
          selected={list.id === chooser.selectedId}
          label={list.isDefault ? t('calendar:gtasks.defaultList', { name: list.name }) : list.name}
          onPress={() => {
            if (gtasks.enabled) {
              setChooser(null);
              if (list.id !== gtasks.listId) onChangeList(list);
              return;
            }
            setChooser({ ...chooser, selectedId: list.id });
          }}
          palette={palette}
          testID={`calendar-gtasks-list-${list.id}`}
        />
      ))}
      {!gtasks.enabled ? (
        <PrimaryButton
          label={working === 'enable' ? t('calendar:gtasks.starting') : t('calendar:gtasks.startSync')}
          onPress={() => {
            if (selected) onEnable(selected);
          }}
          disabled={disabled || selected === null}
          busy={working === 'enable'}
          icon="check"
          palette={palette}
          testID="calendar-gtasks-start"
        />
      ) : (
        <Pressable onPress={() => setChooser(null)} disabled={disabled} accessibilityRole="button" hitSlop={8} testID="calendar-gtasks-chooser-close">
          <Text style={[styles.link, { color: palette.accent }]}>{t('calendar:actions.cancel')}</Text>
        </Pressable>
      )}
    </View>
  ) : null;

  return (
    <View style={[styles.card, { backgroundColor: palette.card, borderColor: palette.border }]} testID="calendar-gtasks-card">
      <View style={partStyles.cardHeader}>
        <MaterialCommunityIcons name="checkbox-marked-circle-outline" size={24} color={palette.accent} />
        <Text style={[partStyles.cardTitle, { color: palette.text }]} accessibilityRole="header">
          {t('calendar:gtasks.title')}
        </Text>
        <Text
          style={[partStyles.pill, { color: stateBadge.color, backgroundColor: stateBadge.background }]}
          maxFontSizeMultiplier={1.5}
          testID="calendar-gtasks-state"
        >
          {t(state.labelKey)}
        </Text>
      </View>
      <Text style={[partStyles.body, { color: palette.muted }]}>{t('calendar:gtasks.description')}</Text>

      {!connected ? (
        <Text style={[partStyles.body, { color: palette.muted }]} testID="calendar-gtasks-connect-first">
          {t('calendar:gtasks.connectFirst')}
        </Text>
      ) : null}

      {connected && gtasks.enabled ? (
        <>
          <View style={[styles.switchRow, { borderColor: palette.border }]}>
            <Text style={[styles.switchLabel, { color: palette.text }]}>{t('calendar:gtasks.syncSwitch')}</Text>
            <Switch
              value
              disabled={disabled}
              onValueChange={(value) => {
                if (!value) onDisable();
              }}
              trackColor={{ true: palette.accent, false: palette.neutralSurface }}
              accessibilityLabel={t('calendar:gtasks.syncSwitch')}
              testID="calendar-gtasks-switch"
            />
          </View>
          <View style={styles.listRow}>
            {needsList ? (
              <Text style={[partStyles.body, styles.listName, { color: palette.warning }]} testID="calendar-gtasks-needs-list">
                {t('calendar:gtasks.needsListHint')}
              </Text>
            ) : (
              <Text style={[partStyles.meta, styles.listName, { color: palette.muted }]} numberOfLines={2} testID="calendar-gtasks-list">
                {t('calendar:gtasks.listLabel', { name: gtasks.listName ?? '' })}
              </Text>
            )}
            {chooser === null ? (
              <Pressable onPress={openChooser} disabled={disabled} accessibilityRole="button" hitSlop={8} testID="calendar-gtasks-change-list">
                <Text style={[styles.link, { color: palette.accent }]}>{needsList ? t('calendar:gtasks.chooseListAction') : t('calendar:gtasks.changeList')}</Text>
              </Pressable>
            ) : null}
          </View>
          {chooserView}
          {gtasks.lastError === 'tasks_scope_missing' || gtasks.lastError === 'permission_denied' ? (
            <Text style={[partStyles.body, { color: palette.warning }]} testID="calendar-gtasks-permission">
              {t('calendar:gtasks.permissionHint')}
            </Text>
          ) : null}
        </>
      ) : null}

      {connected && !gtasks.enabled ? (
        chooser === null ? (
          <PrimaryButton
            label={t('calendar:gtasks.syncTasks')}
            onPress={openChooser}
            disabled={disabled}
            icon="check-all"
            palette={palette}
            testID="calendar-gtasks-enable"
          />
        ) : (
          chooserView
        )
      ) : null}

      {working === 'disable' ? (
        <InlineProgress label={t('calendar:gtasks.disabling')} palette={palette} />
      ) : connected && gtasks.enabled ? (
        <SyncLine provider={gtasks} palette={palette} t={t} language={language} now={now} testID="calendar-gtasks-sync" />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: radii.lg,
    padding: componentMetrics.cardPadding,
    marginBottom: componentMetrics.screenGutter,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: spacing.sm,
  },
  switchLabel: {
    ...typography.bodyL,
    flex: 1,
    marginRight: spacing.md,
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  listName: {
    flex: 1,
    marginRight: spacing.md,
  },
  link: {
    ...typography.labelL,
    paddingVertical: spacing.xs,
  },
  chooser: {
    marginTop: spacing.sm,
  },
});
