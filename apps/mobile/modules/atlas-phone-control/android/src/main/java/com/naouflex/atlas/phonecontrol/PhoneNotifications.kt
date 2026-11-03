package com.naouflex.atlas.phonecontrol

import android.app.Notification
import android.app.RemoteInput
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import org.json.JSONObject

/** Reads and acts on the phone's notifications. The user turns this on in notification access. */
internal object PhoneNotifications {
  fun allowed(context: Context): Boolean {
    val enabled = Settings.Secure.getString(context.contentResolver, "enabled_notification_listeners")
      ?: return false
    val mine = ComponentName(context, AtlasNotificationListener::class.java).flattenToString()
    return enabled.split(":").any { it.equals(mine, ignoreCase = true) }
  }

  fun perform(context: Context, action: JSONObject): JSONObject {
    val verb = action.optString("verb").ifBlank { "list" }
    val key = action.optString("key")
    val button = action.optString("button")
    notificationTargetProblem(verb, key, button)?.let { throw IllegalArgumentException(it) }
    val service = listener(context)
    return when (verb) {
      "list" -> notificationList(service.activeNotifications?.mapNotNull { row(context, it) }.orEmpty())
      "open" -> {
        val posted = find(service, key)
        val intent = posted.notification.contentIntent
          ?: throw IllegalStateException("That notification does not open anything.")
        intent.send()
        JSONObject().put("done", "opened")
      }
      "dismiss" -> {
        find(service, key)
        service.cancelNotification(key)
        JSONObject().put("done", "dismissed")
      }
      "activate" -> {
        val posted = find(service, key)
        val chosen = posted.notification.actions?.firstOrNull {
          it.title?.toString()?.trim().equals(button.trim(), ignoreCase = true)
        } ?: throw IllegalArgumentException("No button named \"$button\" is on that notification.")
        sendAction(context, chosen, action.optString("text").takeIf { action.has("text") && !action.isNull("text") })
        JSONObject().put("done", "activated")
      }
      else -> throw IllegalArgumentException("Unknown notification action.")
    }
  }

  private fun listener(context: Context): AtlasNotificationListener {
    AtlasNotificationListener.instance?.let { return it }
    if (allowed(context) && Build.VERSION.SDK_INT >= 24) {
      NotificationListenerService.requestRebind(ComponentName(context, AtlasNotificationListener::class.java))
      throw IllegalStateException("Notification access is on. Try again in a moment.")
    }
    throw IllegalStateException("Turn on notification access for Atlas in Phone control.")
  }

  private fun find(service: AtlasNotificationListener, key: String): StatusBarNotification =
    service.activeNotifications?.firstOrNull { it.key == key }
      ?: throw IllegalArgumentException("That notification is gone. List them again.")

  private fun row(context: Context, posted: StatusBarNotification): JSONObject? {
    if (posted.packageName == context.packageName) return null
    val extras = posted.notification.extras
    val title = clipNotificationText(extras?.getCharSequence(Notification.EXTRA_TITLE)?.toString().orEmpty(), 200)
    val text = clipNotificationText(notificationText(extras), 500)
    val actions = buildList {
      for (action in posted.notification.actions.orEmpty()) {
        if (size >= 8) break
        val label = action.title?.toString()?.trim().orEmpty()
        if (label.isNotEmpty()) add(clipNotificationText(label, 80))
      }
    }
    if (title.isEmpty() && text.isEmpty() && actions.isEmpty()) return null
    return notificationRow(posted.key, posted.packageName, appLabel(context, posted.packageName), title, text, posted.postTime, posted.isOngoing, actions)
  }

  private fun appLabel(context: Context, packageName: String): String =
    runCatching { context.packageManager.getApplicationLabel(context.packageManager.getApplicationInfo(packageName, 0)).toString() }
      .getOrDefault(packageName)

  private fun sendAction(context: Context, action: Notification.Action, text: String?) {
    val inputs = action.remoteInputs
    val pending = action.actionIntent ?: throw IllegalStateException("That button cannot be pressed.")
    if (inputs.isNullOrEmpty()) {
      pending.send()
      return
    }
    if (text == null) throw IllegalArgumentException("That button needs text.")
    val filled = Bundle()
    val intent = Intent()
    for (input in inputs) filled.putCharSequence(input.resultKey, text)
    RemoteInput.addResultsToIntent(inputs, intent, filled)
    pending.send(context, 0, intent)
  }

  private fun notificationText(extras: Bundle?): String {
    if (extras == null) return ""
    val plain = extras.getCharSequence(Notification.EXTRA_TEXT)?.toString()?.trim().orEmpty()
    if (plain.isNotEmpty()) return plain
    val big = extras.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString()?.trim().orEmpty()
    if (big.isNotEmpty()) return big
    val messages = if (Build.VERSION.SDK_INT >= 33) {
      extras.getParcelableArray(Notification.EXTRA_MESSAGES, Bundle::class.java)
    } else {
      @Suppress("DEPRECATION")
      extras.getParcelableArray(Notification.EXTRA_MESSAGES)
    } ?: return ""
    val last = messages.lastOrNull() as? Bundle ?: return ""
    return last.getCharSequence("text")?.toString().orEmpty()
  }
}
