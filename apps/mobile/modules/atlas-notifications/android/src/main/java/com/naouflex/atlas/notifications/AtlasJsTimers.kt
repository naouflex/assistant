package com.naouflex.atlas.notifications

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.facebook.react.jstasks.HeadlessJsTaskContext

/**
 * React Native stops firing JS timers once the app leaves the screen, unless a headless JS task
 * is running. While a reply is read aloud in the background its queue, watchdogs and the
 * notification's release all run on timers, so a no-op task is held for exactly that long.
 */
object AtlasJsTimers {
  /** Registered in index.ts with AppRegistry.registerHeadlessTask. */
  const val TASK_KEY = "AtlasKeepTimers"

  private var wanted = false
  private var taskId: Int? = null

  /** Starts the task on the UI thread, as React Native requires; a second hold is a no-op. */
  fun hold(context: ReactContext) {
    synchronized(this) { wanted = true }
    UiThreadUtil.runOnUiThread {
      synchronized(this) {
        // A release that landed before this ran wins.
        if (!wanted) return@runOnUiThread
        val tasks = HeadlessJsTaskContext.getInstance(context)
        val running = taskId
        if (running != null && tasks.isTaskRunning(running)) return@runOnUiThread
        taskId = runCatching {
          tasks.startTask(HeadlessJsTaskConfig(TASK_KEY, Arguments.createMap(), 0, true))
        }.getOrNull()
      }
    }
  }

  fun release(context: ReactContext) {
    synchronized(this) {
      wanted = false
      val running = taskId ?: return
      taskId = null
      runCatching {
        val tasks = HeadlessJsTaskContext.getInstance(context)
        if (tasks.isTaskRunning(running)) tasks.finishTask(running)
      }
    }
  }
}
