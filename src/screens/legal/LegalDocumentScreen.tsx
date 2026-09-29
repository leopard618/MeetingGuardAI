/**
 * Privacy Policy / Terms of Service (owner: shell). Texts: `legal` namespace (EN + ES), section
 * order and company details: ./legalContent.
 *
 * - In the Main group the stack header shows the title; in the Auth and Onboarding groups (no
 *   header) the `standalone` variant draws its own top bar (title, back button, top inset).
 * - Sections are a virtualized list; the date is formatted in the UI language.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { useNavigation } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { useMemo, type ReactElement } from 'react';
import { FlatList, Linking, Pressable, StyleSheet, Text, View, type ListRenderItem } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme, type AppColors } from '../../contexts/ThemeContext';
import { toAppError } from '../../core/errors';
import { createLogger } from '../../core/logger';
import { useResponsive } from '../../hooks/useResponsive';
import { i18n, useLanguage, useT } from '../../i18n';
import { formatDate } from '../../utils/format';
import {
  LEGAL_ENTITY,
  LEGAL_LAST_UPDATED,
  contactEmail,
  legalVariables,
  readLegalDocument,
  type LegalDocumentId,
  type LegalSection,
  type RawTranslate,
} from './legalContent';

const log = createLogger('legal');

export interface LegalDocumentScreenProps {
  document: LegalDocumentId;
  /** Draws its own top bar (screens without the Main header). */
  standalone?: boolean;
}

function Bullets({ items, colors }: { items: string[]; colors: AppColors }): ReactElement {
  return (
    <View style={styles.items}>
      {items.map((item, index) => (
        <View key={index} style={styles.itemRow}>
          <Text style={[styles.bullet, { color: colors.primary }]} importantForAccessibility="no" accessibilityElementsHidden>
            •
          </Text>
          <Text style={[styles.paragraph, styles.itemText, { color: colors.text }]}>{item}</Text>
        </View>
      ))}
    </View>
  );
}

function Paragraphs({ paragraphs, colors, muted = false }: { paragraphs: string[]; colors: AppColors; muted?: boolean }): ReactElement {
  return (
    <>
      {paragraphs.map((paragraph, index) => (
        <Text key={index} style={[styles.paragraph, { color: muted ? colors.textSecondary : colors.text }]}>
          {paragraph}
        </Text>
      ))}
    </>
  );
}

export function LegalDocumentScreen({ document, standalone = false }: LegalDocumentScreenProps): ReactElement {
  const t = useT();
  const { language } = useLanguage();
  const { colors, isDarkMode } = useTheme();
  const insets = useSafeAreaInsets();
  const layout = useResponsive();
  const navigation = useNavigation();

  const jurisdiction = t('legal:jurisdiction');
  const sections = useMemo(() => {
    const translate: RawTranslate = (key, options) =>
      (i18n as unknown as { t: RawTranslate }).t(key, { ...options, lng: language });
    return readLegalDocument(translate, document, legalVariables(jurisdiction));
  }, [document, language, jurisdiction]);

  const updated = useMemo(() => {
    try {
      return formatDate(LEGAL_LAST_UPDATED, 'long', { language });
    } catch (error: unknown) {
      log.warn('could not format the legal date', toAppError(error).code);
      return LEGAL_LAST_UPDATED;
    }
  }, [language]);

  const email = contactEmail();
  const title = t(`legal:${document}.title`);
  const columnStyle = { width: layout.contentWidth, alignSelf: 'center' as const };

  const renderSection: ListRenderItem<LegalSection> = ({ item }) => (
    <View style={[styles.section, columnStyle, { backgroundColor: colors.surface, borderColor: colors.border }]} testID={`legal-section-${item.id}`}>
      <Text style={[styles.sectionTitle, { color: colors.text }]} accessibilityRole="header">
        {item.title}
      </Text>
      <Paragraphs paragraphs={item.body} colors={colors} />
      {item.items.length > 0 ? <Bullets items={item.items} colors={colors} /> : null}
      <Paragraphs paragraphs={item.note} colors={colors} muted />
    </View>
  );

  const header = (
    <View style={[styles.intro, columnStyle]}>
      <Text style={[styles.updated, { color: colors.textSecondary }]}>{t('legal:updated', { date: updated })}</Text>
      <Text style={[styles.paragraph, { color: colors.text }]}>{t(`legal:${document}.intro`, { company: LEGAL_ENTITY.name })}</Text>
    </View>
  );

  const footer = (
    <View style={[styles.section, columnStyle, { backgroundColor: colors.surface, borderColor: colors.border }]} testID="legal-contact">
      <Text style={[styles.sectionTitle, { color: colors.text }]} accessibilityRole="header">
        {t('legal:contact.title')}
      </Text>
      <Text style={[styles.paragraph, { color: colors.text }]}>{t('legal:contact.body')}</Text>
      <Text style={[styles.paragraph, { color: colors.text }]} selectable>
        {LEGAL_ENTITY.name}
        {'\n'}
        {LEGAL_ENTITY.address}
      </Text>
      {email ? (
        <Pressable
          onPress={() => {
            Linking.openURL(`mailto:${email}`).catch((error: unknown) => log.warn('could not open the email app', toAppError(error).code));
          }}
          style={styles.emailButton}
          accessibilityRole="link"
          accessibilityHint={t('legal:contact.emailHint')}
          testID="legal-contact-email"
        >
          <Ionicons name="mail-outline" size={18} color={colors.primary} />
          <Text style={[styles.emailText, { color: colors.primary }]}>{email}</Text>
        </Pressable>
      ) : (
        <Text style={[styles.paragraph, { color: colors.text }]} selectable>
          {LEGAL_ENTITY.email}
        </Text>
      )}
    </View>
  );

  return (
    <View style={[styles.fill, { backgroundColor: colors.background }]} testID={`legal-${document}`}>
      {standalone ? (
        <View
          style={[styles.topBar, { paddingTop: insets.top, backgroundColor: colors.surface, borderBottomColor: colors.border }]}
        >
          {/* Its own status bar style: the screen below (Landing) may have set light icons. */}
          <StatusBar style={isDarkMode ? 'light' : 'dark'} />
          <View style={styles.topBarRow}>
            {navigation.canGoBack() ? (
              <Pressable
                onPress={() => navigation.goBack()}
                style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel={t('legal:back')}
                hitSlop={4}
                testID="legal-back"
              >
                <Ionicons name="arrow-back" size={24} color={colors.text} />
              </Pressable>
            ) : null}
            <Text style={[styles.topBarTitle, { color: colors.text }]} numberOfLines={1} accessibilityRole="header" maxFontSizeMultiplier={1.4}>
              {title}
            </Text>
          </View>
        </View>
      ) : null}
      <FlatList
        data={sections}
        keyExtractor={(section) => section.id}
        renderItem={renderSection}
        ListHeaderComponent={header}
        ListFooterComponent={footer}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24, paddingHorizontal: layout.gutter }]}
        initialNumToRender={6}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  topBar: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  topBarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 56,
    paddingHorizontal: 8,
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topBarTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '700',
    marginHorizontal: 8,
  },
  content: {
    paddingTop: 16,
  },
  intro: {
    marginBottom: 8,
  },
  updated: {
    fontSize: 13,
    marginBottom: 12,
  },
  section: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
    marginTop: 12,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 8,
  },
  paragraph: {
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 8,
  },
  items: {
    marginBottom: 4,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  bullet: {
    width: 18,
    fontSize: 15,
    lineHeight: 22,
  },
  itemText: {
    flex: 1,
  },
  emailButton: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
  },
  emailText: {
    fontSize: 15,
    fontWeight: '600',
    marginLeft: 8,
    textDecorationLine: 'underline',
  },
  pressed: {
    opacity: 0.6,
  },
});

export default LegalDocumentScreen;
