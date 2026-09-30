package com.meetingguard.nextmeetingwidget

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * After a reboot or an app update, re-renders every widget instance from SharedPreferences and
 * re-schedules the "meeting started" tick, natively - no JS runtime is started (same pattern as
 * mg-fullscreen-alarm's BootReceiver). Stale data (a start long past) still renders: the
 * provider shows the now-label and the next JS feed replaces it.
 */
class WidgetBootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    when (intent.action) {
      Intent.ACTION_BOOT_COMPLETED,
      Intent.ACTION_REBOOT,
      "android.intent.action.QUICKBOOT_POWERON",
      "com.htc.intent.action.QUICKBOOT_POWERON",
      Intent.ACTION_MY_PACKAGE_REPLACED,
      -> WidgetRenderer.renderAll(context)
    }
  }
}
