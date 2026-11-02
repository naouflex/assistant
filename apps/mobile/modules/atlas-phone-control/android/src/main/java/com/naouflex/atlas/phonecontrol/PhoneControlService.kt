package com.naouflex.atlas.phonecontrol

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import java.util.concurrent.Executors
import java.util.concurrent.Future
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit

/**
 * Holds the phone's connection to the Atlas server while the user has control on. The
 * notification stays up the whole time and its Turn off action stops everything; so does the
 * idle timer and a revoked pairing.
 */
class PhoneControlService : Service() {
  private val main = Handler(Looper.getMainLooper())
  private val client = OkHttpClient.Builder()
    .pingInterval(30, TimeUnit.SECONDS)
    .readTimeout(0, TimeUnit.MILLISECONDS)
    .build()
  private val worker = Executors.newSingleThreadExecutor()
  private val beats = Executors.newSingleThreadScheduledExecutor()
  private var socket: WebSocket? = null
  private var attempt = 0
  private var stopping = false
  private var current: Pair<String, Future<*>>? = null

  @Volatile
  private var lastActivity = SystemClock.elapsedRealtime()

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val storage = PhoneControlStorage(this)
    // Android requires startForeground after startForegroundService, even when turning off.
    if (!foreground() || stopping || intent?.action == ACTION_STOP || !storage.enabled || !storage.paired) {
      turnOff(storage, null)
      return START_NOT_STICKY
    }
    running = true
    touch()
    if (socket == null) connect(storage)
    main.removeCallbacks(idleCheck)
    main.postDelayed(idleCheck, IDLE_CHECK_MS)
    return START_STICKY
  }

  override fun onDestroy() {
    shutdown()
    super.onDestroy()
  }

  private val idleCheck = object : Runnable {
    override fun run() {
      val storage = PhoneControlStorage(this@PhoneControlService)
      val busy = synchronized(this@PhoneControlService) { current != null }
      if (!busy && isIdle(lastActivity, SystemClock.elapsedRealtime(), storage.idleMinutes)) {
        turnOff(storage, getString(R.string.atlas_phone_idle_off, storage.idleMinutes))
      } else {
        main.postDelayed(this, IDLE_CHECK_MS)
      }
    }
  }

  private fun touch() {
    lastActivity = SystemClock.elapsedRealtime()
  }

  private fun connect(storage: PhoneControlStorage) {
    if (stopping) return
    val request = runCatching {
      Request.Builder()
        .url(connectUrl(storage.endpoint))
        .apply { parseHeaders(storage.headers).forEach { (name, value) -> header(name, value) } }
        .header("Authorization", "Bearer ${storage.token}")
        .build()
    }.getOrElse {
      turnOff(storage, null)
      return
    }
    socket = client.newWebSocket(request, listener)
  }

  private val listener = object : WebSocketListener() {
    override fun onOpen(webSocket: WebSocket, response: Response) {
      main.post {
        if (webSocket != socket) return@post
        attempt = 0
        connected = true
        notifyStatus()
      }
    }

    override fun onMessage(webSocket: WebSocket, text: String) {
      when (val message = parseServerMessage(text)) {
        is ServerMessage.Request -> handle(webSocket, message)
        is ServerMessage.Cancel -> cancel(message.id)
        is ServerMessage.Refused -> webSocket.send(errorFrame(message.id, "This is a phone, not a computer."))
        ServerMessage.Revoked -> main.post { revoked() }
        ServerMessage.Unknown -> Unit
      }
    }

    override fun onClosed(webSocket: WebSocket, code: Int, reason: String) = lost(webSocket, null)

    override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) =
      lost(webSocket, response?.code)
  }

  private fun lost(webSocket: WebSocket, status: Int?) {
    main.post {
      if (webSocket != socket) return@post
      socket = null
      connected = false
      cancelCurrent()
      if (stopping) return@post
      if (status == 401) {
        revoked()
        return@post
      }
      notifyStatus()
      main.postDelayed({
        if (!stopping && socket == null) connect(PhoneControlStorage(this))
      }, reconnectDelayMs(attempt++))
    }
  }

  private fun handle(webSocket: WebSocket, message: ServerMessage.Request) {
    touch()
    synchronized(this) {
      if (current != null) {
        webSocket.send(errorFrame(message.id, "The phone is busy with another action."))
        return
      }
      var beat: ScheduledFuture<*>? = null
      val future = worker.submit {
        beat = beats.scheduleWithFixedDelay(
          { webSocket.send(heartbeatFrame(message.id)) },
          10,
          10,
          TimeUnit.SECONDS,
        )
        try {
          val value = PhoneActions.perform(this@PhoneControlService, message.action)
          if (!Thread.currentThread().isInterrupted) {
            webSocket.send(valueFrame(message.id, value))
            webSocket.send(doneFrame(message.id))
          }
        } catch (_: InterruptedException) {
          // Cancelled; the server already gave up on it.
        } catch (error: Throwable) {
          Log.w(TAG, "Phone action failed: ${error.javaClass.simpleName}")
          webSocket.send(errorFrame(message.id, error.message ?: "The phone could not do that."))
        } finally {
          beat?.cancel(false)
          touch()
          synchronized(this@PhoneControlService) { if (current?.first == message.id) current = null }
        }
      }
      current = message.id to future
    }
  }

  private fun cancel(id: String) = synchronized(this) {
    if (current?.first == id) cancelCurrent()
  }

  private fun cancelCurrent() = synchronized(this) {
    current?.second?.cancel(true)
    current = null
  }

  private fun revoked() {
    val storage = PhoneControlStorage(this)
    storage.clear()
    turnOff(storage, getString(R.string.atlas_phone_revoked))
  }

  private fun turnOff(storage: PhoneControlStorage, notice: String?) {
    storage.enabled = false
    shutdown()
    if (notice != null) postNotice(notice)
    stopForegroundCompat()
    stopSelf()
  }

  private fun shutdown() {
    stopping = true
    running = false
    connected = false
    main.removeCallbacksAndMessages(null)
    cancelCurrent()
    socket?.close(1000, null)
    socket = null
    worker.shutdownNow()
    beats.shutdownNow()
  }

  private fun foreground(): Boolean = runCatching {
    createChannel()
    val notification = statusNotification()
    if (Build.VERSION.SDK_INT >= 34) {
      startForeground(STATUS_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
    } else {
      startForeground(STATUS_ID, notification)
    }
  }.onFailure { Log.w(TAG, "Could not start phone control: ${it.javaClass.simpleName}") }.isSuccess

  private fun stopForegroundCompat() {
    if (Build.VERSION.SDK_INT >= 24) stopForeground(STOP_FOREGROUND_REMOVE) else {
      @Suppress("DEPRECATION")
      stopForeground(true)
    }
  }

  private fun notifyStatus() {
    if (!stopping) getSystemService(NotificationManager::class.java).notify(STATUS_ID, statusNotification())
  }

  private fun statusNotification(): Notification {
    val minutes = PhoneControlStorage(this).idleMinutes
    val turnOff = PendingIntent.getService(
      this,
      0,
      Intent(this, PhoneControlService::class.java).setAction(ACTION_STOP),
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
    return builder()
      .setContentTitle(getString(R.string.atlas_phone_on_title))
      .setContentText(
        if (connected) getString(R.string.atlas_phone_connected, minutes) else getString(R.string.atlas_phone_connecting),
      )
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setCategory(Notification.CATEGORY_SERVICE)
      .addAction(Notification.Action.Builder(null, getString(R.string.atlas_phone_turn_off), turnOff).build())
      .build()
  }

  private fun postNotice(text: String) {
    createChannel()
    getSystemService(NotificationManager::class.java).notify(
      NOTICE_ID,
      builder().setContentTitle(getString(R.string.atlas_phone_channel)).setContentText(text).setAutoCancel(true).build(),
    )
  }

  private fun builder(): Notification.Builder {
    val open = packageManager.getLaunchIntentForPackage(packageName)?.let {
      PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_IMMUTABLE)
    }
    val builder = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, CHANNEL) else {
      @Suppress("DEPRECATION")
      Notification.Builder(this)
    }
    return builder.setSmallIcon(R.drawable.ic_atlas_phone_control).setContentIntent(open)
  }

  private fun createChannel() {
    if (Build.VERSION.SDK_INT < 26) return
    getSystemService(NotificationManager::class.java).createNotificationChannel(
      NotificationChannel(CHANNEL, getString(R.string.atlas_phone_channel), NotificationManager.IMPORTANCE_LOW),
    )
  }

  companion object {
    private const val TAG = "AtlasPhoneControl"
    private const val ACTION_STOP = "com.naouflex.atlas.phonecontrol.STOP"
    private const val CHANNEL = "atlas_phone_control"
    private const val STATUS_ID = 7301
    private const val NOTICE_ID = 7302
    private const val IDLE_CHECK_MS = 30_000L

    @Volatile
    var running = false
      private set

    @Volatile
    var connected = false
      private set

    fun start(context: Context) {
      val intent = Intent(context, PhoneControlService::class.java)
      if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent) else context.startService(intent)
    }

    fun stop(context: Context) {
      context.stopService(Intent(context, PhoneControlService::class.java))
    }
  }
}
