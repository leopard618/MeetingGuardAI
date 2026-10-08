package com.meetingguard.fullscreenalarm

import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

/** Mirrors FullScreenAlarmSpec in src/core/contracts.ts (atMs arrives as a JS number). */
class AlarmSpecRecord : Record {
  @Field var id: String = ""

  @Field var atMs: Double = 0.0

  @Field var title: String = ""

  @Field var body: String = ""

  @Field var deepLink: String = ""

  @Field var channelId: String = ""
}

/**
 * Local Expo module "MgFullscreenAlarm" (TS wrapper: modules/mg-fullscreen-alarm/index.ts; glue:
 * src/services/alerts/fsi.ts; contract: FullScreenAlarmModule in src/core/contracts.ts and
 * docs/ARCHITECTURE.md section 18).
 *
 * setAlarms is DECLARATIVE: it replaces the whole pending set, which makes the module the native
 * side of the alert engine's reconcile diff. Pending alarms persist in SharedPreferences
 * (AlarmStore) and BootReceiver restores them after reboots / app updates.
 */
class MgFullscreenAlarmModule : Module() {
  private val reactContext: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("MgFullscreenAlarm")

    AsyncFunction("setAlarms") { alarms: List<AlarmSpecRecord> ->
      setAlarmsInternal(alarms)
    }

    AsyncFunction("clearAlarms") { ids: List<String>? ->
      clearAlarmsInternal(ids)
    }

    AsyncFunction<Map<String, Boolean>>("getStatus") {
      statusInternal()
    }

    AsyncFunction<Unit>("openFullScreenIntentSettings") {
      openFullScreenIntentSettingsInternal()
    }
  }

  /** Replace-all: alarms missing from `alarms` are cancelled, the rest are (re)scheduled. */
  private fun setAlarmsInternal(alarms: List<AlarmSpecRecord>) {
    val context = reactContext
    val now = System.currentTimeMillis()
    val nextIds = HashSet<String>()
    for (spec in alarms) {
      if (spec.id.isNotEmpty()) nextIds.add(spec.id)
    }
    for (existing in AlarmStore.all(context)) {
      if (existing.id !in nextIds) {
        AlarmScheduler.cancel(context, existing.id)
        AlarmStore.remove(context, existing.id)
      }
    }
    for (spec in alarms) {
      if (spec.id.isEmpty()) continue
      val atMs = spec.atMs.toLong()
      val previous = AlarmStore.get(context, spec.id)
      if (atMs <= now) {
        if (previous != null && previous.atMs == atMs) {
          // Already set for this instant: it is firing (or about to). Leave it alone so a
          // reconcile racing the fire time cannot double-post it.
          continue
        }
        if (now - atMs > AlarmScheduler.SET_PAST_GRACE_MS) {
          // Too old to fire. An outdated copy under this id is removed.
          if (previous != null) {
            AlarmScheduler.cancel(context, spec.id)
            AlarmStore.remove(context, spec.id)
          }
          continue
        }
        // Slightly past (scheduling race): AlarmManager fires it immediately.
      }
      val stored = StoredAlarm(spec.id, atMs, spec.title, spec.body, spec.deepLink, spec.channelId)
      AlarmStore.put(context, stored)
      AlarmScheduler.schedule(context, stored)
    }
  }

  /** Cancels the given ids (and their posted tray copies), or everything when ids is null. */
  private fun clearAlarmsInternal(ids: List<String>?) {
    val context = reactContext
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
    val targets = ids ?: AlarmStore.all(context).map { it.id }
    for (id in targets) {
      AlarmScheduler.cancel(context, id)
      AlarmStore.remove(context, id)
      try {
        manager?.cancel(id, 0)
      } catch (_: Exception) {
        // Removing a tray copy is best-effort.
      }
    }
    if (ids == null) AlarmStore.clear(context)
  }

  private fun statusInternal(): Map<String, Boolean> {
    val context = reactContext
    val notifications = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
    val fullScreenAllowed =
      if (Build.VERSION.SDK_INT >= 34) notifications?.canUseFullScreenIntent() ?: false else true
    return mapOf(
      "exactAllowed" to AlarmScheduler.exactAllowed(context),
      "fullScreenAllowed" to fullScreenAllowed,
      "notificationsAllowed" to (notifications?.areNotificationsEnabled() ?: false),
    )
  }

  /** Android 14+: the "Allow full-screen notifications" system page for this app. No-op below. */
  private fun openFullScreenIntentSettingsInternal() {
    if (Build.VERSION.SDK_INT < 34) return
    val context = reactContext
    val intent = Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT)
      .setData(Uri.fromParts("package", context.packageName, null))
    val activity = appContext.currentActivity
    if (activity != null) {
      activity.startActivity(intent)
    } else {
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(intent)
    }
  }
}
