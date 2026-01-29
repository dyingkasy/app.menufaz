plugins {
  id("com.android.application")
  id("org.jetbrains.kotlin.android")
}

android {
  namespace = "com.menufaz.tabletpdv"
  compileSdk = 34

  defaultConfig {
    applicationId = "com.menufaz.tabletpdv"
    minSdk = 24
    targetSdk = 34
    versionCode = 7
    versionName = "1.0.6"

    vectorDrawables {
      useSupportLibrary = true
    }
  }

  signingConfigs {
    val keystorePath = System.getenv("KEYSTORE_PATH")
    val keystorePassword = System.getenv("KEYSTORE_PASSWORD")
    val keyAlias = System.getenv("KEY_ALIAS")
    val keyPassword = System.getenv("KEY_PASSWORD")

    if (!keystorePath.isNullOrBlank() && !keystorePassword.isNullOrBlank() && !keyAlias.isNullOrBlank() && !keyPassword.isNullOrBlank()) {
      create("release") {
        storeFile = file(keystorePath)
        storePassword = keystorePassword
        this.keyAlias = keyAlias
        this.keyPassword = keyPassword
      }
    }
  }

  buildTypes {
    getByName("debug") {
      isMinifyEnabled = false
    }
    getByName("release") {
      isMinifyEnabled = false
      signingConfig = signingConfigs.findByName("release")
    }
  }

  buildFeatures {
    viewBinding = true
  }

  compileOptions {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
  }

  kotlinOptions {
    jvmTarget = "17"
  }
}

dependencies {
  implementation("androidx.core:core-ktx:1.12.0")
  implementation("androidx.appcompat:appcompat:1.6.1")
  implementation("com.google.android.material:material:1.11.0")
  implementation("androidx.constraintlayout:constraintlayout:2.1.4")
  implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.7.0")

  implementation("androidx.camera:camera-camera2:1.3.2")
  implementation("androidx.camera:camera-lifecycle:1.3.2")
  implementation("androidx.camera:camera-view:1.3.2")

  implementation("com.google.mlkit:barcode-scanning:17.2.0")
}
