package com.naouflex.atlas.phonecontrol

import org.json.JSONObject
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PhoneLogicTest {
  @Test
  fun scalesTheScreenToTheScreenshotGrid() {
    val scale = ScreenScale(1080, 2400)
    assertEquals(576, scale.width)
    assertEquals(1280, scale.height)
    assertEquals(640, scale.toShot(1200))
    assertEquals(1200f, scale.toScreenY(640), 1f)
    assertEquals(1079f, scale.toScreenX(10_000), 0f)
    val small = ScreenScale(720, 1280)
    assertEquals(1.0, small.factor, 0.0)
  }

  @Test
  fun swipeUpMovesTheFingerUp() {
    assertArrayEquals(intArrayOf(288, 960, 288, 320), swipePoints("up", 576, 1280))
    assertArrayEquals(intArrayOf(144, 640, 432, 640), swipePoints("right", 576, 1280))
  }

  @Test
  fun formatsNumberedRows() {
    assertEquals(
      "[3] Button \"Say \\\"hi\\\"\" (1,2,3,4) clickable",
      formatRow(3, "android.widget.Button", "  Say\n\"hi\" ", intArrayOf(1, 2, 3, 4), listOf("clickable")),
    )
    assertEquals("[0] View (0,0,1,1)", formatRow(0, null, null, intArrayOf(0, 0, 1, 1), emptyList()))
    assertTrue(matchesQuery(null, "x"))
    assertTrue(matchesQuery("send", null, "Send message"))
    assertFalse(matchesQuery("send", "Cancel"))
  }

  @Test
  fun resolvesAppsByPackageThenLabel() {
    val apps = listOf(
      LauncherApp("com.google.android.apps.maps", "Maps"),
      LauncherApp("com.google.android.gm", "Gmail"),
      LauncherApp("com.android.chrome", "Chrome"),
      LauncherApp("com.example.chromecast", "Chromecast setup"),
    )
    assertEquals("com.google.android.gm", resolveApp("com.google.android.gm", apps)?.packageName)
    assertEquals("com.google.android.gm", resolveApp("gmail", apps)?.packageName)
    assertEquals("com.android.chrome", resolveApp("chro", apps)?.packageName)
    assertEquals("com.google.android.apps.maps", resolveApp("ap", apps)?.packageName)
    assertNull(resolveApp("signal", apps))
    assertNull(resolveApp(" ", apps))
  }

  @Test
  fun capsShellOutput() {
    val buffer = OutputBuffer(4)
    buffer.append("abc".toByteArray(), 3)
    assertFalse(buffer.truncated)
    buffer.append("def".toByteArray(), 3)
    assertTrue(buffer.truncated)
    assertEquals("abcd", buffer.text())
    assertEquals("ab" to true, capText("abc", 2))
  }

  @Test
  fun timesOutAfterIdleMinutesAndBacksOff() {
    assertFalse(isIdle(0, 14 * 60_000L, 15))
    assertTrue(isIdle(0, 15 * 60_000L, 15))
    assertTrue(isIdle(0, 15 * 60_000L, 7))
    assertEquals(5, normalizeIdleMinutes(5))
    assertEquals(1_000L, reconnectDelayMs(0))
    assertEquals(60_000L, reconnectDelayMs(20))
    assertEquals("https://atlas.example/api/devices/connect", connectUrl("https://atlas.example/"))
  }

  @Test
  fun readsServerMessages() {
    val request = parseServerMessage(
      """{"type":"request","id":"r1","request":{"method":"phone","botId":"b","action":{"op":"tap","x":1,"y":2}}}""",
    )
    assertTrue(request is ServerMessage.Request)
    assertEquals("tap", (request as ServerMessage.Request).action.getString("op"))
    assertEquals(
      ServerMessage.Refused("r2"),
      parseServerMessage("""{"type":"request","id":"r2","request":{"method":"exec","botId":"b"}}"""),
    )
    assertEquals(ServerMessage.Cancel("r1"), parseServerMessage("""{"type":"cancel","id":"r1"}"""))
    assertEquals(ServerMessage.Revoked, parseServerMessage("""{"type":"revoked"}"""))
    assertEquals(ServerMessage.Unknown, parseServerMessage("nope"))
  }

  @Test
  fun writesFrames() {
    val value = JSONObject(valueFrame("r1", JSONObject().put("width", 5)))
    assertEquals("frame", value.getString("type"))
    assertEquals(5, value.getJSONObject("frame").getJSONObject("value").getInt("width"))
    assertTrue(JSONObject(doneFrame("r1")).getJSONObject("frame").getBoolean("done"))
    assertEquals("no", JSONObject(errorFrame("r1", "no")).getJSONObject("frame").getString("error"))
    assertTrue(JSONObject(heartbeatFrame("r1")).getJSONObject("frame").getBoolean("heartbeat"))
  }

  @Test
  fun readsHeadersAndEndpoints() {
    assertEquals(mapOf("x-proxy" to "abc"), parseHeaders("""{"x-proxy":"abc","empty":""}"""))
    assertEquals(emptyMap<String, String>(), parseHeaders(""))
    assertTrue(isAllowedEndpoint("https://atlas.example"))
    assertFalse(isAllowedEndpoint("ftp://atlas.example"))
    assertFalse(isAllowedEndpoint("not a url"))
  }
}
