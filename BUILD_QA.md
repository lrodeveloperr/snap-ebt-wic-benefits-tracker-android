# Android QA APK Build Notes

## Recommended handoff

Use the owner-dispatched `Android QA APK` GitHub Actions workflow. An authorized push to `main` runs it automatically only when the commit message contains `[build-apk]`; ordinary pushes are skipped. It builds on GitHub's runner with Gradle directly, so no Expo account, EAS login, EAS subscription, or EAS build credit is required.

The uploaded artifact contains:

- `snap-ebt-wic-benefits-tracker-qa.apk`, an installable Android APK; and
- `SHA256SUMS.txt`, the checksum to verify after download.

The workflow uses its run number as `versionCode`, validates the APK with Android Build Tools 36, and retains the artifact for 14 days.

## Fixed QA safety values

| Purpose | QA value |
| --- | --- |
| Package | `com.goodusestudios.snapebtgrocerytracker.qa` |
| Build profile | `qa` |
| Ad profile | explicit `test` runtime profile |
| Purchase path | real Google Play Billing integration |
| AdMob app | `ca-app-pub-3940256099942544~3347511713` |
| Banner | `ca-app-pub-3940256099942544/6300978111` |
| Android SDK | minimum 24, compile/target 36 |

These are Google's demo ad identifiers. They are pinned in the workflow even if a repository environment contains live values, preventing a manual QA build from requesting production ads.

## Run and install

1. Open the repository's **Actions** tab.
2. Select **Android QA APK**.
3. Choose **Run workflow** for the branch or commit under test.
4. Download `snap-ebt-wic-benefits-tracker-qa-<run-number>` after the job succeeds.
5. Unzip the artifact and optionally verify it:

   ```sh
   sha256sum -c SHA256SUMS.txt
   ```

6. Enable developer options and USB debugging on the test device, then install:

   ```sh
   adb install -r snap-ebt-wic-benefits-tracker-qa.apk
   ```

For a clean-state test, uninstall only the QA package first:

```sh
adb uninstall com.goodusestudios.snapebtgrocerytracker.qa
```

Uninstalling erases that QA installation's on-device data.

## What the workflow proves

- Expo resolves the QA application ID, GitHub run-number version code, and target SDK 36.
- The canonical app is embedded and approved Android assets are prepared before validation.
- Source validation, typechecking, tests, and locked native dependency checks pass.
- Android prebuild completes for React Native 0.86.2.
- The generated native Android project passes `scripts/verify-android.mjs`.
- Gradle produces a release APK.
- The staged APK has a valid signature.
- Android's package metadata reports the `.qa` package and target SDK 36.

It does not prove live Google Play Billing, production ads, Play App Signing, store policy declarations, or upgrade compatibility with the production app.

## Billing and ad testing limits

The app uses the real Google Play Billing integration for the one-time `remove_ads_lifetime` product. This sideloaded `.qa` APK validates installation and non-billing app behavior, but it cannot prove product lookup, purchase, acknowledgement, restore, refund, or entitlement behavior. Test those only with a Play-signed build uploaded to a Play test track, the exact package/product configuration, and licensed test accounts. Do not tap a purchase flow unless the active Play test setup and expected charging behavior are understood.

Demo ads are appropriate for layout and lifecycle testing. Validate consent-region behavior, offline behavior, ad load failure, orientation/safe-area layout, ad-free state, process restart, and device restore separately.

## Signing assumptions

`assembleRelease` may emit either a template-development-signed or unsigned APK. The workflow verifies the result. If it is unsigned, the workflow creates a short-lived QA keystore in the runner's temporary directory, zip-aligns the APK, and signs it. No keystore is uploaded with the artifact. The resulting signature is intentionally non-production and disposable, so installing a later run may require uninstalling the earlier QA build first.

Production must use a separately protected upload key and the base application ID `com.goodusestudios.snapebtgrocerytracker`. Do not promote, rename, or upload the QA APK to Google Play.

## Optional EAS definitions

`eas.json` remains available for teams that already use EAS: `preview` specifies an APK and `production` specifies an AAB. Those profiles are not invoked by the GitHub QA workflow and are not required for QA delivery.
