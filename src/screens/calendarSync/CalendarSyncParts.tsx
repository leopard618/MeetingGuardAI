/**
 * Small building blocks of the calendar sync screen: primary button, provider sync line (real
 * last-sync time and last error), and the calendar rows (import switch, export radio).
 * All colors come from the calendar palette (MG tokens, light / dark).
 */
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { ComponentProps, ReactElement, ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import type { DeviceCalendarInfo, ProviderStatus, TranslateFn } from '../../core/contracts';
import type { Language } from '../../core/types';
// Tokens directly (not the src/theme barrel): the sync screen's tests mock ThemeContext.
import { componentMetrics, pressedDimOpacity, radii, spacing, typography } from '../../theme/tokens';
import { formatRelative } from '../../utils/format';
import { errorText } from './calendarSyncModel';
import type { CalendarPalette } from './palette';

type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

export function PrimaryButton({
  label,
  onPress,
  disabled = false,
  busy = false,
  icon,
  palette,
  testID,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  icon?: IconName;
  palette: CalendarPalette;
  testID?: string;
}): ReactElement {
  const contentColor = disabled ? palette.disabledText : palette.onAccent;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled, busy }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: disabled ? palette.disabled : palette.accent, opacity: pressed ? pressedDimOpacity : 1 },
      ]}
      testID={testID}
    >
      {busy ? (
        <ActivityIndicator size="small" color={contentColor} />
      ) : icon ? (
        <MaterialCommunityIcons name={icon} size={componentMetrics.iconInline} color={contentColor} />
      ) : null}
      <Text style={[styles.buttonText, { color: contentColor }]}>{label}</Text>
    </Pressable>
  );
}

export function InlineProgress({ label, palette }: { label: string; palette: CalendarPalette }): ReactElement {
  return (
    <View style={styles.inlineRow} accessible accessibilityLiveRegion="polite" accessibilityLabel={label}>
      <ActivityIndicator size="small" color={palette.accent} />
      <Text style={[styles.meta, styles.inlineText, { color: palette.muted }]}>{label}</Text>
    </View>
  );
}

export function SyncLine({
  provider,
  palette,
  t,
  language,
  now,
  testID,
}: {
  provider: ProviderStatus;
  palette: CalendarPalette;
  t: TranslateFn;
  language: Language;
  now: Date;
  testID?: string;
}): ReactElement {
  if (provider.syncing) return <InlineProgress label={t('calendar:status.syncing')} palette={palette} />;
  return (
    <View testID={testID}>
      <Text style={[styles.meta, { color: palette.muted }]}>
        {provider.lastSyncAt
          ? t('calendar:status.lastSynced', { time: formatRelative(provider.lastSyncAt, { language, now }) })
          : t('calendar:status.neverSynced')}
      </Text>
      {provider.lastError ? <Text style={[styles.meta, { color: palette.danger }]}>{errorText(t, provider.lastError)}</Text> : null}
    </View>
  );
}

export function CalendarColorDot({ color, palette }: { color: string | null; palette: CalendarPalette }): ReactElement {
  return <View style={[styles.dot, { backgroundColor: color ?? palette.muted }]} />;
}

export function ImportRow({
  calendar,
  subtitle,
  value,
  disabled,
  onChange,
  palette,
  accessibilityLabel,
}: {
  calendar: DeviceCalendarInfo;
  subtitle: string | null;
  value: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
  palette: CalendarPalette;
  accessibilityLabel: string;
}): ReactElement {
  return (
    <View style={[styles.row, { borderColor: palette.border }]} testID={`device-import-${calendar.id}`}>
      <CalendarColorDot color={calendar.color} palette={palette} />
      <View style={styles.rowTextBlock}>
        <Text style={[styles.rowLabel, { color: palette.text }]} numberOfLines={1}>
          {calendar.title}
        </Text>
        {subtitle ? (
          <Text style={[styles.meta, { color: palette.muted }]} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      <Switch
        value={value}
        disabled={disabled}
        onValueChange={onChange}
        accessibilityLabel={accessibilityLabel}
        trackColor={{ true: palette.accent, false: palette.neutralSurface }}
        testID={`device-import-switch-${calendar.id}`}
      />
    </View>
  );
}

export function RadioRow({
  selected,
  label,
  onPress,
  palette,
  color,
  testID,
}: {
  selected: boolean;
  label: string;
  onPress: () => void;
  palette: CalendarPalette;
  /** Calendar color dot; undefined = no dot ("none" option). */
  color?: string | null;
  testID?: string;
}): ReactElement {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected, selected }}
      accessibilityLabel={label}
      onPress={onPress}
      style={[styles.row, { borderColor: palette.border }]}
      testID={testID}
    >
      {color !== undefined ? <CalendarColorDot color={color} palette={palette} /> : null}
      <Text style={[styles.rowLabel, styles.rowTextBlock, { color: palette.text }]} numberOfLines={1}>
        {label}
      </Text>
      <MaterialCommunityIcons
        name={selected ? 'radiobox-marked' : 'radiobox-blank'}
        size={componentMetrics.iconNav}
        color={selected ? palette.accent : palette.muted}
      />
    </Pressable>
  );
}

/** Card chrome around a group of rows (top / bottom parts, so a SectionList can render it). */
export function CardTop({ palette, children }: { palette: CalendarPalette; children?: ReactNode }): ReactElement {
  return <View style={[styles.cardTop, { backgroundColor: palette.card, borderColor: palette.border }]}>{children}</View>;
}

export function CardMiddle({ palette, children }: { palette: CalendarPalette; children?: ReactNode }): ReactElement {
  return <View style={[styles.cardMiddle, { backgroundColor: palette.card, borderColor: palette.border }]}>{children}</View>;
}

export function CardBottom({ palette, children }: { palette: CalendarPalette; children?: ReactNode }): ReactElement {
  return <View style={[styles.cardBottom, { backgroundColor: palette.card, borderColor: palette.border }]}>{children}</View>;
}

export const partStyles = StyleSheet.create({
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  cardTitle: {
    flex: 1,
    ...typography.titleM,
  },
  body: {
    ...typography.bodyM,
  },
  sectionLabel: {
    ...typography.titleS,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  meta: {
    ...typography.bodyS,
  },
  /** Status badge: labelM on a Container pair (see toneBadgeColors). */
  pill: {
    ...typography.labelM,
    borderRadius: radii.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    overflow: 'hidden',
  },
});

const styles = StyleSheet.create({
  ...partStyles,
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    minHeight: componentMetrics.buttonHeight,
    borderRadius: radii.full,
    paddingVertical: spacing.md,
    paddingHorizontal: componentMetrics.cardPadding,
  },
  buttonText: {
    ...typography.labelL,
  },
  inlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  inlineText: {
    marginLeft: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: componentMetrics.listRowMinHeight,
    paddingVertical: componentMetrics.listRowPaddingV,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  rowTextBlock: {
    flex: 1,
  },
  rowLabel: {
    ...typography.bodyL,
    flexShrink: 1,
  },
  dot: {
    width: 12,
    height: 12,
    borderRadius: radii.full,
  },
  cardTop: {
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    borderWidth: 1,
    borderBottomWidth: 0,
    paddingHorizontal: componentMetrics.cardPadding,
    paddingTop: componentMetrics.cardPadding,
    paddingBottom: spacing.xs,
    gap: componentMetrics.cardGap,
  },
  cardMiddle: {
    borderLeftWidth: 1,
    borderRightWidth: 1,
    paddingHorizontal: componentMetrics.cardPadding,
  },
  cardBottom: {
    borderBottomLeftRadius: radii.lg,
    borderBottomRightRadius: radii.lg,
    borderWidth: 1,
    borderTopWidth: 0,
    paddingHorizontal: componentMetrics.cardPadding,
    paddingTop: spacing.xs,
    paddingBottom: componentMetrics.cardPadding,
    marginBottom: componentMetrics.screenGutter,
    gap: spacing.sm,
  },
});
