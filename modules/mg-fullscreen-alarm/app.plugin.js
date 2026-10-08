// Expo config plugin of the local module mg-fullscreen-alarm (docs/ARCHITECTURE.md §18).
//
// Makes sure the merged Android manifest carries USE_FULL_SCREEN_INTENT, the permission behind
// Notification.Builder#setFullScreenIntent (normal / install-time; on Android 14+ the user can
// revoke it in the system settings and the app checks canUseFullScreenIntent()). The permission is
// also listed in app.config.js `android.permissions` and in this module's own library manifest -
// AndroidConfig.Permissions de-duplicates, so prebuild writes it exactly once.
//
// The module's receivers (AlarmReceiver, BootReceiver) and RECEIVE_BOOT_COMPLETED come from the
// library manifest at android/src/main/AndroidManifest.xml and are merged by Gradle; no manifest
// surgery is needed here. The module itself is discovered by expo-modules-autolinking (the
// default `modules/` directory), not by this plugin.
const { AndroidConfig } = require('expo/config-plugins');

const FULL_SCREEN_INTENT_PERMISSION = 'android.permission.USE_FULL_SCREEN_INTENT';

function withMgFullscreenAlarm(config) {
  return AndroidConfig.Permissions.withPermissions(config, [FULL_SCREEN_INTENT_PERMISSION]);
}

module.exports = withMgFullscreenAlarm;
module.exports.FULL_SCREEN_INTENT_PERMISSION = FULL_SCREEN_INTENT_PERMISSION;
