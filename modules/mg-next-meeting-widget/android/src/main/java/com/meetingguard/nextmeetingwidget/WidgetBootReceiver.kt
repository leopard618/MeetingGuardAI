package com.meetingguard.nextmeetingwidget

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * After a reboot or an app update, re-renders every widget instance from SharedPreferences and
 * re-schedules the "meeting started" tick, natively - no JS runtime is started (same pattern as
 * mg-fullscreen-alarm's BootReceiver). A timezone or clock change re-renders too, so the
 * started/grace presentation follows the new wall clock at once (the pre-formatted time strings
 * are replaced by the next JS feed; the feeder re-feeds on foreground when the zone changed).
 * Data whose started grace has passed renders as the empty state (WidgetRenderer).
 */
class WidgetBootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    when (intent.action) {
      Intent.ACTION_BOOT_COMPLETED,
      Intent.ACTION_REBOOT,
      "android.intent.action.QUICKBOOT_POWERON",
      "com.htc.intent.action.QUICKBOOT_POWERON",
      Intent.ACTION_MY_PACKAGE_REPLACED,
      Intent.ACTION_TIMEZONE_CHANGED,
      Intent.ACTION_TIME_CHANGED,
      -> WidgetRenderer.renderAll(context)
    }
  }
}
