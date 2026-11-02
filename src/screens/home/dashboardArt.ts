/**
 * Pictures of the dashboard (client, November 1 and 2, 2026). React Native needs static require()
 * calls, so every picture has a fixed file name under assets/dashboard/; a slot is null until its
 * file exists, and the screen then falls back (plain gradient hero, icon glyph on the assistant
 * button, nothing in a card corner).
 *
 * Files and how they are used:
 * - hero-bg.jpg (1456 x 645): the DARK hero artwork (deep blue waves, glass calendar at the
 *   right), cropped from the client's picture. Drawn bottom-anchored at the hero's width.
 * - hero-bg-light.jpg (same proportions): the LIGHT hero artwork (pale blue waves, white glass
 *   calendar). Set the slot to require('../../../assets/dashboard/hero-bg-light.jpg') once the
 *   file exists; until then light mode shows the light gradient only.
 * - assistant-fab.png (square, transparent): the client's headset-chat icon for the floating
 *   assistant button. Set the slot to require('../../../assets/dashboard/assistant-fab.png')
 *   once the file exists; until then the button shows a robot glyph.
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
    light: null,
    dark: require('../../../assets/dashboard/hero-bg.jpg') as number,
  },
  assistantIcon: null,
  nextMeeting: null,
  tasks: null,
};

/** Aspect ratio (height / width) of the hero artwork files. */
export const HERO_ART_RATIO = 645 / 1456;
