/**
 * Full-screen note editor (create and edit): title, category, content, pin, optional linked
 * meeting (chosen in MeetingPicker) and delete. Closing with unsaved changes asks first (the
 * Android back button included). Persistence is the caller's job (`onSubmit`).
 */
import { useState, type ReactElement } from 'react';
import { Alert, KeyboardAvoidingView, Modal, ScrollView, StyleSheet, View } from 'react-native';
import { Button, Chip, HelperText, IconButton, Switch, Text, TextInput, useTheme as usePaperTheme } from 'react-native-paper';

import { MGButton } from '../../components/ui';
import { NOTE_CATEGORIES, type Meeting, type Note } from '../../core/types';
import { useWindowInsets } from '../../hooks/useWindowInsets';
import { useT } from '../../i18n';
import { componentMetrics, radii, spacing } from '../../theme';
import type { Formatters } from '../shared/useFormatters';
import { categoryColor, categoryIcon } from './categoryStyle';
import { MeetingPicker } from './MeetingPicker';
import {
  NOTE_CONTENT_MAX,
  NOTE_TITLE_MAX,
  draftFromNote,
  isDraftDirty,
  newNoteDraft,
  validateNoteDraft,
  type NoteDraft,
  type NoteDraftError,
} from './notesModel';

export interface NoteEditorProps {
  /** null = a new note. */
  note: Note | null;
  /** Starting values of a new note (e.g. the category the list is filtered by). */
  initialDraft?: Partial<NoteDraft>;
  meetings: readonly Meeting[];
  meetingsById: ReadonlyMap<string, Meeting>;
  fmt: Formatters;
  onClose(): void;
  /** Saves the draft; resolves true when saved (the caller then closes the editor). */
  onSubmit(draft: NoteDraft): Promise<boolean>;
  /** Only for an existing note. */
  onDelete?(note: Note): void;
  /**
   * Why the last save / delete failed. Shown inside the editor: toasts render in the app's root
   * view, which a Modal covers.
   */
  errorMessage?: string | null;
}

/** Characters left before the counter is shown. */
const COUNTER_THRESHOLD = 1_000;

export function NoteEditor({
  note,
  initialDraft,
  meetings,
  meetingsById,
  fmt,
  onClose,
  onSubmit,
  onDelete,
  errorMessage = null,
}: NoteEditorProps): ReactElement {
  const t = useT();
  const theme = usePaperTheme();
  const insets = useWindowInsets();
  const [original] = useState<NoteDraft>(() => (note ? draftFromNote(note) : { ...newNoteDraft(), ...initialDraft }));
  const [draft, setDraft] = useState<NoteDraft>(original);
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [picking, setPicking] = useState(false);
  const [now] = useState(() => new Date());
  const errors = validateNoteDraft(draft);
  const dirty = isDraftDirty(draft, original);
  const change = (patch: Partial<NoteDraft>): void => setDraft((current) => ({ ...current, ...patch }));

  const errorText = (error: NoteDraftError | undefined): string | null => {
    if (!submitted || !error) return null;
    return t(`notes:errors.${error}`, { max: error === 'contentTooLong' ? NOTE_CONTENT_MAX : NOTE_TITLE_MAX });
  };

  const requestClose = (): void => {
    if (picking) {
      setPicking(false);
      return;
    }
    if (saving) return;
    if (!dirty) {
      onClose();
      return;
    }
    Alert.alert(t('notes:editor.discardTitle'), t('notes:editor.discardMessage'), [
      { text: t('notes:editor.keepEditing'), style: 'cancel' },
      { text: t('notes:editor.discard'), style: 'destructive', onPress: onClose },
    ]);
  };

  const save = async (): Promise<void> => {
    setSubmitted(true);
    if (Object.keys(errors).length > 0) return;
    if (note && !dirty) {
      onClose();
      return;
    }
    setSaving(true);
    const saved = await onSubmit(draft);
    if (!saved) setSaving(false);
  };

  const linkedMeeting = draft.meetingId ? (meetingsById.get(draft.meetingId) ?? null) : undefined;
  const contentLeft = NOTE_CONTENT_MAX - draft.content.length;
  const titleError = errorText(errors.title);
  const contentError = errorText(errors.content);

  return (
    <Modal visible animationType="slide" onRequestClose={requestClose} statusBarTranslucent navigationBarTranslucent>
      <View style={[styles.container, { backgroundColor: theme.colors.background, paddingTop: insets.top }]} testID="note-editor">
        {picking ? (
          <MeetingPicker
            meetings={meetings}
            selectedId={draft.meetingId}
            fmt={fmt}
            now={now}
            onBack={() => setPicking(false)}
            onSelect={(meetingId) => {
              change({ meetingId });
              setPicking(false);
            }}
          />
        ) : (
          <>
            <View style={[styles.header, { borderBottomColor: theme.colors.outlineVariant }]}>
              <IconButton icon="close" onPress={requestClose} accessibilityLabel={t('notes:editor.close')} disabled={saving} testID="note-editor-close" />
              <Text variant="titleLarge" accessibilityRole="header" style={styles.headerTitle} numberOfLines={1}>
                {note ? t('notes:editor.editTitle') : t('notes:editor.newTitle')}
              </Text>
              <MGButton variant="ghost" size="sm" onPress={() => void save()} loading={saving} disabled={saving} testID="note-editor-save">
                {t('notes:editor.save')}
              </MGButton>
            </View>
            <KeyboardAvoidingView behavior="padding" style={styles.container}>
              <ScrollView
                contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 24 }]}
                keyboardShouldPersistTaps="handled"
              >
                {errorMessage ? (
                  <HelperText type="error" visible accessibilityLiveRegion="polite" style={styles.saveError} testID="note-editor-error">
                    {errorMessage}
                  </HelperText>
                ) : null}
                <TextInput
                  mode="outlined"
                  outlineStyle={styles.inputOutline}
                  label={t('notes:editor.titleLabel')}
                  value={draft.title}
                  onChangeText={(title) => change({ title })}
                  maxLength={NOTE_TITLE_MAX}
                  error={titleError !== null}
                  autoFocus={note === null}
                  returnKeyType="next"
                  accessibilityLabel={t('notes:editor.titleLabel')}
                  testID="note-title-input"
                />
                <HelperText type="error" visible={titleError !== null}>
                  {titleError ?? ''}
                </HelperText>

                <Text variant="labelLarge" style={styles.label}>
                  {t('notes:editor.category')}
                </Text>
                <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel={t('notes:editor.category')}>
                  {NOTE_CATEGORIES.map((category) => {
                    const selected = draft.category === category;
                    return (
                      <Chip
                        key={category}
                        selected={selected}
                        showSelectedOverlay
                        icon={categoryIcon(category)}
                        onPress={() => change({ category })}
                        style={styles.chip}
                        selectedColor={selected ? categoryColor(category, theme.dark) : undefined}
                        accessibilityRole="radio"
                        testID={`note-category-${category}`}
                      >
                        {t(`notes:categories.${category}`)}
                      </Chip>
                    );
                  })}
                </View>

                <TextInput
                  mode="outlined"
                  outlineStyle={styles.inputOutline}
                  label={t('notes:editor.contentLabel')}
                  placeholder={t('notes:editor.contentPlaceholder')}
                  value={draft.content}
                  onChangeText={(content) => change({ content })}
                  multiline
                  maxLength={NOTE_CONTENT_MAX}
                  error={contentError !== null}
                  style={styles.content}
                  textAlignVertical="top"
                  accessibilityLabel={t('notes:editor.contentLabel')}
                  testID="note-content-input"
                />
                <HelperText type={contentError ? 'error' : 'info'} visible={contentError !== null || contentLeft <= COUNTER_THRESHOLD}>
                  {contentError ?? t('notes:editor.characters', { count: draft.content.length, max: NOTE_CONTENT_MAX })}
                </HelperText>

                <View style={styles.switchRow}>
                  <View style={styles.flex}>
                    <Text variant="bodyLarge">{t('notes:editor.pin')}</Text>
                    <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                      {t('notes:editor.pinHint')}
                    </Text>
                  </View>
                  <Switch
                    value={draft.pinned}
                    onValueChange={(pinned) => change({ pinned })}
                    accessibilityLabel={t('notes:editor.pin')}
                    testID="note-pin-switch"
                  />
                </View>

                <View style={[styles.meetingBox, { borderColor: theme.colors.outlineVariant, backgroundColor: theme.colors.surface }]}>
                  <Text variant="labelLarge">{t('notes:editor.meeting')}</Text>
                  {linkedMeeting ? (
                    <View style={styles.meetingInfo}>
                      <Text variant="bodyLarge" numberOfLines={2} testID="note-linked-meeting">
                        {linkedMeeting.title}
                      </Text>
                      <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                        {fmt.meetingRange(linkedMeeting)}
                      </Text>
                    </View>
                  ) : (
                    <Text variant="bodyMedium" style={[styles.meetingInfo, { color: theme.colors.onSurfaceVariant }]}>
                      {linkedMeeting === null ? t('notes:card.meetingUnavailable') : t('notes:editor.meetingNone')}
                    </Text>
                  )}
                  <View style={styles.meetingActions}>
                    <Button
                      mode="outlined"
                      icon="calendar-search"
                      onPress={() => setPicking(true)}
                      style={styles.meetingButton}
                      testID="note-link-meeting"
                    >
                      {draft.meetingId ? t('notes:editor.changeMeeting') : t('notes:editor.linkMeeting')}
                    </Button>
                    {draft.meetingId ? (
                      <Button
                        mode="text"
                        icon="link-variant-off"
                        onPress={() => change({ meetingId: null })}
                        accessibilityLabel={t('notes:editor.unlinkA11y')}
                        style={styles.meetingButton}
                        testID="note-unlink-meeting"
                      >
                        {t('notes:editor.unlinkMeeting')}
                      </Button>
                    ) : null}
                  </View>
                </View>

                {note && onDelete ? (
                  <Button
                    mode="outlined"
                    icon="delete-outline"
                    textColor={theme.colors.error}
                    onPress={() => onDelete(note)}
                    disabled={saving}
                    style={styles.delete}
                    testID="note-editor-delete"
                  >
                    {t('notes:editor.delete')}
                  </Button>
                ) : null}
              </ScrollView>
            </KeyboardAvoidingView>
          </>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: componentMetrics.headerMinHeight,
    paddingRight: componentMetrics.screenGutter,
    paddingVertical: spacing.xs,
    borderBottomWidth: 1,
  },
  headerTitle: {
    flex: 1,
  },
  body: {
    paddingHorizontal: componentMetrics.screenGutter,
    paddingTop: componentMetrics.screenGutter,
  },
  label: {
    marginBottom: spacing.sm,
  },
  inputOutline: {
    borderRadius: radii.md,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: componentMetrics.screenGutter,
  },
  chip: {
    marginRight: spacing.sm,
    marginBottom: spacing.sm,
  },
  content: {
    minHeight: 180,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: componentMetrics.screenGutter,
  },
  meetingBox: {
    borderWidth: 1,
    borderRadius: radii.lg,
    padding: componentMetrics.cardPadding,
    marginBottom: componentMetrics.screenGutter,
  },
  meetingInfo: {
    marginTop: spacing.sm,
  },
  meetingActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: componentMetrics.cardGap,
  },
  meetingButton: {
    marginRight: spacing.sm,
    marginBottom: spacing.xs,
  },
  delete: {
    alignSelf: 'flex-start',
    marginTop: spacing.sm,
  },
  saveError: {
    marginBottom: spacing.sm,
  },
});
