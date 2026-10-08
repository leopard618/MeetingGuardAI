package com.meetingguard.fullscreenalarm

import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build

/**
 * Fires a scheduled alarm: posts a full-screen-intent notification on the meeting's EXISTING
 * alert channel (the channel id comes from JS: channelForIntensity, "mg-alert-max-v2" or its
 * no-vibration variant - the app creates these channels at startup, before any alarm exists) and
 * removes the alarm from the store. The full-screen intent and the tap both open the app through
 * the meeting deep link ("meetingguardai://meeting/{id}").
 */
class AlarmReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val id = intent.getStringExtra(AlarmScheduler.EXTRA_ALARM_ID) ?: return
    val alarm = AlarmStore.get(context, id) ?: return
    AlarmStore.remove(context, id)
    postNotification(context, alarm)
  }

  companion object {
    /** Fired notifications remove themselves after an hour if never opened. */
    private const val TIMEOUT_MS = 60L * 60_000L

    fun postNotification(context: Context, alarm: StoredAlarm) {
      val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager ?: return
      if (!manager.areNotificationsEnabled()) return

      val contentIntent = activityPendingIntent(context, alarm)
      val builder = if (Build.VERSION.SDK_INT >= 26) {
        Notification.Builder(context, alarm.channelId)
      } else {
        // API 24-25: no channels; the priority and defaults make it heads-up with sound.
        @Suppress("DEPRECATION")
        Notification.Builder(context)
          .setPriority(Notification.PRIORITY_MAX)
          .setDefaults(Notification.DEFAULT_ALL)
      }
      builder
        .setSmallIcon(smallIconRes(context))
        .setContentTitle(alarm.title)
        .setContentText(alarm.body)
        .setCategory(Notification.CATEGORY_ALARM)
        // PRIVATE everywhere, like the JS-scheduled alerts: Android then follows the user's
        // "hide sensitive content" lock-screen setting (titles can come from third parties).
        .setVisibility(Notification.VISIBILITY_PRIVATE)
        .setAutoCancel(true)
      if (contentIntent != null) {
        builder.setContentIntent(contentIntent)
        // On Android 14+ the system ignores this unless canUseFullScreenIntent(); the
        // notification is still posted normally then (heads-up on the MAX channel).
        builder.setFullScreenIntent(contentIntent, true)
      }
      if (Build.VERSION.SDK_INT >= 26) {
        builder.setTimeoutAfter(TIMEOUT_MS)
      }
      try {
        // Tag = alarm id: unique per occurrence/offset without hash collisions.
        manager.notify(alarm.id, 0, builder.build())
      } catch (_: Exception) {
        // A missing channel (never created by the app) must not crash the broadcast.
      }
    }

    private fun activityPendingIntent(context: Context, alarm: StoredAlarm): PendingIntent? {
      val intent: Intent =
        if (alarm.deepLink.isNotEmpty()) {
          // Resolved by MainActivity's "meetingguardai://" intent filter (Expo scheme).
          Intent(Intent.ACTION_VIEW, Uri.parse(alarm.deepLink)).setPackage(context.packageName)
        } else {
          context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return null
        }
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      return PendingIntent.getActivity(
        context,
        alarm.id.hashCode(),
        intent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
    }

    private fun smallIconRes(context: Context): Int {
      // The status-bar icon expo-notifications generates from app.config.js, else the app icon.
      val custom = context.resources.getIdentifier("notification_icon", "drawable", context.packageName)
      return if (custom != 0) custom else context.applicationInfo.icon
    }
  }
}
