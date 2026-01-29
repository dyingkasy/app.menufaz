package com.menufaz.tabletpdv

import java.net.URI
import java.text.Normalizer

object UrlUtils {
  private const val HOST = "app.menufaz.com"

  data class Parsed(val slug: String, val mesa: String)

  fun parseQr(raw: String): Parsed? {
    return try {
      val uri = URI(raw.trim())
      val host = uri.host ?: return null
      if (host.lowercase() != HOST) return null
      val mesa = uri.query?.split("&")
        ?.mapNotNull {
          val parts = it.split("=")
          if (parts.size == 2 && parts[0] == "mesa") parts[1] else null
        }
        ?.firstOrNull()
        ?.trim()
        ?.takeIf { it.isNotEmpty() }
        ?: return null

      val path = (uri.path ?: "").trim('/').trim()
      if (path.isEmpty()) return null
      val slug = path.split('/').first().trim()
      if (slug.isEmpty()) return null
      Parsed(slug, mesa)
    } catch (_: Exception) {
      null
    }
  }

  fun buildFinalUrl(slug: String, mesa: String): String {
    val safeMesa = mesa.trim()
    val safeSlug = slug.trim()
    return "https://$HOST/$safeSlug?mesa=$safeMesa&tablet=1"
  }

  fun normalizeSlug(value: String): String {
    val normalized = Normalizer.normalize(value.lowercase(), Normalizer.Form.NFD)
      .replace("\\p{InCombiningDiacriticalMarks}+".toRegex(), "")
    return normalized
      .replace("[^a-z0-9]+".toRegex(), "-")
      .trim('-')
  }
}
