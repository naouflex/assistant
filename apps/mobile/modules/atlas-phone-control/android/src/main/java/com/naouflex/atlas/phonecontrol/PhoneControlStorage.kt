package com.naouflex.atlas.phonecontrol

import android.content.Context
import android.content.SharedPreferences
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** The phone's pairing. The device token and server headers are encrypted with a keystore key. */
internal class PhoneControlStorage(context: Context) {
  private val preferences = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)

  var enabled: Boolean
    get() = preferences.getBoolean(ENABLED, false)
    set(value) = commit { putBoolean(ENABLED, value) }

  var idleMinutes: Int
    get() = normalizeIdleMinutes(preferences.getInt(IDLE, DEFAULT_IDLE_MINUTES))
    set(value) = commit { putInt(IDLE, normalizeIdleMinutes(value)) }

  var endpoint: String
    get() = preferences.getString(ENDPOINT, "").orEmpty()
    set(value) = commit { putString(ENDPOINT, value) }

  var deviceId: String
    get() = preferences.getString(DEVICE_ID, "").orEmpty()
    set(value) = commit { putString(DEVICE_ID, value) }

  var token: String
    get() = readSecret(TOKEN)
    set(value) = writeSecret(TOKEN, value)

  var headers: String
    get() = readSecret(HEADERS)
    set(value) = writeSecret(HEADERS, value)

  val paired: Boolean get() = endpoint.isNotEmpty() && token.isNotEmpty()

  fun clear() = commit {
    remove(ENABLED)
    remove(ENDPOINT)
    remove(DEVICE_ID)
    remove(TOKEN)
    remove(HEADERS)
  }

  private fun readSecret(name: String): String {
    val encoded = preferences.getString(name, null) ?: return ""
    return runCatching {
      val bytes = Base64.decode(encoded, Base64.NO_WRAP)
      val cipher = Cipher.getInstance(TRANSFORMATION)
      cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes, 0, IV_SIZE))
      String(cipher.doFinal(bytes, IV_SIZE, bytes.size - IV_SIZE), Charsets.UTF_8)
    }.getOrElse {
      commit { remove(name) }
      ""
    }
  }

  private fun writeSecret(name: String, value: String) {
    if (value.isEmpty()) {
      commit { remove(name) }
      return
    }
    val cipher = Cipher.getInstance(TRANSFORMATION)
    cipher.init(Cipher.ENCRYPT_MODE, key())
    val encrypted = cipher.iv + cipher.doFinal(value.toByteArray(Charsets.UTF_8))
    commit { putString(name, Base64.encodeToString(encrypted, Base64.NO_WRAP)) }
  }

  private fun key(): SecretKey {
    val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    (keyStore.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
    return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").run {
      init(
        KeyGenParameterSpec.Builder(
          KEY_ALIAS,
          KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
        ).setBlockModes(KeyProperties.BLOCK_MODE_GCM)
          .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
          .setKeySize(256)
          .build(),
      )
      generateKey()
    }
  }

  private fun commit(change: SharedPreferences.Editor.() -> Unit) {
    check(preferences.edit().apply(change).commit()) { "Could not save phone control settings" }
  }

  private companion object {
    const val PREFERENCES = "com.naouflex.atlas.phonecontrol"
    const val ENABLED = "enabled"
    const val IDLE = "idle_minutes"
    const val ENDPOINT = "endpoint"
    const val DEVICE_ID = "device_id"
    const val TOKEN = "token"
    const val HEADERS = "server_headers"
    const val KEY_ALIAS = "atlas.phonecontrol.session"
    const val TRANSFORMATION = "AES/GCM/NoPadding"
    const val IV_SIZE = 12
  }
}
