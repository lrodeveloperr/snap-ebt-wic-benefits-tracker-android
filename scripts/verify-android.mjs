import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const TEST_APP_ID = "ca-app-pub-3940256099942544~3347511713";
const QA_PACKAGE = "com.lateefrazaqoyetola.snapebtwictracker.qa";
const read = (file) => readFile(file, "utf8");

const [manifest, appGradle, rootGradle, gradleProperties] = await Promise.all([
  read("android/app/src/main/AndroidManifest.xml"),
  read("android/app/build.gradle"),
  read("android/build.gradle"),
  read("android/gradle.properties"),
]);
const nativeSource = [manifest, appGradle, rootGradle, gradleProperties].join("\n");

assert.match(appGradle, new RegExp(`applicationId ["']${QA_PACKAGE.replaceAll(".", "\\.")}["']`));
const expectedVersionCode = Number(process.env.ANDROID_VERSION_CODE || 1);
assert.ok(Number.isSafeInteger(expectedVersionCode) && expectedVersionCode > 0);
assert.match(appGradle, new RegExp(`versionCode\\s+${expectedVersionCode}\\b`));
assert.match(nativeSource, /compileSdkVersion\s*(?:=\s*)?36\b|compileSdk\s*(?:=\s*)?36\b/);
assert.match(nativeSource, /targetSdkVersion\s*(?:=\s*)?36\b|targetSdk\s*(?:=\s*)?36\b/);
assert.match(manifest, /android:allowBackup="false"/);
assert.match(manifest, /android\.permission\.INTERNET/);
assert.match(manifest, /android\.permission\.ACCESS_NETWORK_STATE/);
assert.match(manifest, /android\.permission\.POST_NOTIFICATIONS/);
assert.match(manifest, /<uses-permission[^>]+android:name=["']android\.permission\.CAMERA["'][^>]*\/>/);
assert.match(manifest, /com\.android\.vending\.BILLING/);
assert.match(manifest, new RegExp(TEST_APP_ID.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

for (const permission of [
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

const apkArgument = process.argv[2];
if (apkArgument) {
  const apkPath = path.resolve(apkArgument);
  const info = await stat(apkPath);
  assert.ok(info.isFile() && info.size > 1_000_000, "APK is missing or unexpectedly small");
  const handle = await import("node:fs/promises").then(({ open }) => open(apkPath, "r"));
  try {
    const signature = Buffer.alloc(4);
    await handle.read(signature, 0, 4, 0);
    assert.equal(signature.toString("hex"), "504b0304", "APK is not a ZIP archive");
  } finally {
    await handle.close();
  }
}

console.log(`Android native verification passed${apkArgument ? " (including APK)" : ""}.`);
