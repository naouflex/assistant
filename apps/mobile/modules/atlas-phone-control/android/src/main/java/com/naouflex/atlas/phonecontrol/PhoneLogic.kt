package com.naouflex.atlas.phonecontrol

import org.json.JSONObject
import kotlin.math.roundToInt

/** Screenshots and coordinates use this long side at most, so a bot sees and taps one pixel grid. */
internal const val MAX_SCREEN_SIDE = 1280
internal const val MAX_SHELL_OUTPUT = 64 * 1024
internal const val MAX_TREE_NODES = 2000
internal val IDLE_CHOICES = listOf(5, 15, 30, 60)
internal const val DEFAULT_IDLE_MINUTES = 15

internal fun normalizeIdleMinutes(minutes: Int) =
  if (minutes in IDLE_CHOICES) minutes else DEFAULT_IDLE_MINUTES

internal fun isIdle(lastActivityMs: Long, nowMs: Long, idleMinutes: Int) =
  nowMs - lastActivityMs >= normalizeIdleMinutes(idleMinutes) * 60_000L

/** 1s, 2s, 4s… up to a minute. */
internal fun reconnectDelayMs(attempt: Int): Long = minOf(60_000L, 1_000L shl attempt.coerceIn(0, 6))

internal fun connectUrl(endpoint: String) = endpoint.trimEnd('/') + "/api/devices/connect"

internal fun selfUrl(endpoint: String) = endpoint.trimEnd('/') + "/api/devices/self"

/** Maps the screenshot's pixel grid to the real screen. */
internal class ScreenScale(val screenWidth: Int, val screenHeight: Int) {
  val factor: Double = run {
    val longSide = maxOf(screenWidth, screenHeight)
    if (longSide <= MAX_SCREEN_SIDE) 1.0 else MAX_SCREEN_SIDE.toDouble() / longSide
  }
  val width: Int get() = maxOf(1, (screenWidth * factor).roundToInt())
  val height: Int get() = maxOf(1, (screenHeight * factor).roundToInt())

  fun toShot(value: Int): Int = (value * factor).roundToInt()

  fun toScreenX(x: Int): Float = (x / factor).toFloat().coerceIn(0f, maxOf(0, screenWidth - 1).toFloat())

  fun toScreenY(y: Int): Float = (y / factor).toFloat().coerceIn(0f, maxOf(0, screenHeight - 1).toFloat())
}

/** A swipe "up" scrolls the content up: the finger moves from low on the screen to high. */
internal fun swipePoints(direction: String, width: Int, height: Int): IntArray = when (direction) {
  "up" -> intArrayOf(width / 2, height * 3 / 4, width / 2, height / 4)
  "down" -> intArrayOf(width / 2, height / 4, width / 2, height * 3 / 4)
  "left" -> intArrayOf(width * 3 / 4, height / 2, width / 4, height / 2)
  "right" -> intArrayOf(width / 4, height / 2, width * 3 / 4, height / 2)
  else -> throw IllegalArgumentException("Unknown swipe direction: $direction")
}

/** `[N] Button "OK" (x1,y1,x2,y2) clickable`, bounds in screenshot pixels. */
internal fun formatRow(index: Int, className: String?, text: String?, bounds: IntArray, flags: List<String>): String {
  val kind = className?.substringAfterLast('.')?.ifBlank { null } ?: "View"
  val label = text?.replace(Regex("\\s+"), " ")?.trim()?.take(120)?.replace("\"", "\\\"").orEmpty()
  val parts = mutableListOf("[$index]", kind)
  if (label.isNotEmpty()) parts.add("\"$label\"")
  parts.add("(${bounds.joinToString(",")})")
  parts.addAll(flags)
  return parts.joinToString(" ")
}

internal fun matchesQuery(query: String?, vararg values: String?): Boolean {
  val needle = query?.trim()?.lowercase().orEmpty()
  if (needle.isEmpty()) return true
  return values.any { it?.lowercase()?.contains(needle) == true }
}

internal data class LauncherApp(val packageName: String, val label: String)

/** An exact package, then an exact label, then a label that starts with or contains the name. */
internal fun resolveApp(query: String, apps: List<LauncherApp>): LauncherApp? {
  val name = query.trim().lowercase()
  if (name.isEmpty()) return null
  return apps.firstOrNull { it.packageName.lowercase() == name }
    ?: apps.firstOrNull { it.label.lowercase() == name }
    ?: apps.filter { it.label.lowercase().startsWith(name) }.minByOrNull { it.label.length }
    ?: apps.filter { it.label.lowercase().contains(name) }.minByOrNull { it.label.length }
}

/** Keeps the first `limit` bytes and notes whether more came. */
internal class OutputBuffer(private val limit: Int = MAX_SHELL_OUTPUT) {
  private val bytes = java.io.ByteArrayOutputStream()
  var truncated = false
    private set

  @Synchronized
  fun append(chunk: ByteArray, length: Int) {
    val room = limit - bytes.size()
    if (length > room) truncated = true
    if (room > 0) bytes.write(chunk, 0, minOf(room, length))
  }

  @Synchronized
  fun text(): String = bytes.toString(Charsets.UTF_8.name())
}

internal fun capText(value: String, limit: Int = MAX_SHELL_OUTPUT): Pair<String, Boolean> =
  if (value.length <= limit) value to false else value.substring(0, limit) to true

internal sealed interface ServerMessage {
  data class Request(val id: String, val action: JSONObject) : ServerMessage
  data class Cancel(val id: String) : ServerMessage
  data object Revoked : ServerMessage
  data class Refused(val id: String) : ServerMessage
  data object Unknown : ServerMessage
}

/** Only `phone` requests are served; a computer request gets a refusal so the run is not left waiting. */
internal fun parseServerMessage(text: String): ServerMessage {
  val message = runCatching { JSONObject(text) }.getOrNull() ?: return ServerMessage.Unknown
  val id = message.optString("id")
  return when (message.optString("type")) {
    "revoked" -> ServerMessage.Revoked
    "cancel" -> if (id.isEmpty()) ServerMessage.Unknown else ServerMessage.Cancel(id)
    "request" -> {
      if (id.isEmpty()) return ServerMessage.Unknown
      val request = message.optJSONObject("request")
      val action = request?.optJSONObject("action")
      if (request?.optString("method") == "phone" && action != null) ServerMessage.Request(id, action)
      else ServerMessage.Refused(id)
    }
    else -> ServerMessage.Unknown
  }
}

internal fun valueFrame(id: String, value: JSONObject) = frame(id, JSONObject().put("value", value))

internal fun doneFrame(id: String) = frame(id, JSONObject().put("done", true))

internal fun errorFrame(id: String, error: String) = frame(id, JSONObject().put("error", error.take(2_000)))

internal fun heartbeatFrame(id: String) = frame(id, JSONObject().put("heartbeat", true))

private fun frame(id: String, frame: JSONObject) =
  JSONObject().put("type", "frame").put("id", id).put("frame", frame).toString()

/** A JSON object of extra server headers, such as an access proxy's; anything else is ignored. */
internal fun parseHeaders(json: String): Map<String, String> {
  val value = runCatching { JSONObject(json) }.getOrNull() ?: return emptyMap()
  return value.keys().asSequence().mapNotNull { key ->
    val header = value.optString(key, "")
    if (key.isBlank() || header.isEmpty()) null else key to header
  }.toMap()
}

internal fun isAllowedEndpoint(endpoint: String): Boolean {
  val uri = runCatching { java.net.URI(endpoint) }.getOrNull() ?: return false
  val scheme = uri.scheme?.lowercase()
  return !uri.host.isNullOrEmpty() && (scheme == "https" || scheme == "http")
}
