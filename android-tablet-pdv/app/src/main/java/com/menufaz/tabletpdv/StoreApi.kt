package com.menufaz.tabletpdv

import org.json.JSONArray
import org.json.JSONObject
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

  fun claimTablet(token: String, deviceId: String, deviceLabel: String): Boolean {
    val payload = JSONObject()
      .put("token", token)
      .put("deviceId", deviceId)
      .put("deviceLabel", deviceLabel)
    val postOk = try {
      val connection = (URL("$BASE_URL/api/tablets/claim").openConnection() as HttpURLConnection).apply {
        connectTimeout = 10000
        readTimeout = 15000
        requestMethod = "POST"
        setRequestProperty("Content-Type", "application/json")
        doOutput = true
      }
      connection.outputStream.use { it.write(payload.toString().toByteArray()) }
      val ok = connection.responseCode in 200..299
      connection.disconnect()
      ok
    } catch (_: Exception) {
      false
    }

    if (postOk) return true

    return try {
      val query = "token=${java.net.URLEncoder.encode(token, "UTF-8")}" +
        "&deviceId=${java.net.URLEncoder.encode(deviceId, "UTF-8")}" +
        "&deviceLabel=${java.net.URLEncoder.encode(deviceLabel, "UTF-8")}"
      val connection = (URL("$BASE_URL/api/tablets/claim?$query").openConnection() as HttpURLConnection).apply {
        connectTimeout = 10000
        readTimeout = 15000
        requestMethod = "GET"
      }
      val ok = connection.responseCode in 200..299
      connection.disconnect()
      ok
    } catch (_: Exception) {
      false
    }
  }
}
