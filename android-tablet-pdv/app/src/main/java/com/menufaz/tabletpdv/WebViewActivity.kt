package com.menufaz.tabletpdv

import android.annotation.SuppressLint
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.webkit.JavascriptInterface
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.EditText
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import org.json.JSONObject
import java.net.URI
import android.os.Build

class WebViewActivity : AppCompatActivity() {
  private lateinit var webView: WebView
  private lateinit var mesaOverlay: TextView
  private val resetHandler = Handler(Looper.getMainLooper())
  private val longPressRunnable = Runnable { promptReset() }
  private val claimHandler = Handler(Looper.getMainLooper())
  private val claimRunnable = object : Runnable {
    override fun run() {
      claimTabletFromUrl()
      claimHandler.postDelayed(this, 60000)
    }
  }
  private var config: PdvConfig? = null

  @SuppressLint("SetJavaScriptEnabled")
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    setContentView(R.layout.activity_webview)

    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    hideSystemUi()

    config = PdvPrefs.load(this)
    if (config == null) {
      startScanner()
      return
    }

    webView = findViewById(R.id.webView)
    mesaOverlay = findViewById(R.id.mesaOverlay)

    mesaOverlay.text = "Mesa ${config!!.mesa}"
    setupResetGesture()

    val settings = webView.settings
    settings.javaScriptEnabled = true
    settings.domStorageEnabled = true
    settings.userAgentString = settings.userAgentString + " MenufazTabletPDV/1.0"
    webView.addJavascriptInterface(TabletBridge(), "MenufazTablet")

    webView.webViewClient = object : WebViewClient() {
      override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
        val url = request.url
        if (url.scheme == "menufaz" && url.host == "reset") {
          promptReset()
          return true
        }
        val host = url.host ?: return true
        if (host.lowercase() != "app.menufaz.com") return true
        if (url.scheme != "https") {
          val secureUrl = url.toString().replaceFirst("http://", "https://")
          view.loadUrl(secureUrl)
          return true
        }
        return false
      }
    }

    claimTabletFromUrl()
    claimHandler.postDelayed(claimRunnable, 60000)
    webView.loadUrl(config!!.urlFinal)
  }

  private fun setupResetGesture() {
    mesaOverlay.setOnTouchListener { _, event ->
      when (event.action) {
        MotionEvent.ACTION_DOWN -> {
          resetHandler.postDelayed(longPressRunnable, 5000)
          true
        }
        MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
          resetHandler.removeCallbacks(longPressRunnable)
          true
        }
        else -> false
      }
    }
  }

  private fun promptReset() {
    val slug = config?.slug ?: ""
    if (slug.isBlank()) {
      Toast.makeText(this, getString(R.string.reset_blocked), Toast.LENGTH_LONG).show()
      return
    }

    Thread {
      val adminPin = StoreApi.fetchAdminPin(slug).trim()
      runOnUiThread {
        if (adminPin.isBlank()) {
          Toast.makeText(this, getString(R.string.reset_blocked), Toast.LENGTH_LONG).show()
          return@runOnUiThread
        }

        val input = EditText(this).apply {
          hint = "PIN"
          inputType = android.text.InputType.TYPE_CLASS_NUMBER or android.text.InputType.TYPE_NUMBER_VARIATION_PASSWORD
        }

        AlertDialog.Builder(this)
          .setTitle("Reset Admin")
          .setMessage("Digite o PIN da loja")
          .setView(input)
          .setPositiveButton("Confirmar") { _, _ ->
            val typed = input.text.toString().trim()
            if (typed == adminPin) {
              PdvPrefs.clear(this)
              Toast.makeText(this, "Mesa liberada.", Toast.LENGTH_SHORT).show()
              startScanner()
            } else {
              Toast.makeText(this, "PIN inválido.", Toast.LENGTH_SHORT).show()
            }
          }
          .setNegativeButton("Cancelar", null)
          .show()
      }
    }.start()
  }

  private fun startScanner() {
    val intent = Intent(this, ScannerActivity::class.java)
    intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_NEW_TASK)
    startActivity(intent)
    finish()
  }

  override fun onBackPressed() {
    if (!::webView.isInitialized) return
    val canGoBack = webView.canGoBack()
    if (canGoBack) {
      webView.goBack()
    }
  }

  private fun claimTabletFromUrl() {
    val url = config?.urlFinal ?: return
    try {
      val uri = URI(url)
      val query = uri.query ?: return
      val params = query.split("&")
        .mapNotNull { item ->
          val parts = item.split("=")
          if (parts.size == 2) parts[0] to parts[1] else null
        }
        .toMap()
      val token = params["tablet_token"] ?: params["token"] ?: return
      val mesa = params["mesa"] ?: config?.mesa ?: ""
      val deviceId = getTabletDeviceId()
      val label = buildDeviceLabel(mesa)
      Thread {
        StoreApi.claimTablet(token, deviceId, label)
      }.start()
    } catch (_: Exception) {
    }
  }

  private fun getTabletDeviceId(): String {
    return PdvPrefs.getOrCreateDeviceId(this)
  }

  private fun buildDeviceLabel(mesa: String): String {
    val model = listOf(Build.MANUFACTURER, Build.MODEL)
      .filter { it.isNotBlank() }
      .joinToString(" ")
      .ifBlank { "Android" }
    return if (mesa.isNotBlank()) "Mesa $mesa • $model" else model
  }

  private fun hideSystemUi() {
    window.decorView.systemUiVisibility = (
      View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
        or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
        or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
        or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
        or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
        or View.SYSTEM_UI_FLAG_FULLSCREEN
      )
  }

  override fun onDestroy() {
    claimHandler.removeCallbacks(claimRunnable)
    super.onDestroy()
  }

  inner class TabletBridge {
    @JavascriptInterface
    fun getDeviceId(): String {
      return getTabletDeviceId()
    }

    @JavascriptInterface
    fun getDeviceInfo(): String {
      return try {
        JSONObject()
          .put("manufacturer", Build.MANUFACTURER)
          .put("model", Build.MODEL)
          .put("sdk", Build.VERSION.SDK_INT)
          .toString()
      } catch (_: Exception) {
        "{}"
      }
    }

    @JavascriptInterface
    fun requestReset() {
      runOnUiThread { promptReset() }
    }
  }
}
