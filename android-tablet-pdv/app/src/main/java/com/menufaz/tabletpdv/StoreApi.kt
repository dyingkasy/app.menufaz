package com.menufaz.tabletpdv

import org.json.JSONArray
import java.net.HttpURLConnection
import java.net.URL

object StoreApi {
  private const val BASE_URL = "https://app.menufaz.com"

  fun fetchAdminPin(slug: String): String {
    val connection = (URL("$BASE_URL/api/stores").openConnection() as HttpURLConnection).apply {
      connectTimeout = 10000
      readTimeout = 15000
      requestMethod = "GET"
    }

    return try {
      if (connection.responseCode !in 200..299) return ""
      val body = connection.inputStream.bufferedReader().use { it.readText() }
      val stores = JSONArray(body)
      val target = UrlUtils.normalizeSlug(slug)

      for (i in 0 until stores.length()) {
        val store = stores.getJSONObject(i)
        val custom = store.optString("customUrl")
        val name = store.optString("name")
        val id = store.optString("id")
        val normalized = when {
          custom.isNotBlank() -> UrlUtils.normalizeSlug(custom)
          name.isNotBlank() -> UrlUtils.normalizeSlug(name)
          else -> UrlUtils.normalizeSlug(id)
        }
        if (normalized == target) {
          return store.optString("adminPassword", "")
        }
      }
      ""
    } catch (_: Exception) {
      ""
    } finally {
      connection.disconnect()
    }
  }
}
