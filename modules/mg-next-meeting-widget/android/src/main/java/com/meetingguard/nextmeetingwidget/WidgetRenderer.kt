package com.meetingguard.nextmeetingwidget

import android.app.AlarmManager
import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.RemoteViews

/**
 * Builds the RemoteViews from WidgetStore and pushes them to every widget instance
 * (docs/ARCHITECTURE.md §19). RemoteViews-safe views only (LinearLayout + TextView/ImageView),
 * so the layout works on Android 9 / LDPlayer 9.
 *
 * For non-null data with a future start, ONE INEXACT AlarmManager broadcast (never setExact: no
 * exact-alarm entanglement) at startAtMs makes the provider swap to the nowLabel presentation
 * without JS running. The tick intent targets the provider class explicitly, so no extra
 * receiver is needed.
 */
internal object WidgetRenderer {
  const val ACTION_TICK = "com.meetingguard.nextmeetingwidget.TICK"

  /** " · " between timeText and dateText (language-neutral punctuation; text comes from JS). */
  private const val SEPARATOR = " · "

  private fun provider(context: Context): ComponentName =
    ComponentName(context, NextMeetingWidgetProvider::class.java)

  private fun widgetIds(context: Context, manager: AppWidgetManager): IntArray =
    manager.getAppWidgetIds(provider(context)) ?: IntArray(0)

  fun hasWidgets(context: Context): Boolean =
    widgetIds(context, AppWidgetManager.getInstance(context)).isNotEmpty()

  /** Renders every placed instance from the store and (re)schedules or cancels the tick. */
  fun renderAll(context: Context) {
    val manager = AppWidgetManager.getInstance(context)
    val ids = widgetIds(context, manager)
    val data = WidgetStore.data(context)
    if (ids.isNotEmpty()) {
      manager.updateAppWidget(ids, buildViews(context, data))
    }
    scheduleTick(context, data, ids.isNotEmpty())
  }

  /** onUpdate path: renders exactly the instances the system asked for (a widget just added). */
  fun render(context: Context, manager: AppWidgetManager, ids: IntArray) {
    if (ids.isEmpty()) return
    val data = WidgetStore.data(context)
    manager.updateAppWidget(ids, buildViews(context, data))
    scheduleTick(context, data, true)
  }

  private fun buildViews(context: Context, data: StoredMeeting?): RemoteViews {
    val views = RemoteViews(context.packageName, R.layout.mg_next_meeting_widget)
    val strings = WidgetStore.strings(context)

    if (data == null) {
      views.setTextViewText(R.id.mg_widget_title, strings?.emptyTitle ?: context.getString(R.string.mg_widget_empty_title))
      views.setTextViewText(R.id.mg_widget_line2, strings?.emptyBody ?: context.getString(R.string.mg_widget_empty_body))
    } else {
      views.setTextViewText(R.id.mg_widget_title, data.title)
      val started = System.currentTimeMillis() >= data.startAtMs
      val line2 =
        if (started) strings?.nowLabel ?: context.getString(R.string.mg_widget_now)
        else data.timeText + SEPARATOR + data.dateText
      views.setTextViewText(R.id.mg_widget_line2, line2)
    }

    val icon = context.applicationInfo.icon
    if (icon != 0) views.setImageViewResource(R.id.mg_widget_icon, icon)

    val tap = tapPendingIntent(context, data)
    if (tap != null) views.setOnClickPendingIntent(R.id.mg_widget_root, tap)
    return views
  }

  /** Tap: the meeting deep link ("meetingguardai://meeting/{id}"); empty state: the launch intent. */
  private fun tapPendingIntent(context: Context, data: StoredMeeting?): PendingIntent? {
    val intent: Intent =
      if (data != null && data.deepLink.isNotEmpty()) {
        Intent(Intent.ACTION_VIEW, Uri.parse(data.deepLink)).setPackage(context.packageName)
      } else {
        context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return null
      }
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    return PendingIntent.getActivity(
      context,
      0,
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }

  private fun tickPendingIntent(context: Context): PendingIntent {
    val intent = Intent(context, NextMeetingWidgetProvider::class.java).setAction(ACTION_TICK)
    return PendingIntent.getBroadcast(
      context,
      0,
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }

  /**
   * One pending tick at startAtMs while a future meeting is shown on at least one instance.
   * RTC without wakeup: if the device sleeps past the start, the tick fires on the next wake,
   * exactly when the widget can be seen again.
   */
  private fun scheduleTick(context: Context, data: StoredMeeting?, hasWidgets: Boolean) {
    val manager = context.getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: return
    val operation = tickPendingIntent(context)
    if (data != null && hasWidgets && data.startAtMs > System.currentTimeMillis()) {
      manager.set(AlarmManager.RTC, data.startAtMs, operation)
    } else {
      manager.cancel(operation)
    }
  }
}
