package com.naouflex.atlas.phonecontrol

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.SystemClock
import org.json.JSONObject
import java.io.InputStream
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread

/** `/system/bin/sh` as the Atlas app: its own files, no root. */
internal object PhoneShell {
  fun run(context: Context, command: String, timeoutMs: Long): JSONObject {
    val process = ProcessBuilder("/system/bin/sh", "-c", command)
      .directory(context.filesDir)
      .apply {
        environment()["HOME"] = context.filesDir.path
        environment()["TMPDIR"] = context.cacheDir.path
      }
      .start()
    return runProcess(process, timeoutMs, "sh")
  }

  fun runProcess(process: Process, timeoutMs: Long, runner: String): JSONObject {
    process.outputStream.close()
    val stdout = OutputBuffer()
    val stderr = OutputBuffer()
    val readers = listOf(drain(process.inputStream, stdout), drain(process.errorStream, stderr))
    val deadline = SystemClock.elapsedRealtime() + timeoutMs
    var exitCode: Int? = null
    try {
      while (exitCode == null && SystemClock.elapsedRealtime() < deadline) {
        exitCode = runCatching { process.exitValue() }.getOrNull()
        if (exitCode == null) Thread.sleep(50)
      }
    } finally {
      if (exitCode == null) process.destroy()
    }
    readers.forEach { it.join(2_000) }
    return JSONObject()
      .put("runner", runner)
      .put("exitCode", exitCode ?: JSONObject.NULL)
      .put("stdout", stdout.text())
      .put("stderr", stderr.text())
      .apply {
        if (exitCode == null) put("timedOut", true)
        if (stdout.truncated || stderr.truncated) put("truncated", true)
      }
  }

  private fun drain(stream: InputStream, buffer: OutputBuffer) = thread(isDaemon = true) {
    runCatching {
      stream.use {
        val chunk = ByteArray(8_192)
        while (true) {
          val read = it.read(chunk)
          if (read < 0) break
          buffer.append(chunk, read)
        }
      }
    }
  }
}

/** Termux's documented RUN_COMMAND service. The user installs Termux and allows external apps. */
internal object TermuxShell {
  const val PACKAGE = "com.termux"
  const val PERMISSION = "com.termux.permission.RUN_COMMAND"

  fun installed(context: Context) =
    runCatching { context.packageManager.getPackageInfo(PACKAGE, 0) }.isSuccess

  fun allowed(context: Context) =
    context.checkSelfPermission(PERMISSION) == PackageManager.PERMISSION_GRANTED

  fun run(context: Context, command: String, timeoutMs: Long): JSONObject {
    if (!installed(context)) throw IllegalStateException("Termux is not installed on the phone.")
    if (!allowed(context)) {
      throw IllegalStateException("Allow Atlas to run Termux commands in Phone control settings.")
    }
    val action = "${context.packageName}.TERMUX_RESULT.${UUID.randomUUID()}"
    val latch = CountDownLatch(1)
    var result: Bundle? = null
    val receiver = object : BroadcastReceiver() {
      override fun onReceive(context: Context, intent: Intent) {
        result = intent.getBundleExtra("result")
        latch.countDown()
      }
    }
    if (Build.VERSION.SDK_INT >= 33) {
      context.registerReceiver(receiver, IntentFilter(action), Context.RECEIVER_NOT_EXPORTED)
    } else {
      context.registerReceiver(receiver, IntentFilter(action))
    }
    try {
      val flags = PendingIntent.FLAG_ONE_SHOT or (if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0)
      val pending = PendingIntent.getBroadcast(
        context,
        action.hashCode(),
        Intent(action).setPackage(context.packageName),
        flags,
      )
      val intent = Intent("com.termux.RUN_COMMAND")
        .setClassName(PACKAGE, "com.termux.app.RunCommandService")
        .putExtra("com.termux.RUN_COMMAND_PATH", "/data/data/com.termux/files/usr/bin/bash")
        .putExtra("com.termux.RUN_COMMAND_ARGUMENTS", arrayOf("-c", command))
        .putExtra("com.termux.RUN_COMMAND_WORKDIR", "/data/data/com.termux/files/home")
        .putExtra("com.termux.RUN_COMMAND_BACKGROUND", true)
        .putExtra("com.termux.RUN_COMMAND_PENDING_INTENT", pending)
      context.startService(intent)
      val finished = latch.await(timeoutMs, TimeUnit.MILLISECONDS)
      val bundle = result
      if (!finished || bundle == null) {
        return JSONObject().put("runner", "termux").put("exitCode", JSONObject.NULL)
          .put("stdout", "").put("stderr", "").put("timedOut", true)
      }
      val (stdout, outCut) = capText(bundle.getString("stdout").orEmpty())
      val errmsg = bundle.getString("errmsg").orEmpty()
      val (stderr, errCut) = capText(listOf(bundle.getString("stderr").orEmpty(), errmsg).filter { it.isNotEmpty() }.joinToString("\n"))
      return JSONObject()
        .put("runner", "termux")
        .put("exitCode", if (bundle.containsKey("exitCode")) bundle.getInt("exitCode") else JSONObject.NULL)
        .put("stdout", stdout)
        .put("stderr", stderr)
        .apply { if (outCut || errCut) put("truncated", true) }
    } finally {
      context.unregisterReceiver(receiver)
    }
  }
}
