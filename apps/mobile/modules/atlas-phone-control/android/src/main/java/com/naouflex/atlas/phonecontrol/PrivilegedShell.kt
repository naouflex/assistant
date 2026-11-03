package com.naouflex.atlas.phonecontrol

import android.app.Activity
import android.content.Context
import android.content.pm.PackageManager
import org.json.JSONObject
import rikka.shizuku.Shizuku

/**
 * Deeper commands through Shizuku: the shell user, not the Atlas app. That can read notification
 * state, change settings, and inject input. The user starts Shizuku and allows Atlas.
 */
internal object PrivilegedShell {
  const val PACKAGE = "moe.shizuku.privileged.api"
  private const val REQUEST = 7304

  fun installed(context: Context) =
    runCatching { context.packageManager.getPackageInfo(PACKAGE, 0) }.isSuccess

  fun running() = runCatching { Shizuku.pingBinder() }.getOrDefault(false)

  fun allowed(): Boolean {
    if (!running()) return false
    return runCatching {
      Shizuku.checkSelfPermission() == PackageManager.PERMISSION_GRANTED
    }.getOrDefault(false)
  }

  fun request(activity: Activity) {
    if (!installed(activity)) throw IllegalStateException("Shizuku is not installed.")
    if (!running()) throw IllegalStateException("Start Shizuku, then allow Atlas.")
    if (runCatching { Shizuku.isPreV11() }.getOrDefault(false)) {
      throw IllegalStateException("Update Shizuku to run deeper commands.")
    }
    if (!allowed()) Shizuku.requestPermission(REQUEST)
  }

  fun run(command: String, timeoutMs: Long): JSONObject {
    if (!running()) {
      throw IllegalStateException("Start Shizuku, then allow deeper commands in Phone control.")
    }
    if (runCatching { Shizuku.isPreV11() }.getOrDefault(false)) {
      throw IllegalStateException("Update Shizuku to run deeper commands.")
    }
    if (Shizuku.checkSelfPermission() != PackageManager.PERMISSION_GRANTED) {
      throw IllegalStateException("Allow deeper commands in Phone control settings.")
    }
    return PhoneShell.runProcess(start(command), timeoutMs, "privileged")
  }

  /**
   * Shizuku 13 keeps newProcess private and exposes only a user-service bind. The private method
   * is the shell-user process the deeper commands need, and it lives in this app's own dependency.
   */
  private fun start(command: String): Process {
    val method = Shizuku::class.java.getDeclaredMethod(
      "newProcess",
      Array<String>::class.java,
      Array<String>::class.java,
      String::class.java,
    )
    method.isAccessible = true
    return method.invoke(null, arrayOf("sh", "-c", command), null, null) as Process
  }
}
