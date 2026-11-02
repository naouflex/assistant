package com.naouflex.atlas.phonecontrol

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/** Brings the connection back after a reboot, an app update, or the accessibility service rebinding. */
internal object PhoneControlWake {
  fun resume(context: Context) {
    if (PhoneControlService.running) return
    val storage = PhoneControlStorage(context)
    if (!storage.enabled || !storage.paired) return
    try {
      PhoneControlService.start(context)
    } catch (error: RuntimeException) {
      // Android can refuse a background start; the switch in the app starts it again.
      Log.w("AtlasPhoneControl", "Could not resume phone control", error)
    }
  }
}

class PhoneControlBootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    when (intent.action) {
      Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_MY_PACKAGE_REPLACED -> PhoneControlWake.resume(context)
    }
  }
}
