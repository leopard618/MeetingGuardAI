package com.meetingguard.nextmeetingwidget

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent

/**
 * The home-screen widget (docs/ARCHITECTURE.md §19). The system calls onUpdate when an instance
 * is added (updatePeriodMillis is 0: the app pushes, the system never polls); the module's own
 * inexact AlarmManager tick arrives here too (ACTION_TICK, explicit intent) and re-renders so
 * the "Happening now" presentation appears without JS running.
 */
class NextMeetingWidgetProvider : AppWidgetProvider() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action == WidgetRenderer.ACTION_TICK) {
      WidgetRenderer.renderAll(context)
      return
    }
    super.onReceive(context, intent)
  }

  override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
    // A widget added later must show current data immediately (the feeder always writes).
    WidgetRenderer.render(context, appWidgetManager, appWidgetIds)
  }

  override fun onEnabled(context: Context) {
    // First instance placed: render and schedule the tick from whatever the store holds.
    WidgetRenderer.renderAll(context)
  }

  override fun onDisabled(context: Context) {
    // Last instance removed: renderAll finds no ids and cancels the pending tick.
    WidgetRenderer.renderAll(context)
  }
}
