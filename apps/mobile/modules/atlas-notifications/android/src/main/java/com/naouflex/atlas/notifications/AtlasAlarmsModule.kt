package com.naouflex.atlas.notifications

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** Copies the bots' reminders and wake-ups onto the phone so they go off without a push. */
class AtlasAlarmsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("AtlasAlarms")

    AsyncFunction("setAlarms") { alarms: List<Map<String, Any?>> ->
      AtlasAlarmScheduler.replace(context(), alarms.mapNotNull(AtlasAlarm::fromMap))
    }

    AsyncFunction("listAlarms") {
      AtlasAlarmStore.all(context()).map { it.toMap() }
    }

    Function("canScheduleExactAlarms") { AtlasAlarmScheduler.canScheduleExact(context()) }

    Function("canUseFullScreenIntent") { AtlasAlarmScheduler.canUseFullScreen(context()) }

    AsyncFunction("openExactAlarmSettings") {
      context().startActivity(AtlasAlarmScheduler.exactAlarmSettings(context()))
    }

    AsyncFunction("openFullScreenIntentSettings") {
      context().startActivity(AtlasAlarmScheduler.fullScreenSettings(context()))
    }
  }

  private fun context() = appContext.reactContext
    ?: throw IllegalStateException("Android application context is unavailable")
}
