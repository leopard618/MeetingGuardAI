/**
 * The one language picker of the app shell (client, November 16, 2026: "one dropdown button with
 * flag"): a trigger with the flag of the CURRENT language and a chevron, and a real dropdown menu
 * under it with the five languages (flag, native name, a check on the current one). Picking a
 * language applies it at once and saves it as the user's choice (useLanguage().setLanguage).
 *
 * Used by the sign-in screen, the dashboard top bar, the screen header and the sidebar.
 * - variant 'pill' (default): flag, code (EN, ES...) and chevron; the menu opens under the pill,
 *   right-aligned when the pill sits in the right half of the screen.
 * - variant 'field': full-width row with flag, native name and chevron (the sidebar); the menu
 *   takes the field's width and opens upwards when there is no room below.
 *
 * The menu is a transparent Modal (it works on top of the sidebar's own Modal): a tap outside or
 * the hardware back closes it. Position comes from measureInWindow; until it answers (or where it
 * never does, like tests) the menu sits at the top right under the status bar. No animation.
 * Option test ids: `${testID}-${code}`; the trigger is `testID`, its flag `${testID}-flag`.
 */
import { useRef, useState, type ReactElement } from 'react';
import { Modal, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { AppLanguage } from '../core/types';
import { useLanguage, useT } from '../i18n';
import { componentMetrics, radii, spacing, typography, useAppTheme } from '../theme';
import { Icon } from './ui';

/** Country flag of each language (regional indicator pairs; render on iOS and Android). */
export const LANGUAGE_FLAGS: Readonly<Record<AppLanguage, string>> = {
  en: '\u{1F1FA}\u{1F1F8}',
  es: '\u{1F1EA}\u{1F1F8}',
  // M12: Brazil (pt is Brazilian Portuguese), France, Germany.
  pt: '\u{1F1E7}\u{1F1F7}',
  fr: '\u{1F1EB}\u{1F1F7}',
  de: '\u{1F1E9}\u{1F1EA}',
};

const MENU_MIN_WIDTH = 208;
const ROW_HEIGHT = componentMetrics.touchTargetMin + spacing.xs;
const GAP = spacing.xs;
/** Where the menu sits while the trigger has not been measured: under a header row. */
const FALLBACK_TOP = componentMetrics.headerMinHeight;

interface Anchor {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MenuPlacement {
  top: number;
  left: number;
  width: number;
}

/**
 * Where the menu goes, PURE (unit tested): under the anchor, or above it when the bottom would be
 * cut; right-aligned to an anchor in the right half; always inside the screen with a small margin.
 * A null anchor (not measured) gives the top right corner under `topInset`.
 */
export function placeMenu(
  anchor: Anchor | null,
  screen: { width: number; height: number },
  insets: { top: number; bottom: number },
  options: { fullWidth: boolean; rows: number },
): MenuPlacement {
  const margin = spacing.sm;
  const height = options.rows * ROW_HEIGHT + 2 * spacing.xs;
  const width = Math.min(
    screen.width - 2 * margin,
    options.fullWidth && anchor ? Math.max(anchor.width, MENU_MIN_WIDTH) : MENU_MIN_WIDTH,
  );
  if (anchor === null) {
    return { top: insets.top + FALLBACK_TOP, left: Math.max(margin, screen.width - width - spacing.lg), width };
  }
  const rightAligned = !options.fullWidth && anchor.x + anchor.width / 2 > screen.width / 2;
  const rawLeft = rightAligned ? anchor.x + anchor.width - width : anchor.x;
  const left = Math.min(Math.max(margin, rawLeft), screen.width - width - margin);
  const below = anchor.y + anchor.height + GAP;
  const fitsBelow = below + height <= screen.height - insets.bottom - margin;
  const top = fitsBelow ? below : Math.max(insets.top + margin, anchor.y - height - GAP);
  return { top, left, width };
}

export interface LanguageMenuProps {
  testID: string;
  variant?: 'pill' | 'field';
  /** Text and chevron color of the trigger (default: onSurface). */
  color?: string;
  /** Trigger fill (default: surfaceVariant for the pill, transparent for the field). */
  backgroundColor?: string;
  /** Trigger border (default: none for the pill, outline for the field). */
  borderColor?: string;
  /** Text scaling cap of the trigger (header rows must stay on one line). */
  maxFontSizeMultiplier?: number;
}

export function LanguageMenu({
  testID,
  variant = 'pill',
  color,
  backgroundColor,
  borderColor,
  maxFontSizeMultiplier = 1.4,
}: LanguageMenuProps): ReactElement {
  const t = useT();
  const { colors } = useAppTheme();
  const { language, setLanguage, supportedLanguages } = useLanguage();
  const insets = useSafeAreaInsets();
  const screen = useWindowDimensions();
  const triggerRef = useRef<View>(null);
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<Anchor | null>(null);

  const field = variant === 'field';
  const fg = color ?? colors.onSurface;
  const currentName = t(`common:language.${language}`);

  const openMenu = (): void => {
    setAnchor(null);
    setOpen(true);
    triggerRef.current?.measureInWindow((x, y, width, height) => {
      if ([x, y, width, height].every(Number.isFinite) && width > 0) setAnchor({ x, y, width, height });
    });
  };

  const choose = (code: AppLanguage): void => {
    setOpen(false);
    if (code !== language) void setLanguage(code);
  };

  const placement = placeMenu(anchor, screen, insets, { fullWidth: field, rows: supportedLanguages.length });

  return (
    <>
      <Pressable
        ref={triggerRef}
        onPress={openMenu}
        style={({ pressed }) => [
          field ? styles.field : styles.pill,
          {
            backgroundColor: backgroundColor ?? (field ? 'transparent' : colors.surfaceVariant),
            borderColor: borderColor ?? (field ? colors.outline : 'transparent'),
          },
          pressed && styles.pressed,
        ]}
        accessibilityRole="button"
        accessibilityLabel={`${t('common:language.label')}: ${currentName}`}
        accessibilityState={{ expanded: open }}
        hitSlop={4}
        testID={testID}
      >
        <Text style={styles.flag} maxFontSizeMultiplier={maxFontSizeMultiplier} testID={`${testID}-flag`}>
          {LANGUAGE_FLAGS[language]}
        </Text>
        <Text
          style={[styles.triggerText, field && styles.fieldText, { color: fg }]}
          numberOfLines={1}
          maxFontSizeMultiplier={maxFontSizeMultiplier}
        >
          {field ? currentName : language.toUpperCase()}
        </Text>
        <Icon name="chevronDown" size={componentMetrics.iconMeta} color={fg} />
      </Pressable>

      {open ? (
        <Modal visible transparent animationType="none" onRequestClose={() => setOpen(false)} statusBarTranslucent navigationBarTranslucent>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setOpen(false)}
            accessibilityRole="button"
            accessibilityLabel={t('common:actions.cancel')}
            testID={`${testID}-scrim`}
          />
          <View
            style={[
              styles.menu,
              {
                top: placement.top,
                left: placement.left,
                width: placement.width,
                backgroundColor: colors.surface,
                borderColor: colors.outlineVariant,
                shadowColor: colors.shadow,
              },
            ]}
            accessibilityRole="menu"
            accessibilityLabel={t('common:language.label')}
            testID={`${testID}-menu`}
          >
            {supportedLanguages.map((code) => {
              const selected = code === language;
              return (
                <Pressable
                  key={code}
                  onPress={() => choose(code)}
                  android_ripple={{ color: colors.secondaryContainer }}
                  style={({ pressed }) => [
                    styles.option,
                    selected && { backgroundColor: colors.secondaryContainer },
                    pressed && Platform.OS !== 'android' && styles.pressed,
                  ]}
                  accessibilityRole="menuitem"
                  accessibilityState={{ selected }}
                  testID={`${testID}-${code}`}
                >
                  <Text style={styles.flag}>{LANGUAGE_FLAGS[code]}</Text>
                  <Text
                    style={[styles.optionText, { color: selected ? colors.onSecondaryContainer : colors.onSurface }]}
                    numberOfLines={1}
                  >
                    {t(`common:language.${code}`)}
                  </Text>
                  {selected ? <Icon name="check" size={componentMetrics.iconMeta} color={colors.primary} /> : null}
                </Pressable>
              );
            })}
          </View>
        </Modal>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: componentMetrics.buttonHeightSmall - 4,
    paddingLeft: spacing.sm,
    paddingRight: spacing.sm,
    borderRadius: radii.full,
    borderWidth: 1,
  },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: componentMetrics.touchTargetMin,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
  },
  flag: {
    fontSize: 16,
    lineHeight: 20,
  },
  triggerText: {
    ...typography.labelM,
  },
  fieldText: {
    ...typography.labelL,
    flex: 1,
  },
  menu: {
    position: 'absolute',
    paddingVertical: spacing.xs,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    elevation: 8,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.16,
    shadowRadius: 12,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: ROW_HEIGHT,
    paddingHorizontal: spacing.lg,
  },
  optionText: {
    ...typography.bodyL,
    flex: 1,
  },
  pressed: {
    opacity: 0.6,
  },
});

export default LanguageMenu;
