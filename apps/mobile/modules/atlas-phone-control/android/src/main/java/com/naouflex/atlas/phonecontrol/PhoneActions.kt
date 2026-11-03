package com.naouflex.atlas.phonecontrol

import android.content.Context
import org.json.JSONObject

/** Runs one `phone` action from the server; the server has already validated its shape. */
internal object PhoneActions {
  fun perform(context: Context, action: JSONObject): JSONObject {
    val op = action.optString("op")
    if (op == "shell") {
      val command = action.getString("command")
      val timeoutMs = action.optLong("timeoutMs", 120_000L).coerceIn(1_000L, 30 * 60_000L)
      return when {
        action.optBoolean("privileged") -> PrivilegedShell.run(command, timeoutMs)
        action.optBoolean("termux") -> TermuxShell.run(context, command, timeoutMs)
        else -> PhoneShell.run(context, command, timeoutMs)
      }
    }
    if (op == "notifications") return PhoneNotifications.perform(context, action)
    val screen = AtlasPhoneAccessibilityService.instance
      ?: throw IllegalStateException("Turn on Atlas phone control in the phone's Accessibility settings.")
    return when (op) {
      "screenshot" -> screen.screenshot()
      "uiTree" -> screen.uiTree(action.optString("query").ifBlank { null })
      "tap" -> screen.tap(action.intOrNull("element"), action.intOrNull("x"), action.intOrNull("y"), action.optBoolean("long"))
      "swipe" -> screen.swipe(
        action.optString("direction").ifBlank { null },
        listOf("x1", "y1", "x2", "y2").takeIf { keys -> keys.all(action::has) }
          ?.map(action::getInt)?.toIntArray(),
        action.optInt("durationMs", 300),
      )
      "type" -> screen.type(action.getString("text"), action.intOrNull("element"), action.optBoolean("submit"))
      "key" -> screen.key(action.getString("key"))
      "openApp" -> screen.openApp(action.getString("app"))
      else -> throw IllegalArgumentException("This phone does not know \"$op\". Update the Atlas app.")
    }
  }

  private fun JSONObject.intOrNull(name: String): Int? = if (has(name) && !isNull(name)) getInt(name) else null
}
