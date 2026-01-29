package com.menufaz.tabletpdv

import android.content.Context

object PdvPrefs {
  private const val PREFS = "menufaz_tablet_pdv"
  private const val KEY_SLUG = "slug"
  private const val KEY_MESA = "mesa"
  private const val KEY_URL = "url_final"
  private const val KEY_PIN = "admin_pin"
  private const val KEY_DEVICE_ID = "device_id"

  fun load(context: Context): PdvConfig? {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val slug = prefs.getString(KEY_SLUG, null) ?: return null
    val mesa = prefs.getString(KEY_MESA, null) ?: return null
    val url = prefs.getString(KEY_URL, null) ?: return null
    val pin = prefs.getString(KEY_PIN, "") ?: ""
    return PdvConfig(slug, mesa, url, pin)
  }

  fun save(context: Context, config: PdvConfig) {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    prefs.edit()
      .putString(KEY_SLUG, config.slug)
      .putString(KEY_MESA, config.mesa)
      .putString(KEY_URL, config.urlFinal)
      .putString(KEY_PIN, config.adminPin)
      .apply()
  }

  fun clear(context: Context) {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    prefs.edit().clear().apply()
  }

  fun getOrCreateDeviceId(context: Context): String {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val existing = prefs.getString(KEY_DEVICE_ID, null)
    if (!existing.isNullOrBlank()) return existing
    val generated = "tab-${System.currentTimeMillis().toString(36)}-${kotlin.random.Random.nextLong().toString(36)}"
    prefs.edit().putString(KEY_DEVICE_ID, generated).apply()
    return generated
  }
}
