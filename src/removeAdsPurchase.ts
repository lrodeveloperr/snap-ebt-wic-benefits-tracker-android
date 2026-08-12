import {
  ErrorCode,
  endConnection,
  fetchProducts,
  finishTransaction,
  getAvailablePurchases,
  initConnection,
  purchaseErrorListener,
  purchaseUpdatedListener,
  requestPurchase,
  restorePurchases,
} from "expo-iap";
import type {
  ExpoPurchaseError,
  Purchase,
  PurchaseAndroid,
} from "expo-iap";

export const REMOVE_ADS_PRODUCT_ID = "remove_ads_lifetime";
const ANDROID_PACKAGE_NAME = "com.lateefrazaqoyetola.snapebtwictracker";

export type RemoveAdsProduct = {
  displayName: string;
  displayPrice: string;
  description: string;
};

export type RemoveAdsStoreListeners = {
  onPurchaseUpdated: (purchase: Purchase) => void;
  onPurchaseError: (error: ExpoPurchaseError) => void;
};

export type RemoveAdsStoreConnection = {
  close: () => void;
};

export type VerifiedRemoveAdsEntitlement = {
  entitled: boolean;
  purchase: PurchaseAndroid | null;
};

function isUsableEntitlement(purchase: Purchase): purchase is PurchaseAndroid {
  if (purchase.store !== "google") return false;
  const androidPurchase = purchase as PurchaseAndroid;
  return Boolean(
    androidPurchase.productId === REMOVE_ADS_PRODUCT_ID &&
      androidPurchase.purchaseState === "purchased" &&
      androidPurchase.isSuspendedAndroid !== true &&
      (!androidPurchase.packageNameAndroid ||
        androidPurchase.packageNameAndroid === ANDROID_PACKAGE_NAME),
  );
}

export async function connectRemoveAdsStore(
  listeners: RemoveAdsStoreListeners,
): Promise<RemoveAdsStoreConnection> {
  const updateSubscription = purchaseUpdatedListener(
    listeners.onPurchaseUpdated,
  );
  const errorSubscription = purchaseErrorListener(listeners.onPurchaseError);
  try {
    const connected = await initConnection();
    if (!connected) {
      throw new Error("Google Play Billing connection was not established");
    }
  } catch (error) {
    updateSubscription.remove();
    errorSubscription.remove();
    throw error;
  }
  let closed = false;
  return {
    close() {
      if (closed) return;
      closed = true;
      updateSubscription.remove();
      errorSubscription.remove();
      void endConnection().catch(() => {});
    },
  };
}

export async function fetchRemoveAdsProduct(): Promise<RemoveAdsProduct | null> {
  const products = await fetchProducts({
    skus: [REMOVE_ADS_PRODUCT_ID],
    type: "in-app",
  });
  const product = (products || []).find(
    (candidate) =>
      candidate.id === REMOVE_ADS_PRODUCT_ID &&
      candidate.platform === "android" &&
      candidate.type === "in-app" &&
      (!candidate.productStatusAndroid ||
        candidate.productStatusAndroid === "ok"),
  );
  if (!product?.displayPrice) return null;
  return {
    displayName:
      product.displayName?.trim() || product.title?.trim() || "Remove Ads Forever",
    displayPrice: product.displayPrice,
    description: product.description?.trim() || "",
  };
}

export async function readVerifiedRemoveAdsEntitlement(): Promise<VerifiedRemoveAdsEntitlement> {
  const purchases = await getAvailablePurchases({
    includeSuspendedAndroid: false,
  });
  const purchase = (purchases || []).find(isUsableEntitlement);
  return purchase
    ? { entitled: true, purchase }
    : { entitled: false, purchase: null };
}

export async function requestRemoveAdsPurchase(): Promise<void> {
  await requestPurchase({
    request: {
      google: {
        skus: [REMOVE_ADS_PRODUCT_ID],
      },
    },
    type: "in-app",
  });
}

export async function restoreRemoveAdsPurchase(): Promise<void> {
  await restorePurchases();
}

export async function finishVerifiedRemoveAdsPurchase(
  purchase: Purchase,
): Promise<void> {
  if (!isUsableEntitlement(purchase)) {
    throw new Error("Refusing to acknowledge an invalid Remove Ads purchase");
  }
  if (purchase.isAcknowledgedAndroid === true) return;
  await finishTransaction({ purchase, isConsumable: false });
}

export function removeAdsPurchaseErrorCode(error: unknown): string {
  const code =
    error && typeof error === "object" && "code" in error
      ? String((error as { code?: unknown }).code || "")
      : "";
  return code;
}

export function isRemoveAdsPurchaseCancelled(error: unknown): boolean {
  return removeAdsPurchaseErrorCode(error) === ErrorCode.UserCancelled;
}

export function isRemoveAdsAlreadyOwned(error: unknown): boolean {
  return removeAdsPurchaseErrorCode(error) === ErrorCode.AlreadyOwned;
}

export function isRemoveAdsPurchasePending(error: unknown): boolean {
  const code = removeAdsPurchaseErrorCode(error);
  return code === ErrorCode.Pending || code === ErrorCode.DeferredPayment;
}

export function isRemoveAdsPurchaseEvent(purchase: Purchase): boolean {
  return (
    purchase.store === "google" &&
    purchase.productId === REMOVE_ADS_PRODUCT_ID
  );
}
