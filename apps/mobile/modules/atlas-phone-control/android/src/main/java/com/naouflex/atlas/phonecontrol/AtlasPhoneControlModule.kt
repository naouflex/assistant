package com.naouflex.atlas.phonecontrol

import android.content.Context
import android.content.Intent
import android.os.Build
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import okhttp3.OkHttpClient
import okhttp3.Request
import java.util.concurrent.TimeUnit

class AtlasPhoneControlModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("AtlasPhoneControl")

    AsyncFunction("getState") {
      val context = context()
      val storage = PhoneControlStorage(context)
      mapOf(
        "enabled" to (storage.enabled && PhoneControlService.running),
        "connected" to PhoneControlService.connected,
        "paired" to storage.paired,
        "endpoint" to storage.endpoint,
        "deviceId" to storage.deviceId,
        "accessibility" to (AtlasPhoneAccessibilityService.instance != null),
        "screenshots" to (Build.VERSION.SDK_INT >= 30),
        "idleMinutes" to storage.idleMinutes,
        "termuxInstalled" to TermuxShell.installed(context),
        "termuxAllowed" to TermuxShell.allowed(context),
        "notifications" to PhoneNotifications.allowed(context),
        "deeperCommandsInstalled" to PrivilegedShell.installed(context),
        "deeperCommandsRunning" to PrivilegedShell.running(),
        "deeperCommandsAllowed" to PrivilegedShell.allowed(),
        "deviceName" to (Build.MODEL ?: "Android phone"),
      )
    }

    AsyncFunction("pair") { endpoint: String, deviceId: String, token: String, headers: String ->
      if (!isAllowedEndpoint(endpoint) || token.isBlank()) throw IllegalArgumentException("Invalid pairing")
      val storage = PhoneControlStorage(context())
      storage.endpoint = endpoint.trimEnd('/')
      storage.deviceId = deviceId
      storage.token = token
      storage.headers = headers
    }

    AsyncFunction("enable") {
      val context = context()
      val storage = PhoneControlStorage(context)
      if (!storage.paired) throw IllegalStateException("This phone is not paired")
      storage.enabled = true
      PhoneControlService.start(context)
    }

    AsyncFunction("disable") {
      val context = context()
      PhoneControlStorage(context).enabled = false
      PhoneControlService.stop(context)
    }

    AsyncFunction("setIdleMinutes") { minutes: Int ->
      PhoneControlStorage(context()).idleMinutes = minutes
    }

    /** Revokes this phone's pairing on the server, then forgets it here either way. */
    AsyncFunction("forget") {
      val context = context()
      val storage = PhoneControlStorage(context)
      storage.enabled = false
      PhoneControlService.stop(context)
      val revoked = storage.paired && runCatching {
        val request = Request.Builder()
          .url(selfUrl(storage.endpoint))
          .apply { parseHeaders(storage.headers).forEach { (name, value) -> header(name, value) } }
          .header("Authorization", "Bearer ${storage.token}")
          .delete()
          .build()
        OkHttpClient.Builder().callTimeout(15, TimeUnit.SECONDS).build()
          .newCall(request).execute().use { it.code == 204 || it.code == 401 }
      }.getOrDefault(false)
      storage.clear()
      revoked
    }

    AsyncFunction("openAccessibilitySettings") {
      context().startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }

    AsyncFunction("requestTermuxPermission") {
      val activity = appContext.currentActivity ?: throw IllegalStateException("Open Atlas first")
      if (!TermuxShell.allowed(activity)) activity.requestPermissions(arrayOf(TermuxShell.PERMISSION), 7303)
    }

    AsyncFunction("openNotificationSettings") {
      context().startActivity(
        Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
      )
    }

    AsyncFunction("requestDeeperCommands") {
      val activity = appContext.currentActivity ?: throw IllegalStateException("Open Atlas first")
      PrivilegedShell.request(activity)
    }
  }

  private fun context(): Context = appContext.reactContext
    ?: throw IllegalStateException("Android application context is unavailable")
}
