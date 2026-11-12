/**
 * The app's icon set (owner: shell / Foundation; docs/v1/DESIGN_SYSTEM.md §2.2). One thin,
 * rounded line family (Feather, bundled with @expo/vector-icons) behind semantic names, so a
 * screen asks for `place` or `tasks` and never picks a glyph style of its own. The assistant
 * keeps Ionicons' sparkles (Feather has no equivalent); everything else is Feather.
 *
 * Sizes: iconMeta 16 (meta rows), iconInline 20 (buttons, chips), iconNav 24 (bars, rows).
 * Legacy MaterialCommunityIcons names still flow through EmptyState / ListRow / Paper props;
 * new code uses this component.
 */
import Feather from '@expo/vector-icons/Feather';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps, ReactElement } from 'react';
import type { StyleProp, TextStyle } from 'react-native';

import { componentMetrics } from '../../theme';

type FeatherName = ComponentProps<typeof Feather>['name'];

const FEATHER = {
  home: 'home',
  meetings: 'list',
  calendar: 'calendar',
  tasks: 'check-square',
  notes: 'file-text',
  newMeeting: 'calendar',
  plus: 'plus',
  bell: 'bell',
  bellOff: 'bell-off',
  settings: 'settings',
  user: 'user',
  signOut: 'log-out',
  globe: 'globe',
  menu: 'menu',
  back: 'arrow-left',
  forward: 'arrow-right',
  place: 'map-pin',
  video: 'video',
  clock: 'clock',
  chevronRight: 'chevron-right',
  chevronDown: 'chevron-down',
  chevronUp: 'chevron-up',
  alert: 'alert-circle',
  warning: 'alert-triangle',
  search: 'search',
  edit: 'edit-2',
  delete: 'trash-2',
  more: 'more-horizontal',
  close: 'x',
  mic: 'mic',
  send: 'send',
  star: 'star',
  check: 'check',
  checkCircle: 'check-circle',
  circle: 'circle',
  repeat: 'repeat',
  people: 'users',
  link: 'link',
  mail: 'mail',
  help: 'help-circle',
  info: 'info',
  refresh: 'refresh-cw',
  attach: 'paperclip',
  camera: 'camera',
  image: 'image',
  plans: 'credit-card',
  tune: 'sliders',
  insights: 'bar-chart-2',
  whatsapp: 'message-circle',
  chat: 'message-square',
  sun: 'sun',
  moon: 'moon',
  phone: 'smartphone',
  zap: 'zap',
  inbox: 'inbox',
  tag: 'tag',
  briefcase: 'briefcase',
  coffee: 'coffee',
  sunrise: 'sunrise',
  activity: 'activity',
  grid: 'grid',
  layers: 'layers',
  bookmark: 'bookmark',
  shield: 'shield',
  lock: 'lock',
  external: 'external-link',
} as const satisfies Record<string, FeatherName>;

export type IconName = keyof typeof FEATHER | 'ai';

export interface IconProps {
  name: IconName;
  /** Default componentMetrics.iconNav (24). */
  size?: number;
  color: string;
  style?: StyleProp<TextStyle>;
  /** Decorative by default (the parent carries the label); pass a label for a standalone icon. */
  accessibilityLabel?: string;
  testID?: string;
}

export function Icon({ name, size = componentMetrics.iconNav, color, style, accessibilityLabel, testID }: IconProps): ReactElement {
  const a11y = accessibilityLabel
    ? { accessibilityLabel, accessibilityRole: 'image' as const }
    : { accessibilityElementsHidden: true, importantForAccessibility: 'no' as const };
  if (name === 'ai') {
    return <Ionicons name="sparkles" size={size} color={color} style={style} testID={testID} {...a11y} />;
  }
  return <Feather name={FEATHER[name]} size={size} color={color} style={style} testID={testID} {...a11y} />;
}
