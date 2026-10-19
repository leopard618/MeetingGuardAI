/**
 * Icon and accent color of each note category. Colors come from the canonical chart palette and
 * note-category index in src/theme/tokens.ts (docs/v1/DESIGN_SYSTEM.md §2), so the hue of a
 * category never forks from the rest of the app; both variants keep >= 3:1 on surface.
 */
import type MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { ComponentProps } from 'react';

import type { NoteCategory } from '../../core/types';
// Tokens directly (pure module, no hooks needed here).
import { chartPalette, noteCategoryColorIndex } from '../../theme/tokens';

type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

const CATEGORY_ICONS: Readonly<Record<NoteCategory, IconName>> = {
  general: 'note-text-outline',
  work: 'briefcase-outline',
  ideas: 'lightbulb-on-outline',
  personal: 'account-heart-outline',
};

export function categoryIcon(category: NoteCategory): IconName {
  return CATEGORY_ICONS[category];
}

export function categoryColor(category: NoteCategory, dark: boolean): string {
  const palette = dark ? chartPalette.dark : chartPalette.light;
  return palette[noteCategoryColorIndex[category]];
}
