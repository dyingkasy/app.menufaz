package com.menufaz.tabletpdv

import java.net.URI
import java.text.Normalizer

object UrlUtils {
  private const val HOST = "app.menufaz.com"

  data class Parsed(val slug: String, val mesa: String, val token: String?)

  fun parseQr(raw: String): Parsed? {
    return try {
      val uri = URI(raw.trim())
      val host = uri.host ?: return null
      if (host.lowercase() != HOST) return null
      val queryMap = uri.query
        ?.split("&")
        ?.mapNotNull { item ->
          val parts = item.split("=")
          if (parts.size == 2) parts[0] to parts[1] else null
        }
        ?.toMap()
        ?: emptyMap()
      val mesa = queryMap["mesa"]?.trim()?.takeIf { it.isNotEmpty() } ?: return null
      val token = queryMap["tablet_token"]?.trim()?.takeIf { it.isNotEmpty() }

      val path = (uri.path ?: "").trim('/').trim()
      if (path.isEmpty()) return null
      val slug = path.split('/').first().trim()
      if (slug.isEmpty()) return null
      Parsed(slug, mesa, token)
    } catch (_: Exception) {
      null
    }
  }

  fun buildFinalUrl(slug: String, mesa: String, token: String?, deviceId: String?): String {
    val safeMesa = mesa.trim()
    val safeSlug = slug.trim()
    val base = "https://$HOST/$safeSlug?mesa=$safeMesa&tablet=1"
    val withToken = if (!token.isNullOrBlank()) "$base&tablet_token=$token" else base
    return if (!deviceId.isNullOrBlank()) "$withToken&tablet_device_id=$deviceId" else withToken
  }

  fun buildClaimUrl(slug: String, mesa: String, token: String?, deviceId: String?, deviceLabel: String?): String {
    val safeMesa = mesa.trim()
    val safeSlug = slug.trim()
    val safeToken = token?.trim().orEmpty()
    val safeDeviceId = deviceId?.trim().orEmpty()
    val safeLabel = deviceLabel?.trim().orEmpty()
    return "https://$HOST/tablet-claim?slug=${java.net.URLEncoder.encode(safeSlug, "UTF-8")}" +
      "&mesa=${java.net.URLEncoder.encode(safeMesa, "UTF-8")}" +
      "&token=${java.net.URLEncoder.encode(safeToken, "UTF-8")}" +
      "&deviceId=${java.net.URLEncoder.encode(safeDeviceId, "UTF-8")}" +
      (if (safeLabel.isNotBlank()) "&deviceLabel=${java.net.URLEncoder.encode(safeLabel, "UTF-8")}" else "")
  }

  fun normalizeSlug(value: String): String {
    val normalized = Normalizer.normalize(value.lowercase(), Normalizer.Form.NFD)
      .replace("\\p{InCombiningDiacriticalMarks}+".toRegex(), "")
    return normalized
      .replace("[^a-z0-9]+".toRegex(), "-")
      .trim('-')
  }
}
