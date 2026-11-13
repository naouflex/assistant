package com.naouflex.atlas.notifications

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.drawable.Icon
import android.media.MediaMetadata
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.os.Build
import android.os.IBinder

/**
 * Keeps a reply being read aloud playing when the app leaves the screen: a media-playback
 * foreground service with a notification and Stop button, plus a media session so headset
 * buttons and the lock screen can stop it too. The app starts it when speech begins and stops
 * it when speech ends; Stop here asks the app to cut the speech, which then stops the service.
 */
class AtlasPlaybackService : Service() {
  private var session: MediaSession? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_STOP) {
      requestStop()
      return START_NOT_STICKY
    }
    val title = intent?.getStringExtra(EXTRA_TITLE)?.takeIf(String::isNotBlank)
      ?: getString(R.string.atlas_playback_title)
    createChannel()
    val mediaSession = session ?: createSession().also { session = it }
    mediaSession.setMetadata(
      MediaMetadata.Builder()
        .putString(MediaMetadata.METADATA_KEY_TITLE, title)
        .putString(MediaMetadata.METADATA_KEY_ARTIST, getString(R.string.atlas_playback_text))
        .build(),
    )
    try {
      startForegroundCompat(title, mediaSession)
    } catch (_: Exception) {
      report(started = false)
      stopSelf()
      return START_NOT_STICKY
    }
    report(started = true)
    return START_NOT_STICKY
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onDestroy() {
    session?.run {
      isActive = false
      release()
    }
    session = null
    stopForeground(STOP_FOREGROUND_REMOVE)
    super.onDestroy()
  }

  private fun requestStop() {
    val listener = onStopRequested
    if (listener != null) {
      listener()
    } else {
      // Nobody is listening (the app's JS is gone): there is nothing left to stop but us.
      stopSelf()
    }
  }

  private fun createSession(): MediaSession =
    MediaSession(this, "AtlasPlayback").apply {
      setCallback(
        object : MediaSession.Callback() {
          override fun onStop() = requestStop()

          override fun onPause() = requestStop()
        },
      )
      setPlaybackState(
        PlaybackState.Builder()
          .setActions(PlaybackState.ACTION_STOP or PlaybackState.ACTION_PAUSE or PlaybackState.ACTION_PLAY_PAUSE)
          .setState(PlaybackState.STATE_PLAYING, PlaybackState.PLAYBACK_POSITION_UNKNOWN, 1f)
          .build(),
      )
      isActive = true
    }

  private fun startForegroundCompat(title: String, mediaSession: MediaSession) {
    val stop = Notification.Action.Builder(
      Icon.createWithResource(this, android.R.drawable.ic_menu_close_clear_cancel),
      getString(R.string.atlas_playback_stop),
      stopIntent(),
    ).build()
    val notification = builder()
      .setSmallIcon(R.drawable.ic_atlas_notification)
      .setContentTitle(title)
      .setContentText(getString(R.string.atlas_playback_text))
      .setContentIntent(openApp())
      .setDeleteIntent(stopIntent())
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setCategory(Notification.CATEGORY_TRANSPORT)
      .setVisibility(Notification.VISIBILITY_PUBLIC)
      .addAction(stop)
      .setStyle(
        Notification.MediaStyle()
          .setMediaSession(mediaSession.sessionToken)
          .setShowActionsInCompactView(0),
      )
      .build()
    if (Build.VERSION.SDK_INT >= 29) {
      startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
  }

  @Suppress("DEPRECATION")
  private fun builder(): Notification.Builder =
    if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, CHANNEL_ID)
    else Notification.Builder(this)

  private fun stopIntent(): PendingIntent =
    PendingIntent.getService(
      this,
      1,
      Intent(this, AtlasPlaybackService::class.java).setAction(ACTION_STOP),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

  private fun openApp(): PendingIntent {
    val intent = packageManager.getLaunchIntentForPackage(packageName)
      ?: Intent(Intent.ACTION_VIEW, android.net.Uri.parse("atlas://"))
    intent.flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
    return PendingIntent.getActivity(
      this,
      0,
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }

  private fun createChannel() {
    if (Build.VERSION.SDK_INT < 26) return
    val manager = getSystemService(NotificationManager::class.java)
    manager.createNotificationChannel(
      NotificationChannel(CHANNEL_ID, getString(R.string.atlas_playback_channel), NotificationManager.IMPORTANCE_LOW),
    )
  }

  private fun report(started: Boolean) {
    val pending = pendingStart
    pendingStart = null
    pending?.invoke(started)
  }

  companion object {
    private const val CHANNEL_ID = "atlas_playback"
    private const val NOTIFICATION_ID = 1103
    private const val EXTRA_TITLE = "com.naouflex.atlas.notifications.PLAYBACK_TITLE"
    private const val ACTION_STOP = "com.naouflex.atlas.notifications.PLAYBACK_STOP"

    /** Answers the start request that is still waiting for [onStartCommand]. */
    private var pendingStart: ((Boolean) -> Unit)? = null

    /** Set by the JS bridge: the user asked to stop from the notification or a media button. */
    var onStopRequested: (() -> Unit)? = null

    fun start(context: Context, title: String, onResult: (Boolean) -> Unit) {
      pendingStart?.invoke(false)
      pendingStart = onResult
      val intent = Intent(context, AtlasPlaybackService::class.java).putExtra(EXTRA_TITLE, title)
      // Android 12+ refuses a foreground start from the background; speech then simply ends
      // when the app is frozen, as before.
      val queued = runCatching {
        if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent)
        else context.startService(intent)
        true
      }.getOrDefault(false)
      if (!queued) {
        pendingStart = null
        onResult(false)
      }
    }

    fun stop(context: Context) {
      pendingStart?.invoke(false)
      pendingStart = null
      context.stopService(Intent(context, AtlasPlaybackService::class.java))
    }
  }
}
