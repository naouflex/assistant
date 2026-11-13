package com.naouflex.atlas.notifications

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build
import android.os.Handler
import android.os.Looper

/**
 * Holds transient, may-duck audio focus for as long as a reply is being spoken, across every clip
 * and sentence of it. Other apps' music dips instead of playing over the voice, and a phone call
 * or an assistant taking the audio pauses the reply until it gives the audio back.
 *
 * expo-audio would request and abandon focus per clip, so music would swell back up between
 * sentences; one session-wide request here keeps it ducked for the whole reply.
 */
object AtlasSpeechFocus {
  /** "interrupted" (a call or another app took the audio for now), "resumed", or "lost". */
  var onChange: ((String) -> Unit)? = null

  private val main = Handler(Looper.getMainLooper())
  private var request: AudioFocusRequest? = null
  private var held = false

  private val listener = AudioManager.OnAudioFocusChangeListener { change ->
    when (change) {
      AudioManager.AUDIOFOCUS_LOSS_TRANSIENT -> onChange?.invoke("interrupted")
      AudioManager.AUDIOFOCUS_GAIN -> onChange?.invoke("resumed")
      AudioManager.AUDIOFOCUS_LOSS -> {
        // Another app started its own playback: the reply waits paused rather than talking over
        // it, and does not grab the audio back on its own.
        held = false
        onChange?.invoke("lost")
      }
      // Ducking for a notification sound is applied by the system on Android 8+.
      else -> Unit
    }
  }

  private fun audioManager(context: Context): AudioManager? =
    context.applicationContext.getSystemService(Context.AUDIO_SERVICE) as? AudioManager

  /**
   * "granted" to speak now, "delayed" while a call holds the audio (a "resumed" change follows
   * when it ends), or "failed" when the system refused: speech then plays without focus.
   */
  fun acquire(context: Context): String {
    if (held) return "granted"
    val manager = audioManager(context) ?: return "failed"
    val result = if (Build.VERSION.SDK_INT >= 26) {
      val next = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
        .setAudioAttributes(
          AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_MEDIA)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
            .build(),
        )
        .setOnAudioFocusChangeListener(listener, main)
        .setAcceptsDelayedFocusGain(true)
        .setWillPauseWhenDucked(false)
        .build()
      request = next
      manager.requestAudioFocus(next)
    } else {
      @Suppress("DEPRECATION")
      manager.requestAudioFocus(listener, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
    }
    return when (result) {
      AudioManager.AUDIOFOCUS_REQUEST_GRANTED -> {
        held = true
        "granted"
      }
      AudioManager.AUDIOFOCUS_REQUEST_DELAYED -> {
        held = true
        "delayed"
      }
      else -> {
        request = null
        "failed"
      }
    }
  }

  fun release(context: Context) {
    val manager = audioManager(context) ?: return
    if (Build.VERSION.SDK_INT >= 26) {
      request?.let { manager.abandonAudioFocusRequest(it) }
    } else {
      @Suppress("DEPRECATION")
      manager.abandonAudioFocus(listener)
    }
    request = null
    held = false
  }
}
