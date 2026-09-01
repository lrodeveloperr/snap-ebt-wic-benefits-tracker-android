import { Directory, File, Paths } from "expo-file-system";
import {
  CameraView,
  useCameraPermissions,
  type BarcodeScanningResult,
  type BarcodeType,
} from "expo-camera";
import * as Notifications from "expo-notifications";
import * as Sharing from "expo-sharing";
import { StatusBar } from "expo-status-bar";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  ActivityIndicator,
  AppState,
  BackHandler,
  Linking,
  Pressable,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";
import mobileAds, {
  AdsConsent,
  AdsConsentPrivacyOptionsRequirementStatus,
  BannerAd,
  BannerAdSize,
  MaxAdContentRating,
} from "react-native-google-mobile-ads";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { WebView as PackageWebView } from "react-native-webview";
import type {
  AndroidWebViewProps,
  ShouldStartLoadRequest,
  WebViewMessageEvent,
  WebViewOpenWindowEvent,
  WebViewRenderProcessGoneEvent,
} from "react-native-webview/lib/WebViewTypes";

import APP_HTML from "./src/appHtml";
import {
  connectRemoveAdsStore,
  fetchRemoveAdsProduct,
  finishVerifiedRemoveAdsPurchase,
  isRemoveAdsAlreadyOwned,
  isRemoveAdsPurchaseCancelled,
  isRemoveAdsPurchaseEvent,
  isRemoveAdsPurchasePending,
  readVerifiedRemoveAdsEntitlement,
  requestRemoveAdsPurchase,
  restoreRemoveAdsPurchase,
} from "./src/removeAdsPurchase";
import type {
  RemoveAdsProduct,
  RemoveAdsStoreConnection,
} from "./src/removeAdsPurchase";

const LOCAL_APP_ORIGIN = "https://snap-ebt-wic.local/";
const AD_BANNER_HEIGHT = 50;
const AD_RAIL_SEPARATOR_HEIGHT = 10;
const AD_RAIL_HEIGHT = AD_BANNER_HEIGHT + AD_RAIL_SEPARATOR_HEIGHT;
const GOOGLE_DEMO_PUBLISHER_ID = "3940256099942544";
const PLAY_BILLING_CONNECTION_RETRY_DELAYS_MS = [0, 1000, 3000] as const;
const PLAY_BILLING_ENTITLEMENT_RETRY_DELAYS_MS = [0, 500, 2000] as const;
const MAX_SHARE_BYTES = 20 * 1024 * 1024;
const MAX_SHARE_DATA_URL_CHARS = 28 * 1024 * 1024;
const NOTIFICATION_OWNER = "snap-ebt-grocery-tracker:local-reminder:v1";
const NOTIFICATION_IDENTIFIER_PREFIX = "gbt-local-reminder-v1:";
const ANDROID_REMINDER_CHANNEL_ID = "gbt-local-reminders-v1";
const MAX_OWNED_REMINDERS = 48;

const ANDROID_COPY_REPLACEMENTS = [
  ["iOS Web App", "Android App"],
  ["aplicación web para iOS", "aplicación para Android"],
  ["installed iPhone app", "installed Android app"],
  ["aplicación instalada en el iPhone", "aplicación instalada en Android"],
  ["en este iPhone", "en este dispositivo Android"],
  ["this iPhone", "this Android device"],
  ["Las notificaciones del iPhone", "Las notificaciones de Android"],
  ["iPhone notifications", "Android notifications"],
  ["Apple Account", "Google Account"],
  ["Cuenta de Apple", "Cuenta de Google"],
  ["Apple confirms", "Google Play confirms"],
  ["Apple confirme", "Google Play confirme"],
  ["App Store", "Google Play"],
] as const;

const ANDROID_NATIVE_LAYOUT_STYLE = String.raw`
<style id="android-native-layout">
html[data-native-platform="android"] {
  --radius: 16px;
  --bottom: 56px;
  --ad-nav-height: 56px;
  width: 100%;
  max-width: 100%;
  overflow-x: hidden;
  overflow-x: clip;
  -webkit-text-size-adjust: 100%;
  text-size-adjust: 100%;
}
html[data-native-platform="android"] body,
html[data-native-platform="android"] .app-shell {
  width: 100%;
  max-width: 100%;
  overflow-x: hidden;
  overflow-x: clip;
  font-family: Roboto, "Noto Sans", system-ui, sans-serif;
}
html[data-native-platform="android"] .topbar {
  height: 56px;
  padding: 0 12px;
  grid-template-columns: 44px minmax(0, 1fr) auto;
  background: #fff;
  border-bottom: 1px solid #dfe3e8;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}
html[data-native-platform="android"] .topbar-title {
  padding-left: 8px;
  color: #202124;
  font-size: 20px;
  font-weight: 650;
  letter-spacing: 0;
}
html[data-native-platform="android"] .icon-btn {
  width: 40px;
  height: 40px;
  border-radius: 20px;
}
html[data-native-platform="android"] .main {
  width: 100%;
  max-width: 720px;
  min-width: 0;
  padding: 72px 16px 76px !important;
  margin: 0 auto;
}
html[data-native-platform="android"] .bottom-nav {
  height: 56px;
  padding: 4px 8px;
  background: #fff;
  border-top: 1px solid #dfe3e8;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}
html[data-native-platform="android"] .nav-btn {
  min-width: 0;
  min-height: 48px;
  padding: 3px;
  gap: 2px;
  border-radius: 16px;
}
html[data-native-platform="android"] .nav-btn.active {
  color: #0b73d9;
  background: #e8f1ff !important;
}
html[data-native-platform="android"] .nav-btn span:last-child {
  font-size: 11px;
  font-weight: 650;
}
html[data-native-platform="android"] .drawer {
  padding: 18px 14px 20px;
  border-radius: 0 20px 20px 0;
}
html[data-native-platform="android"] .modal {
  padding: 24px 16px 22px;
}
html[data-native-platform="android"] .onboarding {
  padding: 28px 16px 24px;
}
html[data-native-platform="android"] #storageAlert {
  top: 8px !important;
}
html[data-native-platform="android"] .ad-banner,
html[data-native-platform="android"] .ad-nav-separator {
  display: none !important;
}
html[data-native-platform="android"] .toast {
  bottom: 80px;
}
html[data-native-platform="android"] .page,
html[data-native-platform="android"] .page > *,
html[data-native-platform="android"] .section-card,
html[data-native-platform="android"] .section-card > *,
html[data-native-platform="android"] form,
html[data-native-platform="android"] fieldset,
html[data-native-platform="android"] .field,
html[data-native-platform="android"] .filter-row,
html[data-native-platform="android"] .price-qty-grid,
html[data-native-platform="android"] .price-qty-grid > *,
html[data-native-platform="android"] .home-status-grid > *,
html[data-native-platform="android"] .metric-grid > *,
html[data-native-platform="android"] .report-filters > *,
html[data-native-platform="android"] .report-filter-grid > *,
html[data-native-platform="android"] .wic-top-grid > *,
html[data-native-platform="android"] .wic-dates > *,
html[data-native-platform="android"] .split-grid > *,
html[data-native-platform="android"] .section-head > *,
html[data-native-platform="android"] .two-col > * {
  min-width: 0;
  max-width: 100%;
}
html[data-native-platform="android"] .page {
  gap: 14px;
}
html[data-native-platform="android"] .page-head h1 {
  color: #202124;
  font-size: 28px;
  font-weight: 650;
  letter-spacing: -.4px;
}
html[data-native-platform="android"] .section-card,
html[data-native-platform="android"] .summary-card,
html[data-native-platform="android"] .saved-card,
html[data-native-platform="android"] .history-card {
  border-radius: 16px;
}
html[data-native-platform="android"] label,
html[data-native-platform="android"] .label,
html[data-native-platform="android"] legend {
  color: #5f6368;
  font-size: 14px;
  font-weight: 650;
}
html[data-native-platform="android"] input:not([type="checkbox"]):not([type="radio"]),
html[data-native-platform="android"] select,
html[data-native-platform="android"] .input-like {
  width: 100%;
  max-width: 100%;
  min-width: 0;
  height: 48px;
  min-height: 48px;
  padding: 0 14px;
  border: 1px solid #cbd5df;
  border-radius: 12px;
  background: #fff;
  color: #202124;
  font-size: 16px;
  box-shadow: none;
}
html[data-native-platform="android"] fieldset {
  width: 100%;
  min-inline-size: 0;
  margin-inline: 0;
  padding: 12px;
  border: 1px solid #d6dce3;
  border-radius: 14px;
}
html[data-native-platform="android"] legend {
  padding: 0 5px;
}
html[data-native-platform="android"] .price-qty-grid {
  grid-template-columns: minmax(0, 1fr) minmax(112px, 38%);
  gap: 12px;
}
html[data-native-platform="android"] .stepper {
  min-width: 0;
  grid-template-columns: 40px minmax(0, 1fr) 40px;
  border-radius: 12px;
}
html[data-native-platform="android"] .stepper input {
  width: 100%;
  min-width: 0;
  padding: 0 2px !important;
  border: 0 !important;
  border-radius: 0 !important;
  text-align: center;
  box-shadow: none !important;
}
html[data-native-platform="android"] .chips,
html[data-native-platform="android"] .funding-chips {
  width: 100%;
  max-width: 100%;
  min-width: 0;
}
html[data-native-platform="android"] .filter-row > .chips,
html[data-native-platform="android"] fieldset > .funding-chips {
  flex-wrap: wrap;
  overflow: visible;
}
html[data-native-platform="android"] .fund-chip,
html[data-native-platform="android"] .chips button {
  min-height: 44px;
  padding: 9px 13px;
  border-radius: 14px;
}
html[data-native-platform="android"] .btn {
  border-radius: 12px;
}
html[data-native-platform="android"] .button-row > * {
  min-width: 0;
}
@media (max-width: 380px) {
  html[data-native-platform="android"] .main {
    padding-right: 12px !important;
    padding-left: 12px !important;
  }
  html[data-native-platform="android"] .section-card {
    padding: 14px;
  }
  html[data-native-platform="android"] .price-qty-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>`;

function buildAndroidAppHtml(html: string) {
  let androidHtml = ANDROID_COPY_REPLACEMENTS.reduce(
    (next, [source, replacement]) => next.split(source).join(replacement),
    html,
  );
  const htmlTag = /<html\b([^>]*)>/i;
  if (!htmlTag.test(androidHtml) || !androidHtml.includes("</head>")) {
    throw new Error("Embedded app HTML is missing its document shell");
  }
  androidHtml = androidHtml.replace(
    htmlTag,
    (_tag, attributes: string) =>
      `<html${attributes} data-native-platform="android">`,
  );
  return androidHtml.replace(
    "</head>",
    `${ANDROID_NATIVE_LAYOUT_STYLE}</head>`,
  );
}

const ANDROID_APP_HTML = buildAndroidAppHtml(APP_HTML);

type ConsentState = "unresolved" | "permitted" | "blocked";
type NativeAdState = "idle" | "loading" | "loaded" | "failed";
type RemoveAdsEntitlementState =
  | "checking"
  | "not-entitled"
  | "entitled"
  | "unknown";
type RemoveAdsProductState = "loading" | "ready" | "unavailable";
type RemoveAdsOperation = "idle" | "purchasing" | "restoring";
type RemoveAdsAction = "purchase" | "restore";
type RemoveAdsActionContext = {
  kind: RemoveAdsAction;
  token: number;
};
type RemoveAdsResult =
  | "success"
  | "already-active"
  | "pending"
  | "cancelled"
  | "none"
  | "failed";
type ReminderKind = "snap-balance" | "wic-review" | "wic-expiry";
type ReminderLocale = "en-US" | "es-PR";

type NativeReminderSpec = {
  id: string;
  kind: ReminderKind;
  fireAt: string;
  locale: ReminderLocale;
};

type BarcodeScannerRequest = {
  barcodeTypes: BarcodeType[];
  locale: "en-US" | "es-PR";
  permissionGranted: boolean;
};

const GROCERY_BARCODE_TYPES = [
  "ean13",
  "ean8",
  "upc_a",
  "upc_e",
] as const satisfies readonly BarcodeType[];
const GROCERY_BARCODE_TYPE_SET = new Set<BarcodeType>(GROCERY_BARCODE_TYPES);

type WebViewHandle = {
  injectJavaScript: (script: string) => void;
};

const NativeWebView = PackageWebView as unknown as React.ForwardRefExoticComponent<
  AndroidWebViewProps & React.RefAttributes<WebViewHandle>
>;

type BridgeMessage =
  | { type: "bridge-ready" }
  | { type: "android-back-result"; handled?: boolean }
  | { type: "legal-ready"; ready: boolean; locale?: string }
  | { type: "ad-eligibility"; eligible: boolean }
  | {
      type: "ad-presentation";
      state: string;
      height: number;
      eligible: boolean;
    }
  | { type: "privacy-choices" }
  | { type: "purchase-remove-ads" }
  | { type: "restore-remove-ads" }
  | { type: "share-text"; title?: string; text?: string; url?: string }
  | {
      type: "share-file";
      requestId?: string;
      name?: string;
      mimeType?: string;
      dataUrl?: string;
    }
  | {
      type: "notifications-reconcile";
      requestId?: string;
      optedIn?: boolean;
      requestPermission?: boolean;
      reminders?: unknown;
    }
  | { type: "clear-app-data"; requestId?: string }
  | {
      type: "open-barcode-scanner";
      locale?: string;
      formats?: unknown;
    };

const NATIVE_COPY = {
  "en-US": {
    exportUnavailableTitle: "Export unavailable",
    exportUnavailableBody:
      "The file could not be opened in the Android share sheet. Please try again.",
    advertisingUnavailableTitle: "Advertising unavailable",
    advertisingUnavailableBody:
      "Advertising could not be initialized. Please try again later.",
    privacyChoicesTitle: "Advertising privacy choices",
    privacyChoicesBody:
      "No additional advertising privacy form is required on this device right now.",
    linkUnavailableTitle: "Link unavailable",
    linkUnavailableBody: "This secure web page could not be opened.",
    cameraPermissionTitle: "Camera permission",
    cameraPermissionBody:
      "Allow camera access to scan barcodes. You can also enter the item manually.",
    notNow: "Not now",
    settings: "Settings",
    cameraUnavailableTitle: "Camera unavailable",
    cameraOpenFailedBody:
      "The camera could not be opened. Enter the item manually instead.",
    scannerStartFailedBody:
      "The scanner could not start. Enter the item manually instead.",
    scannerPreparing: "Preparing camera…",
    scannerCancelA11y: "Cancel scanning",
    scannerCancel: "Cancel",
    scannerTitle: "Scan barcode",
    scannerTargetA11y: "Place the barcode inside the frame",
    scannerHint: "Place the UPC or EAN barcode inside the frame",
  },
  "es-PR": {
    exportUnavailableTitle: "Exportación no disponible",
    exportUnavailableBody:
      "No se pudo abrir el archivo en la hoja para compartir de Android. Intenta de nuevo.",
    advertisingUnavailableTitle: "Publicidad no disponible",
    advertisingUnavailableBody:
      "No se pudo iniciar la publicidad. Intenta de nuevo más tarde.",
    privacyChoicesTitle: "Opciones de privacidad de publicidad",
    privacyChoicesBody:
      "Este dispositivo no necesita otro formulario de privacidad de publicidad en este momento.",
    linkUnavailableTitle: "Enlace no disponible",
    linkUnavailableBody: "No se pudo abrir esta página web segura.",
    cameraPermissionTitle: "Permiso de cámara",
    cameraPermissionBody:
      "Permite el acceso a la cámara para escanear códigos de barras. También puedes escribir el artículo manualmente.",
    notNow: "Ahora no",
    settings: "Configuración",
    cameraUnavailableTitle: "Cámara no disponible",
    cameraOpenFailedBody:
      "No se pudo abrir la cámara. Escribe el artículo manualmente.",
    scannerStartFailedBody:
      "No se pudo iniciar el escáner. Escribe el artículo manualmente.",
    scannerPreparing: "Preparando la cámara…",
    scannerCancelA11y: "Cancelar escaneo",
    scannerCancel: "Cancelar",
    scannerTitle: "Escanear código de barras",
    scannerTargetA11y: "Coloca el código de barras dentro del marco",
    scannerHint: "Coloca el código UPC o EAN dentro del marco",
  },
} as const;

function requestedGroceryBarcodeTypes(formats: unknown): BarcodeType[] {
  if (!Array.isArray(formats)) return [...GROCERY_BARCODE_TYPES];
  const requested = formats.filter(
    (format): format is BarcodeType =>
      typeof format === "string" &&
      GROCERY_BARCODE_TYPE_SET.has(format as BarcodeType),
  );
  return requested.length ? [...new Set(requested)] : [...GROCERY_BARCODE_TYPES];
}

function waitFor(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function hasMatchingProductionAdMobIdentifiers(
  approvedPublisherId: string,
  appId: string,
  bannerId: string,
) {
  const appMatch = /^ca-app-pub-(\d{16})~\d{10}$/.exec(appId);
  const bannerMatch = /^ca-app-pub-(\d{16})\/\d{10}$/.exec(bannerId);
  return Boolean(
    /^\d{16}$/.test(approvedPublisherId) &&
      approvedPublisherId !== GOOGLE_DEMO_PUBLISHER_ID &&
      appMatch?.[1] === approvedPublisherId &&
      bannerMatch?.[1] === approvedPublisherId,
  );
}

Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const isOwned =
      notification.request.content.data?.owner === NOTIFICATION_OWNER;
    return {
      shouldShowBanner: isOwned,
      shouldShowList: isOwned,
      shouldPlaySound: false,
      shouldSetBadge: false,
    };
  },
});

const NATIVE_BRIDGE_SCRIPT = String.raw`
(function () {
  if (window.__GBT_NATIVE_BRIDGE_INSTALLED__) return;
  window.__GBT_NATIVE_BRIDGE_INSTALLED__ = true;
  const post = function (payload) {
    try {
      window.ReactNativeWebView.postMessage(JSON.stringify(payload));
    } catch (_) {}
  };
  const bridgeError = function (code, message) {
    const error = new Error(String(message || code || "Native operation failed"));
    error.code = String(code || "NATIVE_OPERATION_FAILED");
    return error;
  };

  const pendingFileShares = Object.create(null);
  let fileShareInFlight = false;
  window.GBTNativeShareCompleted = function (requestId, ok, code, message) {
    const pending = pendingFileShares[String(requestId || "")];
    if (!pending) return;
    delete pendingFileShares[String(requestId || "")];
    window.clearTimeout(pending.timeout);
    fileShareInFlight = false;
    if (ok) pending.resolve();
    else pending.reject(bridgeError(code || "SHARE_FAILED", message || "File export failed"));
  };
  window.GBTNativeShareFile = function (blob, name, mimeType) {
    if (!(blob instanceof Blob)) {
      return Promise.reject(bridgeError("SHARE_INVALID_BLOB", "Invalid export file"));
    }
    if (fileShareInFlight) {
      return Promise.reject(bridgeError("SHARE_BUSY", "Another export is already open"));
    }
    if (blob.size <= 0 || blob.size > 20 * 1024 * 1024) {
      return Promise.reject(bridgeError("SHARE_SIZE_UNSUPPORTED", "Export file size is not supported"));
    }
    fileShareInFlight = true;
    const requestId = "share-" + Date.now() + "-" + Math.random().toString(36).slice(2);
    return new Promise(function (resolve, reject) {
      const timeout = window.setTimeout(function () {
        delete pendingFileShares[requestId];
        fileShareInFlight = false;
        reject(bridgeError("SHARE_TIMEOUT", "The Android share sheet did not respond"));
      }, 120000);
      pendingFileShares[requestId] = { resolve: resolve, reject: reject, timeout: timeout };
      const reader = new FileReader();
      reader.onload = function () {
        const dataUrl = String(reader.result || "");
        if (!dataUrl || dataUrl.length > 28 * 1024 * 1024) {
          window.GBTNativeShareCompleted(
            requestId,
            false,
            "SHARE_SIZE_UNSUPPORTED",
            "Export file size is not supported"
          );
          return;
        }
        post({
          type: "share-file",
          requestId: requestId,
          name: String(name || "export"),
          mimeType: String(mimeType || blob.type || "application/octet-stream"),
          dataUrl: dataUrl
        });
      };
      reader.onerror = function () {
        window.GBTNativeShareCompleted(
          requestId,
          false,
          "SHARE_READ_FAILED",
          "Export file could not be read"
        );
      };
      try {
        reader.readAsDataURL(blob);
      } catch (_) {
        window.GBTNativeShareCompleted(
          requestId,
          false,
          "SHARE_READ_FAILED",
          "Export file could not be read"
        );
      }
    });
  };

  const pendingNotificationReconciles = Object.create(null);
  let notificationReconcileInFlight = false;
  window.GBTNativeNotificationReconciled = function (
    requestId,
    ok,
    code,
    scheduledCount,
    message
  ) {
    const pending = pendingNotificationReconciles[String(requestId || "")];
    if (!pending) return;
    delete pendingNotificationReconciles[String(requestId || "")];
    window.clearTimeout(pending.timeout);
    notificationReconcileInFlight = false;
    if (ok) {
      pending.resolve({
        code: String(code || "NOTIFICATIONS_RECONCILED"),
        scheduledCount: Number(scheduledCount) || 0
      });
    } else {
      pending.reject(
        bridgeError(
          code || "NOTIFICATIONS_FAILED",
          message || "Reminders could not be scheduled"
        )
      );
    }
  };
  window.GBTNativeReconcileNotifications = function (options) {
    if (
      !options ||
      typeof options !== "object" ||
      typeof options.optedIn !== "boolean" ||
      !Array.isArray(options.reminders)
    ) {
      return Promise.reject(
        bridgeError("NOTIFICATIONS_INVALID_REQUEST", "Invalid reminder request")
      );
    }
    if (notificationReconcileInFlight) {
      return Promise.reject(
        bridgeError("NOTIFICATIONS_BUSY", "Reminder settings are already being saved")
      );
    }
    notificationReconcileInFlight = true;
    const requestId = "notifications-" + Date.now() + "-" + Math.random().toString(36).slice(2);
    return new Promise(function (resolve, reject) {
      const timeout = window.setTimeout(function () {
        delete pendingNotificationReconciles[requestId];
        notificationReconcileInFlight = false;
        reject(
          bridgeError("NOTIFICATIONS_TIMEOUT", "The Android reminder service did not respond")
        );
      }, 30000);
      pendingNotificationReconciles[requestId] = {
        resolve: resolve,
        reject: reject,
        timeout: timeout
      };
      post({
        type: "notifications-reconcile",
        requestId: requestId,
        optedIn: options.optedIn === true,
        requestPermission: options.requestPermission === true,
        reminders: options.reminders
      });
    });
  };

  const pendingAppDataClears = Object.create(null);
  let appDataClearInFlight = false;
  window.GBTNativeClearAppDataCompleted = function (requestId, ok, code, message) {
    const pending = pendingAppDataClears[String(requestId || "")];
    if (!pending) return;
    delete pendingAppDataClears[String(requestId || "")];
    window.clearTimeout(pending.timeout);
    appDataClearInFlight = false;
    if (ok) {
      pending.resolve({ code: String(code || "APP_DATA_CLEARED") });
    } else {
      pending.reject(
        bridgeError(
          code || "APP_DATA_CLEAR_FAILED",
          message || "Native app data could not be cleared"
        )
      );
    }
  };
  window.GBTNativeClearAppData = function () {
    if (appDataClearInFlight) {
      return Promise.reject(
        bridgeError("APP_DATA_CLEAR_BUSY", "App data is already being cleared")
      );
    }
    appDataClearInFlight = true;
    const requestId = "clear-app-data-" + Date.now() + "-" + Math.random().toString(36).slice(2);
    return new Promise(function (resolve, reject) {
      const timeout = window.setTimeout(function () {
        delete pendingAppDataClears[requestId];
        appDataClearInFlight = false;
        reject(
          bridgeError("APP_DATA_CLEAR_TIMEOUT", "The Android data service did not respond")
        );
      }, 30000);
      pendingAppDataClears[requestId] = {
        resolve: resolve,
        reject: reject,
        timeout: timeout
      };
      post({ type: "clear-app-data", requestId: requestId });
    });
  };

  const nativeShare = async function (payload) {
    const files = payload && payload.files ? Array.from(payload.files) : [];
    if (files.length) {
      const file = files[0];
      return window.GBTNativeShareFile(
        file,
        file.name || "export",
        file.type || "application/octet-stream"
      );
    }
    post({
      type: "share-text",
      title: payload && payload.title ? String(payload.title) : "",
      text: payload && payload.text ? String(payload.text) : "",
      url: payload && payload.url ? String(payload.url) : ""
    });
  };

  try {
    Object.defineProperty(navigator, "canShare", {
      configurable: true,
      value: function (payload) {
        return Boolean(payload && payload.files && payload.files.length);
      }
    });
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: nativeShare
    });
  } catch (_) {}

  try {
    window.webkit = window.webkit || {};
    window.webkit.messageHandlers = window.webkit.messageHandlers || {};
    window.webkit.messageHandlers.openPrivacyChoices = {
      postMessage: function () { post({ type: "privacy-choices" }); }
    };
  } catch (_) {}

  let lastEligibility = null;
  let lastPresentation = "";
  const publishAdPresentation = function () {
    const runtime = window.GBTAdRuntime;
    if (!runtime || typeof runtime.getLayoutMetrics !== "function") return;
    const metrics = runtime.getLayoutMetrics();
    const eligible = Boolean(metrics.canRequestRealAd);
    if (eligible !== lastEligibility) {
      lastEligibility = eligible;
      post({ type: "ad-eligibility", eligible: eligible });
    }
    const presentation = String(metrics.state) + "|" + String(metrics.runtimeHeight) + "|" + String(eligible);
    if (presentation !== lastPresentation) {
      lastPresentation = presentation;
      post({
        type: "ad-presentation",
        state: String(metrics.state || ""),
        height: Number(metrics.runtimeHeight) || 0,
        eligible: eligible
      });
    }
  };
  window.addEventListener("gbt-ad-presentation-change", publishAdPresentation);
  window.setInterval(publishAdPresentation, 250);
  publishAdPresentation();

  document.addEventListener("click", function (event) {
    const target = event.target;
    const routeButton = target && typeof target.closest === "function"
      ? target.closest("[data-route]")
      : null;
    if (!routeButton) return;
    window.setTimeout(function () {
      window.scrollTo(0, 0);
      const main = document.getElementById("main");
      if (main && typeof main.scrollTo === "function") main.scrollTo(0, 0);
    }, 0);
  }, true);

  post({ type: "bridge-ready" });
})();
true;
`;

const ANDROID_BACK_SCRIPT = String.raw`
(function () {
  let handled = false;
  try {
    const moneyPadShade = document.getElementById("moneyPadShade");
    const modalShade = document.getElementById("modalShade");
    const drawerShade = document.getElementById("drawerShade");
    const onboarding = document.getElementById("onboarding");

    if (moneyPadShade && moneyPadShade.classList.contains("open")) {
      if (typeof closeMoneyPad === "function") closeMoneyPad();
      else moneyPadShade.click();
      handled = true;
    } else if (modalShade && modalShade.classList.contains("open")) {
      let dismissible = true;
      try {
        dismissible = typeof modalState === "undefined" || modalState !== "rollover";
      } catch (_) {}
      if (dismissible) {
        if (typeof closeModal === "function") closeModal();
        else document.querySelector('[data-action="close-modal"]')?.click();
      }
      handled = true;
    } else if (drawerShade && drawerShade.classList.contains("open")) {
      if (typeof closeDrawer === "function") closeDrawer();
      else drawerShade.click();
      handled = true;
    } else if (onboarding && !onboarding.classList.contains("hidden")) {
      const backButton = onboarding.querySelector('[data-action="onboard-back"]');
      if (backButton) {
        backButton.click();
        handled = true;
      }
    } else {
      if (typeof window.GBTAndroidBack === "function") {
        handled = window.GBTAndroidBack() === true;
      }
      if (handled) {
        // The web application owns its route stack.
      } else {
      let currentRoute = "";
      try {
        if (typeof state === "object") currentRoute = String(state.route || "home");
      } catch (_) {}
      if (!currentRoute) {
        currentRoute = String(
          document.querySelector('[data-route][aria-current="page"]')?.dataset?.route || "home"
        );
      }
      if (currentRoute !== "home") {
        if (typeof setRoute === "function") setRoute("home");
        else document.querySelector('[data-route="home"]')?.click();
        handled = true;
      }
      }
    }
  } catch (_) {}
  try {
    window.ReactNativeWebView.postMessage(JSON.stringify({
      type: "android-back-result",
      handled: handled
    }));
  } catch (_) {}
})();
true;
`;

class NativeBridgeError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "NativeBridgeError";
    this.code = code;
  }
}

function sanitizedFileName(value: unknown) {
  const name = String(value || "export")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
    .replace(/^\.+/, "")
    .slice(0, 180);
  return name || "export";
}

function parseDataUrl(dataUrl: string) {
  if (!dataUrl || dataUrl.length > MAX_SHARE_DATA_URL_CHARS) {
    throw new NativeBridgeError(
      "SHARE_SIZE_UNSUPPORTED",
      "Export file size is not supported",
    );
  }
  const separator = dataUrl.indexOf(",");
  if (separator < 0) {
    throw new NativeBridgeError(
      "SHARE_INVALID_DATA_URL",
      "Invalid file payload",
    );
  }
  const header = dataUrl.slice(0, separator);
  const payload = dataUrl.slice(separator + 1);
  if (
    !/^data:[^,]*;base64$/i.test(header) ||
    payload.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(payload)
  ) {
    throw new NativeBridgeError(
      "SHARE_INVALID_BASE64",
      "Invalid base64 file payload",
    );
  }
  const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
  const byteLength = (payload.length / 4) * 3 - padding;
  if (byteLength <= 0 || byteLength > MAX_SHARE_BYTES) {
    throw new NativeBridgeError(
      "SHARE_SIZE_UNSUPPORTED",
      "Export file size is not supported",
    );
  }
  return { payload, byteLength };
}

function nativeBridgeFailure(
  error: unknown,
  fallbackCode: string,
  fallbackMessage: string,
) {
  return error instanceof NativeBridgeError
    ? error
    : new NativeBridgeError(fallbackCode, fallbackMessage);
}

function notificationIdentifier(id: string) {
  return `${NOTIFICATION_IDENTIFIER_PREFIX}${id}`;
}

function normalizeReminderSpecs(value: unknown): NativeReminderSpec[] {
  if (!Array.isArray(value)) {
    throw new NativeBridgeError(
      "NOTIFICATIONS_INVALID_REQUEST",
      "Reminder list is invalid",
    );
  }
  if (value.length > MAX_OWNED_REMINDERS) {
    throw new NativeBridgeError(
      "NOTIFICATIONS_TOO_MANY",
      `No more than ${MAX_OWNED_REMINDERS} local reminders can be scheduled`,
    );
  }

  const now = Date.now();
  const latest = now + 370 * 24 * 60 * 60 * 1000;
  const seen = new Set<string>();
  return value.map((candidate, index) => {
    if (!candidate || typeof candidate !== "object") {
      throw new NativeBridgeError(
        "NOTIFICATIONS_INVALID_REMINDER",
        `Reminder ${index + 1} is invalid`,
      );
    }
    const record = candidate as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id.trim() : "";
    const kind = record.kind;
    const fireAt =
      typeof record.fireAt === "string" ? record.fireAt.trim() : "";
    const locale = record.locale;
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(id) || seen.has(id)) {
      throw new NativeBridgeError(
        "NOTIFICATIONS_INVALID_REMINDER_ID",
        `Reminder ${index + 1} has an invalid or duplicate identifier`,
      );
    }
    if (
      kind !== "snap-balance" &&
      kind !== "wic-review" &&
      kind !== "wic-expiry"
    ) {
      throw new NativeBridgeError(
        "NOTIFICATIONS_INVALID_KIND",
        `Reminder ${index + 1} has an unsupported type`,
      );
    }
    if (locale !== "en-US" && locale !== "es-PR") {
      throw new NativeBridgeError(
        "NOTIFICATIONS_INVALID_LOCALE",
        `Reminder ${index + 1} has an unsupported locale`,
      );
    }
    if (!/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(fireAt)) {
      throw new NativeBridgeError(
        "NOTIFICATIONS_INVALID_DATE",
        `Reminder ${index + 1} must include a time zone`,
      );
    }
    const fireAtMs = Date.parse(fireAt);
    if (!Number.isFinite(fireAtMs) || fireAtMs <= now + 30_000 || fireAtMs > latest) {
      throw new NativeBridgeError(
        "NOTIFICATIONS_INVALID_DATE",
        `Reminder ${index + 1} is outside the supported scheduling window`,
      );
    }
    seen.add(id);
    return { id, kind, fireAt: new Date(fireAtMs).toISOString(), locale };
  });
}

function notificationCopy(kind: ReminderKind, locale: ReminderLocale) {
  if (locale === "es-PR") {
    if (kind === "snap-balance") {
      return {
        title: "Recordatorio de SNAP",
        body: "Abre la aplicación para revisar tu saldo guardado en este dispositivo.",
      };
    }
    return kind === "wic-review"
      ? {
          title: "Recordatorio de WIC",
          body: "Abre la aplicación para revisar tus beneficios mensuales de WIC.",
        }
      : {
          title: "Beneficios de WIC por vencer",
          body: "Abre la aplicación para revisar los beneficios que vencen pronto.",
        };
  }
  if (kind === "snap-balance") {
    return {
      title: "SNAP reminder",
      body: "Open the app to review the balance stored on this device.",
    };
  }
  return kind === "wic-review"
    ? {
        title: "WIC reminder",
        body: "Open the app to review your monthly WIC benefits.",
      }
    : {
        title: "WIC benefits expiring soon",
        body: "Open the app to review benefits that are nearing expiration.",
      };
}

function isOwnedNotification(request: Notifications.NotificationRequest) {
  return request.content.data?.owner === NOTIFICATION_OWNER;
}

async function cancelOwnedScheduledReminders(keep = new Set<string>()) {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    scheduled
      .filter(
        (request) =>
          isOwnedNotification(request) && !keep.has(request.identifier),
      )
      .map((request) =>
        Notifications.cancelScheduledNotificationAsync(request.identifier),
      ),
  );
}

function purgeShareCacheRoot() {
  const shareCacheRoot = new Directory(Paths.cache, "gbt-share");
  if (shareCacheRoot.exists) shareCacheRoot.delete();
  if (shareCacheRoot.exists) {
    throw new NativeBridgeError(
      "APP_DATA_CACHE_CLEAR_FAILED",
      "Temporary export files could not be cleared",
    );
  }
}

function notificationsAllowed(
  permission: Notifications.NotificationPermissionsStatus,
) {
  return permission.granted;
}

async function ensureAndroidReminderChannel() {
  await Notifications.setNotificationChannelAsync(
    ANDROID_REMINDER_CHANNEL_ID,
    {
      name: "Local reminders",
      description: "Silent SNAP and WIC reminders stored on this device",
      importance: Notifications.AndroidImportance.DEFAULT,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
      showBadge: false,
      sound: null,
      vibrationPattern: null,
      enableLights: false,
      enableVibrate: false,
    },
  );
}

function fileUti(name: string, mimeType?: string) {
  const extension = name.toLowerCase().split(".").pop();
  if (extension === "pdf" || mimeType === "application/pdf") {
    return "com.adobe.pdf";
  }
  if (extension === "csv" || mimeType?.startsWith("text/csv")) {
    return "public.comma-separated-values-text";
  }
  if (
    extension === "xlsx" ||
    mimeType ===
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  ) {
    return "org.openxmlformats.spreadsheetml.sheet";
  }
  if (extension === "json" || mimeType?.startsWith("application/json")) {
    return "public.json";
  }
  if (extension === "txt" || mimeType?.startsWith("text/plain")) {
    return "public.plain-text";
  }
  return "public.data";
}

export default function App() {
  const webViewRef = useRef<WebViewHandle>(null);
  const androidBackRequestAtRef = useRef(0);
  const barcodeScannerOpenRef = useRef(false);
  const barcodeResultConsumedRef = useRef(false);
  const adsInitializationRef = useRef<Promise<boolean> | null>(null);
  const previousWebAdStateRef = useRef("AD_LOADING");
  const removeAdsEntitlementRef =
    useRef<RemoveAdsEntitlementState>("checking");
  const removeAdsEntitledRef = useRef(false);
  const removeAdsStoreRef = useRef<RemoveAdsStoreConnection | null>(null);
  const removeAdsOperationRef = useRef<RemoveAdsOperation>("idle");
  const removeAdsActionRef = useRef<RemoveAdsActionContext | null>(null);
  const removeAdsActionSequenceRef = useRef(0);
  const removeAdsDeliveryQueueRef = useRef<Promise<void>>(Promise.resolve());
  const removeAdsReconcileQueueRef = useRef<Promise<void>>(Promise.resolve());
  const [webReady, setWebReady] = useState(false);
  const [webViewInstance, setWebViewInstance] = useState(0);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [barcodeScannerRequest, setBarcodeScannerRequest] =
    useState<BarcodeScannerRequest | null>(null);
  const [appLocale, setAppLocale] = useState<keyof typeof NATIVE_COPY>("en-US");
  const [legalReady, setLegalReady] = useState(false);
  const [privacyChoicesRequired, setPrivacyChoicesRequired] = useState(false);
  const [removeAdsEntitlement, setRemoveAdsEntitlement] =
    useState<RemoveAdsEntitlementState>("checking");
  const [removeAdsProductState, setRemoveAdsProductState] =
    useState<RemoveAdsProductState>("loading");
  const [removeAdsProduct, setRemoveAdsProduct] =
    useState<RemoveAdsProduct | null>(null);
  const [removeAdsStoreReady, setRemoveAdsStoreReady] = useState(false);
  const [removeAdsOperation, setRemoveAdsOperation] =
    useState<RemoveAdsOperation>("idle");
  const [consentState, setConsentState] =
    useState<ConsentState>("unresolved");
  const [adEligible, setAdEligible] = useState(false);
  const [nativeAdState, setNativeAdState] =
    useState<NativeAdState>("idle");
  const [webAdState, setWebAdState] = useState("AD_LOADING");
  const [adLoadAttempt, setAdLoadAttempt] = useState(0);
  const [bannerInstance, setBannerInstance] = useState(0);
  const nativeCopy = NATIVE_COPY[appLocale];

  const productionBannerId =
    process.env.EXPO_PUBLIC_ANDROID_ADMOB_BANNER_ID?.trim() || "";
  const productionAppId =
    process.env.EXPO_PUBLIC_ANDROID_ADMOB_APP_ID?.trim() || "";
  const approvedPublisherId =
    process.env.EXPO_PUBLIC_ADMOB_PUBLISHER_ID?.trim() || "";
  const adProfile = process.env.EXPO_PUBLIC_AD_PROFILE?.trim() || "";
  const testAds = adProfile === "test";
  const productionAds = adProfile === "production";
  const productionAdsConfigured =
    productionAds &&
    hasMatchingProductionAdMobIdentifiers(
      approvedPublisherId,
      productionAppId,
      productionBannerId,
    );
  const testAppMatch = /^ca-app-pub-(\d{16})~\d{10}$/.exec(productionAppId);
  const testBannerMatch = /^ca-app-pub-(\d{16})\/\d{10}$/.exec(
    productionBannerId,
  );
  const testAdsConfigured =
    testAds &&
    testAppMatch?.[1] === GOOGLE_DEMO_PUBLISHER_ID &&
    testBannerMatch?.[1] === GOOGLE_DEMO_PUBLISHER_ID;
  const adProfileConfigured = testAdsConfigured || productionAdsConfigured;
  const bannerUnitId = adProfileConfigured ? productionBannerId : "";

  useEffect(() => {
    try {
      purgeShareCacheRoot();
    } catch (error) {
      console.warn("Stale export cache cleanup failed", error);
    }
    void Promise.allSettled([
      ensureAndroidReminderChannel(),
      Notifications.setAutoServerRegistrationEnabledAsync(false),
      Notifications.unregisterForNotificationsAsync(),
    ]);
  }, []);

  const setRemoveAdsOperationState = useCallback(
    (operation: RemoveAdsOperation) => {
      removeAdsOperationRef.current = operation;
      setRemoveAdsOperation(operation);
    },
    [],
  );

  const applyRemoveAdsEntitlementState = useCallback(
    (entitlement: RemoveAdsEntitlementState) => {
      removeAdsEntitlementRef.current = entitlement;
      removeAdsEntitledRef.current = entitlement === "entitled";
      setRemoveAdsEntitlement(entitlement);
      if (entitlement === "entitled") {
        setNativeAdState("idle");
        setAdLoadAttempt(0);
      }
    },
    [],
  );

  const completeRemoveAdsAction = useCallback(
    (action: RemoveAdsAction, result: RemoveAdsResult) => {
      webViewRef.current?.injectJavaScript(`
        window.GBTPurchaseRuntime?.complete(
          ${JSON.stringify(action)},
          ${JSON.stringify(result)}
        );
        true;
      `);
    },
    [],
  );

  const refreshRemoveAdsProduct = useCallback(async () => {
    setRemoveAdsProductState("loading");
    try {
      const product = await fetchRemoveAdsProduct();
      if (!product) {
        setRemoveAdsProduct(null);
        setRemoveAdsProductState("unavailable");
        return null;
      }
      setRemoveAdsProduct(product);
      setRemoveAdsProductState("ready");
      return product;
    } catch {
      setRemoveAdsProduct(null);
      setRemoveAdsProductState("unavailable");
      return null;
    }
  }, []);

  const reconcileRemoveAdsEntitlement = useCallback(() => {
    const reconciliation = removeAdsReconcileQueueRef.current.then(
      async (): Promise<boolean | null> => {
        for (const delay of PLAY_BILLING_ENTITLEMENT_RETRY_DELAYS_MS) {
          if (delay > 0) await waitFor(delay);
          try {
            const result = await readVerifiedRemoveAdsEntitlement();
            if (result.entitled && result.purchase) {
              await finishVerifiedRemoveAdsPurchase(result.purchase);
            }
            applyRemoveAdsEntitlementState(
              result.entitled ? "entitled" : "not-entitled",
            );
            return result.entitled;
          } catch {}
        }
        applyRemoveAdsEntitlementState(
          removeAdsEntitledRef.current ? "entitled" : "unknown",
        );
        return null;
      },
    );
    removeAdsReconcileQueueRef.current = reconciliation.then(() => undefined);
    return reconciliation;
  }, [applyRemoveAdsEntitlementState]);

  const deliverRemoveAdsPurchase = useCallback(
    (
      purchase: Parameters<typeof isRemoveAdsPurchaseEvent>[0],
      purchaseAction: RemoveAdsActionContext | null,
    ) => {
      if (!isRemoveAdsPurchaseEvent(purchase)) return Promise.resolve();
      const delivery = removeAdsDeliveryQueueRef.current.then(async () => {
        if (purchase.purchaseState !== "purchased") {
          if (
            purchaseAction?.kind === "purchase" &&
            removeAdsActionRef.current === purchaseAction
          ) {
            removeAdsActionRef.current = null;
            completeRemoveAdsAction(
              "purchase",
              purchase.purchaseState === "pending" ? "pending" : "failed",
            );
            setRemoveAdsOperationState("idle");
          }
          return;
        }
        const ownsPurchaseAction =
          purchaseAction?.kind === "purchase" &&
          removeAdsActionRef.current === purchaseAction;
        if (ownsPurchaseAction) removeAdsActionRef.current = null;
        try {
          const entitled = await reconcileRemoveAdsEntitlement();
          if (entitled !== true) {
            if (ownsPurchaseAction) {
              completeRemoveAdsAction("purchase", "failed");
            }
            return;
          }
          if (ownsPurchaseAction) {
            completeRemoveAdsAction("purchase", "success");
          }
        } finally {
          if (ownsPurchaseAction) setRemoveAdsOperationState("idle");
        }
      });
      removeAdsDeliveryQueueRef.current = delivery.catch((error) => {
        console.warn("Google Play Billing purchase delivery failed", error);
      });
      return delivery;
    },
    [
      completeRemoveAdsAction,
      reconcileRemoveAdsEntitlement,
      setRemoveAdsOperationState,
    ],
  );

  const settleRemoveAdsPurchaseError = useCallback(
    async (error: unknown, action: RemoveAdsActionContext | null) => {
      if (
        action?.kind !== "purchase" ||
        removeAdsActionRef.current !== action
      ) {
        return;
      }
      removeAdsActionRef.current = null;
      try {
        if (isRemoveAdsAlreadyOwned(error)) {
          const entitled = await reconcileRemoveAdsEntitlement();
          completeRemoveAdsAction(
            "purchase",
            entitled === true ? "success" : "failed",
          );
        } else if (isRemoveAdsPurchaseCancelled(error)) {
          completeRemoveAdsAction("purchase", "cancelled");
        } else if (isRemoveAdsPurchasePending(error)) {
          completeRemoveAdsAction("purchase", "pending");
        } else {
          completeRemoveAdsAction("purchase", "failed");
        }
      } finally {
        setRemoveAdsOperationState("idle");
      }
    },
    [
      completeRemoveAdsAction,
      reconcileRemoveAdsEntitlement,
      setRemoveAdsOperationState,
    ],
  );

  useEffect(() => {
    let active = true;
    let connectionTask: Promise<void> | null = null;
    const listeners = {
      onPurchaseUpdated: (
        purchase: Parameters<typeof isRemoveAdsPurchaseEvent>[0],
      ) => {
        if (active) {
          const action = removeAdsActionRef.current;
          const purchaseAction = action?.kind === "purchase" ? action : null;
          void deliverRemoveAdsPurchase(purchase, purchaseAction).catch(
            (error) => {
              console.warn("Google Play Billing purchase update failed", error);
            },
          );
        }
      },
      onPurchaseError: (error: unknown) => {
        const action = removeAdsActionRef.current;
        if (active && action?.kind === "purchase") {
          void settleRemoveAdsPurchaseError(error, action);
        }
      },
    };
    const connectWithRetry = async () => {
      for (const delay of PLAY_BILLING_CONNECTION_RETRY_DELAYS_MS) {
        if (!active || removeAdsStoreRef.current) return;
        if (delay > 0) await waitFor(delay);
        if (!active || removeAdsStoreRef.current) return;
        try {
          const connection = await connectRemoveAdsStore(listeners);
          if (!active) {
            connection.close();
            return;
          }
          removeAdsStoreRef.current = connection;
          setRemoveAdsStoreReady(true);
          await Promise.all([
            reconcileRemoveAdsEntitlement(),
            refreshRemoveAdsProduct(),
          ]);
          return;
        } catch (error) {
          console.warn("Google Play Billing Remove Ads setup is unavailable", error);
          if (active) {
            setRemoveAdsStoreReady(false);
            applyRemoveAdsEntitlementState("unknown");
            setRemoveAdsProduct(null);
            setRemoveAdsProductState("unavailable");
          }
        }
      }
    };
    const ensureStoreConnection = () => {
      if (removeAdsStoreRef.current) {
        return Promise.all([
          reconcileRemoveAdsEntitlement(),
          refreshRemoveAdsProduct(),
        ]).then(() => undefined);
      }
      if (!connectionTask) {
        connectionTask = connectWithRetry().finally(() => {
          connectionTask = null;
        });
      }
      return connectionTask;
    };
    const appStateSubscription = AppState.addEventListener(
      "change",
      (state) => {
        if (active && state === "active") void ensureStoreConnection();
      },
    );
    void ensureStoreConnection();
    return () => {
      active = false;
      appStateSubscription.remove();
      removeAdsStoreRef.current?.close();
      removeAdsStoreRef.current = null;
    };
  }, [
    applyRemoveAdsEntitlementState,
    completeRemoveAdsAction,
    deliverRemoveAdsPurchase,
    reconcileRemoveAdsEntitlement,
    refreshRemoveAdsProduct,
    settleRemoveAdsPurchaseError,
    setRemoveAdsOperationState,
  ]);

  const ensureAdsInitialized = useCallback(async () => {
    if (removeAdsEntitlementRef.current !== "not-entitled") return false;
    if (!adProfileConfigured) return false;
    if (!adsInitializationRef.current) {
      adsInitializationRef.current = (async () => {
        await mobileAds().setRequestConfiguration({
          maxAdContentRating: MaxAdContentRating.G,
        });
        if (removeAdsEntitlementRef.current !== "not-entitled") return false;
        await mobileAds().initialize();
        return true;
      })().catch((error) => {
        adsInitializationRef.current = null;
        throw error;
      });
    }
    const initialization = adsInitializationRef.current;
    const initialized = await initialization;
    if (!initialized && adsInitializationRef.current === initialization) {
      adsInitializationRef.current = null;
    }
    return (
      initialized &&
      removeAdsEntitlementRef.current === "not-entitled"
    );
  }, [adProfileConfigured]);

  const startAdsIfAllowed = useCallback(
    async () => {
      if (removeAdsEntitlementRef.current !== "not-entitled") return false;
      // Google's demo app ID cannot be linked to this publisher's UMP
      // messages. Internal builds use only Google's fixed demo banner, so
      // initialize that test inventory directly. Production builds continue
      // to fail closed behind the publisher-owned UMP consent state.
      if (testAds) {
        setPrivacyChoicesRequired(false);
        return ensureAdsInitialized();
      }
      if (!productionAdsConfigured) return false;
      let currentInfo;
      try {
        currentInfo = await AdsConsent.getConsentInfo();
        setPrivacyChoicesRequired(
          currentInfo.privacyOptionsRequirementStatus ===
            AdsConsentPrivacyOptionsRequirementStatus.REQUIRED,
        );
      } catch {
        return false;
      }
      if (
        !currentInfo.canRequestAds ||
        removeAdsEntitlementRef.current !== "not-entitled"
      ) {
        return false;
      }
      return ensureAdsInitialized();
    },
    [ensureAdsInitialized, productionAdsConfigured, testAds],
  );

  useEffect(() => {
    if (
      removeAdsEntitlement !== "not-entitled" ||
      !legalReady ||
      consentState !== "unresolved"
    ) {
      return;
    }
    let active = true;
    void (async () => {
      if (!adProfileConfigured) {
        setConsentState("blocked");
        return;
      }
      if (testAds) {
        try {
          const started = await startAdsIfAllowed();
          if (active) setConsentState(started ? "permitted" : "blocked");
        } catch {
          if (active) setConsentState("blocked");
        }
        return;
      }
      try {
        const consent = await AdsConsent.gatherConsent();
        if (active) {
          setPrivacyChoicesRequired(
            consent.privacyOptionsRequirementStatus ===
              AdsConsentPrivacyOptionsRequirementStatus.REQUIRED,
          );
        }
      } catch {}
      if (!active) return;
      try {
        const started = await startAdsIfAllowed();
        if (active) {
          setConsentState(
            started || removeAdsEntitlementRef.current !== "not-entitled"
              ? "permitted"
              : "blocked",
          );
        }
      } catch {
        if (active) {
          setConsentState(
            removeAdsEntitlementRef.current === "not-entitled"
              ? "blocked"
              : "permitted",
          );
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [
    consentState,
    adProfileConfigured,
    legalReady,
    productionAds,
    testAds,
    removeAdsEntitlement,
    startAdsIfAllowed,
  ]);

  useEffect(() => {
    if (
      removeAdsEntitlement !== "not-entitled" ||
      !legalReady ||
      consentState !== "permitted"
    ) {
      return;
    }
    let active = true;
    void startAdsIfAllowed()
      .then((started) => {
        if (
          active &&
          !started &&
          removeAdsEntitlementRef.current === "not-entitled"
        ) {
          setConsentState("blocked");
        }
      })
      .catch(() => {
        if (
          active &&
          removeAdsEntitlementRef.current === "not-entitled"
        ) {
          setConsentState("blocked");
        }
      });
    return () => {
      active = false;
    };
  }, [
    consentState,
    legalReady,
    removeAdsEntitlement,
    startAdsIfAllowed,
  ]);

  useEffect(() => {
    if (!adEligible || removeAdsEntitlement !== "not-entitled") {
      setNativeAdState("idle");
      setAdLoadAttempt(0);
      return;
    }
    setNativeAdState("loading");
  }, [adEligible, removeAdsEntitlement]);

  useEffect(() => {
    if (
      nativeAdState !== "failed" ||
      !adEligible ||
      consentState !== "permitted" ||
      removeAdsEntitlement !== "not-entitled" ||
      adLoadAttempt >= 2
    ) {
      return;
    }
    const retryTimer = setTimeout(
      () => {
        setAdLoadAttempt((attempt) => attempt + 1);
        setBannerInstance((instance) => instance + 1);
        setNativeAdState("loading");
      },
      2000 * 2 ** adLoadAttempt,
    );
    return () => clearTimeout(retryTimer);
  }, [
    adEligible,
    adLoadAttempt,
    consentState,
    nativeAdState,
    removeAdsEntitlement,
  ]);

  useEffect(() => {
    const previous = previousWebAdStateRef.current;
    previousWebAdStateRef.current = webAdState;
    if (
      previous === "AD_TEMPORARILY_HIDDEN" &&
      webAdState !== "AD_TEMPORARILY_HIDDEN" &&
      adEligible &&
      consentState === "permitted" &&
      removeAdsEntitlement === "not-entitled"
    ) {
      setAdLoadAttempt(0);
      setBannerInstance((instance) => instance + 1);
      setNativeAdState("loading");
    }
  }, [adEligible, consentState, removeAdsEntitlement, webAdState]);

  const syncAdRuntime = useCallback(() => {
    if (!webReady) return;
    const consent =
      consentState === "permitted"
        ? "REQUEST_PERMITTED"
        : consentState === "blocked"
          ? "REQUEST_BLOCKED"
          : "UNRESOLVED";
    const state =
      removeAdsEntitlement !== "not-entitled" ||
      consentState === "blocked" ||
      !adEligible
        ? "AD_DISABLED"
        : nativeAdState === "loaded"
          ? "AD_LOADED"
          : nativeAdState === "failed"
            ? "AD_UNAVAILABLE"
            : "AD_LOADING";
    webViewRef.current?.injectJavaScript(`
      (function () {
        const runtime = window.GBTAdRuntime;
        if (!runtime) return;
        runtime.setMode("REAL");
        runtime.setConsentStatus(${JSON.stringify(consent)});
        runtime.setRuntimeBannerHeight(0);
        runtime.setState(${JSON.stringify(state)});
      })();
      true;
    `);
  }, [
    adEligible,
    consentState,
    nativeAdState,
    removeAdsEntitlement,
    webReady,
  ]);

  useEffect(() => {
    syncAdRuntime();
  }, [syncAdRuntime]);

  const syncRemoveAdsRuntime = useCallback(() => {
    if (!webReady) return;
    const status =
      removeAdsEntitlement === "entitled"
        ? "active"
        : removeAdsOperation === "purchasing"
          ? "purchasing"
          : removeAdsOperation === "restoring"
            ? "restoring"
            : removeAdsEntitlement === "checking"
              ? "checking"
              : removeAdsProductState === "ready"
                ? "ready"
                : "unavailable";
    webViewRef.current?.injectJavaScript(`
      window.GBTPurchaseRuntime?.setState({
        status: ${JSON.stringify(status)},
        adsRemoved: ${removeAdsEntitlement === "entitled"},
        displayPrice: ${JSON.stringify(removeAdsProduct?.displayPrice || "")},
        canPurchase: ${
          removeAdsStoreReady &&
          removeAdsProductState === "ready" &&
          removeAdsEntitlement === "not-entitled" &&
          removeAdsOperation === "idle"
        },
        canRestore: ${
          removeAdsStoreReady && removeAdsOperation === "idle"
        }
      });
      true;
    `);
  }, [
    removeAdsEntitlement,
    removeAdsOperation,
    removeAdsProduct?.displayPrice,
    removeAdsProductState,
    removeAdsStoreReady,
    webReady,
  ]);

  useEffect(() => {
    syncRemoveAdsRuntime();
  }, [syncRemoveAdsRuntime]);

  const syncAdvertisingPrivacyOptions = useCallback(() => {
    if (!webReady) return;
    webViewRef.current?.injectJavaScript(`
      window.GBTAdvertisingPrivacyOptions?.setRequired(${privacyChoicesRequired});
      true;
    `);
  }, [privacyChoicesRequired, webReady]);

  useEffect(() => {
    syncAdvertisingPrivacyOptions();
  }, [syncAdvertisingPrivacyOptions]);

  const completeNativeFileShare = useCallback(
    (
      requestId: string | undefined,
      ok: boolean,
      code: string,
      message = "",
    ) => {
      if (!requestId) return;
      webViewRef.current?.injectJavaScript(`
        window.GBTNativeShareCompleted?.(
          ${JSON.stringify(requestId)},
          ${ok ? "true" : "false"},
          ${JSON.stringify(code)},
          ${JSON.stringify(message)}
        );
        true;
      `);
    },
    [],
  );

  const shareFile = useCallback(async (message: BridgeMessage) => {
    if (message.type !== "share-file") return;
    if (!message.dataUrl) {
      completeNativeFileShare(
        message.requestId,
        false,
        "SHARE_MISSING_PAYLOAD",
        "Export file is missing",
      );
      return;
    }
    const name = sanitizedFileName(message.name);
    const shareDirectory = new Directory(
      Paths.cache,
      "gbt-share",
      sanitizedFileName(
        `${message.requestId || "share"}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      ),
    );
    const file = new File(shareDirectory, name);
    try {
      const { payload: base64, byteLength } = parseDataUrl(message.dataUrl);
      shareDirectory.create({ idempotent: true, intermediates: true });
      file.create({ overwrite: true, intermediates: true });
      file.write(base64, { encoding: "base64" });
      if (!file.exists || Number(file.size) !== byteLength) {
        throw new NativeBridgeError(
          "SHARE_WRITE_FAILED",
          "Export file could not be prepared",
        );
      }
      if (!(await Sharing.isAvailableAsync())) {
        throw new NativeBridgeError(
          "SHARE_UNAVAILABLE",
          "System sharing is unavailable",
        );
      }
      await Sharing.shareAsync(file.uri, {
        dialogTitle: name,
        mimeType: message.mimeType || "application/octet-stream",
        UTI: fileUti(name, message.mimeType),
      });
      completeNativeFileShare(message.requestId, true, "SHARE_COMPLETED");
    } catch (error) {
      console.error("Native file export failed", error);
      const failure = nativeBridgeFailure(
        error,
        "SHARE_FAILED",
        "Export failed",
      );
      completeNativeFileShare(
        message.requestId,
        false,
        failure.code,
        failure.message,
      );
      Alert.alert(
        nativeCopy.exportUnavailableTitle,
        nativeCopy.exportUnavailableBody,
      );
    } finally {
      setTimeout(() => {
        try {
          shareDirectory.delete();
        } catch {}
      }, 15000);
    }
  }, [completeNativeFileShare, nativeCopy]);

  const completeNativeNotificationReconcile = useCallback(
    (
      requestId: string | undefined,
      ok: boolean,
      code: string,
      scheduledCount: number,
      message = "",
    ) => {
      if (!requestId) return;
      webViewRef.current?.injectJavaScript(`
        window.GBTNativeNotificationReconciled?.(
          ${JSON.stringify(requestId)},
          ${ok ? "true" : "false"},
          ${JSON.stringify(code)},
          ${Math.max(0, Math.trunc(scheduledCount))},
          ${JSON.stringify(message)}
        );
        true;
      `);
    },
    [],
  );

  const completeNativeAppDataClear = useCallback(
    (
      requestId: string | undefined,
      ok: boolean,
      code: string,
      message = "",
    ) => {
      if (!requestId) return;
      webViewRef.current?.injectJavaScript(`
        window.GBTNativeClearAppDataCompleted?.(
          ${JSON.stringify(requestId)},
          ${ok ? "true" : "false"},
          ${JSON.stringify(code)},
          ${JSON.stringify(message)}
        );
        true;
      `);
    },
    [],
  );

  const clearNativeAppData = useCallback(
    async (message: BridgeMessage) => {
      if (message.type !== "clear-app-data") return;
      try {
        await cancelOwnedScheduledReminders();
        purgeShareCacheRoot();
        completeNativeAppDataClear(
          message.requestId,
          true,
          "APP_DATA_CLEARED",
        );
      } catch (error) {
        console.error("Native app-data cleanup failed", error);
        const failure = nativeBridgeFailure(
          error,
          "APP_DATA_CLEAR_FAILED",
          "Native app data could not be cleared",
        );
        completeNativeAppDataClear(
          message.requestId,
          false,
          failure.code,
          failure.message,
        );
      }
    },
    [completeNativeAppDataClear],
  );

  const reconcileNotifications = useCallback(
    async (message: BridgeMessage) => {
      if (message.type !== "notifications-reconcile") return;

      try {
        if (typeof message.optedIn !== "boolean") {
          throw new NativeBridgeError(
            "NOTIFICATIONS_INVALID_REQUEST",
            "Reminder opt-in state is missing",
          );
        }
        if (!message.optedIn) {
          await cancelOwnedScheduledReminders();
          completeNativeNotificationReconcile(
            message.requestId,
            true,
            "NOTIFICATIONS_DISABLED",
            0,
          );
          return;
        }

        const reminders = normalizeReminderSpecs(message.reminders);
        if (!reminders.length) {
          await cancelOwnedScheduledReminders();
          completeNativeNotificationReconcile(
            message.requestId,
            true,
            "NOTIFICATIONS_CLEARED",
            0,
          );
          return;
        }

        await ensureAndroidReminderChannel();
        let permission = await Notifications.getPermissionsAsync();
        if (
          !notificationsAllowed(permission) &&
          message.requestPermission === true &&
          permission.canAskAgain
        ) {
          permission = await Notifications.requestPermissionsAsync();
        }
        if (!notificationsAllowed(permission)) {
          throw new NativeBridgeError(
            permission.canAskAgain && message.requestPermission !== true
              ? "NOTIFICATIONS_PERMISSION_REQUIRED"
              : "NOTIFICATIONS_PERMISSION_DENIED",
            permission.canAskAgain && message.requestPermission !== true
              ? "Notification permission requires a direct opt-in action"
              : "Notification permission was not granted",
          );
        }

        const desiredIdentifiers = new Set(
          reminders.map((reminder) => notificationIdentifier(reminder.id)),
        );
        for (const reminder of reminders) {
          const copy = notificationCopy(reminder.kind, reminder.locale);
          await Notifications.scheduleNotificationAsync({
            identifier: notificationIdentifier(reminder.id),
            content: {
              ...copy,
              sound: false,
              data: {
                owner: NOTIFICATION_OWNER,
                reminderId: reminder.id,
                reminderKind: reminder.kind,
                fireAt: reminder.fireAt,
                schemaVersion: 1,
              },
            },
            trigger: {
              type: Notifications.SchedulableTriggerInputTypes.DATE,
              date: new Date(reminder.fireAt),
              channelId: ANDROID_REMINDER_CHANNEL_ID,
            },
          });
        }
        await cancelOwnedScheduledReminders(desiredIdentifiers);
        completeNativeNotificationReconcile(
          message.requestId,
          true,
          "NOTIFICATIONS_RECONCILED",
          reminders.length,
        );
      } catch (error) {
        console.error("Native reminder reconciliation failed", error);
        const failure = nativeBridgeFailure(
          error,
          "NOTIFICATIONS_FAILED",
          "Reminders could not be scheduled",
        );
        completeNativeNotificationReconcile(
          message.requestId,
          false,
          failure.code,
          0,
          failure.message,
        );
      }
    },
    [completeNativeNotificationReconcile],
  );

  const shareText = useCallback(async (message: BridgeMessage) => {
    if (message.type !== "share-text") return;
    const remoteUrl =
      typeof message.url === "string" &&
      /^https:\/\//i.test(message.url) &&
      !message.url.startsWith(LOCAL_APP_ORIGIN)
        ? message.url
        : undefined;
    const text = [message.text, remoteUrl].filter(Boolean).join("\n");
    if (!text) return;
    try {
      await Share.share({
        title: message.title || undefined,
        message: text,
        url: remoteUrl,
      });
    } catch {}
  }, []);

  const showPrivacyChoices = useCallback(async () => {
    if (!productionAdsConfigured) {
      setPrivacyChoicesRequired(false);
      return;
    }
    try {
      await AdsConsent.showPrivacyOptionsForm();
      const info = await AdsConsent.getConsentInfo();
      setPrivacyChoicesRequired(
        info.privacyOptionsRequirementStatus ===
          AdsConsentPrivacyOptionsRequirementStatus.REQUIRED,
      );
      if (!info.canRequestAds) {
        setConsentState("blocked");
        return;
      }
      if (removeAdsEntitlementRef.current !== "not-entitled") {
        setConsentState("permitted");
        return;
      }
      try {
        const started = await startAdsIfAllowed();
        setConsentState(
          started || removeAdsEntitlementRef.current !== "not-entitled"
            ? "permitted"
            : "blocked",
        );
      } catch {
        if (removeAdsEntitlementRef.current === "not-entitled") {
          setConsentState("blocked");
          Alert.alert(
            nativeCopy.advertisingUnavailableTitle,
            nativeCopy.advertisingUnavailableBody,
          );
        } else {
          setConsentState("permitted");
        }
      }
    } catch {
      setConsentState("blocked");
      Alert.alert(
        nativeCopy.privacyChoicesTitle,
        nativeCopy.privacyChoicesBody,
      );
    }
  }, [nativeCopy, productionAdsConfigured, startAdsIfAllowed]);

  const beginRemoveAdsPurchase = useCallback(async () => {
    if (removeAdsEntitlementRef.current === "entitled") {
      completeRemoveAdsAction("purchase", "already-active");
      return;
    }
    if (removeAdsEntitlementRef.current !== "not-entitled") {
      completeRemoveAdsAction("purchase", "failed");
      return;
    }
    if (removeAdsOperationRef.current !== "idle") return;
    if (!removeAdsStoreRef.current) {
      completeRemoveAdsAction("purchase", "failed");
      return;
    }
    const product =
      removeAdsProductState === "ready" && removeAdsProduct
        ? removeAdsProduct
        : await refreshRemoveAdsProduct();
    if (!product) {
      completeRemoveAdsAction("purchase", "failed");
      return;
    }
    const action: RemoveAdsActionContext = {
      kind: "purchase",
      token: ++removeAdsActionSequenceRef.current,
    };
    removeAdsActionRef.current = action;
    setRemoveAdsOperationState("purchasing");
    try {
      await requestRemoveAdsPurchase();
    } catch (error) {
      await settleRemoveAdsPurchaseError(error, action);
    }
  }, [
    completeRemoveAdsAction,
    reconcileRemoveAdsEntitlement,
    refreshRemoveAdsProduct,
    removeAdsProduct,
    removeAdsProductState,
    settleRemoveAdsPurchaseError,
    setRemoveAdsOperationState,
  ]);

  const beginRemoveAdsRestore = useCallback(async () => {
    if (removeAdsOperationRef.current !== "idle") return;
    if (removeAdsEntitlementRef.current === "entitled") {
      completeRemoveAdsAction("restore", "already-active");
      return;
    }
    if (!removeAdsStoreRef.current) {
      completeRemoveAdsAction("restore", "failed");
      return;
    }
    const action: RemoveAdsActionContext = {
      kind: "restore",
      token: ++removeAdsActionSequenceRef.current,
    };
    removeAdsActionRef.current = action;
    setRemoveAdsOperationState("restoring");
    try {
      await restoreRemoveAdsPurchase();
      const entitled = await reconcileRemoveAdsEntitlement();
      completeRemoveAdsAction(
        "restore",
        entitled === true ? "success" : entitled === false ? "none" : "failed",
      );
    } catch {
      completeRemoveAdsAction("restore", "failed");
    } finally {
      if (removeAdsActionRef.current === action) {
        removeAdsActionRef.current = null;
        setRemoveAdsOperationState("idle");
      }
    }
  }, [
    completeRemoveAdsAction,
    reconcileRemoveAdsEntitlement,
    setRemoveAdsOperationState,
  ]);

  const finishBarcodeScanner = useCallback(
    (result: "complete" | "cancel", value?: string) => {
      if (
        !barcodeScannerOpenRef.current ||
        barcodeResultConsumedRef.current
      ) {
        return;
      }
      barcodeResultConsumedRef.current = true;
      barcodeScannerOpenRef.current = false;
      setBarcodeScannerRequest(null);
      const argument = result === "complete" ? JSON.stringify(value || "") : "";
      webViewRef.current?.injectJavaScript(`
        window.GBTBarcodeScanner?.${result}(${argument});
        true;
      `);
    },
    [],
  );

  const cancelBarcodeScanner = useCallback(() => {
    finishBarcodeScanner("cancel");
  }, [finishBarcodeScanner]);

  const openBarcodeScanner = useCallback(
    async (message: Extract<BridgeMessage, { type: "open-barcode-scanner" }>) => {
      if (barcodeScannerOpenRef.current) return;
      barcodeScannerOpenRef.current = true;
      barcodeResultConsumedRef.current = false;
      const locale = message.locale === "es-PR" ? "es-PR" : "en-US";
      const copy = NATIVE_COPY[locale];
      const barcodeTypes = requestedGroceryBarcodeTypes(message.formats);
      setBarcodeScannerRequest({
        barcodeTypes,
        locale,
        permissionGranted: cameraPermission?.granted === true,
      });

      try {
        const permission = cameraPermission?.granted
          ? cameraPermission
          : await requestCameraPermission();
        if (!barcodeScannerOpenRef.current) return;
        if (!permission.granted) {
          cancelBarcodeScanner();
          Alert.alert(copy.cameraPermissionTitle, copy.cameraPermissionBody, [
            {
              text: copy.notNow,
              style: "cancel",
            },
            {
              text: copy.settings,
              onPress: () => void Linking.openSettings(),
            },
          ]);
          return;
        }
        setBarcodeScannerRequest((current) =>
          current ? { ...current, permissionGranted: true } : current,
        );
      } catch (error) {
        console.error("Camera permission request failed", error);
        cancelBarcodeScanner();
        Alert.alert(
          copy.cameraUnavailableTitle,
          copy.cameraOpenFailedBody,
        );
      }
    },
    [cameraPermission, cancelBarcodeScanner, requestCameraPermission],
  );

  const handleBarcodeScanned = useCallback(
    (result: BarcodeScanningResult) => {
      if (
        !barcodeScannerOpenRef.current ||
        barcodeResultConsumedRef.current
      ) {
        return;
      }
      const value = String(result.data || "").trim();
      if (!/^\d{8}$|^\d{12,14}$/.test(value)) return;
      finishBarcodeScanner("complete", value);
    },
    [finishBarcodeScanner],
  );

  const handleBarcodeCameraError = useCallback(
    (error: { message: string }) => {
      if (!barcodeScannerOpenRef.current) return;
      const locale = barcodeScannerRequest?.locale || "en-US";
      const copy = NATIVE_COPY[locale];
      console.error("Barcode camera failed to mount", error.message);
      cancelBarcodeScanner();
      Alert.alert(
        copy.cameraUnavailableTitle,
        copy.scannerStartFailedBody,
      );
    },
    [barcodeScannerRequest?.locale, cancelBarcodeScanner],
  );

  const onMessage = useCallback(
    (event: WebViewMessageEvent) => {
      let message: BridgeMessage;
      try {
        message = JSON.parse(event.nativeEvent.data) as BridgeMessage;
      } catch {
        return;
      }
      if (!message || typeof message !== "object" || !("type" in message)) {
        return;
      }
      switch (message.type) {
        case "bridge-ready":
          androidBackRequestAtRef.current = 0;
          setWebReady(true);
          break;
        case "android-back-result":
          androidBackRequestAtRef.current = 0;
          if (message.handled !== true) BackHandler.exitApp();
          break;
        case "legal-ready":
          setLegalReady(Boolean(message.ready));
          if (message.locale === "en-US" || message.locale === "es-PR") {
            setAppLocale(message.locale);
          }
          break;
        case "ad-eligibility":
          setAdEligible(Boolean(message.eligible));
          break;
        case "ad-presentation":
          setWebAdState(message.state);
          break;
        case "privacy-choices":
          if (legalReady && privacyChoicesRequired) void showPrivacyChoices();
          break;
        case "purchase-remove-ads":
          if (legalReady) void beginRemoveAdsPurchase();
          break;
        case "restore-remove-ads":
          if (legalReady) void beginRemoveAdsRestore();
          break;
        case "share-file":
          void shareFile(message);
          break;
        case "share-text":
          void shareText(message);
          break;
        case "notifications-reconcile":
          void reconcileNotifications(message);
          break;
        case "clear-app-data":
          void clearNativeAppData(message);
          break;
        case "open-barcode-scanner":
          void openBarcodeScanner(message);
          break;
      }
    },
    [beginRemoveAdsPurchase, beginRemoveAdsRestore, clearNativeAppData, legalReady, openBarcodeScanner, privacyChoicesRequired, reconcileNotifications, shareFile, shareText, showPrivacyChoices],
  );

  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        if (barcodeScannerOpenRef.current) {
          cancelBarcodeScanner();
          return true;
        }
        if (!webReady || !webViewRef.current) return false;
        if (Date.now() - androidBackRequestAtRef.current < 1500) return true;
        androidBackRequestAtRef.current = Date.now();
        webViewRef.current.injectJavaScript(ANDROID_BACK_SCRIPT);
        return true;
      },
    );
    return () => subscription.remove();
  }, [cancelBarcodeScanner, webReady]);

  const recoverFromRenderProcessLoss = useCallback(
    (event: WebViewRenderProcessGoneEvent) => {
      console.warn(
        `Android WebView renderer ${
          event.nativeEvent.didCrash ? "crashed" : "was reclaimed"
        }; recreating it`,
      );
      androidBackRequestAtRef.current = 0;
      setWebReady(false);
      setLegalReady(false);
      setAdEligible(false);
      setWebAdState("AD_LOADING");
      setWebViewInstance((instance) => instance + 1);
    },
    [],
  );

  const openExternalUrl = useCallback((url: string) => {
    if (!/^https:\/\//i.test(url)) return;
    void Linking.openURL(url).catch(() => {
      Alert.alert(nativeCopy.linkUnavailableTitle, nativeCopy.linkUnavailableBody);
    });
  }, [nativeCopy]);

  const shouldStartNavigation = useCallback(
    (request: ShouldStartLoadRequest) => {
      const url = request.url || "";
      if (
        url === "about:blank" ||
        url.startsWith(LOCAL_APP_ORIGIN)
      ) {
        return true;
      }
      if (/^https:\/\//i.test(url)) openExternalUrl(url);
      return false;
    },
    [openExternalUrl],
  );

  const source = useMemo(
    () => ({ html: ANDROID_APP_HTML, baseUrl: LOCAL_APP_ORIGIN }),
    [],
  );
  const showBanner =
    adProfileConfigured &&
    removeAdsEntitlement === "not-entitled" &&
    legalReady &&
    consentState === "permitted" &&
    adEligible &&
    (nativeAdState !== "failed" || adLoadAttempt < 2);
  const bannerMounted =
    showBanner && webAdState !== "AD_TEMPORARILY_HIDDEN";
  const bannerVisible =
    bannerMounted &&
    nativeAdState === "loaded" &&
    webAdState === "AD_LOADED";
  const scannerCopy =
    NATIVE_COPY[barcodeScannerRequest?.locale === "es-PR" ? "es-PR" : "en-US"];

  return (
    <SafeAreaProvider style={styles.root}>
      <StatusBar style={barcodeScannerRequest ? "light" : "dark"} />
      <SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}>
        <NativeWebView
          accessibilityElementsHidden={Boolean(barcodeScannerRequest)}
          importantForAccessibility={
            barcodeScannerRequest ? "no-hide-descendants" : "auto"
          }
          key={`webview-${webViewInstance}`}
          ref={webViewRef}
          source={source}
          originWhitelist={["https://*", "about:*"]}
          injectedJavaScript={NATIVE_BRIDGE_SCRIPT}
          javaScriptEnabled
          cacheEnabled
          domStorageEnabled
          thirdPartyCookiesEnabled={false}
          mixedContentMode="never"
          setBuiltInZoomControls={false}
          setDisplayZoomControls={false}
          textZoom={100}
          overScrollMode="never"
          allowsFullscreenVideo={false}
          mediaPlaybackRequiresUserAction
          onMessage={onMessage}
          onLoadStart={() => {
            androidBackRequestAtRef.current = 0;
            setWebReady(false);
          }}
          onLoadEnd={() => setWebReady(true)}
          onShouldStartLoadWithRequest={shouldStartNavigation}
          onOpenWindow={(event: WebViewOpenWindowEvent) =>
            openExternalUrl(event.nativeEvent.targetUrl || "")
          }
          onRenderProcessGone={recoverFromRenderProcessLoss}
          style={styles.webView}
        />
        {bannerMounted ? (
          <View
            accessibilityElementsHidden={!bannerVisible}
            importantForAccessibility={
              bannerVisible ? "auto" : "no-hide-descendants"
            }
            pointerEvents={bannerVisible ? "auto" : "none"}
            style={[
              styles.bannerRail,
              !bannerVisible && styles.bannerHidden,
            ]}
          >
            <BannerAd
              key={`banner-${bannerInstance}`}
              unitId={bannerUnitId}
              size={BannerAdSize.BANNER}
              requestOptions={{ requestNonPersonalizedAdsOnly: true }}
              onAdLoaded={() => {
                setAdLoadAttempt(0);
                setNativeAdState("loaded");
              }}
              onAdFailedToLoad={() => setNativeAdState("failed")}
            />
          </View>
        ) : null}
        {testAds ? (
          <View accessibilityElementsHidden style={styles.testMarker} />
        ) : null}
        {barcodeScannerRequest ? (
          <View
            accessibilityViewIsModal
            importantForAccessibility="yes"
            style={styles.scannerOverlay}
          >
            {barcodeScannerRequest.permissionGranted ? (
              <CameraView
                accessible={false}
                barcodeScannerSettings={{
                  barcodeTypes: barcodeScannerRequest.barcodeTypes,
                }}
                facing="back"
                onBarcodeScanned={handleBarcodeScanned}
                onMountError={handleBarcodeCameraError}
                style={styles.scannerCamera}
              />
            ) : (
              <View style={styles.scannerLoading}>
                <ActivityIndicator color="#ffffff" size="large" />
                <Text style={styles.scannerLoadingText}>
                  {scannerCopy.scannerPreparing}
                </Text>
              </View>
            )}
            <View pointerEvents="box-none" style={styles.scannerChrome}>
              <View style={styles.scannerHeader}>
                <Pressable
                  accessibilityLabel={scannerCopy.scannerCancelA11y}
                  accessibilityRole="button"
                  onPress={cancelBarcodeScanner}
                  style={({ pressed }) => [
                    styles.scannerCancel,
                    pressed && styles.scannerCancelPressed,
                  ]}
                >
                  <Text style={styles.scannerCancelText}>
                    {scannerCopy.scannerCancel}
                  </Text>
                </Pressable>
                <Text accessibilityRole="header" style={styles.scannerTitle}>
                  {scannerCopy.scannerTitle}
                </Text>
                <View style={styles.scannerHeaderSpacer} />
              </View>
              <View
                accessible
                accessibilityRole="image"
                accessibilityLabel={scannerCopy.scannerTargetA11y}
                style={styles.scannerTarget}
              />
              <Text style={styles.scannerHint}>
                {scannerCopy.scannerHint}
              </Text>
            </View>
          </View>
        ) : null}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#f2f2f7",
  },
  safeArea: {
    flex: 1,
    backgroundColor: "#f2f2f7",
  },
  webView: {
    flex: 1,
    backgroundColor: "#f2f2f7",
  },
  bannerRail: {
    height: AD_RAIL_HEIGHT,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "flex-end",
    backgroundColor: "#f2f2f7",
    borderTopColor: "#d1d1d6",
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: AD_RAIL_SEPARATOR_HEIGHT,
    overflow: "hidden",
  },
  bannerHidden: {
    opacity: 0,
  },
  testMarker: {
    position: "absolute",
    width: 1,
    height: 1,
    opacity: 0,
  },
  scannerOverlay: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 100,
    backgroundColor: "#111111",
  },
  scannerCamera: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  scannerLoading: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    backgroundColor: "#111111",
  },
  scannerLoadingText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "600",
  },
  scannerChrome: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: "center",
    backgroundColor: "rgba(0, 0, 0, 0.22)",
  },
  scannerHeader: {
    width: "100%",
    height: 64,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    backgroundColor: "rgba(0, 0, 0, 0.66)",
  },
  scannerCancel: {
    minWidth: 80,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 22,
  },
  scannerCancelPressed: {
    backgroundColor: "rgba(255, 255, 255, 0.18)",
  },
  scannerCancelText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "600",
  },
  scannerTitle: {
    flex: 1,
    color: "#ffffff",
    fontSize: 18,
    fontWeight: "700",
    textAlign: "center",
  },
  scannerHeaderSpacer: {
    width: 80,
  },
  scannerTarget: {
    width: "82%",
    maxWidth: 460,
    height: 190,
    marginTop: "42%",
    borderWidth: 3,
    borderColor: "#ffffff",
    borderRadius: 18,
    backgroundColor: "rgba(255, 255, 255, 0.03)",
  },
  scannerHint: {
    maxWidth: 360,
    marginTop: 24,
    paddingHorizontal: 18,
    paddingVertical: 12,
    overflow: "hidden",
    borderRadius: 12,
    color: "#ffffff",
    backgroundColor: "rgba(0, 0, 0, 0.72)",
    fontSize: 16,
    fontWeight: "600",
    textAlign: "center",
  },
});
