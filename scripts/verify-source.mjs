import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import vm from "node:vm";

const APPROVED_ICON_SHA256 =
  "a2893e96e83fed237c7063747c1f41c10c30ea85e3911149c13b02bfa861f808";
const TEST_APP_ID = "ca-app-pub-3940256099942544~3347511713";
const TEST_BANNER_ID = "ca-app-pub-3940256099942544/6300978111";
const PACKAGE = "com.goodusestudios.snapebtgrocerytracker";
const LEGAL_ORIGIN = "https://lrodeveloperr.github.io/snap-wic-benefits-tracker-legal";

const read = (path) => readFile(path, "utf8");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const mustContain = (source, value, label = value) =>
  assert.ok(source.includes(value), `missing ${label}`);
const mustNotContain = (source, value, label = value) =>
  assert.ok(!source.includes(value), `forbidden ${label}`);

const [
  html,
  app,
  billing,
  appConfig,
  appJsonText,
  packageText,
  provenance,
  installedAdsPackageText,
  qaWorkflow,
] =
  await Promise.all([
    read("app.html"),
    read("App.tsx"),
    read("src/removeAdsPurchase.ts"),
    read("app.config.js"),
    read("app.json"),
    read("package.json"),
    read("SOURCE_PROVENANCE.md"),
    read("node_modules/react-native-google-mobile-ads/package.json"),
    read(".github/workflows/android-qa-apk.yml"),
  ]);
const appJson = JSON.parse(appJsonText);
const packageJson = JSON.parse(packageText);
const installedAdsPackage = JSON.parse(installedAdsPackageText);

assert.match(html.trimStart(), /^<!doctype html>/i);
assert.match(html, /<\/html>\s*$/i);

const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/gi)].map(
  (match) => match[1],
);
assert.ok(scripts.length >= 5, "canonical HTML scripts are missing");
scripts.forEach((source, index) =>
  new vm.Script(source, { filename: `canonical-inline-${index + 1}.js` }),
);

const storesMatch = html.match(/window\.STORES=(\[[\s\S]*?\]);window\.GROCERY_CATALOG=/);
const catalogMatch = html.match(/window\.GROCERY_CATALOG=(\[[\s\S]*?\]);<\/script>/);
assert.ok(storesMatch && catalogMatch, "catalog payload is missing");
assert.equal(JSON.parse(storesMatch[1]).length, 243, "store catalog changed unexpectedly");
assert.equal(JSON.parse(catalogMatch[1]).length, 687, "grocery catalog changed unexpectedly");

const messageBaseMatch = html.match(/const MESSAGES=(\{[\s\S]*?\});\s*\n\s*Object\.assign/);
assert.ok(messageBaseMatch, "base translations are missing");
const messages = JSON.parse(messageBaseMatch[1]);
const patchPattern = /Object\.assign\(MESSAGES\['(en-US|es-PR)'\],\s*(\{[\s\S]*?\})\s*\);/g;
for (const match of html.matchAll(patchPattern)) {
  Object.assign(messages[match[1]], vm.runInNewContext(`(${match[2]})`));
}
assert.deepEqual(
  Object.keys(messages["en-US"]).sort(),
  Object.keys(messages["es-PR"]).sort(),
  "translation catalogs must have identical keys",
);
assert.equal(messages["en-US"]["purchase.subtitle"], "One-time Google Play purchase. No subscription.");
assert.match(messages["es-PR"]["purchase.subtitle"], /Google Play/);
assert.doesNotMatch(messages["en-US"]["app.webTitle"], /iOS|iPhone|App Store|Apple Account/);
assert.doesNotMatch(messages["es-PR"]["app.webTitle"], /iOS|iPhone|App Store|Cuenta de Apple/);

mustContain(html, "const TERMS_VERSION='2026-08-11'", "pinned Terms version");
mustContain(html, "onboarded:false", "fresh state onboarding gate");
mustContain(html, "legalAcceptance:null", "fresh state legal acceptance");
mustContain(html, "seq=['legal','program']", "legal-first onboarding sequence");
mustContain(html, "id=\"onAgeConfirmed\"", "adult confirmation checkbox");
mustContain(html, "id=\"onTermsAccepted\"", "Terms and Privacy checkbox");
mustContain(html, "privacyAcknowledged:true", "Privacy acknowledgment record");
mustContain(html, "if(!state.onboarded){", "onboarding route guard");
mustContain(html, "if(!hasCurrentLegalAcceptance(state)){", "Terms route guard");
mustContain(html, "el('shell').classList.add('hidden')", "hidden tracker shell");
mustContain(html, "type:'legal-ready',ready:!!state.onboarded&&hasCurrentLegalAcceptance(state)", "native legal gate");
for (const path of ["/terms/", "/privacy/", "/support/", "/official-sources/"]) {
  mustContain(html, `${LEGAL_ORIGIN}${path}`, `canonical legal link ${path}`);
}

mustContain(app, TEST_BANNER_ID, "Google Android demo banner ID");
mustContain(app, "requestNonPersonalizedAdsOnly: true", "non-personalized ad request");
mustContain(app, "<BannerAd", "single banner format");
mustContain(app, "legalReady &&", "native legal ad gate");
mustContain(app, 'removeAdsEntitlement === "not-entitled"', "free-user ad gate");
mustContain(app, 'id="android-native-layout"', "Android-only layout layer");
mustContain(app, 'data-native-platform="android"', "Android document marker");
mustContain(app, "-webkit-text-size-adjust: 100%", "stable Android WebView text scale");
mustContain(app, "grid-template-columns: minmax(0, 1fr)", "shrinkable Android grids");
mustContain(app, '.report-filters > *', "shrinkable Android report filters");
mustContain(app, '.report-filter-grid > *', "shrinkable Android report filter grid");
mustContain(app, "padding-right: 12px !important", "effective narrow Android gutter");
mustContain(app, "textZoom={100}", "explicit Android WebView text zoom");
mustContain(app, "runtime.setRuntimeBannerHeight(0)", "native-flow ad layout");
mustContain(app, "styles.bannerRail", "native-flow banner rail");
mustContain(app, 'accessibilityElementsHidden={!bannerVisible}', "hidden-ad accessibility gate");
mustContain(app, 'bannerVisible ? "auto" : "no-hide-descendants"', "hidden-ad TalkBack gate");
mustNotContain(app, "bannerOverlay", "absolute banner overlay");
mustNotContain(app, "AD_SLOT_BOTTOM", "hard-coded banner offset");
mustNotContain(app, "InterstitialAd", "interstitial ads");
mustNotContain(app, "RewardedAd", "rewarded ads");
mustContain(appConfig, TEST_APP_ID, "Google Android demo app ID");
mustContain(appConfig, "ANDROID_PRODUCTION_KEYS", "production AdMob checks");
mustContain(appConfig, "invalidOwnership", "production publisher ownership check");

mustContain(billing, 'REMOVE_ADS_PRODUCT_ID = "remove_ads_lifetime"');
mustContain(billing, 'type: "in-app"', "one-time Play product type");
mustContain(billing, "getAvailablePurchases", "owned Play purchase query");
mustContain(billing, 'purchase.store !== "google"', "Google purchase validation");
mustContain(billing, "isConsumable: false", "non-consumable acknowledgement");
mustNotContain(billing, 'type: "subs"', "subscription product type");
mustNotContain(billing.toLowerCase(), "monthly", "monthly billing plan");
mustNotContain(billing.toLowerCase(), "annual", "annual billing plan");

mustContain(app, "setNotificationChannelAsync", "Android notification channel");
mustContain(app, "requestPermissionsAsync", "Android notification permission request");
mustContain(app, "enableVibrate: false", "silent reminder channel");
mustContain(app, "onRenderProcessGone", "Android WebView recovery");
mustContain(app, "BackHandler.addEventListener", "Android hardware back handling");

assert.equal(appJson.expo.name, "SNAP-EBT & WIC Benefits Tracker");
assert.deepEqual(appJson.expo.platforms, ["android"]);
assert.equal(appJson.expo.android.package, PACKAGE);
assert.equal(appJson.expo.android.allowBackup, false);
assert.ok(appJson.expo.android.permissions.includes("android.permission.POST_NOTIFICATIONS"));
assert.ok(appJson.expo.android.blockedPermissions.includes("android.permission.VIBRATE"));
assert.equal(packageJson.name, "snap-ebt-wic-benefits-tracker-android");
assert.equal(packageJson.dependencies["react-native-google-mobile-ads"], "16.3.4");
assert.equal(installedAdsPackage.version, "16.3.4");
assert.equal(installedAdsPackage.sdkVersions.android.googleMobileAds, "25.0.0");
assert.equal(installedAdsPackage.sdkVersions.android.googleUmp, "4.0.0");
mustContain(qaWorkflow, '"$zipalign" -P 16 -f -v 4', "16 KiB APK alignment");
mustContain(qaWorkflow, "-sigalg SHA256withRSA", "modern QA certificate signature");
mustContain(qaWorkflow, "--v1-signing-enabled true", "APK v1 signature");
mustContain(qaWorkflow, "--v2-signing-enabled true", "APK v2 signature");
mustContain(qaWorkflow, "--v3-signing-enabled true", "APK v3 signature");
mustContain(qaWorkflow, "--min-sdk-version 23", "APK v1 verification floor");
mustContain(qaWorkflow, "--max-sdk-version 23", "APK v1 compatibility verification");
mustContain(qaWorkflow, "adb install --no-streaming", "Android 15 install smoke test");
mustContain(
  qaWorkflow,
  "reactivecircus/android-emulator-runner@a421e43855164a8197daf9d8d40fe71c6996bb0d",
  "pinned Android emulator runner",
);
mustContain(qaWorkflow, "target: aosp_atd", "lean Android 15 test image");
mustContain(qaWorkflow, "emulator-boot-timeout: 420", "bounded Android emulator boot");
assert.ok(
  qaWorkflow.indexOf("- name: Upload QA APK") <
    qaWorkflow.indexOf("- name: Prove APK installs on Android 15"),
  "validated APK must be preserved before emulator infrastructure runs",
);

for (const path of ["assets/icon.png", "assets/brand-logo-ui.png", "assets/splash-icon.png"]) {
  const bytes = await readFile(path);
  assert.equal(sha256(bytes), APPROVED_ICON_SHA256, `${path} is not the reviewed artwork`);
}
for (const path of ["assets/android-icon-foreground.png", "assets/android-icon-monochrome.png"]) {
  const bytes = await readFile(path);
  assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", `${path} is not PNG`);
  assert.ok((await stat(path)).size > 10_000, `${path} is unexpectedly small`);
}

const generated = await read("src/appHtml.ts");
const expectedHtmlDigest = sha256(Buffer.from(html));
mustContain(generated, `APP_HTML_SHA256 = \"${expectedHtmlDigest}\"`, "embedded HTML digest");
mustContain(generated, "data:image/png;base64,", "embedded reviewed logo");
mustNotContain(generated, "assets/brand-logo-ui.png", "unembedded logo path");

mustContain(provenance, "03d1dd013f215938b82ca1601c88301c9d5ed518", "source commit provenance");
mustContain(provenance, "23d938c18df0e185e54946759a3075ef42ce2a6cbc3a0bff99b3a085387e4fcd", "source archive provenance");

console.log("Android source verification passed.");
