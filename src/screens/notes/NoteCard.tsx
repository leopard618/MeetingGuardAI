/**
 * One note in the Notes list. The body (title, preview, category, last update) opens the editor;
 * the linked meeting, pin and delete are separate controls (siblings of the body, so screen
 * readers can reach each of them).
 */
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { memo, type ReactElement } from 'react';
import { StyleSheet, View } from 'react-native';
import { IconButton, Text, TouchableRipple, useTheme as usePaperTheme } from 'react-native-paper';

import type { Meeting, Note } from '../../core/types';
import { useT } from '../../i18n';
import { componentMetrics, radii, spacing } from '../../theme';
import { categoryColor, categoryIcon } from './categoryStyle';

export interface NoteCardProps {
  note: Note;
  /** The linked meeting; undefined when the note has no link, null when the meeting is gone. */
  meeting: Meeting | null | undefined;
  meetingWhen: string;
  updatedText: string;
  onOpen(note: Note): void;
  onTogglePin(note: Note): void;
  onDelete(note: Note): void;
  onOpenMeeting(meetingId: string): void;
}

function NoteCardView({ note, meeting, meetingWhen, updatedText, onOpen, onTogglePin, onDelete, onOpenMeeting }: NoteCardProps): ReactElement {
  const t = useT();
  const theme = usePaperTheme();
  const accent = categoryColor(note.category, theme.dark);
  const categoryLabel = t(`notes:categories.${note.category}`);

  return (
    <View
      style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.outlineVariant, borderLeftColor: accent }]}
      testID={`note-card-${note.id}`}
    >
      <TouchableRipple
        onPress={() => onOpen(note)}
        accessibilityRole="button"
        accessibilityLabel={t('notes:card.open', { title: note.title })}
        accessibilityHint={t('notes:card.openHint')}
        style={styles.body}
        borderless={false}
        testID={`note-open-${note.id}`}
      >
        <View>
          <View style={styles.titleRow}>
            {note.pinned ? (
              <MaterialCommunityIcons
                name="pin"
                size={componentMetrics.iconMeta}
                color={theme.colors.onSurfaceVariant}
                style={styles.pinIcon}
                accessibilityLabel={t('notes:card.pinned')}
              />
            ) : null}
            <Text variant="titleMedium" numberOfLines={2} style={styles.flex}>
              {note.title}
            </Text>
          </View>
          {note.content.trim().length > 0 ? (
            <Text variant="bodyMedium" numberOfLines={2} style={[styles.preview, { color: theme.colors.onSurfaceVariant }]}>
              {note.content}
            </Text>
          ) : null}
          <View style={styles.metaRow}>
            <MaterialCommunityIcons name={categoryIcon(note.category)} size={componentMetrics.iconMeta} color={accent} />
            <Text variant="labelMedium" style={[styles.category, { color: theme.colors.onSurfaceVariant }]}>
              {categoryLabel}
            </Text>
            <Text variant="bodySmall" style={[styles.flex, { color: theme.colors.onSurfaceVariant }]} numberOfLines={1}>
              {updatedText ? t('notes:card.updated', { when: updatedText }) : ''}
            </Text>
          </View>
        </View>
      </TouchableRipple>

      <View style={styles.footer}>
        {meeting ? (
          <TouchableRipple
            onPress={() => onOpenMeeting(meeting.id)}
            accessibilityRole="link"
            accessibilityLabel={t('notes:card.meeting', { title: meeting.title })}
            style={[styles.meetingLink, { backgroundColor: theme.colors.secondaryContainer }]}
            testID={`note-meeting-${note.id}`}
          >
            <View style={styles.meetingRow}>
              <MaterialCommunityIcons name="calendar-clock" size={componentMetrics.iconMeta} color={theme.colors.onSecondaryContainer} />
              <View style={styles.meetingText}>
                <Text variant="labelLarge" numberOfLines={1} style={{ color: theme.colors.onSecondaryContainer }}>
                  {meeting.title}
                </Text>
                {meetingWhen ? (
                  <Text variant="bodySmall" numberOfLines={1} style={{ color: theme.colors.onSecondaryContainer }}>
                    {meetingWhen}
                  </Text>
                ) : null}
              </View>
            </View>
          </TouchableRipple>
        ) : meeting === null ? (
          <View style={[styles.meetingRow, styles.flex]}>
            <MaterialCommunityIcons name="calendar-remove-outline" size={componentMetrics.iconMeta} color={theme.colors.onSurfaceVariant} />
            <Text variant="bodySmall" style={[styles.meetingText, { color: theme.colors.onSurfaceVariant }]}>
              {t('notes:card.meetingUnavailable')}
            </Text>
          </View>
        ) : (
          <View style={styles.flex} />
        )}
        <IconButton
          icon={note.pinned ? 'pin-off-outline' : 'pin-outline'}
          size={20}
          onPress={() => onTogglePin(note)}
          accessibilityLabel={t(note.pinned ? 'notes:card.unpin' : 'notes:card.pin', { title: note.title })}
          testID={`note-pin-${note.id}`}
        />
        <IconButton
          icon="delete-outline"
          size={20}
          iconColor={theme.colors.error}
          onPress={() => onDelete(note)}
          accessibilityLabel={t('notes:card.delete', { title: note.title })}
          testID={`note-delete-${note.id}`}
        />
      </View>
    </View>
  );
}

export const NoteCard = memo(NoteCardView);

const styles = StyleSheet.create({
  card: {
    borderRadius: radii.lg,
    borderWidth: 1,
    borderLeftWidth: componentMetrics.accentBarWidth,
    marginBottom: componentMetrics.cardGap,
    overflow: 'hidden',
  },
  body: {
    paddingHorizontal: componentMetrics.cardPadding,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  flex: {
    flex: 1,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  pinIcon: {
    marginRight: spacing.sm,
    marginTop: spacing.xs,
  },
  preview: {
    marginTop: spacing.xs,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  category: {
    marginLeft: spacing.xs,
    marginRight: spacing.md,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: spacing.md,
    paddingRight: spacing.xs,
    paddingBottom: spacing.sm,
  },
  meetingLink: {
    flex: 1,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginRight: spacing.xs,
    minHeight: componentMetrics.touchTargetMin,
    justifyContent: 'center',
  },
  meetingRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  meetingText: {
    flex: 1,
    marginLeft: spacing.sm,
  },
});
