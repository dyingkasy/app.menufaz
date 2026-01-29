package com.menufaz.tabletpdv

import android.content.Intent
import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity

class MainActivity : AppCompatActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val config = PdvPrefs.load(this)
    val next = if (config == null) {
      Intent(this, ScannerActivity::class.java)
    } else {
      Intent(this, WebViewActivity::class.java)
    }
    next.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_NEW_TASK)
    startActivity(next)
    finish()
  }
}
