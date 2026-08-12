# SNAP-EBT & WIC Benefits Tracker for Android

This is the Expo 57 / React Native 0.86.2 Android app for SNAP-EBT & WIC Benefits Tracker. Expo prebuild generates a native Android project around the reviewed application source.

The app keeps grocery planning data on the device, supports SNAP/EBT and Puerto Rico PAN terminology, exports reports, displays Google Mobile Ads after consent handling, and supports an optional ad-free entitlement.

## Android build contract

| Setting | Production | QA |
| --- | --- | --- |
| Application ID | `com.lateefrazaqoyetola.snapebtwictracker` | `com.lateefrazaqoyetola.snapebtwictracker.qa` |
| Output | Play-ready AAB when built with the production profile | Directly installable APK |
| Ads | Approved live AdMob app/banner IDs, verified by the release job | Google's official demo app/banner IDs only |
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

The manual **Android Production AAB** workflow is the release boundary. It fixes `EXPO_PUBLIC_BUILD_PROFILE=production`, `EXPO_PUBLIC_AD_PROFILE=production`, the approved live AdMob IDs, and the Play package `com.lateefrazaqoyetola.snapebtwictracker`. Production config rejects Google's demo publisher ID or any publisher mismatch.

The job accepts an unused positive Play version code, runs source/type/tests, regenerates and verifies Android, removes Expo's debug release signing, builds an unsigned bundle, signs it with the long-lived upload key, validates it with Bundletool, and publishes the AAB plus checksum and public upload certificate as a private Actions artifact.

The private repository must define `ANDROID_UPLOAD_KEYSTORE_BASE64`, `ANDROID_UPLOAD_KEYSTORE_PASSWORD`, `ANDROID_UPLOAD_KEY_ALIAS`, `ANDROID_UPLOAD_KEY_PASSWORD`, and `ANDROID_UPLOAD_CERT_SHA256` as encrypted Actions secrets. The release key contract is a PKCS12 keystore containing an RSA upload key; the workflow signs with SHA256withRSA. It never uploads the keystore. Never commit signing files or passwords. After building, upload the AAB to the Play internal-testing release and retain the upload key independently of GitHub.

The Play listing still needs the one-time `remove_ads_lifetime` product, store declarations, and Play-track billing/ads verification. The `production` EAS profile remains available, but this repository's guarded production workflow is the documented first-release path.

See [BUILD_QA.md](BUILD_QA.md) for the complete QA handoff.
