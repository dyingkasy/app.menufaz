# MenuFaz Tablet Kiosk (Android)

Projeto Android (WebView) para rodar o MenuFaz em modo kiosk/Lock Task.

## Build
- Abra `android-tablet-kiosk/` no Android Studio e faça **Build > Build APK(s)**.
- Ou via CLI:
  ```bash
  cd android-tablet-kiosk
  ./gradlew assembleDebug
  ./gradlew assembleRelease
  ```
- URL inicial configurada em `app/build.gradle` (BuildConfig.START_URL) ou via env `ANDROID_START_URL`.
- Versão pode ser definida via env `ANDROID_VERSION_NAME` e `ANDROID_VERSION_CODE`.

## Release assinado
Defina as variáveis de ambiente:
```
ANDROID_KEYSTORE_PATH=/caminho/keystore.jks
ANDROID_KEYSTORE_PASSWORD=senha
ANDROID_KEYSTORE_ALIAS=alias
ANDROID_KEYSTORE_KEY_PASSWORD=senha
```
Depois rode:
```bash
./gradlew assembleRelease
```

## Provisionamento (Device Owner)
> Requer aparelho recém-formatado ou perfil dedicado.

1. Instale o APK:
   ```bash
   adb install app-debug.apk
   ```
2. Defina o app como **Device Owner**:
   ```bash
   adb shell dpm set-device-owner com.menufaz.tablet/.KioskDeviceAdminReceiver
   ```
3. Abra o app. Ele entrará em **Lock Task Mode** automaticamente.

## Sair do kiosk
- Para retirar o Device Owner:
  ```bash
  adb shell dpm remove-active-admin com.menufaz.tablet/.KioskDeviceAdminReceiver
  ```
- Depois disso, feche/reabra o app para liberar o Lock Task.

## Observações
- O app bloqueia navegação fora do domínio definido em `BuildConfig.START_URL`.
- Para atualizar URL/ambiente, altere `BuildConfig.START_URL` e gere novo APK.
- O APK é global (todas as lojas). O pareamento por QR fixa loja + mesa.
