package com.meetingguard.fullscreenalarm

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONObject

/** One pending full-screen alarm. `id` is the MeetingGuard notification identifier ("mg:..."). */
data class StoredAlarm(
  val id: String,
  val atMs: Long,
  val title: String,
  val body: String,
  val deepLink: String,
  val channelId: String,
)

/**
 * SharedPreferences persistence of the pending alarms (one entry per alarm id, JSON value), so a
 * BOOT_COMPLETED / MY_PACKAGE_REPLACED receiver can restore them without starting JS.
 * AlarmManager itself forgets alarms on reboot.
 */
internal object AlarmStore {
  private const val PREFS_NAME = "mg_fullscreen_alarm_store"

  private fun prefs(context: Context): SharedPreferences =
    context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

  fun all(context: Context): List<StoredAlarm> =
    prefs(context).all.mapNotNull { (id, value) -> (value as? String)?.let { parse(id, it) } }

  fun get(context: Context, id: String): StoredAlarm? =
    prefs(context).getString(id, null)?.let { parse(id, it) }

  fun put(context: Context, alarm: StoredAlarm) {
    prefs(context).edit().putString(alarm.id, serialize(alarm)).apply()
  }

  fun remove(context: Context, id: String) {
    prefs(context).edit().remove(id).apply()
  }

  fun clear(context: Context) {
    prefs(context).edit().clear().apply()
  }

  private fun serialize(alarm: StoredAlarm): String = JSONObject()
    .put("atMs", alarm.atMs)
    .put("title", alarm.title)
    .put("body", alarm.body)
    .put("deepLink", alarm.deepLink)
    .put("channelId", alarm.channelId)
    .toString()

  private fun parse(id: String, raw: String): StoredAlarm? = try {
    val json = JSONObject(raw)
    StoredAlarm(
      id = id,
      atMs = json.getLong("atMs"),
      title = json.optString("title"),
      body = json.optString("body"),
      deepLink = json.optString("deepLink"),
      channelId = json.optString("channelId"),
    )
  } catch (_: Exception) {
    null
  }
}
