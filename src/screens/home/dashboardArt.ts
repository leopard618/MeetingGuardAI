/**
 * Pictures of the dashboard mockup (client, November 1, 2026). React Native needs static
 * require() calls, so every picture has a fixed file name under assets/dashboard/; a slot is
 * null until its file exists, and the screen then shows nothing there.
 *
 * - hero-bg.jpg (1456 x 645): the client's artwork behind the greeting (deep blue waves with a
 *   glass calendar on the right), cropped from the panel of the picture he sent; drawn with
 *   resizeMode cover, so the calendar stays at the right edge on every width.
 * - next-meeting.png (512 x 512, transparent PNG): the 3D calendar top-right of the next-meeting
 *   card. Set to require('../../../assets/dashboard/next-meeting.png') once the file exists.
 * - tasks.png (512 x 512, transparent PNG): the checklist bottom-right of the tasks card. Set to
 *   require('../../../assets/dashboard/tasks.png') once the file exists.
 */
export interface DashboardArt {
  heroBackground: number | null;
  nextMeeting: number | null;
  tasks: number | null;
}

export const DASHBOARD_ART: DashboardArt = {
  heroBackground: require('../../../assets/dashboard/hero-bg.jpg') as number,
  nextMeeting: null,
  tasks: null,
};
