package com.meetingguard.fullscreenalarm

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONObject

/** An alarm that has fired (its notification was posted) and has not been handed to JS yet. */
data class FiredAlarm(
  val id: String,
  val firedAtMs: Long,
  val title: String,
  val body: String,
  val deepLink: String,
  val data: String,
)

/**
 * Fired alarms, kept until the app reads them (`getFired`) and clears them (`clearFired`), so the
 * alert engine can show the in-app alarm screen (sound loop, voice readout, snooze) when the
 * full-screen intent opens the app, or when the user opens it shortly after. Without this record
 * the fired native notification is invisible to JS: it is not an expo-notifications
 * notification, so the tray sweep skips it and the app only navigates to the meeting.
 *
 * Entries older than MAX_AGE_MS are dropped on every access; the engine's own re-show window is
 * shorter, so nothing stale is ever shown.
 */
internal object FiredStore {
  private const val PREFS_NAME = "mg_fullscreen_alarm_fired"
  private const val MAX_AGE_MS = 2L * 60L * 60_000L

  private fun prefs(context: Context): SharedPreferences =
    context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

  fun put(context: Context, alarm: FiredAlarm) {
    prune(context, System.currentTimeMillis())
    prefs(context).edit().putString(alarm.id, serialize(alarm)).apply()
  }

  /** Fired alarms whose id starts with `scope` (null / empty = all), oldest first. */
  fun all(context: Context, scope: String?): List<FiredAlarm> {
    prune(context, System.currentTimeMillis())
    return prefs(context).all
      .mapNotNull { (id, value) -> (value as? String)?.let { parse(id, it) } }
      .filter { scope.isNullOrEmpty() || it.id.startsWith(scope) }
      .sortedBy { it.firedAtMs }
  }

  fun remove(context: Context, ids: Collection<String>) {
    val editor = prefs(context).edit()
    for (id in ids) editor.remove(id)
    editor.apply()
  }

  fun clear(context: Context) {
    prefs(context).edit().clear().apply()
  }

  private fun prune(context: Context, now: Long) {
    val stale = prefs(context).all
      .mapNotNull { (id, value) -> (value as? String)?.let { parse(id, it) } }
      .filter { now - it.firedAtMs > MAX_AGE_MS }
      .map { it.id }
    if (stale.isNotEmpty()) remove(context, stale)
  }

  private fun serialize(alarm: FiredAlarm): String = JSONObject()
    .put("firedAtMs", alarm.firedAtMs)
    .put("title", alarm.title)
    .put("body", alarm.body)
    .put("deepLink", alarm.deepLink)
    .put("data", alarm.data)
    .toString()

  private fun parse(id: String, raw: String): FiredAlarm? = try {
    val json = JSONObject(raw)
    FiredAlarm(
      id = id,
      firedAtMs = json.getLong("firedAtMs"),
      title = json.optString("title"),
      body = json.optString("body"),
      deepLink = json.optString("deepLink"),
      data = json.optString("data"),
    )
  } catch (_: Exception) {
    null
  }
}
