/**
 * Build-time feature switches (owner: core).
 *
 * A switch here hides a feature that is BUILT, TESTED AND KEPT GREEN but not yet due to be shown.
 * It is not a kill switch for broken code and it is not configurable at runtime: flipping one is a
 * deliberate source change, reviewed and released like any other. Keeping the feature compiled and
 * under test is the whole point, so turning it back on is one line and never a merge.
 *
 * Every switch names the week it is scheduled for, so a stale flag is obvious.
 */
export const FEATURES = {
  /**
   * The ongoing "alerts are on" status notification (src/services/alerts/statusNotification.ts),
   * with its Settings > Alerts switch. Built early; scheduled for WEEK 5 of the delivery plan.
   * While this is false the scheduler does nothing and the setting is hidden, so the stored
   * preference keeps whatever value it had and nothing is lost by waiting.
   */
  statusNotification: false,
} as const;

export type FeatureName = keyof typeof FEATURES;
