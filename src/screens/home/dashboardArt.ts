/**
 * Pictures of the dashboard mockup (client, November 1, 2026). React Native needs static
 * require() calls, so every picture has a fixed file name under assets/dashboard/; a slot is
 * null until its file exists, and the screen then shows nothing there.
 *
 * To add or replace a picture, drop the file with this exact name and set the slot:
 * - hero-overlay.png (1080 x 760, transparent PNG): the glass building behind the hero, right-
 *   weighted, fading to transparent on the left and bottom. The built-in file is a subtle glass
 *   panel drawing until the real picture arrives.
 * - next-meeting.png (512 x 512, transparent PNG): the 3D calendar shown top-right of the
 *   next-meeting card.
 * - tasks.png (512 x 512, transparent PNG): the checklist shown bottom-right of the tasks card.
 */
export interface DashboardArt {
  heroOverlay: number | null;
  nextMeeting: number | null;
  tasks: number | null;
}

export const DASHBOARD_ART: DashboardArt = {
  heroOverlay: require('../../../assets/dashboard/hero-overlay.png') as number,
  // Set to require('../../../assets/dashboard/next-meeting.png') once the file exists.
  nextMeeting: null,
  // Set to require('../../../assets/dashboard/tasks.png') once the file exists.
  tasks: null,
};
