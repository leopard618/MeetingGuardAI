/**
 * Privacy Policy / Terms of Service (owner: shell). Texts: `legal` namespace (EN + ES), section
 * order and company details: ./legalContent.
 *
 * - In the Main group the stack header shows the title; in the Auth and Onboarding groups (no
 *   header) the `standalone` variant draws its own top bar (title, back button, top inset).
 * - Sections are a virtualized list; the date is formatted in the UI language.
 * - Reads as a prose page (no cards): bodyL text, titleM section headings, bodyS meta.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { useNavigation } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { useMemo, type ReactElement } from 'react';
import { FlatList, Linking, Pressable, StyleSheet, Text, View, type ListRenderItem } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { toAppError } from '../../core/errors';
import { createLogger } from '../../core/logger';
import { useResponsive } from '../../hooks/useResponsive';
import { i18n, useLanguage, useT } from '../../i18n';
import { componentMetrics, pressedOpacity, spacing, typography, useAppTheme, type MGColors } from '../../theme';
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

function Bullets({ items, colors }: { items: string[]; colors: MGColors }): ReactElement {
  return (
    <View style={styles.items}>
      {items.map((item, index) => (
        <View key={index} style={styles.itemRow}>
          <Text style={[styles.bullet, { color: colors.primary }]} importantForAccessibility="no" accessibilityElementsHidden>
            •
          </Text>
          <Text style={[styles.paragraph, styles.itemText, { color: colors.onSurface }]}>{item}</Text>
        </View>
      ))}
    </View>
  );
}

function Paragraphs({ paragraphs, colors, muted = false }: { paragraphs: string[]; colors: MGColors; muted?: boolean }): ReactElement {
  return (
    <>
      {paragraphs.map((paragraph, index) => (
        <Text key={index} style={[styles.paragraph, { color: muted ? colors.onSurfaceVariant : colors.onSurface }]}>
          {paragraph}
        </Text>
      ))}
    </>
  );
}

export function LegalDocumentScreen({ document, standalone = false }: LegalDocumentScreenProps): ReactElement {
  const t = useT();
  const { language } = useLanguage();
  const { colors, isDark } = useAppTheme();
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
    <View style={[styles.section, columnStyle]} testID={`legal-section-${item.id}`}>
      <Text style={[styles.sectionTitle, { color: colors.onSurface }]} accessibilityRole="header">
        {item.title}
      </Text>
      <Paragraphs paragraphs={item.body} colors={colors} />
      {item.items.length > 0 ? <Bullets items={item.items} colors={colors} /> : null}
      <Paragraphs paragraphs={item.note} colors={colors} muted />
    </View>
  );

  const header = (
    <View style={[styles.intro, columnStyle]}>
      <Text style={[styles.updated, { color: colors.onSurfaceVariant }]}>{t('legal:updated', { date: updated })}</Text>
      <Text style={[styles.paragraph, { color: colors.onSurface }]}>{t(`legal:${document}.intro`, { company: LEGAL_ENTITY.name })}</Text>
    </View>
  );

  const footer = (
    <View style={[styles.section, columnStyle]} testID="legal-contact">
      <Text style={[styles.sectionTitle, { color: colors.onSurface }]} accessibilityRole="header">
        {t('legal:contact.title')}
      </Text>
      <Text style={[styles.paragraph, { color: colors.onSurface }]}>{t('legal:contact.body')}</Text>
      <Text style={[styles.paragraph, { color: colors.onSurface }]} selectable>
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
        <Text style={[styles.paragraph, { color: colors.onSurface }]} selectable>
          {LEGAL_ENTITY.email}
        </Text>
      )}
    </View>
  );

  return (
    <View style={[styles.fill, { backgroundColor: colors.background }]} testID={`legal-${document}`}>
      {standalone ? (
        <View
          style={[styles.topBar, { paddingTop: insets.top, backgroundColor: colors.surface, borderBottomColor: colors.outlineVariant }]}
        >
          {/* Its own status bar style: the screen below (Landing) may have set light icons. */}
          <StatusBar style={isDark ? 'light' : 'dark'} />
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
                <Ionicons name="arrow-back" size={componentMetrics.iconNav} color={colors.onSurface} />
              </Pressable>
            ) : null}
            <Text style={[styles.topBarTitle, { color: colors.onSurface }]} numberOfLines={1} accessibilityRole="header" maxFontSizeMultiplier={1.4}>
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
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xxl, paddingHorizontal: layout.gutter }]}
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
    minHeight: componentMetrics.headerMinHeight,
    paddingHorizontal: spacing.sm,
  },
  backButton: {
    width: componentMetrics.touchTargetMin,
    height: componentMetrics.touchTargetMin,
    borderRadius: componentMetrics.headerRippleRadius,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topBarTitle: {
    ...typography.titleL,
    flex: 1,
    marginHorizontal: spacing.sm,
  },
  content: {
    paddingTop: spacing.lg,
  },
  intro: {
    marginBottom: spacing.sm,
  },
  updated: {
    ...typography.bodyS,
    marginBottom: spacing.md,
  },
  section: {
    marginTop: spacing.xxl,
  },
  sectionTitle: {
    ...typography.titleM,
    marginBottom: spacing.sm,
  },
  paragraph: {
    ...typography.bodyL,
    marginBottom: spacing.sm,
  },
  items: {
    marginBottom: spacing.xs,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  bullet: {
    ...typography.bodyL,
    width: spacing.xl,
  },
  itemText: {
    flex: 1,
  },
  emailButton: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: componentMetrics.touchTargetMin,
  },
  emailText: {
    ...typography.labelL,
    marginLeft: spacing.sm,
    textDecorationLine: 'underline',
  },
  pressed: {
    opacity: pressedOpacity,
  },
});

export default LegalDocumentScreen;
