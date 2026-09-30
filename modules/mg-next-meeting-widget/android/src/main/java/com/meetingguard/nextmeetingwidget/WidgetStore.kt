package com.meetingguard.nextmeetingwidget

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONObject

/** The meeting the widget shows. All text arrives pre-localized and pre-formatted from JS. */
data class StoredMeeting(
  val title: String,
  /** Start instant, epoch ms: the "Happening now" re-render boundary (not displayed). */
  val startAtMs: Long,
  val timeText: String,
  val dateText: String,
  val deepLink: String,
)

/** Localized static strings pushed from JS (the APP language, not the system locale). */
data class StoredStrings(
  val emptyTitle: String,
  val emptyBody: String,
  val nowLabel: String,
)

/**
 * SharedPreferences persistence of the last data + strings, so the AppWidgetProvider and the
 * boot receiver can render without starting JS (docs/ARCHITECTURE.md §19). Missing strings fall
 * back to the module's res/values(-es) strings (a widget added before the app ever ran).
 */
internal object WidgetStore {
  private const val PREFS_NAME = "mg_next_meeting_widget_store"
  private const val KEY_DATA = "data"
  private const val KEY_STRINGS = "strings"

  private fun prefs(context: Context): SharedPreferences =
    context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

  fun data(context: Context): StoredMeeting? =
    prefs(context).getString(KEY_DATA, null)?.let(::parseData)

  fun putData(context: Context, data: StoredMeeting?) {
    val editor = prefs(context).edit()
    if (data == null) {
      editor.remove(KEY_DATA)
    } else {
      editor.putString(
        KEY_DATA,
        JSONObject()
          .put("title", data.title)
          .put("startAtMs", data.startAtMs)
          .put("timeText", data.timeText)
          .put("dateText", data.dateText)
          .put("deepLink", data.deepLink)
          .toString(),
      )
    }
    editor.apply()
  }

  fun strings(context: Context): StoredStrings? =
    prefs(context).getString(KEY_STRINGS, null)?.let(::parseStrings)

  fun putStrings(context: Context, strings: StoredStrings) {
    prefs(context)
      .edit()
      .putString(
        KEY_STRINGS,
        JSONObject()
          .put("emptyTitle", strings.emptyTitle)
          .put("emptyBody", strings.emptyBody)
          .put("nowLabel", strings.nowLabel)
          .toString(),
      )
      .apply()
  }

  /** Sign-out: wipes data AND strings; the widget falls back to its res-string empty state. */
  fun clear(context: Context) {
    prefs(context).edit().clear().apply()
  }

  private fun parseData(raw: String): StoredMeeting? = try {
    val json = JSONObject(raw)
    StoredMeeting(
      title = json.optString("title"),
      startAtMs = json.getLong("startAtMs"),
      timeText = json.optString("timeText"),
      dateText = json.optString("dateText"),
      deepLink = json.optString("deepLink"),
    )
  } catch (_: Exception) {
    null
  }

  private fun parseStrings(raw: String): StoredStrings? = try {
    val json = JSONObject(raw)
    StoredStrings(
      emptyTitle = json.optString("emptyTitle"),
      emptyBody = json.optString("emptyBody"),
      nowLabel = json.optString("nowLabel"),
    )
  } catch (_: Exception) {
    null
  }
}
