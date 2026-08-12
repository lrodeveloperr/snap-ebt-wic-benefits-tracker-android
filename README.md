# SNAP-EBT & WIC Benefits Tracker for Android

This is the Expo 57 / React Native 0.86.2 Android app for SNAP-EBT & WIC Benefits Tracker. Expo prebuild generates a native Android project around the reviewed application source.

The app keeps grocery planning data on the device, supports SNAP/EBT and Puerto Rico PAN terminology, exports reports, displays Google Mobile Ads after consent handling, and supports an optional ad-free entitlement.

## Android build contract

| Setting | Production | QA |
| --- | --- | --- |
| Application ID | `com.goodusestudios.snapebtgrocerytracker` | `com.goodusestudios.snapebtgrocerytracker.qa` |
| Output | Play-ready AAB when built with the production profile | Directly installable APK |
| Ads | Live app/banner IDs supplied outside source control | Google's official demo app/banner IDs only |
| Purchases | Google Play Billing non-consumable | Real Google Play Billing code; Play-track build required for billing QA |
| SDK | compile/target 36, minimum 24 | compile/target 36, minimum 24 |

Hermes and React Native's New Architecture are enabled. Android backup is disabled and unneeded sensitive permissions are blocked in `app.json`.

The ads wrapper is locked to `react-native-google-mobile-ads` 16.3.4, whose published Android dependency pair is Google Mobile Ads 25.0.0 and UMP 4.0.0. This avoids the Kotlin 2.3 metadata introduced by the wrapper's 25.4.0 dependency while retaining a normal, upstream-published package. Source and CI validation fail if the wrapper or native SDK pair drifts.

## Fastest QA build: GitHub Actions

Run **Actions > Android QA APK > Run workflow**. An authorized push to `main` also starts the job only when its commit message contains `[build-apk]`. The workflow in `.github/workflows/android-qa-apk.yml`:

1. installs Node 22, JDK 17, and Android API/Build Tools 36;
2. embeds the reviewed web app, verifies the committed reviewed Android assets, and runs source/type/test validation;
3. checks the Expo dependency set and resolved application ID;
4. generates and verifies the Android project with Expo prebuild;
5. realigns and signs the release APK with a fresh SHA-256 QA certificate and APK signature schemes v1, v2, and v3;
6. verifies the signature, 16 KiB alignment, package name, target SDK, and SHA-256 checksum;
7. installs the final APK on a clean Android 15 emulator; and
8. uploads `snap-ebt-wic-benefits-tracker-qa-<run-number>` for 14 days.

Download the artifact, unzip it, and install it on a test device:

```sh
adb install -r snap-ebt-wic-benefits-tracker-qa.apk
```

The `.qa` suffix allows QA and production installations to coexist. The QA signature is for non-billing sideload tests only and must never be used for Google Play.

## Local checks

Requirements: Node 22, npm, JDK 17, Android SDK Platform 36, and Build Tools 36.0.0.

```sh
npm ci

export EXPO_PUBLIC_BUILD_PROFILE=qa
export EXPO_PUBLIC_AD_PROFILE=test
export ANDROID_VERSION_CODE=1
export EXPO_PUBLIC_ANDROID_ADMOB_APP_ID='ca-app-pub-3940256099942544~3347511713'
export EXPO_PUBLIC_ANDROID_ADMOB_BANNER_ID='ca-app-pub-3940256099942544/6300978111'

# Only needed when deliberately regenerating icon variants:
npm run prepare:android-assets
npm run validate:source
npx expo config --type prebuild --json
npx expo prebuild --clean --platform android --no-install
node scripts/verify-android.mjs
cd android
./gradlew :app:assembleRelease
```

The expected Gradle output is `android/app/build/outputs/apk/release/app-release.apk`. A locally generated release APK may need signing before Android will install it; the GitHub workflow handles that automatically.

## Production boundary

Set `EXPO_PUBLIC_BUILD_PROFILE=production` and `EXPO_PUBLIC_AD_PROFILE=production` only in a protected release job. Production config keeps the base package name and refuses Google's demo publisher ID. It requires these live Android values from protected secrets:

- `EXPO_PUBLIC_ANDROID_ADMOB_APP_ID`
- `EXPO_PUBLIC_ANDROID_ADMOB_BANNER_ID`
- `EXPO_PUBLIC_ADMOB_PUBLISHER_ID`

The `production` EAS profile remains an AAB definition, but the QA workflow does not use EAS. A Play release still needs a unique version code, Play App Signing/upload-key configuration, the `remove_ads_lifetime` in-app product, store declarations, and release-track testing. Never commit signing files or live advertising credentials.

See [BUILD_QA.md](BUILD_QA.md) for the complete QA handoff.
