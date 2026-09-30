package com.meetingguard.fullscreenalarm

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Restores the pending alarms after a reboot (AlarmManager loses them) and after an app update,
 * natively - no JS runtime is started. A missed alarm (fire time already past) younger than
 * RESTORE_PAST_GRACE_MS is posted right away (the meeting may still be starting); older ones are
 * dropped.
 */
class BootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    when (intent.action) {
      Intent.ACTION_BOOT_COMPLETED,
      Intent.ACTION_REBOOT,
      "android.intent.action.QUICKBOOT_POWERON",
      "com.htc.intent.action.QUICKBOOT_POWERON",
      Intent.ACTION_MY_PACKAGE_REPLACED,
      -> restore(context)
    }
  }

  private fun restore(context: Context) {
    val now = System.currentTimeMillis()
    for (alarm in AlarmStore.all(context)) {
      when {
        alarm.atMs > now -> AlarmScheduler.schedule(context, alarm)
        now - alarm.atMs <= AlarmScheduler.RESTORE_PAST_GRACE_MS -> {
          AlarmStore.remove(context, alarm.id)
          AlarmReceiver.postNotification(context, alarm)
        }
        else -> AlarmStore.remove(context, alarm.id)
      }
    }
  }
}
