package com.meetingguard.nextmeetingwidget

import android.content.Context
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

/** Mirrors WidgetMeetingData in src/core/contracts.ts (startAtMs arrives as a JS number). */
class WidgetDataRecord : Record {
  @Field var title: String = ""

  @Field var startAtMs: Double = 0.0

  @Field var timeText: String = ""

  @Field var dateText: String = ""

  @Field var deepLink: String = ""
}

/** Mirrors WidgetStrings in src/core/contracts.ts (localized by JS in the APP language). */
class WidgetStringsRecord : Record {
  @Field var emptyTitle: String = ""

  @Field var emptyBody: String = ""

  @Field var nowLabel: String = ""
}

/**
 * Local Expo module "MgNextMeetingWidget" (TS wrapper: modules/mg-next-meeting-widget/index.ts;
 * glue: src/services/widget; contract: NextMeetingWidgetModule in src/core/contracts.ts and
 * docs/ARCHITECTURE.md §19).
 *
 * The module only writes WidgetStore and asks WidgetRenderer to re-render; everything the
 * widget needs later (boot, tick, a widget added while the app is dead) works from the store
 * without JS.
 */
class MgNextMeetingWidgetModule : Module() {
  private val reactContext: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("MgNextMeetingWidget")

    AsyncFunction<Boolean>("hasWidgets") {
      WidgetRenderer.hasWidgets(reactContext)
    }

    AsyncFunction("setNextMeeting") { data: WidgetDataRecord? ->
      val context = reactContext
      WidgetStore.putData(
        context,
        data?.let {
          StoredMeeting(
            title = it.title,
            startAtMs = it.startAtMs.toLong(),
            timeText = it.timeText,
            dateText = it.dateText,
            deepLink = it.deepLink,
          )
        },
      )
      WidgetRenderer.renderAll(context)
    }

    AsyncFunction("setStrings") { strings: WidgetStringsRecord ->
      val context = reactContext
      WidgetStore.putStrings(
        context,
        StoredStrings(
          emptyTitle = strings.emptyTitle,
          emptyBody = strings.emptyBody,
          nowLabel = strings.nowLabel,
        ),
      )
      WidgetRenderer.renderAll(context)
    }

    AsyncFunction<Unit>("clear") {
      val context = reactContext
      WidgetStore.clear(context)
      WidgetRenderer.renderAll(context)
    }
  }
}
