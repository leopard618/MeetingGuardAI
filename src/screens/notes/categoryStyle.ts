/** Icon and accent color of each note category (light and dark variants keep text contrast). */
import type { MaterialCommunityIcons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';

import type { NoteCategory } from '../../core/types';

type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

interface CategoryStyle {
  icon: IconName;
  light: string;
  dark: string;
}

const CATEGORY_STYLES: Readonly<Record<NoteCategory, CategoryStyle>> = {
  general: { icon: 'note-text-outline', light: '#475569', dark: '#CBD5E1' },
  work: { icon: 'briefcase-outline', light: '#1D4ED8', dark: '#93C5FD' },
  ideas: { icon: 'lightbulb-on-outline', light: '#B45309', dark: '#FCD34D' },
  personal: { icon: 'account-heart-outline', light: '#047857', dark: '#6EE7B7' },
};

export function categoryIcon(category: NoteCategory): IconName {
  return CATEGORY_STYLES[category].icon;
}

export function categoryColor(category: NoteCategory, dark: boolean): string {
  const style = CATEGORY_STYLES[category];
  return dark ? style.dark : style.light;
}
