import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const PRODUCTION_PACKAGE = "com.lateefrazaqoyetola.snapebtwictracker";
const LIVE_APP_ID = "ca-app-pub-8054612600809568~2189058911";
const LIVE_BANNER_ID = "ca-app-pub-8054612600809568/5751919465";
const GOOGLE_DEMO_APP_ID = "ca-app-pub-3940256099942544~3347511713";
const read = (file) => readFile(file, "utf8");

const expectedVersionCode = Number(process.env.ANDROID_VERSION_CODE);
assert.ok(
  Number.isSafeInteger(expectedVersionCode) && expectedVersionCode > 0,
  "ANDROID_VERSION_CODE must be a positive integer",
);
assert.equal(process.env.EXPO_PUBLIC_BUILD_PROFILE, "production");
assert.equal(process.env.EXPO_PUBLIC_AD_PROFILE, "production");
assert.equal(process.env.EXPO_PUBLIC_ANDROID_ADMOB_APP_ID, LIVE_APP_ID);
assert.equal(process.env.EXPO_PUBLIC_ANDROID_ADMOB_BANNER_ID, LIVE_BANNER_ID);
assert.equal(process.env.EXPO_PUBLIC_ADMOB_PUBLISHER_ID, "8054612600809568");

const [manifest, appGradle, rootGradle, gradleProperties] = await Promise.all([
  read("android/app/src/main/AndroidManifest.xml"),
  read("android/app/build.gradle"),
  read("android/build.gradle"),
  read("android/gradle.properties"),
]);
const nativeSource = [manifest, appGradle, rootGradle, gradleProperties].join("\n");
const escapedPackage = PRODUCTION_PACKAGE.replaceAll(".", "\\.");

assert.match(appGradle, new RegExp(`applicationId ["']${escapedPackage}["']`));
assert.match(appGradle, new RegExp(`versionCode\\s+${expectedVersionCode}\\b`));
assert.match(nativeSource, /compileSdkVersion\s*(?:=\s*)?36\b|compileSdk\s*(?:=\s*)?36\b/);
assert.match(nativeSource, /targetSdkVersion\s*(?:=\s*)?36\b|targetSdk\s*(?:=\s*)?36\b/);
assert.match(manifest, /android:allowBackup="false"/);
assert.match(manifest, /android\.permission\.INTERNET/);
assert.match(manifest, /android\.permission\.ACCESS_NETWORK_STATE/);
assert.match(manifest, /android\.permission\.POST_NOTIFICATIONS/);
assert.match(manifest, /com\.android\.vending\.BILLING/);
assert.ok(manifest.includes(LIVE_APP_ID), "live AdMob app ID is missing from the manifest");
assert.ok(!manifest.includes(GOOGLE_DEMO_APP_ID), "Google demo AdMob app ID reached production");
assert.ok(!nativeSource.includes(`${PRODUCTION_PACKAGE}.qa`), "QA package reached production");

for (const permission of [
  "CAMERA",
  "RECORD_AUDIO",
  "ACCESS_FINE_LOCATION",
  "ACCESS_COARSE_LOCATION",
  "READ_CONTACTS",
  "READ_EXTERNAL_STORAGE",
  "WRITE_EXTERNAL_STORAGE",
  "READ_MEDIA_IMAGES",
  "READ_MEDIA_VIDEO",
  "READ_MEDIA_AUDIO",
  "RECEIVE_BOOT_COMPLETED",
  "SCHEDULE_EXACT_ALARM",
  "USE_EXACT_ALARM",
  "VIBRATE",
]) {
  const declarationPattern = new RegExp(
    `<uses-permission[^>]+android:name=["']android\\.permission\\.${permission}["'][^>]*>`,
    "g",
  );
  for (const match of manifest.matchAll(declarationPattern)) {
    assert.match(
      match[0],
      /tools:node=["']remove["']/,
      `forbidden ${permission} permission is active`,
    );
  }
}

const bundleArgument = process.argv[2];
if (bundleArgument) {
  const bundlePath = path.resolve(bundleArgument);
  const info = await stat(bundlePath);
  assert.ok(info.isFile() && info.size > 1_000_000, "AAB is missing or unexpectedly small");
  const handle = await import("node:fs/promises").then(({ open }) => open(bundlePath, "r"));
  try {
    const signature = Buffer.alloc(4);
    await handle.read(signature, 0, 4, 0);
    assert.equal(signature.toString("hex"), "504b0304", "AAB is not a ZIP archive");
  } finally {
    await handle.close();
  }
}

console.log(
  `Android production verification passed${bundleArgument ? " (including AAB)" : ""}.`,
);

