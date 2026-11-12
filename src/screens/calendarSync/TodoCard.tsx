/**
 * Microsoft To Do card of the calendar sync screen (only when EXPO_PUBLIC_MSAL_CLIENT_ID is set).
 * The sync rides on the Outlook connection: without it the card only says so. Turning it on asks
 * which list new tasks go to (the account's lists, loaded live); while on, the list can be
 * changed and the sync stopped. On without a list for new tasks (none could be restored), the
 * card asks for one instead of showing an empty list. Every state comes from the shared
 * calendar status.
 */
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useState, type ReactElement } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import type { CalendarStatus, TodoList, TranslateFn } from '../../core/contracts';
import { errorMessageKey, toAppError } from '../../core/errors';
import type { Language } from '../../core/types';
import { componentMetrics, radii, spacing, typography } from '../../theme/tokens';
import { todoStateView } from './calendarSyncModel';
import { InlineProgress, PrimaryButton, RadioRow, SyncLine, partStyles } from './CalendarSyncParts';
import { toneBadgeColors, type CalendarPalette } from './palette';

export type TodoWork = 'enable' | 'disable' | null;

export interface TodoCardProps {
  todo: NonNullable<CalendarStatus['todo']>;
  /** The Outlook card's connection (same Microsoft account). */
  outlookConnected: boolean;
  /** Another action on the screen is running: lock the controls. */
  locked: boolean;
  working: TodoWork;
  palette: CalendarPalette;
  t: TranslateFn;
  language: Language;
  now: Date;
  loadLists(): Promise<TodoList[]>;
  onEnable(list: TodoList): void;
  onChangeList(list: TodoList): void;
  onDisable(): void;
}

interface Chooser {
  lists: TodoList[];
  loading: boolean;
  error: string | null;
  selectedId: string | null;
}

export function TodoCard({
  todo,
  outlookConnected,
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
}: TodoCardProps): ReactElement {
  const state = todoStateView(todo, outlookConnected);
  const stateBadge = toneBadgeColors(palette, state.tone);
  const [chooser, setChooser] = useState<Chooser | null>(null);
  const disabled = locked || working !== null;
  // On, but no list resolved for new tasks (erased on another device): they wait until one is chosen.
  const needsList = state.labelKey === 'calendar:todo.state.needsList';

  const openChooser = (): void => {
    setChooser({ lists: [], loading: true, error: null, selectedId: todo.listId });
    loadLists()
      .then((lists) => {
        const preferred = todo.listId ?? lists.find((list) => list.isDefault)?.id ?? lists[0]?.id ?? null;
        setChooser({ lists, loading: false, error: null, selectedId: preferred });
      })
      .catch((error: unknown) => {
        setChooser({ lists: [], loading: false, error: t(errorMessageKey(toAppError(error).code)), selectedId: null });
      });
  };

  const selected = chooser?.lists.find((list) => list.id === chooser.selectedId) ?? null;

  const chooserView = chooser ? (
    <View style={styles.chooser} testID="calendar-todo-chooser">
      <Text style={[partStyles.body, { color: palette.text }]}>{t('calendar:todo.chooseList')}</Text>
      {chooser.loading ? <InlineProgress label={t('calendar:todo.loadingLists')} palette={palette} /> : null}
      {chooser.error !== null ? (
        <Text style={[partStyles.body, { color: palette.warning }]} testID="calendar-todo-lists-error">
          {t('calendar:todo.listsFailed', { error: chooser.error })}
        </Text>
      ) : null}
      {chooser.lists.map((list) => (
        <RadioRow
          key={list.id}
          selected={list.id === chooser.selectedId}
          label={list.isDefault ? t('calendar:todo.defaultList', { name: list.name }) : list.name}
          onPress={() => {
            if (todo.enabled) {
              setChooser(null);
              if (list.id !== todo.listId) onChangeList(list);
              return;
            }
            setChooser({ ...chooser, selectedId: list.id });
          }}
          palette={palette}
          testID={`calendar-todo-list-${list.id}`}
        />
      ))}
      {!todo.enabled ? (
        <PrimaryButton
          label={working === 'enable' ? t('calendar:todo.starting') : t('calendar:todo.startSync')}
          onPress={() => {
            if (selected) onEnable(selected);
          }}
          disabled={disabled || selected === null}
          busy={working === 'enable'}
          icon="check"
          palette={palette}
          testID="calendar-todo-start"
        />
      ) : (
        <Pressable onPress={() => setChooser(null)} disabled={disabled} accessibilityRole="button" hitSlop={8} testID="calendar-todo-chooser-close">
          <Text style={[styles.link, { color: palette.accent }]}>{t('calendar:actions.cancel')}</Text>
        </Pressable>
      )}
    </View>
  ) : null;

  return (
    <View style={[styles.card, { backgroundColor: palette.card, borderColor: palette.border }]} testID="calendar-todo-card">
      <View style={partStyles.cardHeader}>
        <MaterialCommunityIcons name="check-circle-outline" size={24} color={palette.accent} />
        <Text style={[partStyles.cardTitle, { color: palette.text }]} accessibilityRole="header">
          {t('calendar:todo.title')}
        </Text>
        <Text
          style={[partStyles.pill, { color: stateBadge.color, backgroundColor: stateBadge.background }]}
          maxFontSizeMultiplier={1.5}
          testID="calendar-todo-state"
        >
          {t(state.labelKey)}
        </Text>
      </View>
      <Text style={[partStyles.body, { color: palette.muted }]}>{t('calendar:todo.description')}</Text>

      {!outlookConnected ? (
        <Text style={[partStyles.body, { color: palette.muted }]} testID="calendar-todo-connect-first">
          {t('calendar:todo.connectFirst')}
        </Text>
      ) : null}

      {outlookConnected && todo.enabled ? (
        <>
          <View style={[styles.switchRow, { borderColor: palette.border }]}>
            <Text style={[styles.switchLabel, { color: palette.text }]}>{t('calendar:todo.syncSwitch')}</Text>
            <Switch
              value
              disabled={disabled}
              onValueChange={(value) => {
                if (!value) onDisable();
              }}
              trackColor={{ true: palette.accent, false: palette.neutralSurface }}
              accessibilityLabel={t('calendar:todo.syncSwitch')}
              testID="calendar-todo-switch"
            />
          </View>
          <View style={styles.listRow}>
            {needsList ? (
              <Text style={[partStyles.body, styles.listName, { color: palette.warning }]} testID="calendar-todo-needs-list">
                {t('calendar:todo.needsListHint')}
              </Text>
            ) : (
              <Text style={[partStyles.meta, styles.listName, { color: palette.muted }]} numberOfLines={2} testID="calendar-todo-list">
                {t('calendar:todo.listLabel', { name: todo.listName ?? '' })}
              </Text>
            )}
            {chooser === null ? (
              <Pressable onPress={openChooser} disabled={disabled} accessibilityRole="button" hitSlop={8} testID="calendar-todo-change-list">
                <Text style={[styles.link, { color: palette.accent }]}>{needsList ? t('calendar:todo.chooseListAction') : t('calendar:todo.changeList')}</Text>
              </Pressable>
            ) : null}
          </View>
          {chooserView}
          {todo.lastError === 'permission_denied' ? (
            <Text style={[partStyles.body, { color: palette.warning }]} testID="calendar-todo-permission">
              {t('calendar:todo.permissionHint')}
            </Text>
          ) : null}
        </>
      ) : null}

      {outlookConnected && !todo.enabled ? (
        chooser === null ? (
          <PrimaryButton
            label={t('calendar:todo.syncTasks')}
            onPress={openChooser}
            disabled={disabled}
            icon="check-all"
            palette={palette}
            testID="calendar-todo-enable"
          />
        ) : (
          chooserView
        )
      ) : null}

      {working === 'disable' ? (
        <InlineProgress label={t('calendar:todo.disabling')} palette={palette} />
      ) : outlookConnected && todo.enabled ? (
        <SyncLine provider={todo} palette={palette} t={t} language={language} now={now} testID="calendar-todo-sync" />
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
