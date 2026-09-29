/**
 * Chooses the meeting a note is linked to (inside the note editor): search, then upcoming
 * meetings (soonest first) and past meetings (most recent first) in a SectionList.
 */
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useMemo, useState, type ReactElement } from 'react';
import { SectionList, StyleSheet, View } from 'react-native';
import { IconButton, Searchbar, Text, TouchableRipple, useTheme as usePaperTheme } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { Meeting } from '../../core/types';
import { useT } from '../../i18n';
import type { Formatters } from '../shared/useFormatters';
import { meetingChoices } from './notesModel';

export interface MeetingPickerProps {
  meetings: readonly Meeting[];
  selectedId: string | null;
  fmt: Formatters;
  now: Date;
  onSelect(meetingId: string): void;
  onBack(): void;
}

interface PickerSection {
  key: 'upcoming' | 'past';
  title: string;
  data: Meeting[];
}

export function MeetingPicker({ meetings, selectedId, fmt, now, onSelect, onBack }: MeetingPickerProps): ReactElement {
  const t = useT();
  const theme = usePaperTheme();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');

  const sections = useMemo((): PickerSection[] => {
    const choices = meetingChoices(meetings, { now, query });
    const result: PickerSection[] = [];
    if (choices.upcoming.length > 0) result.push({ key: 'upcoming', title: t('notes:picker.upcoming'), data: choices.upcoming });
    if (choices.past.length > 0) result.push({ key: 'past', title: t('notes:picker.past'), data: choices.past });
    return result;
  }, [meetings, now, query, t]);

  const renderItem = ({ item }: { item: Meeting }): ReactElement => {
    const selected = item.id === selectedId;
    const when = fmt.meetingRange(item);
    return (
      <TouchableRipple
        onPress={() => onSelect(item.id)}
        accessibilityRole="radio"
        accessibilityState={{ selected, checked: selected }}
        accessibilityLabel={t('notes:picker.select', { title: item.title, when })}
        style={[styles.item, selected && { backgroundColor: theme.colors.secondaryContainer }]}
        testID={`picker-meeting-${item.id}`}
      >
        <View style={styles.itemRow}>
          <MaterialCommunityIcons
            name={selected ? 'radiobox-marked' : 'radiobox-blank'}
            size={22}
            color={selected ? theme.colors.primary : theme.colors.onSurfaceVariant}
          />
          <View style={styles.itemText}>
            <Text variant="bodyLarge" numberOfLines={2}>
              {item.title}
            </Text>
            <Text variant="bodySmall" numberOfLines={1} style={{ color: theme.colors.onSurfaceVariant }}>
              {item.status === 'cancelled' ? `${when} · ${t('notes:picker.cancelled')}` : when}
            </Text>
          </View>
          {selected ? (
            <Text variant="labelMedium" style={{ color: theme.colors.primary }}>
              {t('notes:picker.linked')}
            </Text>
          ) : null}
        </View>
      </TouchableRipple>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <IconButton icon="arrow-left" onPress={onBack} accessibilityLabel={t('notes:picker.back')} testID="picker-back" />
        <Text variant="titleLarge" accessibilityRole="header" style={styles.headerTitle} numberOfLines={1}>
          {t('notes:picker.title')}
        </Text>
      </View>
      <Searchbar
        placeholder={t('notes:picker.search')}
        value={query}
        onChangeText={setQuery}
        style={styles.search}
        accessibilityLabel={t('notes:picker.search')}
        clearAccessibilityLabel={t('notes:search.clear')}
        testID="picker-search"
      />
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        renderSectionHeader={({ section }) => (
          <Text
            variant="labelLarge"
            accessibilityRole="header"
            style={[styles.sectionHeader, { color: theme.colors.primary, backgroundColor: theme.colors.background }]}
          >
            {section.title}
          </Text>
        )}
        stickySectionHeadersEnabled
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        ListEmptyComponent={
          <Text variant="bodyMedium" style={[styles.empty, { color: theme.colors.onSurfaceVariant }]} testID="picker-empty">
            {query.trim().length > 0 ? t('notes:picker.noMatches') : t('notes:picker.empty')}
          </Text>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: 16,
  },
  headerTitle: {
    flex: 1,
  },
  search: {
    marginHorizontal: 16,
    marginBottom: 8,
  },
  sectionHeader: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 6,
  },
  item: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    minHeight: 56,
    justifyContent: 'center',
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  itemText: {
    flex: 1,
    marginHorizontal: 12,
  },
  empty: {
    textAlign: 'center',
    paddingHorizontal: 32,
    paddingTop: 32,
  },
});
