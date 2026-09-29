/**
 * "Attachments" section of the meeting details screen: the meeting's DEVICE-LOCAL files (clearly
 * labeled: not uploaded, not synced, not shared), open with another app, remove, and add a file,
 * a photo from the library or a new photo.
 */
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { ComponentProps, ReactElement } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, HelperText, IconButton, Text, TouchableRipple, useTheme as usePaperTheme } from 'react-native-paper';
import Toast from 'react-native-toast-message';

import { errorMessageKey, toAppError } from '../../core/errors';
import { createLogger } from '../../core/logger';
import { useLanguage, useT } from '../../i18n';
import {
  MAX_ATTACHMENT_MB,
  useMeetingAttachments,
  type AttachmentCategory,
  type AttachmentRecord,
  type AttachmentSource,
} from '../../services/attachments';
import { Section } from '../shared/Section';
import { useFormatters } from '../shared/useFormatters';
import { addErrorMessage, formatFileSize, showAddResult } from './attachmentMessages';

const log = createLogger('attachments');

type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

const CATEGORY_ICONS: Readonly<Record<AttachmentCategory, IconName>> = {
  documents: 'file-document-outline',
  images: 'file-image-outline',
  videos: 'file-video-outline',
  audio: 'file-music-outline',
  archives: 'folder-zip-outline',
};

function AttachmentRow({
  item,
  meta,
  onOpen,
  onRemove,
}: {
  item: AttachmentRecord;
  meta: string;
  onOpen(item: AttachmentRecord): void;
  onRemove(item: AttachmentRecord): void;
}): ReactElement {
  const t = useT();
  const theme = usePaperTheme();
  return (
    <View style={styles.row} testID={`attachment-${item.id}`}>
      <TouchableRipple
        onPress={() => onOpen(item)}
        accessibilityRole="button"
        accessibilityLabel={t('attachments:open', { name: item.name })}
        accessibilityHint={t('attachments:openHint')}
        style={styles.rowMain}
        testID={`attachment-open-${item.id}`}
      >
        <View style={styles.rowContent}>
          <MaterialCommunityIcons
            name={CATEGORY_ICONS[item.category]}
            size={26}
            color={theme.colors.primary}
            accessibilityLabel={t(`attachments:category.${item.category}`)}
          />
          <View style={styles.rowText}>
            <Text variant="bodyLarge" numberOfLines={1} ellipsizeMode="middle">
              {item.name}
            </Text>
            {meta ? (
              <Text variant="bodySmall" numberOfLines={1} style={{ color: theme.colors.onSurfaceVariant }}>
                {meta}
              </Text>
            ) : null}
          </View>
        </View>
      </TouchableRipple>
      <IconButton
        icon="close-circle-outline"
        iconColor={theme.colors.error}
        onPress={() => onRemove(item)}
        accessibilityLabel={t('attachments:remove', { name: item.name })}
        testID={`attachment-remove-${item.id}`}
      />
    </View>
  );
}

export function MeetingAttachmentsSection({ meetingId }: { meetingId: string }): ReactElement {
  const t = useT();
  const theme = usePaperTheme();
  const { language } = useLanguage();
  const fmt = useFormatters();
  const { attachments, isLoading, error, busy, reload, add, remove, open } = useMeetingAttachments(meetingId);

  const addFrom = async (source: AttachmentSource): Promise<void> => {
    try {
      showAddResult(await add(source), t);
    } catch (caught) {
      const appError = toAppError(caught);
      if (appError.code === 'cancelled') return;
      log.warn('could not add an attachment', appError.code);
      Toast.show({ type: 'error', text1: addErrorMessage(appError, source, t) });
    }
  };

  const openItem = (item: AttachmentRecord): void => {
    open(item).catch((caught: unknown) => {
      const appError = toAppError(caught);
      log.warn('could not open an attachment', appError.code);
      Toast.show({ type: 'error', text1: appError.code === 'not_found' ? t('attachments:missing') : t('attachments:openFailed') });
    });
  };

  const confirmRemove = (item: AttachmentRecord): void => {
    Alert.alert(t('attachments:removeTitle'), t('attachments:removeMessage', { name: item.name }), [
      { text: t('common:actions.cancel'), style: 'cancel' },
      {
        text: t('attachments:removeConfirm'),
        style: 'destructive',
        onPress: () => {
          remove(item.id).then(
            () => Toast.show({ type: 'success', text1: t('attachments:removed') }),
            (caught: unknown) => {
              const appError = toAppError(caught);
              log.warn('could not remove an attachment', appError.code);
              Toast.show({ type: 'error', text1: t(errorMessageKey(appError.code)) });
            },
          );
        },
      },
    ]);
  };

  const metaOf = (item: AttachmentRecord): string => {
    const date = fmt.date(item.createdAt, 'medium');
    const size = item.size !== null ? formatFileSize(item.size, language, t) : '';
    if (size && date) return t('attachments:meta', { size, date });
    return size || date;
  };

  return (
    <Section title={t('attachments:title')} testID="meeting-attachments">
      <View style={styles.notice}>
        <MaterialCommunityIcons name="cellphone-lock" size={18} color={theme.colors.onSurfaceVariant} style={styles.noticeIcon} />
        <Text variant="bodySmall" style={[styles.flex, { color: theme.colors.onSurfaceVariant }]} testID="attachments-local-only">
          {t('attachments:localOnly')}
        </Text>
      </View>

      {isLoading ? (
        <View style={styles.status}>
          <ActivityIndicator size="small" />
          <Text variant="bodySmall" style={styles.statusText}>
            {t('attachments:loading')}
          </Text>
        </View>
      ) : error ? (
        <View>
          <HelperText type="error" visible>
            {t('attachments:loadError')}
          </HelperText>
          <Button mode="text" icon="refresh" onPress={reload} style={styles.retry} testID="attachments-retry">
            {t('common:actions.retry')}
          </Button>
        </View>
      ) : attachments.length === 0 ? (
        <Text variant="bodyMedium" style={[styles.empty, { color: theme.colors.onSurfaceVariant }]} testID="attachments-empty">
          {t('attachments:empty')}
        </Text>
      ) : (
        <View style={styles.list}>
          {attachments.map((item) => (
            <AttachmentRow key={item.id} item={item} meta={metaOf(item)} onOpen={openItem} onRemove={confirmRemove} />
          ))}
        </View>
      )}

      <View style={styles.actions}>
        <Button mode="contained-tonal" icon="paperclip" onPress={() => void addFrom('document')} disabled={busy} style={styles.action} testID="attachments-add-file">
          {t('attachments:addFile')}
        </Button>
        <Button mode="contained-tonal" icon="image-outline" onPress={() => void addFrom('image')} disabled={busy} style={styles.action} testID="attachments-add-photo">
          {t('attachments:addPhoto')}
        </Button>
        <Button mode="contained-tonal" icon="camera-outline" onPress={() => void addFrom('camera')} disabled={busy} style={styles.action} testID="attachments-take-photo">
          {t('attachments:takePhoto')}
        </Button>
      </View>
      {busy ? <ActivityIndicator size="small" style={styles.busy} testID="attachments-busy" /> : null}
      <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
        {t('attachments:limits', { maxMb: MAX_ATTACHMENT_MB })}
      </Text>
    </Section>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  noticeIcon: {
    marginRight: 8,
    marginTop: 1,
  },
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
  },
  statusText: {
    marginLeft: 8,
  },
  retry: {
    alignSelf: 'flex-start',
  },
  empty: {
    paddingVertical: 8,
  },
  list: {
    marginVertical: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  rowMain: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 4,
    minHeight: 48,
    justifyContent: 'center',
  },
  rowContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  rowText: {
    flex: 1,
    marginLeft: 12,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 8,
  },
  action: {
    marginRight: 8,
    marginBottom: 8,
  },
  busy: {
    alignSelf: 'flex-start',
    marginBottom: 8,
  },
});
