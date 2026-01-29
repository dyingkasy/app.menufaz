package com.menufaz.tabletpdv

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.common.InputImage
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

class ScannerActivity : AppCompatActivity() {
  private lateinit var previewView: PreviewView
  private lateinit var errorView: TextView
  private val cameraExecutor = Executors.newSingleThreadExecutor()
  private val handling = AtomicBoolean(false)
  private val handler = Handler(Looper.getMainLooper())

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    setContentView(R.layout.activity_scanner)

    previewView = findViewById(R.id.previewView)
    errorView = findViewById(R.id.scannerError)

    findViewById<Button>(R.id.manualButton).setOnClickListener {
      showManualEntry()
    }

    if (hasCameraPermission()) {
      startCamera()
    } else {
      ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.CAMERA), 101)
    }
  }

  override fun onRequestPermissionsResult(
    requestCode: Int,
    permissions: Array<out String>,
    grantResults: IntArray
  ) {
    super.onRequestPermissionsResult(requestCode, permissions, grantResults)
    if (requestCode == 101 && grantResults.isNotEmpty() && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
      startCamera()
    } else {
      Toast.makeText(this, "Permissão de câmera necessária.", Toast.LENGTH_LONG).show()
    }
  }

  private fun startCamera() {
    val cameraProviderFuture = ProcessCameraProvider.getInstance(this)
    cameraProviderFuture.addListener({
      val cameraProvider = cameraProviderFuture.get()
      val preview = Preview.Builder().build().also {
        it.setSurfaceProvider(previewView.surfaceProvider)
      }
      val analysis = ImageAnalysis.Builder()
        .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
        .build()

      val scanner = BarcodeScanning.getClient()
      analysis.setAnalyzer(cameraExecutor) { imageProxy ->
        val mediaImage = imageProxy.image
        if (mediaImage != null) {
          val image = InputImage.fromMediaImage(mediaImage, imageProxy.imageInfo.rotationDegrees)
          scanner.process(image)
            .addOnSuccessListener { barcodes ->
              if (handling.get()) return@addOnSuccessListener
              for (barcode in barcodes) {
                val raw = barcode.rawValue ?: continue
                handleQr(raw)
                break
              }
            }
            .addOnCompleteListener { imageProxy.close() }
        } else {
          imageProxy.close()
        }
      }

      val cameraSelector = CameraSelector.DEFAULT_BACK_CAMERA
      cameraProvider.unbindAll()
      cameraProvider.bindToLifecycle(this, cameraSelector, preview, analysis)
    }, ContextCompat.getMainExecutor(this))
  }

  private fun handleQr(raw: String) {
    val parsed = UrlUtils.parseQr(raw)
    if (parsed == null) {
      showError()
      return
    }
    if (parsed.token.isNullOrBlank()) {
      showError()
      return
    }

    if (!handling.compareAndSet(false, true)) return

    Thread {
      val deviceId = Settings.Secure.getString(contentResolver, Settings.Secure.ANDROID_ID)
        ?.takeIf { it.isNotBlank() }
        ?: PdvPrefs.getOrCreateDeviceId(this)
      val deviceLabel = "Mesa ${parsed.mesa}"
      val claimed = StoreApi.claimTablet(parsed.token, deviceId, deviceLabel)
      if (!claimed) {
        handling.set(false)
        runOnUiThread {
          Toast.makeText(this, "QR expirado ou invalido.", Toast.LENGTH_SHORT).show()
        }
        return@Thread
      }
      val finalUrl = UrlUtils.buildFinalUrl(parsed.slug, parsed.mesa, parsed.token, deviceId)
      val adminPin = StoreApi.fetchAdminPin(parsed.slug)
      val config = PdvConfig(parsed.slug, parsed.mesa, finalUrl, adminPin)
      PdvPrefs.save(this, config)
      runOnUiThread {
        openWebView()
      }
    }.start()
  }

  private fun showError() {
    handler.post {
      errorView.visibility = View.VISIBLE
      errorView.alpha = 1f
      errorView.animate().alpha(0f).setDuration(1500).withEndAction {
        errorView.visibility = View.GONE
        errorView.alpha = 1f
      }.start()
    }
  }

  private fun openWebView() {
    val intent = Intent(this, WebViewActivity::class.java)
    intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_NEW_TASK)
    startActivity(intent)
    finish()
  }

  private fun showManualEntry() {
    val container = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      setPadding(24, 16, 24, 0)
    }

    val slugInput = EditText(this).apply {
      hint = "Slug da loja"
    }
    val mesaInput = EditText(this).apply {
      hint = "Mesa"
    }

    container.addView(slugInput)
    container.addView(mesaInput)

    AlertDialog.Builder(this)
      .setTitle("Definir mesa manualmente")
      .setView(container)
      .setPositiveButton("Salvar") { _, _ ->
        val slug = slugInput.text.toString().trim()
        val mesa = mesaInput.text.toString().trim()
        if (slug.isEmpty() || mesa.isEmpty()) {
          Toast.makeText(this, "Preencha slug e mesa.", Toast.LENGTH_SHORT).show()
          return@setPositiveButton
        }
        handling.set(true)
        Thread {
          val deviceId = Settings.Secure.getString(contentResolver, Settings.Secure.ANDROID_ID)
            ?.takeIf { it.isNotBlank() }
            ?: PdvPrefs.getOrCreateDeviceId(this)
          val finalUrl = UrlUtils.buildFinalUrl(slug, mesa, null, deviceId)
          val adminPin = StoreApi.fetchAdminPin(slug)
          val config = PdvConfig(slug, mesa, finalUrl, adminPin)
          PdvPrefs.save(this, config)
          runOnUiThread { openWebView() }
        }.start()
      }
      .setNegativeButton("Cancelar", null)
      .show()
  }

  private fun hasCameraPermission(): Boolean {
    return ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
  }

  override fun onDestroy() {
    super.onDestroy()
    cameraExecutor.shutdown()
  }
}
