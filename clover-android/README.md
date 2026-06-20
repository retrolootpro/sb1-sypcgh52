# RetroLootPro Clover Android Wrapper

This Android app is the Clover device shell for RetroLootPro POS.

It loads `https://retrolootpro.com/pos` in a full-screen WebView and exposes a native JavaScript bridge named `RetroLootClover`.

## Current bridge

- `RetroLootClover.sale(payload)` starts a Clover card sale through Payment Connector.
- `RetroLootClover.printReceipt(payload)` is reserved for Clover receipt printer wiring.
- `RetroLootClover.openCashDrawer()` is reserved for Clover cash drawer wiring.

## Build and upload

1. Open this `clover-android` folder in Android Studio.
2. Let Gradle sync.
3. Build a signed APK.
4. Upload the signed APK in Clover Developer Dashboard under RetroLootPro -> App Releases.

## Clover app values

- Clover app id: `17HXZV0SM1Y3J`
- Package name: `com.retrolootpro.clover`

If Clover gives a separate Remote App ID / RAID, update `app/src/main/res/values/strings.xml` before building.

Do not store the Clover app secret in this Android app.
