import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import vm from "node:vm";

const APPROVED_ICON_SHA256 =
  "a2893e96e83fed237c7063747c1f41c10c30ea85e3911149c13b02bfa861f808";
const TEST_APP_ID = "ca-app-pub-3940256099942544~3347511713";
const TEST_BANNER_ID = "ca-app-pub-3940256099942544/6300978111";
const PACKAGE = "com.lateefrazaqoyetola.snapebtwictracker";
const LEGAL_ORIGIN = "https://lrodeveloperr.github.io/grocery-benefits-tracker";
const LEGACY_PUBLIC_MARKERS = Object.freeze([
  "SNAP-EBT & WIC Benefits Tracker",
  "SNAP-EBT WIC Benefits Tracker",
  "SNAP-EBT-WIC-Benefits-Tracker",
  "SNAP-EBT · WIC · Shopping budget",
  "PAN · WIC · Presupuesto de compra",
  "https://lrodeveloperr.github.io/snap-wic-benefits-tracker-legal",
  "snap-ebt-wic-history",
  "historial-snap-ebt-wic",
  "snap-ebt-wic-local-recovery.txt",
  "USDA/FNS",
  "fns.usda.gov",
]);

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
  installProof,
  productionWorkflow,
  qaVerifier,
  productionVerifier,
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
    read("scripts/prove-android-install.sh"),
    read(".github/workflows/android-production-aab.yml"),
    read("scripts/verify-android.mjs"),
    read("scripts/verify-android-production.mjs"),
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
assert.equal(
  messages["en-US"]["app.drawerSubtitle"],
  "Manual tracker · Grocery budget",
);
assert.equal(
  messages["es-PR"]["app.drawerSubtitle"],
  "Rastreador manual · Presupuesto de compra",
);

mustContain(html, "const TERMS_VERSION='2026-08-11'", "pinned Terms version");
mustContain(html, "onboarded:false", "fresh state onboarding gate");
mustContain(html, "legalAcceptance:null", "fresh state legal acceptance");
mustContain(
  html,
  "function onboardingSequence(){return ['legal'];}",
  "consent-only onboarding sequence",
);
mustContain(html, "id=\"onLegalCombined\"", "combined legal confirmation checkbox");
mustContain(
  html,
  "onboardingDraft.ageConfirmed=combined.checked;onboardingDraft.termsAccepted=combined.checked",
  "combined adult, Terms, and Privacy confirmation",
);
mustContain(html, "privacyAcknowledged:true", "Privacy acknowledgment record");
mustContain(html, "if(!state.onboarded){", "onboarding route guard");
mustContain(html, "if(!hasCurrentLegalAcceptance(state)){", "Terms route guard");
mustContain(html, "el('shell').classList.add('hidden')", "hidden tracker shell");
mustContain(html, "type:'legal-ready',ready:!!state.onboarded&&hasCurrentLegalAcceptance(state)", "native legal gate");
for (const path of ["/terms/", "/privacy/", "/support/", "/official-sources/"]) {
  mustContain(html, `${LEGAL_ORIGIN}${path}`, `canonical legal link ${path}`);
}
for (const path of [
  "/es/terminos/",
  "/es/privacidad/",
  "/es/soporte/",
  "/es/fuentes-oficiales/",
]) {
  mustContain(html, `${LEGAL_ORIGIN}${path}`, `canonical Spanish legal link ${path}`);
}
for (const marker of LEGACY_PUBLIC_MARKERS) {
  mustNotContain(html, marker, `legacy public marker ${marker}`);
}
mustContain(html, "USDA FNA (formerly FNS)", "current USDA administration name");
assert.equal(
  messages["en-US"]["history.exportFilename"],
  "grocery-benefits-tracker-history",
);
assert.equal(
  messages["es-PR"]["history.exportFilename"],
  "historial-rastreador-beneficios",
);
mustContain(
  html,
  "grocery-benefits-tracker-local-recovery.txt",
  "neutral recovery export filename",
);

mustNotContain(app, TEST_BANNER_ID, "hard-coded Google Android demo banner ID in runtime source");
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
mustContain(app, "runtime.setRuntimeBannerHeight(${height})", "native and house-banner layout");
mustContain(app, "styles.bannerRail", "native-flow banner rail");
mustContain(app, 'accessibilityElementsHidden={!nativeBannerVisible}', "hidden-ad accessibility gate");
mustContain(app, 'nativeBannerVisible ? "auto" : "no-hide-descendants"', "hidden-ad TalkBack gate");
mustContain(app, 'const HOUSE_BANNER_HEIGHT = 58', "house-banner reservation");
mustContain(html, 'data-action="house-ad-purchase"', "house-banner purchase action");
mustContain(html, "function adPlacementAllowed(){return state.route!=='removeAds';}", "high-availability banner placement");
mustNotContain(app, "bannerOverlay", "absolute banner overlay");
mustNotContain(app, "AD_SLOT_BOTTOM", "hard-coded banner offset");
mustNotContain(app, "InterstitialAd", "interstitial ads");
mustNotContain(app, "RewardedAd", "rewarded ads");
mustContain(appConfig, TEST_APP_ID, "Google Android demo app ID");
mustContain(appConfig, TEST_BANNER_ID, "Google Android demo banner ID");
mustContain(appConfig, "ANDROID_PRODUCTION_KEYS", "production AdMob checks");
mustContain(appConfig, "invalidOwnership", "production publisher ownership check");

mustContain(billing, 'REMOVE_ADS_PRODUCT_ID = "remove_ads_lifetime"');
mustContain(billing, `ANDROID_PACKAGE_NAME = "${PACKAGE}"`, "Play package billing validation");
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
mustContain(app, 'case "open-barcode-scanner"', "native barcode bridge handler");
mustContain(app, "<CameraView", "native barcode camera view");
mustContain(app, "GBTBarcodeScanner?.${result}", "barcode result callback");

assert.equal(appJson.expo.name, "Grocery Benefits Tracker");
assert.deepEqual(appJson.expo.platforms, ["android"]);
assert.equal(appJson.expo.android.package, PACKAGE);
assert.equal(appJson.expo.android.allowBackup, false);
assert.ok(appJson.expo.android.permissions.includes("android.permission.POST_NOTIFICATIONS"));
assert.ok(appJson.expo.android.permissions.includes("android.permission.CAMERA"));
assert.ok(!appJson.expo.android.blockedPermissions.includes("android.permission.CAMERA"));
assert.ok(appJson.expo.android.blockedPermissions.includes("android.permission.VIBRATE"));
assert.equal(packageJson.name, "snap-ebt-wic-benefits-tracker-android");
assert.match(packageJson.dependencies["expo-camera"], /^~57\.0\./);
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
mustContain(
  qaWorkflow,
  "reactivecircus/android-emulator-runner@a421e43855164a8197daf9d8d40fe71c6996bb0d",
  "pinned Android emulator runner",
);
mustContain(qaWorkflow, "target: aosp_atd", "lean Android 15 test image");
mustContain(qaWorkflow, "-partition-size 1536", "command-line Android emulator data partition");
mustContain(qaWorkflow, "emulator-boot-timeout: 420", "bounded Android emulator boot");
mustContain(qaWorkflow, "script: bash scripts/prove-android-install.sh", "single-command install proof");
mustContain(installProof, "set -euo pipefail", "strict Android install proof");
mustContain(installProof, "adb install --no-streaming -r", "APK PackageManager install proof");
mustContain(installProof, 'grep -F "versionCode=${ANDROID_VERSION_CODE}"', "installed version proof");
assert.ok(
  qaWorkflow.indexOf("- name: Upload QA APK") <
    qaWorkflow.indexOf("- name: Prove APK installs on Android 15"),
  "validated APK must be preserved before emulator infrastructure runs",
);
mustContain(productionWorkflow, "workflow_dispatch:", "manual production release trigger");
mustNotContain(productionWorkflow, "push:", "automatic production release trigger");
mustContain(productionWorkflow, "ca-app-pub-8054612600809568~2189058911", "live Android AdMob app ID");
mustContain(productionWorkflow, "ca-app-pub-8054612600809568/5751919465", "live Android banner ID");
mustContain(productionWorkflow, "ANDROID_UPLOAD_KEYSTORE_BASE64", "protected upload keystore");
mustContain(productionWorkflow, ":app:bundleRelease", "production bundle build");
mustContain(productionWorkflow, "jarsigner", "AAB upload-key signing");
mustContain(productionWorkflow, "bundletool_version=\"1.18.3\"", "pinned bundletool validation");
mustContain(
  productionWorkflow,
  "a099cfa1543f55593bc2ed16a70a7c67fe54b1747bb7301f37fdfd6d91028e29",
  "pinned bundletool checksum",
);
mustContain(productionWorkflow, "Upload production AAB", "production artifact handoff");
mustContain(productionVerifier, PACKAGE, "production verifier package");
mustContain(productionVerifier, "ca-app-pub-8054612600809568~2189058911", "production verifier app ID");
mustContain(productionVerifier, "ca-app-pub-8054612600809568/5751919465", "production verifier banner ID");
for (const [name, verifier] of [["QA", qaVerifier], ["production", productionVerifier]]) {
  mustContain(verifier, "android\\.permission\\.CAMERA", `${name} verifier requires barcode camera`);
  mustNotContain(verifier, '\n  "CAMERA",', `${name} verifier must not forbid barcode camera`);
}

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
const generatedParts = (
  await Promise.all(
    (await readdir("src"))
      .filter((name) => /^appHtml\.part\d+\.ts$/.test(name))
      .sort((left, right) =>
        Number(left.match(/\d+/)?.[0]) - Number(right.match(/\d+/)?.[0]),
      )
      .map((name) => read(`src/${name}`)),
  )
).join("\n");
const expectedHtmlDigest = sha256(Buffer.from(html));
mustContain(generated, `APP_HTML_SHA256 = \"${expectedHtmlDigest}\"`, "embedded HTML digest");
mustContain(generatedParts, "data:image/png;base64,", "embedded reviewed logo");
mustNotContain(generatedParts, "assets/brand-logo-ui.png", "unembedded logo path");

mustContain(provenance, "03d1dd013f215938b82ca1601c88301c9d5ed518", "source commit provenance");
mustContain(provenance, "23d938c18df0e185e54946759a3075ef42ce2a6cbc3a0bff99b3a085387e4fcd", "source archive provenance");

console.log("Android source verification passed.");
