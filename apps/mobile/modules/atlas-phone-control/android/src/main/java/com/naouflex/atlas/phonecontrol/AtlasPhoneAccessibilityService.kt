package com.naouflex.atlas.phonecontrol

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Path
import android.graphics.Rect
import android.os.Build
import android.os.Bundle
import android.hardware.display.DisplayManager
import android.util.Base64
import android.util.DisplayMetrics
import android.view.Display
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * Reads and drives the screen for Atlas. The user turns it on in Accessibility settings; it does
 * nothing on its own and acts only on requests the control service forwards while control is on.
 */
class AtlasPhoneAccessibilityService : AccessibilityService() {
  private var lastNodes: List<AccessibilityNodeInfo> = emptyList()

  override fun onServiceConnected() {
    instance = this
  }

  override fun onUnbind(intent: Intent?): Boolean {
    instance = null
    return super.onUnbind(intent)
  }

  override fun onDestroy() {
    instance = null
    super.onDestroy()
  }

  override fun onAccessibilityEvent(event: AccessibilityEvent?) = Unit

  override fun onInterrupt() = Unit

  /** The full display in its current rotation, the same size takeScreenshot returns. */
  private fun scale(): ScreenScale {
    val display = getSystemService(DisplayManager::class.java).getDisplay(Display.DEFAULT_DISPLAY)
    val metrics = DisplayMetrics()
    @Suppress("DEPRECATION")
    display.getRealMetrics(metrics)
    return ScreenScale(metrics.widthPixels, metrics.heightPixels)
  }

  private fun foregroundPackage(): String? = rootInActiveWindow?.packageName?.toString()

  private fun screen(scale: ScreenScale = scale()) = JSONObject()
    .put("width", scale.width)
    .put("height", scale.height)
    .apply { foregroundPackage()?.let { put("package", it) } }

  @Synchronized
  fun uiTree(query: String?): JSONObject {
    val scale = scale()
    val rows = mutableListOf<String>()
    val nodes = mutableListOf<AccessibilityNodeInfo>()
    val roots = runCatching { windows.mapNotNull { it.root } }.getOrDefault(emptyList())
      .ifEmpty { listOfNotNull(rootInActiveWindow) }
    val rect = Rect()
    fun walk(node: AccessibilityNodeInfo) {
      if (nodes.size >= MAX_TREE_NODES || !node.isVisibleToUser) return
      val text = node.text?.toString()?.ifBlank { null }
        ?: node.contentDescription?.toString()?.ifBlank { null }
        ?: if (Build.VERSION.SDK_INT >= 26) node.hintText?.toString()?.ifBlank { null } else null
      if (text != null || node.isClickable || node.isEditable || node.isScrollable || node.isCheckable) {
        val index = nodes.size
        nodes.add(node)
        node.getBoundsInScreen(rect)
        val flags = buildList {
          if (node.isClickable) add("clickable")
          if (node.isEditable) add("editable")
          if (node.isScrollable) add("scrollable")
          if (node.isCheckable) add(if (node.isChecked) "checked" else "unchecked")
          if (node.isFocused) add("focused")
          if (!node.isEnabled) add("disabled")
        }
        val bounds = intArrayOf(
          scale.toShot(rect.left),
          scale.toShot(rect.top),
          scale.toShot(rect.right),
          scale.toShot(rect.bottom),
        )
        if (matchesQuery(query, text, node.className?.toString(), node.viewIdResourceName)) {
          rows.add(formatRow(index, node.className?.toString(), text, bounds, flags))
        }
      }
      for (child in 0 until node.childCount) node.getChild(child)?.let(::walk)
    }
    roots.forEach(::walk)
    lastNodes = nodes
    return screen(scale).put("tree", rows.joinToString("\n").ifEmpty { "(no matching elements)" })
  }

  @Synchronized
  private fun node(element: Int): AccessibilityNodeInfo {
    val node = lastNodes.getOrNull(element)
      ?: throw IllegalArgumentException("Element $element is not on the last phone_ui_tree. Read it again.")
    if (!node.refresh()) throw IllegalArgumentException("Element $element is gone. Read phone_ui_tree again.")
    return node
  }

  fun tap(element: Int?, x: Int?, y: Int?, long: Boolean): JSONObject {
    val scale = scale()
    if (element != null) {
      val node = node(element)
      val action = if (long) AccessibilityNodeInfo.ACTION_LONG_CLICK else AccessibilityNodeInfo.ACTION_CLICK
      val clickable = if (long) node.isLongClickable else node.isClickable
      if (!(clickable && node.performAction(action))) {
        val rect = Rect().also(node::getBoundsInScreen)
        gesture(rect.exactCenterX(), rect.exactCenterY(), rect.exactCenterX(), rect.exactCenterY(), if (long) 800 else 60)
      }
    } else {
      val px = scale.toScreenX(requireNotNull(x) { "x is required" })
      val py = scale.toScreenY(requireNotNull(y) { "y is required" })
      gesture(px, py, px, py, if (long) 800 else 60)
    }
    return settled()
  }

  fun swipe(direction: String?, points: IntArray?, durationMs: Int): JSONObject {
    val scale = scale()
    val (x1, y1, x2, y2) = (if (direction != null) swipePoints(direction, scale.width, scale.height) else points)
      ?.toList() ?: throw IllegalArgumentException("Pass a direction or x1, y1, x2 and y2.")
    gesture(scale.toScreenX(x1), scale.toScreenY(y1), scale.toScreenX(x2), scale.toScreenY(y2), durationMs)
    return settled()
  }

  fun type(text: String, element: Int?, submit: Boolean): JSONObject {
    val target = if (element != null) {
      node(element).also { if (!it.isFocused) it.performAction(AccessibilityNodeInfo.ACTION_FOCUS) }
    } else {
      findFocus(AccessibilityNodeInfo.FOCUS_INPUT)
        ?: throw IllegalStateException("No text field is focused. Tap one first, or pass element.")
    }
    val arguments = Bundle().apply {
      putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text)
    }
    if (!target.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, arguments)) {
      throw IllegalStateException("That element does not take text.")
    }
    if (submit) enter(target)
    return settled()
  }

  fun key(key: String): JSONObject {
    val global = when (key) {
      "back" -> GLOBAL_ACTION_BACK
      "home" -> GLOBAL_ACTION_HOME
      "recents" -> GLOBAL_ACTION_RECENTS
      "notifications" -> GLOBAL_ACTION_NOTIFICATIONS
      "quick_settings" -> GLOBAL_ACTION_QUICK_SETTINGS
      "power_dialog" -> GLOBAL_ACTION_POWER_DIALOG
      "lock" -> if (Build.VERSION.SDK_INT >= 28) GLOBAL_ACTION_LOCK_SCREEN else null
      "enter" -> null
      else -> throw IllegalArgumentException("Unknown key: $key")
    }
    when {
      key == "enter" -> enter(
        findFocus(AccessibilityNodeInfo.FOCUS_INPUT)
          ?: throw IllegalStateException("No text field is focused."),
      )
      global == null -> throw IllegalStateException("This phone cannot do that from Atlas.")
      !performGlobalAction(global) -> throw IllegalStateException("The phone did not press $key.")
    }
    return settled()
  }

  fun openApp(app: String): JSONObject {
    val launcher = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
    val apps = packageManager.queryIntentActivities(launcher, 0).map {
      LauncherApp(it.activityInfo.packageName, it.loadLabel(packageManager).toString())
    }
    val match = resolveApp(app, apps) ?: throw IllegalArgumentException("No app named \"$app\" is installed.")
    val intent = packageManager.getLaunchIntentForPackage(match.packageName)
      ?: throw IllegalStateException("${match.label} cannot be opened.")
    startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    Thread.sleep(800)
    return screen().put("opened", match.packageName)
  }

  fun screenshot(): JSONObject {
    if (Build.VERSION.SDK_INT < 30) throw IllegalStateException("Screenshots need Android 11 or newer.")
    val scale = scale()
    var bitmap = capture() ?: run {
      // Android allows about one screenshot a second.
      Thread.sleep(1_100)
      capture()
    } ?: throw IllegalStateException(lastScreenshotError)
    if (bitmap.width != scale.width || bitmap.height != scale.height) {
      bitmap = Bitmap.createScaledBitmap(bitmap, scale.width, scale.height, true)
    }
    val bytes = ByteArrayOutputStream()
    bitmap.compress(Bitmap.CompressFormat.JPEG, 70, bytes)
    val image = JSONObject()
      .put("mimeType", "image/jpeg")
      .put("data", Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP))
      .put("width", bitmap.width)
      .put("height", bitmap.height)
    return screen(scale).put("image", image)
  }

  private var lastScreenshotError = "The phone did not take a screenshot."

  private fun capture(): Bitmap? {
    if (Build.VERSION.SDK_INT < 30) return null
    val latch = CountDownLatch(1)
    var result: Bitmap? = null
    takeScreenshot(
      Display.DEFAULT_DISPLAY,
      mainExecutor,
      object : TakeScreenshotCallback {
        override fun onSuccess(screenshot: ScreenshotResult) {
          val buffer = screenshot.hardwareBuffer
          result = Bitmap.wrapHardwareBuffer(buffer, screenshot.colorSpace)?.copy(Bitmap.Config.ARGB_8888, false)
          buffer.close()
          latch.countDown()
        }

        override fun onFailure(errorCode: Int) {
          lastScreenshotError = if (errorCode == ERROR_TAKE_SCREENSHOT_SECURE_WINDOW) {
            "The app on screen blocks screenshots. Use phone_ui_tree instead."
          } else {
            "The phone did not take a screenshot (error $errorCode)."
          }
          latch.countDown()
        }
      },
    )
    latch.await(5, TimeUnit.SECONDS)
    return result
  }

  private fun enter(node: AccessibilityNodeInfo) {
    if (Build.VERSION.SDK_INT < 30 ||
      !node.performAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_IME_ENTER.id)
    ) {
      throw IllegalStateException("The phone did not press enter.")
    }
  }

  private fun gesture(x1: Float, y1: Float, x2: Float, y2: Float, durationMs: Int) {
    val path = Path().apply {
      moveTo(x1, y1)
      lineTo(x2, y2)
    }
    val stroke = GestureDescription.StrokeDescription(path, 0, durationMs.toLong().coerceIn(1, 5_000))
    val latch = CountDownLatch(1)
    var completed = false
    val dispatched = dispatchGesture(
      GestureDescription.Builder().addStroke(stroke).build(),
      object : GestureResultCallback() {
        override fun onCompleted(gestureDescription: GestureDescription?) {
          completed = true
          latch.countDown()
        }

        override fun onCancelled(gestureDescription: GestureDescription?) = latch.countDown()
      },
      null,
    )
    if (!dispatched) throw IllegalStateException("The phone refused the gesture.")
    latch.await(durationMs + 5_000L, TimeUnit.MILLISECONDS)
    if (!completed) throw IllegalStateException("The gesture was interrupted.")
  }

  /** Gives the app a moment to react, then reports what is in front. */
  private fun settled(): JSONObject {
    Thread.sleep(500)
    return screen()
  }

  companion object {
    @Volatile
    var instance: AtlasPhoneAccessibilityService? = null
      private set
  }
}
