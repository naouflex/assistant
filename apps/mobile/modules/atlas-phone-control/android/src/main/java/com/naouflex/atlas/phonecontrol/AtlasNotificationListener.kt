package com.naouflex.atlas.phonecontrol

import android.service.notification.NotificationListenerService

/** Holds notification access. It does nothing until Phone control asks it to. */
class AtlasNotificationListener : NotificationListenerService() {
  override fun onListenerConnected() {
    instance = this
  }

  override fun onListenerDisconnected() {
    if (instance === this) instance = null
  }

  override fun onDestroy() {
    if (instance === this) instance = null
    super.onDestroy()
  }

  companion object {
    @Volatile
    var instance: AtlasNotificationListener? = null
  }
}
