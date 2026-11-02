/**
 * Pictures of the dashboard (client, November 1 and 2, 2026). React Native needs static require()
 * calls, so every picture has a fixed file name under assets/dashboard/; a slot is null until its
 * file exists, and the screen then falls back (plain gradient hero, icon glyph on the assistant
 * button, nothing in a card corner).
 *
 * Files and how they are used:
 * - hero-bg-dark.jpg (1456 x 816): the DARK hero: the client's artwork (deep blue waves, glass
 *   calendar at the right) extended upward with its own top colors so the picture covers the
 *   whole panel with no seam. Drawn with resizeMode cover over the panel.
 * - hero-bg-light.jpg (1456 x 816): the LIGHT hero: the client's pale artwork (white glass calendar
 *   on light blue waves), extended upward the same way.
 * - assistant-fab.png (320 px, transparent): the client's headset-chat icon on the floating
 *   assistant button.
 * - next-meeting.png / tasks.png (512 x 512, transparent): optional card illustrations.
 */
export interface DashboardArt {
  heroBackground: { light: number | null; dark: number | null };
  assistantIcon: number | null;
  nextMeeting: number | null;
  tasks: number | null;
}

export const DASHBOARD_ART: DashboardArt = {
  heroBackground: {
    light: require('../../../assets/dashboard/hero-bg-light.jpg') as number,
    dark: require('../../../assets/dashboard/hero-bg-dark.jpg') as number,
  },
  assistantIcon: require('../../../assets/dashboard/assistant-fab.png') as number,
  nextMeeting: null,
  tasks: null,
};

/** Aspect ratio (height / width) of the hero artwork files. */
export const HERO_ART_RATIO = 816 / 1456;
