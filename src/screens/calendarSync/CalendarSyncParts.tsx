/**
 * Small building blocks of the calendar sync screen: primary button, provider sync line (real
 * last-sync time and last error), and the calendar rows (import switch, export radio).
 */
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import type { ComponentProps, ReactElement, ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import type { DeviceCalendarInfo, ProviderStatus, TranslateFn } from '../../core/contracts';
import type { Language } from '../../core/types';
import { formatRelative } from '../../utils/format';
import { errorText } from './calendarSyncModel';
import type { CalendarPalette } from './palette';

type IconName = ComponentProps<typeof MaterialIcons>['name'];

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
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled, busy }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.button, { backgroundColor: disabled ? palette.disabled : palette.accent, opacity: pressed ? 0.85 : 1 }]}
      testID={testID}
    >
      {busy ? (
        <ActivityIndicator size="small" color={palette.onAccent} />
      ) : icon ? (
        <MaterialIcons name={icon} size={18} color={palette.onAccent} />
      ) : null}
      <Text style={[styles.buttonText, { color: palette.onAccent }]}>{label}</Text>
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
        trackColor={{ true: palette.accent, false: palette.border }}
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
      <MaterialIcons
        name={selected ? 'radio-button-checked' : 'radio-button-unchecked'}
        size={22}
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
    gap: 8,
  },
  cardTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '700',
  },
  body: {
    fontSize: 14,
    lineHeight: 20,
  },
  sectionLabel: {
    fontSize: 15,
    fontWeight: '600',
    paddingTop: 8,
    paddingBottom: 4,
  },
  meta: {
    fontSize: 13,
    lineHeight: 18,
  },
  pill: {
    fontSize: 12,
    fontWeight: '600',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
    overflow: 'hidden',
  },
});

const styles = StyleSheet.create({
  ...partStyles,
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 48,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  buttonText: {
    fontSize: 15,
    fontWeight: '600',
  },
  inlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  inlineText: {
    marginLeft: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 48,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  rowTextBlock: {
    flex: 1,
  },
  rowLabel: {
    fontSize: 15,
    flexShrink: 1,
  },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  cardTop: {
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: 0,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 4,
    gap: 12,
  },
  cardMiddle: {
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
  },
  cardBottom: {
    borderBottomLeftRadius: 12,
    borderBottomRightRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderTopWidth: 0,
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 16,
    marginBottom: 16,
    gap: 8,
  },
});
