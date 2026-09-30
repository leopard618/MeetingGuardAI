package com.meetingguard.fullscreenalarm

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build

/**
 * AlarmManager wrapper. Exact + allow-while-idle when the exact-alarm permission is granted
 * (always below Android 12), inexact allow-while-idle otherwise, so an alarm still fires (possibly
 * delayed under Doze) instead of throwing SecurityException.
 */
internal object AlarmScheduler {
  const val ACTION_FIRE = "com.meetingguard.fullscreenalarm.FIRE"
  const val EXTRA_ALARM_ID = "com.meetingguard.fullscreenalarm.ALARM_ID"

  /** setAlarms(): a NEW alarm may be at most this far in the past and still fire immediately. */
  const val SET_PAST_GRACE_MS = 30_000L

  /** Boot/update restore: a missed alarm younger than this is posted right away; older are dropped. */
  const val RESTORE_PAST_GRACE_MS = 30L * 60_000L

  private fun alarmManager(context: Context): AlarmManager? =
    context.getSystemService(Context.ALARM_SERVICE) as? AlarmManager

  /**
   * One PendingIntent per alarm id: the data URI makes the intents distinct under
   * Intent.filterEquals, so a constant request code is safe and cancel() is precise.
   */
  private fun firePendingIntent(context: Context, id: String): PendingIntent {
    val intent = Intent(context, AlarmReceiver::class.java)
      .setAction(ACTION_FIRE)
      .setData(Uri.fromParts("mgfsa", id, null))
      .putExtra(EXTRA_ALARM_ID, id)
    return PendingIntent.getBroadcast(
      context,
      0,
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }

  /** AlarmManager.canScheduleExactAlarms(); true below Android 12 (API 31). */
  fun exactAllowed(context: Context): Boolean {
    val manager = alarmManager(context) ?: return false
    return Build.VERSION.SDK_INT < 31 || manager.canScheduleExactAlarms()
  }

  /** Schedules (or replaces) the alarm. Re-setting the same id replaces the previous alarm. */
  fun schedule(context: Context, alarm: StoredAlarm) {
    val manager = alarmManager(context) ?: return
    val operation = firePendingIntent(context, alarm.id)
    try {
      if (exactAllowed(context)) {
        manager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, alarm.atMs, operation)
      } else {
        manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, alarm.atMs, operation)
      }
    } catch (_: SecurityException) {
      // The exact-alarm permission was revoked between the check and the call.
      manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, alarm.atMs, operation)
    }
  }

  fun cancel(context: Context, id: String) {
    alarmManager(context)?.cancel(firePendingIntent(context, id))
  }
}
