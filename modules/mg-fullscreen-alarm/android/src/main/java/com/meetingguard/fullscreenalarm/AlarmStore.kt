package com.meetingguard.fullscreenalarm

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONObject

/**
 * One pending full-screen alarm. `id` is the Meeting Guard AI notification identifier ("mg:...").
 * `data` is the alert payload as JSON text (the same object the expo-notifications path carries
 * as `content.data`); the module never reads it, it hands it back to JS when the alarm has fired
 * so the app can show the in-app alarm screen (sound loop, voice readout, snooze). Empty for
 * alarms that have no in-app presentation (the daily briefing).
 */
data class StoredAlarm(
  val id: String,
  val atMs: Long,
  val title: String,
  val body: String,
  val deepLink: String,
  val channelId: String,
  val data: String = "",
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
    .put("data", alarm.data)
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
      data = json.optString("data"),
    )
  } catch (_: Exception) {
    null
  }
}
