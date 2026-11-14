package com.naouflex.atlas.notifications

import android.app.Activity
import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.Gravity
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import org.json.JSONArray
import org.json.JSONObject
import java.text.DateFormat
import java.util.Date

/**
 * A reminder or wake-up a bot scheduled, copied onto the phone so it goes off at its time even
 * when no push arrives. A wake-up rings like an alarm clock until dismissed or snoozed.
 */
data class AtlasAlarm(
  val id: String,
  val atMs: Long,
  val title: String,
  val body: String,
  val wake: Boolean,
  /** Set on a snooze the user asked for here, which a sync from the server keeps. */
  val snoozed: Boolean = false,
) {
  fun toJson(): JSONObject = JSONObject()
    .put("id", id).put("atMs", atMs).put("title", title).put("body", body)
    .put("wake", wake).put("snoozed", snoozed)

  fun toMap(): Map<String, Any> =
    mapOf("id" to id, "atMs" to atMs.toDouble(), "title" to title, "body" to body, "wake" to wake, "snoozed" to snoozed)

  companion object {
    fun fromJson(json: JSONObject) = AtlasAlarm(
      json.getString("id"), json.getLong("atMs"), json.optString("title"), json.optString("body"),
      json.optBoolean("wake"), json.optBoolean("snoozed"),
    )

    fun fromMap(map: Map<String, Any?>): AtlasAlarm? {
      val id = map["id"] as? String ?: return null
      val at = (map["atMs"] as? Number)?.toLong() ?: return null
      return AtlasAlarm(id, at, map["title"] as? String ?: "", map["body"] as? String ?: "", map["wake"] == true)
    }
  }
}

object AtlasAlarmStore {
  private const val PREFS = "atlas_alarms"
  private const val KEY = "alarms"

  fun all(context: Context): List<AtlasAlarm> {
    val raw = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, null) ?: return emptyList()
    return runCatching {
      val array = JSONArray(raw)
      (0 until array.length()).map { AtlasAlarm.fromJson(array.getJSONObject(it)) }
    }.getOrDefault(emptyList())
  }

  fun save(context: Context, alarms: List<AtlasAlarm>) {
    val array = JSONArray().apply { alarms.forEach { put(it.toJson()) } }
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, array.toString()).apply()
  }
}

object AtlasAlarmScheduler {
  const val ACTION_FIRE = "com.naouflex.atlas.alarms.FIRE"
  const val ACTION_DISMISS = "com.naouflex.atlas.alarms.DISMISS"
  const val ACTION_SNOOZE = "com.naouflex.atlas.alarms.SNOOZE"
  const val EXTRA_ID = "com.naouflex.atlas.alarms.ID"
  const val ALARM_CHANNEL = "atlas_alarm"
  const val REMINDER_CHANNEL = "atlas_reminder"
  const val SNOOZE_MS = 10 * 60_000L
  /** A wake-up that nobody answers stops ringing after this long. */
  const val RING_MS = 10 * 60_000L

  /** Replaces the alarms copied from the server; snoozes set on this phone stay. */
  fun replace(context: Context, alarms: List<AtlasAlarm>) {
    val now = System.currentTimeMillis()
    val old = AtlasAlarmStore.all(context)
    old.forEach { cancel(context, it) }
    val snoozes = old.filter { it.snoozed && it.atMs > now }
    val next = alarms.filter { it.atMs > now }.distinctBy { it.id } + snoozes.filter { s -> alarms.none { it.id == s.id } }
    AtlasAlarmStore.save(context, next)
    next.forEach { schedule(context, it) }
  }

  /** After a reboot, an update or a clock change the system forgets alarms, so they are set again. */
  fun restore(context: Context) {
    val now = System.currentTimeMillis()
    val keep = AtlasAlarmStore.all(context).filter { it.atMs > now }
    AtlasAlarmStore.save(context, keep)
    keep.forEach { schedule(context, it) }
  }

  fun canScheduleExact(context: Context): Boolean =
    Build.VERSION.SDK_INT < 31 || context.getSystemService(AlarmManager::class.java).canScheduleExactAlarms()

  private fun schedule(context: Context, alarm: AtlasAlarm) {
    val manager = context.getSystemService(AlarmManager::class.java)
    val fire = firePending(context, alarm.id)
    try {
      when {
        // Shown as the next alarm in the status bar and never deferred by Doze.
        canScheduleExact(context) && alarm.wake ->
          manager.setAlarmClock(AlarmManager.AlarmClockInfo(alarm.atMs, openApp(context)), fire)
        canScheduleExact(context) -> manager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, alarm.atMs, fire)
        else -> manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, alarm.atMs, fire)
      }
    } catch (_: SecurityException) {
      manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, alarm.atMs, fire)
    }
  }

  private fun cancel(context: Context, alarm: AtlasAlarm) {
    context.getSystemService(AlarmManager::class.java).cancel(firePending(context, alarm.id))
  }

  private fun firePending(context: Context, id: String): PendingIntent = PendingIntent.getBroadcast(
    context,
    id.hashCode(),
    Intent(context, AtlasAlarmReceiver::class.java).setAction(ACTION_FIRE).putExtra(EXTRA_ID, id),
    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
  )

  fun actionPending(context: Context, action: String, id: String): PendingIntent = PendingIntent.getBroadcast(
    context,
    (action + id).hashCode(),
    Intent(context, AtlasAlarmReceiver::class.java).setAction(action).putExtra(EXTRA_ID, id),
    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
  )

  fun openApp(context: Context): PendingIntent {
    val intent = context.packageManager.getLaunchIntentForPackage(context.packageName)
      ?: Intent(Intent.ACTION_VIEW, android.net.Uri.parse("atlas://"))
    intent.flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
    return PendingIntent.getActivity(context, 7, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  }

  fun fire(context: Context, id: String) {
    val alarms = AtlasAlarmStore.all(context)
    val alarm = alarms.firstOrNull { it.id == id } ?: return
    AtlasAlarmStore.save(context, alarms.filter { it.id != id })
    // A phone that was off at the time doesn't ring for a wake-up long past.
    if (System.currentTimeMillis() - alarm.atMs > RING_MS) return
    createChannels(context)
    val manager = context.getSystemService(NotificationManager::class.java)
    val builder = builder(context, if (alarm.wake) ALARM_CHANNEL else REMINDER_CHANNEL)
      .setSmallIcon(R.drawable.ic_atlas_notification)
      .setContentTitle(alarm.title)
      .setContentText(alarm.body)
      .setStyle(Notification.BigTextStyle().bigText(alarm.body))
      .setContentIntent(openApp(context))
      .setWhen(alarm.atMs)
      .setShowWhen(true)
    if (alarm.wake) {
      val ring = PendingIntent.getActivity(
        context,
        id.hashCode(),
        Intent(context, AtlasAlarmActivity::class.java)
          .putExtra(EXTRA_ID, id)
          .putExtra("title", alarm.title)
          .putExtra("body", alarm.body)
          .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_NO_USER_ACTION),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
      builder
        .setCategory(Notification.CATEGORY_ALARM)
        .setFullScreenIntent(ring, true)
        .setOngoing(true)
        .setAutoCancel(false)
      if (Build.VERSION.SDK_INT >= 26) builder.setTimeoutAfter(RING_MS)
      builder
        .addAction(Notification.Action.Builder(null, context.getString(R.string.atlas_alarm_snooze), actionPending(context, ACTION_SNOOZE, id)).build())
        .addAction(Notification.Action.Builder(null, context.getString(R.string.atlas_alarm_dismiss), actionPending(context, ACTION_DISMISS, id)).build())
      val notification = builder.build()
      // Rings until it is answered, like an alarm clock.
      notification.flags = notification.flags or Notification.FLAG_INSISTENT
      manager.notify(id.hashCode(), notification)
    } else {
      builder.setCategory(Notification.CATEGORY_REMINDER).setAutoCancel(true)
      manager.notify(id.hashCode(), builder.build())
    }
  }

  fun dismiss(context: Context, id: String) {
    context.getSystemService(NotificationManager::class.java).cancel(id.hashCode())
  }

  fun snooze(context: Context, id: String, title: String, body: String) {
    dismiss(context, id)
    val alarm = AtlasAlarm("$id~snooze", System.currentTimeMillis() + SNOOZE_MS, title, body, wake = true, snoozed = true)
    AtlasAlarmStore.save(context, AtlasAlarmStore.all(context).filter { it.id != alarm.id } + alarm)
    schedule(context, alarm)
  }

  private fun createChannels(context: Context) {
    if (Build.VERSION.SDK_INT < 26) return
    val manager = context.getSystemService(NotificationManager::class.java)
    val alarmSound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
      ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
    manager.createNotificationChannel(
      NotificationChannel(ALARM_CHANNEL, context.getString(R.string.atlas_alarm_channel), NotificationManager.IMPORTANCE_HIGH).apply {
        setSound(alarmSound, AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build())
        enableVibration(true)
        vibrationPattern = longArrayOf(0, 800, 600, 800, 600)
        lockscreenVisibility = Notification.VISIBILITY_PUBLIC
      },
    )
    manager.createNotificationChannel(
      NotificationChannel(REMINDER_CHANNEL, context.getString(R.string.atlas_reminder_channel), NotificationManager.IMPORTANCE_HIGH).apply {
        enableVibration(true)
      },
    )
  }

  @Suppress("DEPRECATION")
  private fun builder(context: Context, channel: String): Notification.Builder =
    if (Build.VERSION.SDK_INT >= 26) Notification.Builder(context, channel) else Notification.Builder(context)

  fun exactAlarmSettings(context: Context): Intent =
    if (Build.VERSION.SDK_INT >= 31) {
      Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, android.net.Uri.parse("package:${context.packageName}"))
    } else {
      Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, android.net.Uri.parse("package:${context.packageName}"))
    }.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

  fun canUseFullScreen(context: Context): Boolean =
    Build.VERSION.SDK_INT < 34 || context.getSystemService(NotificationManager::class.java).canUseFullScreenIntent()

  fun fullScreenSettings(context: Context): Intent =
    if (Build.VERSION.SDK_INT >= 34) {
      Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, android.net.Uri.parse("package:${context.packageName}"))
    } else {
      Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
    }.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
}

class AtlasAlarmReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val id = intent.getStringExtra(AtlasAlarmScheduler.EXTRA_ID)
    when (intent.action) {
      AtlasAlarmScheduler.ACTION_FIRE -> id?.let { AtlasAlarmScheduler.fire(context, it) }
      AtlasAlarmScheduler.ACTION_DISMISS -> id?.let { AtlasAlarmScheduler.dismiss(context, it) }
      AtlasAlarmScheduler.ACTION_SNOOZE -> id?.let { snoozeFromNotification(context, it) }
      else -> AtlasAlarmScheduler.restore(context)
    }
  }

  private fun snoozeFromNotification(context: Context, id: String) {
    val shown = context.getSystemService(NotificationManager::class.java).activeNotifications
      .firstOrNull { it.id == id.hashCode() }?.notification?.extras
    AtlasAlarmScheduler.snooze(
      context,
      id.removeSuffix("~snooze"),
      shown?.getCharSequence(Notification.EXTRA_TITLE)?.toString() ?: "",
      shown?.getCharSequence(Notification.EXTRA_TEXT)?.toString() ?: "",
    )
  }
}

/** The full-screen alarm shown over the lock screen when a wake-up goes off. */
class AtlasAlarmActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    if (Build.VERSION.SDK_INT >= 27) {
      setShowWhenLocked(true)
      setTurnScreenOn(true)
    } else {
      @Suppress("DEPRECATION")
      window.addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON)
    }
    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    val id = intent.getStringExtra(AtlasAlarmScheduler.EXTRA_ID) ?: run { finish(); return }
    val title = intent.getStringExtra("title") ?: ""
    val body = intent.getStringExtra("body") ?: ""
    val density = resources.displayMetrics.density
    fun px(dp: Int) = (dp * density).toInt()
    val root = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      gravity = Gravity.CENTER
      setBackgroundColor(Color.rgb(20, 20, 20))
      setPadding(px(32), px(48), px(32), px(48))
    }
    root.addView(TextView(this).apply {
      text = DateFormat.getTimeInstance(DateFormat.SHORT).format(Date())
      textSize = 64f
      setTextColor(Color.WHITE)
      gravity = Gravity.CENTER
    })
    root.addView(TextView(this).apply {
      text = title
      textSize = 24f
      setTextColor(Color.WHITE)
      gravity = Gravity.CENTER
      setPadding(0, px(16), 0, px(8))
    })
    root.addView(TextView(this).apply {
      text = body
      textSize = 16f
      setTextColor(Color.rgb(200, 200, 200))
      gravity = Gravity.CENTER
      maxLines = 6
      setPadding(0, 0, 0, px(40))
    })
    val buttons = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER }
    buttons.addView(Button(this).apply {
      text = getString(R.string.atlas_alarm_snooze)
      setOnClickListener {
        AtlasAlarmScheduler.snooze(this@AtlasAlarmActivity, id.removeSuffix("~snooze"), title, body)
        finish()
      }
    }, LinearLayout.LayoutParams(0, px(64), 1f).apply { marginEnd = px(12) })
    buttons.addView(Button(this).apply {
      text = getString(R.string.atlas_alarm_dismiss)
      setOnClickListener {
        AtlasAlarmScheduler.dismiss(this@AtlasAlarmActivity, id)
        finish()
      }
    }, LinearLayout.LayoutParams(0, px(64), 1f))
    root.addView(buttons, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
    setContentView(root)
  }
}
