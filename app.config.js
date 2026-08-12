const ANDROID_PACKAGE = "com.goodusestudios.snapebtgrocerytracker";
const TEST_ANDROID_APP_ID = "ca-app-pub-3940256099942544~3347511713";
const GOOGLE_TEST_PUBLISHER = "ca-app-pub-3940256099942544";

const ANDROID_PRODUCTION_KEYS = [
  "EXPO_PUBLIC_ANDROID_ADMOB_APP_ID",
  "EXPO_PUBLIC_ANDROID_ADMOB_BANNER_ID",
  "EXPO_PUBLIC_ADMOB_PUBLISHER_ID",
];

function publisherFromAdMobId(value, separator) {
  const match = new RegExp(`^ca-app-pub-(\\d{16})[${separator}]\\d{10}$`).exec(
    String(value || ""),
  );
  return match?.[1] || "";
}

module.exports = ({ config }) => {
  const profile = process.env.EXPO_PUBLIC_BUILD_PROFILE || "qa";
  if (!new Set(["qa", "production"]).has(profile)) {
    throw new Error(
      `Unsupported EXPO_PUBLIC_BUILD_PROFILE: ${profile}. Expected qa or production.`,
    );
  }

  const production = profile === "production";
  const expectedAdProfile = production ? "production" : "test";
  if (process.env.EXPO_PUBLIC_AD_PROFILE !== expectedAdProfile) {
    throw new Error(
      `${profile} builds require EXPO_PUBLIC_AD_PROFILE=${expectedAdProfile}.`,
    );
  }
  if (production) {
    const missing = ANDROID_PRODUCTION_KEYS.filter((key) => !process.env[key]);
    const testIds = ANDROID_PRODUCTION_KEYS.slice(0, 2).filter(
      (key) =>
        String(process.env[key] || "").startsWith(GOOGLE_TEST_PUBLISHER),
    );
    const approvedPublisher = String(
      process.env.EXPO_PUBLIC_ADMOB_PUBLISHER_ID || "",
    ).trim();
    const appPublisher = publisherFromAdMobId(
      process.env.EXPO_PUBLIC_ANDROID_ADMOB_APP_ID,
      "~",
    );
    const bannerPublisher = publisherFromAdMobId(
      process.env.EXPO_PUBLIC_ANDROID_ADMOB_BANNER_ID,
      "/",
    );
    const invalidOwnership =
      Boolean(approvedPublisher) &&
      (!/^\d{16}$/.test(approvedPublisher) ||
        approvedPublisher === "3940256099942544" ||
        appPublisher !== approvedPublisher ||
        bannerPublisher !== approvedPublisher);
    if (missing.length || testIds.length || invalidOwnership) {
      throw new Error(
        `Production AdMob configuration rejected. Missing: ${missing.join(", ") || "none"}. Test IDs: ${testIds.join(", ") || "none"}. Publisher ownership valid: ${!invalidOwnership}.`,
      );
    }
  }

  const androidAppId = production
    ? process.env.EXPO_PUBLIC_ANDROID_ADMOB_APP_ID
    : TEST_ANDROID_APP_ID;
  const requestedVersionCode = Number(
    process.env.ANDROID_VERSION_CODE || config.android.versionCode,
  );
  if (!Number.isSafeInteger(requestedVersionCode) || requestedVersionCode < 1) {
    throw new Error("ANDROID_VERSION_CODE must be a positive integer.");
  }

  return {
    ...config,
    name: production ? config.name : `${config.name} QA`,
    android: {
      ...config.android,
      package: production ? ANDROID_PACKAGE : `${ANDROID_PACKAGE}.qa`,
      versionCode: requestedVersionCode,
    },
    extra: {
      ...(config.extra || {}),
      buildProfile: profile,
      androidPackage: production ? ANDROID_PACKAGE : `${ANDROID_PACKAGE}.qa`,
    },
    plugins: (config.plugins || []).map((plugin) => {
      if (!Array.isArray(plugin) || plugin[0] !== "react-native-google-mobile-ads")
        return plugin;
      return [plugin[0], { ...plugin[1], androidAppId }];
    }),
  };
};
