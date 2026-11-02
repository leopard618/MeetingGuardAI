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
 * - hero-bg-light.jpg (1456 x 816): the LIGHT hero: a pale blue wave composition with a soft glow
 *   at the right, drawn to the same proportions. Replace the file to change it.
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
    light: require('../../../assets/dashboard/hero-bg-light.jpg') as number,
    dark: require('../../../assets/dashboard/hero-bg-dark.jpg') as number,
  },
  assistantIcon: null,
  nextMeeting: null,
  tasks: null,
};

/** Aspect ratio (height / width) of the hero artwork files. */
export const HERO_ART_RATIO = 816 / 1456;
