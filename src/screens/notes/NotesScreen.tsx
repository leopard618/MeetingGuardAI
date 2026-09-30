/**
 * Notes (route "Notes"). Real, persisted notes: the data layer's notes repository (Firestore
 * users/{uid}/notes with the per-user cache and outbox, so creating, editing and deleting work
 * offline and sync later). No sample data.
 *
 * - Search (title, content and the linked meeting's title; accents ignored) and category filter.
 * - Pinned notes first, then the most recently updated (repository order).
 * - Create / edit in a full-screen editor: title, category, content, pin, optional link to a
 *   meeting (the card opens that meeting). Delete asks first; notes are hard-deleted everywhere.
 */
import type { StackScreenProps } from '@react-navigation/stack';
import { useCallback, useMemo, useState, type ReactElement } from 'react';
import { Alert, FlatList, ScrollView, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Chip, FAB, HelperText, Searchbar, Text, useTheme as usePaperTheme } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';

import { EmptyState, MGButton } from '../../components/ui';
import type { RootStackParamList } from '../../core/contracts';
import { errorMessageKey, toAppError } from '../../core/errors';
import { createLogger } from '../../core/logger';
import type { Meeting, Note } from '../../core/types';
import { useT } from '../../i18n';
import { useMeetings, useNotes, useSyncState } from '../../services/data';
import { componentMetrics, radii, spacing } from '../../theme';
import { formatRelative } from '../../utils/format';
import { useFormatters } from '../shared/useFormatters';
import { useLiveNow } from '../shared/useLiveNow';
import { categoryColor } from './categoryStyle';
import { NoteCard } from './NoteCard';
import { NoteEditor } from './NoteEditor';
import { NOTE_FILTERS, countByCategory, draftToInput, draftToPatch, filterNotes, type NoteDraft, type NoteFilter } from './notesModel';

const log = createLogger('notes');

type Props = StackScreenProps<RootStackParamList, 'Notes'>;

type EditorState = { mode: 'create' } | { mode: 'edit'; note: Note } | null;

const CLOCK_TICK_MS = 60_000;

export function NotesScreen({ navigation }: Props): ReactElement {
  const t = useT();
  const theme = usePaperTheme();
  const insets = useSafeAreaInsets();
  const fmt = useFormatters();
  // "now" for relative times (paused behind other screens and in the background).
  const now = useLiveNow(CLOCK_TICK_MS);
  const { notes, isLoading, error, create, update, remove } = useNotes();
  const { meetings, isLoading: meetingsLoading } = useMeetings();
  const sync = useSyncState();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<NoteFilter>('all');
  const [editor, setEditor] = useState<EditorState>(null);
  /** Failure while the editor is open (a toast would be hidden behind the editor's Modal). */
  const [editorError, setEditorError] = useState<string | null>(null);

  const meetingsById = useMemo(() => new Map(meetings.map((meeting) => [meeting.id, meeting])), [meetings]);
  const visible = useMemo(
    () => filterNotes(notes, { query, category: filter, meetingTitle: (id) => meetingsById.get(id)?.title ?? null }),
    [notes, query, filter, meetingsById],
  );
  const counts = useMemo(() => countByCategory(notes), [notes]);
  const filtered = query.trim().length > 0 || filter !== 'all';

  const linkedMeeting = useCallback(
    (note: Note): Meeting | null | undefined => {
      if (!note.meetingId || meetingsLoading) return undefined;
      return meetingsById.get(note.meetingId) ?? null;
    },
    [meetingsById, meetingsLoading],
  );

  const errorText = useCallback(
    (caught: unknown, what: string): string => {
      const appError = toAppError(caught);
      log.warn(what, appError.code);
      return t(errorMessageKey(appError.code));
    },
    [t],
  );

  const showError = useCallback(
    (caught: unknown, what: string): void => {
      Toast.show({ type: 'error', text1: errorText(caught, what) });
    },
    [errorText],
  );

  const openEditor = useCallback((next: Exclude<EditorState, null>): void => {
    setEditorError(null);
    setEditor(next);
  }, []);

  const deleteNote = useCallback(
    async (note: Note): Promise<void> => {
      try {
        await remove(note.id);
        setEditor((current) => (current?.mode === 'edit' && current.note.id === note.id ? null : current));
        Toast.show({ type: 'success', text1: t('notes:toast.deleted') });
      } catch (caught) {
        if (editor?.mode === 'edit' && editor.note.id === note.id) setEditorError(errorText(caught, 'could not delete a note'));
        else showError(caught, 'could not delete a note');
      }
    },
    [remove, editor, errorText, showError, t],
  );

  const confirmDelete = useCallback(
    (note: Note): void => {
      Alert.alert(t('notes:delete.title', { title: note.title }), t('notes:delete.message'), [
        { text: t('common:actions.cancel'), style: 'cancel' },
        { text: t('notes:delete.confirm'), style: 'destructive', onPress: () => void deleteNote(note) },
      ]);
    },
    [deleteNote, t],
  );

  const togglePin = useCallback(
    async (note: Note): Promise<void> => {
      try {
        await update(note.id, { pinned: !note.pinned });
        Toast.show({ type: 'success', text1: t(note.pinned ? 'notes:toast.unpinned' : 'notes:toast.pinned') });
      } catch (caught) {
        showError(caught, 'could not pin a note');
      }
    },
    [update, showError, t],
  );

  const openNote = useCallback((note: Note) => openEditor({ mode: 'edit', note }), [openEditor]);
  const onTogglePin = useCallback((note: Note) => void togglePin(note), [togglePin]);
  const openMeeting = useCallback((meetingId: string) => navigation.navigate('MeetingDetails', { meetingId }), [navigation]);

  const submit = useCallback(
    async (draft: NoteDraft): Promise<boolean> => {
      if (!editor) return false;
      setEditorError(null);
      try {
        if (editor.mode === 'create') {
          await create(draftToInput(draft));
        } else {
          const patch = draftToPatch(editor.note, draft);
          if (patch) await update(editor.note.id, patch);
        }
        setEditor(null);
        Toast.show({ type: 'success', text1: t('notes:toast.saved') });
        return true;
      } catch (caught) {
        setEditorError(errorText(caught, 'could not save a note'));
        return false;
      }
    },
    [editor, create, update, errorText, t],
  );

  const clearFilters = (): void => {
    setQuery('');
    setFilter('all');
  };

  const renderItem = useCallback(
    ({ item }: { item: Note }): ReactElement => {
      const meeting = linkedMeeting(item);
      let updatedText = '';
      try {
        updatedText = formatRelative(item.updatedAt, { ...fmt.options, now });
      } catch {
        updatedText = '';
      }
      return (
        <NoteCard
          note={item}
          meeting={meeting}
          meetingWhen={meeting ? fmt.meetingRange(meeting) : ''}
          updatedText={updatedText}
          onOpen={openNote}
          onTogglePin={onTogglePin}
          onDelete={confirmDelete}
          onOpenMeeting={openMeeting}
        />
      );
    },
    [linkedMeeting, fmt, now, openNote, onTogglePin, confirmDelete, openMeeting],
  );

  const renderEmpty = (): ReactElement => {
    if (isLoading) {
      return (
        <View style={styles.centered} testID="notes-loading">
          <ActivityIndicator size="large" />
          <Text variant="bodyMedium" style={styles.centeredText}>
            {t('notes:list.loading')}
          </Text>
        </View>
      );
    }
    if (error && notes.length === 0) {
      return (
        <View style={styles.centered}>
          <EmptyState icon="cloud-alert" title={t('notes:loadError.title')} body={t(errorMessageKey(error.code))} testID="notes-error" />
        </View>
      );
    }
    if (notes.length === 0) {
      return (
        <View style={styles.centered}>
          <EmptyState
            icon="note-text-outline"
            title={t('notes:empty.title')}
            body={t('notes:empty.body')}
            action={{ label: t('notes:empty.action'), onPress: () => openEditor({ mode: 'create' }) }}
            testID="notes-empty"
          />
        </View>
      );
    }
    return (
      <View style={styles.centered}>
        <EmptyState icon="magnify" title={t('notes:noMatches.title')} body={t('notes:noMatches.body')} testID="notes-no-matches" />
        {filtered ? (
          <MGButton variant="tonal" style={styles.clearButton} onPress={clearFilters} testID="notes-clear-filters">
            {t('notes:noMatches.action')}
          </MGButton>
        ) : null}
      </View>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <View style={styles.top}>
        <Searchbar
          placeholder={t('notes:search.placeholder')}
          value={query}
          onChangeText={setQuery}
          accessibilityLabel={t('notes:search.placeholder')}
          clearAccessibilityLabel={t('notes:search.clear')}
          testID="notes-search"
        />
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filters}
          accessibilityRole="radiogroup"
          accessibilityLabel={t('notes:filters.label')}
        >
          {NOTE_FILTERS.map((option) => {
            const label = option === 'all' ? t('notes:filters.all') : t(`notes:categories.${option}`);
            return (
              <Chip
                key={option}
                selected={filter === option}
                showSelectedOverlay
                icon={
                  option === 'all'
                    ? 'notebook-multiple'
                    : () => <View style={[styles.chipDot, { backgroundColor: categoryColor(option, theme.dark) }]} />
                }
                onPress={() => setFilter(option)}
                style={styles.filterChip}
                accessibilityRole="radio"
                testID={`notes-filter-${option}`}
              >
                {t('notes:filters.withCount', { label, count: counts[option] })}
              </Chip>
            );
          })}
        </ScrollView>
        {!sync.online ? (
          <HelperText type="info" visible testID="notes-offline">
            {t('data:sync.offline')}
          </HelperText>
        ) : null}
        {error && notes.length > 0 ? (
          <HelperText type="error" visible>
            {t(errorMessageKey(error.code))}
          </HelperText>
        ) : null}
      </View>

      <FlatList
        data={visible}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        ListEmptyComponent={renderEmpty()}
        ListHeaderComponent={
          visible.length > 0 ? (
            <Text variant="labelMedium" style={[styles.count, { color: theme.colors.onSurfaceVariant }]} accessibilityRole="summary">
              {t('notes:list.count', { count: visible.length })}
            </Text>
          ) : null
        }
        contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 96 }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        testID="notes-list"
      />

      <FAB
        icon="plus"
        label={t('notes:add')}
        accessibilityLabel={t('notes:addA11y')}
        onPress={() => openEditor({ mode: 'create' })}
        style={[styles.fab, { bottom: insets.bottom + 16, right: insets.right + 16 }]}
        testID="notes-add"
      />

      {editor ? (
        <NoteEditor
          note={editor.mode === 'edit' ? editor.note : null}
          initialDraft={editor.mode === 'create' && filter !== 'all' ? { category: filter } : undefined}
          meetings={meetings}
          meetingsById={meetingsById}
          fmt={fmt}
          onClose={() => setEditor(null)}
          onSubmit={submit}
          onDelete={confirmDelete}
          errorMessage={editorError}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  top: {
    paddingHorizontal: componentMetrics.screenGutter,
    paddingTop: spacing.md,
  },
  filters: {
    paddingVertical: spacing.md,
  },
  filterChip: {
    marginRight: spacing.sm,
  },
  chipDot: {
    width: componentMetrics.sourceDotSize,
    height: componentMetrics.sourceDotSize,
    borderRadius: radii.full,
  },
  list: {
    flexGrow: 1,
    paddingHorizontal: componentMetrics.screenGutter,
  },
  count: {
    marginBottom: spacing.sm,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xxl,
  },
  centeredText: {
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  clearButton: {
    alignSelf: 'center',
  },
  fab: {
    position: 'absolute',
  },
});
