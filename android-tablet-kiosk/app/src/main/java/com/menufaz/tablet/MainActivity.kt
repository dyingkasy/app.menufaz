package com.menufaz.tablet

import android.Manifest
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.util.Log
import android.view.View
import android.webkit.ConsoleMessage
import android.webkit.GeolocationPermissions
import android.webkit.JavascriptInterface
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.ValueCallback
import android.webkit.WebResourceResponse
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.webkit.WebViewAssetLoader
import org.json.JSONObject
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class MainActivity : AppCompatActivity() {
    private lateinit var webView: WebView
    private val localStartUrl = "https://appassets.androidplatform.net/assets/app/index.html"
    private val localHost = "appassets.androidplatform.net"
    private val remoteStartUrl: String by lazy {
        BuildConfig.START_URL
    }
    private val startUrl: String by lazy {
        if (BuildConfig.DEBUG && remoteStartUrl.isNotBlank()) remoteStartUrl else localStartUrl
    }
    private val allowedHosts: Set<String> by lazy {
        listOfNotNull(
            Uri.parse(localStartUrl).host,
            Uri.parse(remoteStartUrl).host
        ).toSet()
    }
    private lateinit var assetLoader: WebViewAssetLoader
    private enum class CameraPermissionReason { WEB, FILE_CHOOSER, NATIVE_SCANNER }
    private var pendingPermissionRequest: PermissionRequest? = null
    private var pendingPermissionResources: Array<String> = emptyArray()
    private var pendingGeolocationOrigin: String? = null
    private var pendingGeolocationCallback: GeolocationPermissions.Callback? = null
    private var pendingFileChooserCallback: ValueCallback<Array<Uri>>? = null
    private var pendingFileChooserIntent: Intent? = null
    private var cameraImageUri: Uri? = null
    private var cameraPermissionReason: CameraPermissionReason = CameraPermissionReason.WEB

    private val cameraPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        val request = pendingPermissionRequest
        val resources = pendingPermissionResources
        val reason = cameraPermissionReason
        pendingPermissionRequest = null
        pendingPermissionResources = emptyArray()
        cameraPermissionReason = CameraPermissionReason.WEB
        if (!granted) {
            request?.deny()
            pendingFileChooserCallback?.onReceiveValue(emptyArray())
            pendingFileChooserCallback = null
            pendingFileChooserIntent = null
            showToast("Permita camera para escanear o QR.")
            return@registerForActivityResult
        }

        when (reason) {
            CameraPermissionReason.WEB -> {
                if (request != null && resources.isNotEmpty()) {
                    request.grant(resources)
                }
            }
            CameraPermissionReason.FILE_CHOOSER -> {
                launchPendingFileChooser()
            }
            CameraPermissionReason.NATIVE_SCANNER -> {
                launchNativeQrScanner()
            }
        }
    }

    private val locationPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        val origin = pendingGeolocationOrigin
        val callback = pendingGeolocationCallback
        pendingGeolocationOrigin = null
        pendingGeolocationCallback = null
        if (origin != null && callback != null) {
            callback.invoke(origin, granted, false)
            if (!granted) {
                showToast("Permita localizacao para usar sua posicao.")
            }
        }
    }

    private val fileChooserLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        val callback = pendingFileChooserCallback
        pendingFileChooserCallback = null
        pendingFileChooserIntent = null
        if (callback == null) return@registerForActivityResult

        val parsed = WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data)
        val finalUris = when {
            parsed != null && parsed.isNotEmpty() -> parsed
            result.resultCode == RESULT_OK && cameraImageUri != null -> arrayOf(cameraImageUri!!)
            else -> emptyArray()
        }
        callback.onReceiveValue(finalUris)
        cameraImageUri = null
    }

    private val qrScannerLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (result.resultCode != RESULT_OK) return@registerForActivityResult
        val value = result.data?.getStringExtra(QrScannerActivity.EXTRA_QR_VALUE)?.trim()
        if (value.isNullOrEmpty()) {
            showToast("Nao foi possivel ler o QR.")
            return@registerForActivityResult
        }
        dispatchQrValueToWeb(value)
    }

    private inner class MenufazAndroidBridge {
        @JavascriptInterface
        fun openQrScanner() {
            runOnUiThread {
                startNativeQrScanner()
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        webView = findViewById(R.id.webview)
        webView.settings.javaScriptEnabled = true
        webView.settings.domStorageEnabled = true
        webView.settings.mediaPlaybackRequiresUserGesture = false
        webView.settings.allowFileAccess = true
        assetLoader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .addPathHandler("/res/", WebViewAssetLoader.ResourcesPathHandler(this))
            .build()
        webView.addJavascriptInterface(MenufazAndroidBridge(), "MenufazAndroid")
        webView.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest) {
                runOnUiThread {
                    handleWebPermissionRequest(request)
                }
            }

            override fun onShowFileChooser(
                webView: WebView,
                filePathCallback: ValueCallback<Array<Uri>>,
                fileChooserParams: FileChooserParams
            ): Boolean {
                return handleFileChooser(filePathCallback, fileChooserParams)
            }

            override fun onGeolocationPermissionsShowPrompt(
                origin: String,
                callback: GeolocationPermissions.Callback
            ) {
                runOnUiThread {
                    handleGeolocationRequest(origin, callback)
                }
            }

            override fun onConsoleMessage(consoleMessage: ConsoleMessage): Boolean {
                if (BuildConfig.DEBUG) {
                    Log.d(
                        "MenufazWebView",
                        "[${consoleMessage.messageLevel()}] ${consoleMessage.message()} (${consoleMessage.sourceId()}:${consoleMessage.lineNumber()})"
                    )
                }
                return super.onConsoleMessage(consoleMessage)
            }
        }
        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val targetHost = request.url.host
                return if (targetHost != null && allowedHosts.contains(targetHost)) {
                    false
                } else {
                    true
                }
            }

            override fun shouldInterceptRequest(
                view: WebView,
                request: WebResourceRequest
            ): WebResourceResponse? {
                val url = request.url
                if (url.host == localHost) {
                    val path = url.path ?: "/"
                    if (path.startsWith("/assets/") || path.startsWith("/res/")) {
                        return assetLoader.shouldInterceptRequest(url)
                    }
                    return assetLoader.shouldInterceptRequest(Uri.parse(localStartUrl))
                }
                return super.shouldInterceptRequest(view, request)
            }
        }

        if (savedInstanceState == null) {
            clearCacheIfNeeded()
            webView.loadUrl(startUrl)
        }

        enterImmersiveMode()
        maybeStartLockTask()
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) {
            enterImmersiveMode()
        }
    }

    override fun onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack()
        }
    }

    private fun enterImmersiveMode() {
        window.decorView.systemUiVisibility = (
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or
                View.SYSTEM_UI_FLAG_FULLSCREEN or
                View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or
                View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or
                View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION or
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            )
    }

    private fun maybeStartLockTask() {
        val dpm = getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
        val adminComponent = ComponentName(this, KioskDeviceAdminReceiver::class.java)
        if (dpm.isDeviceOwnerApp(packageName)) {
            dpm.setLockTaskPackages(adminComponent, arrayOf(packageName))
            if (dpm.isLockTaskPermitted(packageName)) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    startLockTask()
                } else {
                    startLockTask()
                }
            }
        }
    }

    private fun clearCacheIfNeeded() {
        val prefs = getSharedPreferences("menufaz_kiosk", Context.MODE_PRIVATE)
        val lastVersion = prefs.getInt("last_version_code", -1)
        val currentVersion = BuildConfig.VERSION_CODE
        if (currentVersion != lastVersion) {
            webView.clearCache(true)
            prefs.edit().putInt("last_version_code", currentVersion).apply()
        }
    }

    private fun handleWebPermissionRequest(request: PermissionRequest) {
        val resources = request.resources
        val wantsVideo = resources.contains(PermissionRequest.RESOURCE_VIDEO_CAPTURE)
        if (!wantsVideo) {
            request.deny()
            return
        }

        val resourcesToGrant = arrayOf(PermissionRequest.RESOURCE_VIDEO_CAPTURE)
        if (hasCameraPermission()) {
            request.grant(resourcesToGrant)
            return
        }

        pendingPermissionRequest?.deny()
        pendingPermissionRequest = request
        pendingPermissionResources = resourcesToGrant
        cameraPermissionReason = CameraPermissionReason.WEB
        cameraPermissionLauncher.launch(Manifest.permission.CAMERA)
    }

    private fun handleFileChooser(
        callback: ValueCallback<Array<Uri>>?,
        params: WebChromeClient.FileChooserParams?
    ): Boolean {
        pendingFileChooserCallback?.onReceiveValue(emptyArray())
        pendingFileChooserCallback = callback
        if (callback == null) return false

        pendingFileChooserIntent = buildFileChooserIntent(params)
        cameraPermissionReason = CameraPermissionReason.FILE_CHOOSER
        if (hasCameraPermission()) {
            launchPendingFileChooser()
        } else {
            cameraPermissionLauncher.launch(Manifest.permission.CAMERA)
        }
        return true
    }

    private fun buildFileChooserIntent(params: WebChromeClient.FileChooserParams?): Intent {
        val picturesDir = getExternalFilesDir(Environment.DIRECTORY_PICTURES)
        val baseDir = picturesDir ?: cacheDir
        if (!baseDir.exists()) baseDir.mkdirs()
        val timeStamp = SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(Date())
        val imageFile = File(baseDir, "menufaz_$timeStamp.jpg")
        cameraImageUri = FileProvider.getUriForFile(
            this,
            "${BuildConfig.APPLICATION_ID}.fileprovider",
            imageFile
        )

        val cameraIntent = Intent(android.provider.MediaStore.ACTION_IMAGE_CAPTURE).apply {
            putExtra(android.provider.MediaStore.EXTRA_OUTPUT, cameraImageUri)
            addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }

        val mimeType = params?.acceptTypes?.firstOrNull { it.isNotBlank() } ?: "image/*"
        val contentIntent = Intent(Intent.ACTION_GET_CONTENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = mimeType
        }

        return Intent(Intent.ACTION_CHOOSER).apply {
            putExtra(Intent.EXTRA_INTENT, contentIntent)
            putExtra(Intent.EXTRA_TITLE, "Selecionar imagem")
            putExtra(Intent.EXTRA_INITIAL_INTENTS, arrayOf(cameraIntent))
        }
    }

    private fun launchPendingFileChooser() {
        val intent = pendingFileChooserIntent ?: return
        try {
            fileChooserLauncher.launch(intent)
        } catch (error: Exception) {
            pendingFileChooserCallback?.onReceiveValue(emptyArray())
            pendingFileChooserCallback = null
            pendingFileChooserIntent = null
            showToast("Nao foi possivel abrir a camera.")
        }
    }

    private fun handleGeolocationRequest(
        origin: String,
        callback: GeolocationPermissions.Callback
    ) {
        if (hasPermission(Manifest.permission.ACCESS_FINE_LOCATION)) {
            callback.invoke(origin, true, false)
            return
        }
        pendingGeolocationOrigin = origin
        pendingGeolocationCallback = callback
        locationPermissionLauncher.launch(Manifest.permission.ACCESS_FINE_LOCATION)
    }

    private fun startNativeQrScanner() {
        cameraPermissionReason = CameraPermissionReason.NATIVE_SCANNER
        if (hasCameraPermission()) {
            launchNativeQrScanner()
        } else {
            cameraPermissionLauncher.launch(Manifest.permission.CAMERA)
        }
    }

    private fun launchNativeQrScanner() {
        val intent = Intent(this, QrScannerActivity::class.java)
        qrScannerLauncher.launch(intent)
    }

    private fun dispatchQrValueToWeb(value: String) {
        val escaped = JSONObject.quote(value)
        webView.evaluateJavascript(
            "window.onMenufazQrScanned && window.onMenufazQrScanned($escaped);",
            null
        )
    }

    private fun hasCameraPermission(): Boolean {
        return hasPermission(Manifest.permission.CAMERA)
    }

    private fun hasPermission(permission: String): Boolean {
        return ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED
    }

    private fun showToast(message: String) {
        Toast.makeText(this, message, Toast.LENGTH_LONG).show()
    }
}
