import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT_ROOT = path.resolve(
  process.argv[2] || path.join(ROOT, "artifacts", "android-storefront-screenshots"),
);
const FIXED_TODAY = "2026-09-02";
const VIEWPORT = Object.freeze({ width: 360, height: 640 });
const DEVICE_SCALE_FACTOR = 3;

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
];

const EN_ITEMS = [
  ["Apples", "produce", 249],
  ["Bananas", "produce", 179],
  ["Whole milk", "dairy", 429],
  ["Eggs", "dairy", 399],
  ["Whole-wheat bread", "grains", 349],
  ["Chicken breast", "protein", 899],
  ["Brown rice", "grains", 529],
  ["Black beans", "pantry", 169],
  ["Frozen vegetables", "frozen", 379],
  ["Orange juice", "beverages", 449],
  ["Yogurt", "dairy", 119],
  ["Peanut butter", "pantry", 399],
];

const ES_ITEMS = [
  ["Manzanas", "produce", 249],
  ["Guineos", "produce", 179],
  ["Leche entera", "dairy", 429],
  ["Huevos", "dairy", 399],
  ["Pan integral", "grains", 349],
  ["Pechuga de pollo", "protein", 899],
  ["Arroz integral", "grains", 529],
  ["Habichuelas negras", "pantry", 169],
  ["Vegetales congelados", "frozen", 379],
  ["Jugo de naranja", "beverages", 449],
  ["Yogur", "dairy", 119],
  ["Mantequilla de maní", "pantry", 399],
];

const STORES = ["Walmart", "Aldi", "Kroger", "Target", "Publix", "H-E-B"];

function isoDate(year, month, day) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function addMonths(year, month, delta) {
  const date = new Date(Date.UTC(year, month - 1 + delta, 1));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
}

function historyItem({ id, name, category, unitPriceCents, quantity = 1, allocations }) {
  return {
    id,
    name,
    brand: "",
    catalogItemId: null,
    systemNameKey: null,
    quantity,
    quantityRaw: String(quantity),
    quantityUnit: "each",
    unitPriceCents,
    priceKnown: true,
    priceEntryMode: "UNIT_PRICE",
    lineTotalCents: null,
    category,
    snapEligibility: allocations.some((allocation) => allocation.type === "SNAP")
      ? "ELIGIBLE"
      : "UNSURE",
    reportCategoryAtTransaction: category,
    reportCategorySource: "CATALOG",
    allocations,
  };
}

function buildHistory(locale) {
  const localizedItems = locale === "es-PR" ? ES_ITEMS : EN_ITEMS;
  const history = [];
  for (let monthOffset = -11; monthOffset <= 0; monthOffset += 1) {
    const { year, month } = addMonths(2026, 8, monthOffset);
    for (let trip = 0; trip < 4; trip += 1) {
      const date = isoDate(year, month, 4 + trip * 7);
      const rows = [];
      for (let itemOffset = 0; itemOffset < 4; itemOffset += 1) {
        const itemIndex = (monthOffset + 11 + trip * 2 + itemOffset) % localizedItems.length;
        const [name, category, basePrice] = localizedItems[itemIndex];
        const quantity = itemOffset === 1 && trip % 2 === 0 ? 2 : 1;
        const unitPriceCents = basePrice + ((monthOffset + 11 + trip) % 3) * 10;
        const lineTotal = unitPriceCents * quantity;
        let allocations;
        if (itemOffset === 3 && trip % 2 === 1) {
          allocations = [{ type: "CASH", amountCents: lineTotal }];
        } else if (itemOffset === 2 && trip === 2) {
          allocations = [
            {
              type: "WIC",
              cardId: "wic-main",
              allowanceId: "wic-produce",
              unit: "$",
              quantity: lineTotal / 100,
              amountCents: lineTotal,
            },
          ];
        } else {
          allocations = [
            { type: "SNAP", cardId: "snap-main", amountCents: lineTotal },
          ];
        }
        rows.push(
          historyItem({
            id: `history-${year}-${month}-${trip}-${itemOffset}`,
            name,
            category,
            unitPriceCents,
            quantity,
            allocations,
          }),
        );
      }
      const totalKnownCents = rows.reduce(
        (sum, item) => sum + item.unitPriceCents * item.quantity,
        0,
      );
      history.push({
        id: `transaction-${year}-${month}-${trip}`,
        store: STORES[(monthOffset + 11 + trip) % STORES.length],
        storeDisplayName: STORES[(monthOffset + 11 + trip) % STORES.length],
        storeNormalizedKey: STORES[(monthOffset + 11 + trip) % STORES.length].toLowerCase(),
        transactionDate: date,
        createdAt: `${date}T18:15:00.000Z`,
        recordedAt: `${date}T18:15:00.000Z`,
        programJurisdiction: "US_SNAP",
        items: rows,
        totalKnownCents,
        unknownPriceCount: 0,
      });
    }
  }
  return history.sort(
    (left, right) => right.transactionDate.localeCompare(left.transactionDate),
  );
}

function archivedCashPeriods() {
  return Array.from({ length: 12 }, (_, index) => {
    const { year, month } = addMonths(2025, 9, index);
    const start = isoDate(year, month, 1);
    const end = isoDate(year, month, new Date(Date.UTC(year, month, 0)).getUTCDate());
    const periodBudget = 20000 + (index % 3) * 1500;
    const spent = 15300 + ((index * 1739) % 6900);
    const variance = periodBudget - spent;
    return {
      id: `cash-period-${year}-${month}`,
      periodId: `cash-period-${year}-${month}`,
      start,
      end,
      baseBudget: periodBudget,
      carryover: 0,
      periodBudget,
      budget: periodBudget,
      spent,
      variance,
      remaining: Math.max(0, variance),
      overage: Math.max(0, -variance),
      status: variance > 0 ? "UNDER_BUDGET" : variance === 0 ? "AT_BUDGET" : "OVER_BUDGET",
      closedAt: `${end}T23:59:00.000Z`,
      reason: "EXPIRED",
    };
  });
}

function currentBasket(locale) {
  const names = locale === "es-PR"
    ? ["Manzanas", "Leche entera", "Pan integral", "Pechuga de pollo"]
    : ["Apples", "Whole milk", "Whole-wheat bread", "Chicken breast"];
  return {
    store: "Walmart",
    transactionDate: FIXED_TODAY,
    items: [
      {
        id: "basket-apples",
        name: names[0],
        quantity: 2,
        quantityRaw: "2",
        quantityUnit: "each",
        unitPriceCents: 249,
        priceKnown: true,
        priceEntryMode: "UNIT_PRICE",
        lineTotalCents: null,
        category: "produce",
        snapEligibility: "ELIGIBLE",
        funding: { mode: "SNAP", snapCardId: "snap-main" },
      },
      {
        id: "basket-milk",
        name: names[1],
        quantity: 1,
        quantityRaw: "1",
        quantityUnit: "gal",
        unitPriceCents: 429,
        priceKnown: true,
        priceEntryMode: "UNIT_PRICE",
        lineTotalCents: null,
        category: "dairy",
        snapEligibility: "ELIGIBLE",
        funding: {
          mode: "WIC",
          wicCardId: "wic-main",
          allowanceId: "wic-milk",
          wicQuantity: 1,
          wicUnit: "gal",
        },
      },
      {
        id: "basket-bread",
        name: names[2],
        quantity: 1,
        quantityRaw: "1",
        quantityUnit: "each",
        unitPriceCents: 349,
        priceKnown: true,
        priceEntryMode: "UNIT_PRICE",
        lineTotalCents: null,
        category: "grains",
        snapEligibility: "ELIGIBLE",
        funding: { mode: "SNAP", snapCardId: "snap-main" },
      },
      {
        id: "basket-chicken",
        name: names[3],
        quantity: 1,
        quantityRaw: "1",
        quantityUnit: "each",
        unitPriceCents: 899,
        priceKnown: true,
        priceEntryMode: "UNIT_PRICE",
        lineTotalCents: null,
        category: "protein",
        snapEligibility: "UNSURE",
        funding: { mode: "CASH" },
      },
    ],
  };
}

function savedItem(name, category, quantityRaw = "1", quantityUnit = "each") {
  return {
    name,
    brand: "",
    catalogItemId: null,
    systemNameKey: null,
    quantityRaw,
    quantityUnit,
    previousPriceCents: null,
    unitPriceCents: null,
    priceKnown: false,
    snapEligibility: "UNSURE",
    suggestedFunding: null,
    category,
  };
}

function buildDemoState(locale, termsVersion) {
  const spanish = locale === "es-PR";
  return {
    schemaVersion: 26,
    onboarded: true,
    route: "home",
    settings: {
      language: locale,
      programJurisdiction: "US_SNAP",
      enabledPrograms: ["SNAP", "WIC"],
      enabledProgramsChosen: true,
      defaultFundingMode: "SNAP",
      privacyEnabled: false,
      localNotificationsEnabled: false,
      legalAcceptance: {
        version: termsVersion,
        acceptedAt: "2026-09-01T12:00:00.000Z",
        ageConfirmed: true,
        termsAccepted: true,
        privacyAcknowledged: true,
      },
    },
    snapCards: [
      {
        id: "snap-main",
        name: "",
        generatedNameKey: "cards.defaultSnapName",
        generatedNameIndex: 1,
        active: true,
        balance: 18432,
        startingBalance: 31500,
        transactions: [],
        reminder: { enabled: false, nextDate: "", lastNotified: "", anchorDay: null },
      },
    ],
    wicCards: [
      {
        id: "wic-main",
        name: "",
        generatedNameKey: "cards.defaultWicName",
        generatedNameIndex: 1,
        active: true,
        transactions: [],
        reminder: { enabled: false, nextDate: "", lastNotified: "", anchorDay: null },
        allowances: [
          { id: "wic-produce", categoryId: "produce", unit: "$", starting: 52, remaining: 34.75, startDate: "2026-09-01", expiryDate: "2026-09-30", active: true, transactions: [] },
          { id: "wic-milk", categoryId: "milk", unit: "gal", starting: 4, remaining: 3, startDate: "2026-09-01", expiryDate: "2026-09-30", active: true, transactions: [] },
          { id: "wic-eggs", categoryId: "eggs", unit: "dozen", starting: 2, remaining: 2, startDate: "2026-09-01", expiryDate: "2026-09-30", active: true, transactions: [] },
          { id: "wic-grains", categoryId: "grains", unit: "oz", starting: 48, remaining: 32, startDate: "2026-09-01", expiryDate: "2026-09-30", active: true, transactions: [] },
        ],
      },
    ],
    cash: {
      periodId: "cash-current-2026-09",
      baseBudget: 18500,
      carryover: 1500,
      periodBudget: 20000,
      spent: 7645,
      start: "2026-09-01",
      end: "2026-09-30",
      cycle: "monthly",
      customDays: 21,
      anchorPolicy: "DAY_OF_MONTH",
      anchorDay: 1,
      periodState: "ACTIVE",
      status: "UNDER_BUDGET",
      pendingRollover: null,
      periodHistory: archivedCashPeriods(),
    },
    basket: currentBasket(locale),
    savedBaskets: [
      {
        id: "saved-weekly",
        name: spanish ? "Compra semanal" : "Weekly essentials",
        store: "Aldi",
        createdAt: "2026-08-29T12:00:00.000Z",
        items: [
          savedItem(spanish ? "Leche" : "Milk", "dairy"),
          savedItem(spanish ? "Huevos" : "Eggs", "dairy"),
          savedItem(spanish ? "Pan" : "Bread", "grains"),
          savedItem(spanish ? "Guineos" : "Bananas", "produce", "6"),
        ],
      },
      {
        id: "saved-school",
        name: spanish ? "Almuerzos escolares" : "School lunches",
        store: "Walmart",
        createdAt: "2026-08-22T12:00:00.000Z",
        items: [
          savedItem(spanish ? "Manzanas" : "Apples", "produce", "6"),
          savedItem(spanish ? "Yogur" : "Yogurt", "dairy", "5"),
          savedItem(spanish ? "Mantequilla de maní" : "Peanut butter", "pantry"),
        ],
      },
      {
        id: "saved-monthly",
        name: spanish ? "Despensa mensual" : "Monthly pantry",
        store: "Costco",
        createdAt: "2026-08-01T12:00:00.000Z",
        items: [
          savedItem(spanish ? "Arroz integral" : "Brown rice", "grains", "2"),
          savedItem(spanish ? "Habichuelas negras" : "Black beans", "pantry", "4"),
          savedItem(spanish ? "Vegetales congelados" : "Frozen vegetables", "frozen", "3"),
        ],
      },
    ],
    history: buildHistory(locale),
    recentStores: ["Walmart", "Aldi", "Kroger", "Target"],
    recentItems: [],
    barcodeMappings: {},
    importBatches: [],
    entryDrafts: { shop: null, onboarding: null, cash: null, saved: null, store: null },
  };
}

async function buildAndroidHtml() {
  const [html, appSource] = await Promise.all([
    fs.readFile(path.join(ROOT, "app.html"), "utf8"),
    fs.readFile(path.join(ROOT, "App.tsx"), "utf8"),
  ]);
  const styleMatch = appSource.match(
    /const ANDROID_NATIVE_LAYOUT_STYLE = String\.raw`([\s\S]*?)`;\n\nfunction buildAndroidAppHtml/,
  );
  assert.ok(styleMatch, "Android-native layout style could not be extracted");
  let androidHtml = ANDROID_COPY_REPLACEMENTS.reduce(
    (next, [source, replacement]) => next.split(source).join(replacement),
    html,
  );
  androidHtml = androidHtml.replace(
    /<html\b([^>]*)>/i,
    (_tag, attributes) => `<html${attributes} data-native-platform="android">`,
  );
  return androidHtml.replace("</head>", `${styleMatch[1]}</head>`);
}

async function startServer(html) {
  const server = http.createServer((request, response) => {
    if (request.url === "/favicon.ico") {
      response.writeHead(204).end();
      return;
    }
    response.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    });
    response.end(html);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return { server, url: `http://127.0.0.1:${address.port}/` };
}

async function waitForStableUi(page) {
  await page.waitForFunction(() => Boolean(window.GBTApp?.getState));
  await page.waitForTimeout(250);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(100);
}

async function capture(page, outputDirectory, name) {
  await waitForStableUi(page);
  const outputPath = path.join(outputDirectory, `${name}.png`);
  await page.screenshot({ path: outputPath, fullPage: false, animations: "disabled" });
  const stats = await fs.stat(outputPath);
  assert.ok(stats.size > 20_000, `${name} screenshot is unexpectedly small`);
  return { file: path.basename(outputPath), bytes: stats.size };
}

async function captureLocale(browser, serverUrl, locale) {
  const outputDirectory = path.join(OUTPUT_ROOT, locale);
  await fs.mkdir(outputDirectory, { recursive: true });
  const context = await browser.newContext({
    locale,
    viewport: VIEWPORT,
    deviceScaleFactor: DEVICE_SCALE_FACTOR,
    isMobile: true,
    hasTouch: true,
    colorScheme: "light",
  });
  await context.addInitScript(() => {
    Object.defineProperty(window, "ReactNativeWebView", {
      configurable: true,
      value: { postMessage() {} },
    });
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto(serverUrl, { waitUntil: "load" });
  await page.waitForFunction(() => Boolean(window.GBTApp?.setStateForTest));
  const termsVersion = await page.evaluate(() => window.GBTApp.getTermsVersion());
  const demoState = buildDemoState(locale, termsVersion);
  await page.evaluate((state) => window.GBTApp.setStateForTest(state), demoState);
  await page.evaluate(() => {
    window.GBTPurchaseRuntime.setState({
      status: "active",
      adsRemoved: true,
      displayPrice: "$1.99",
      canPurchase: false,
      canRestore: true,
    });
  });

  const captures = [];
  await page.evaluate(() => window.GBTApp.route("home"));
  captures.push(await capture(page, outputDirectory, "01-home"));

  await page.evaluate(() => window.GBTApp.route("cards"));
  captures.push(await capture(page, outputDirectory, "02-cards-and-budget"));

  await page.evaluate(() => window.GBTApp.route("shop"));
  captures.push(await capture(page, outputDirectory, "03-add-groceries"));

  await page.locator('[data-action="go-to-basket"], [data-action="review-checkout"]').first().click();
  captures.push(await capture(page, outputDirectory, "04-review-basket"));
  await page.locator('[data-action="close-modal"]').click();

  await page.evaluate(() => window.GBTApp.route("history"));
  captures.push(await capture(page, outputDirectory, "05-history"));

  await page.locator('[data-action="history-mode"][data-value="INSIGHTS"]').click();
  captures.push(await capture(page, outputDirectory, "06-insights"));

  await page.evaluate(() => window.GBTApp.route("saved"));
  captures.push(await capture(page, outputDirectory, "07-saved-baskets"));

  await page.evaluate(() => {
    window.GBTPurchaseRuntime.setState({
      status: "ready",
      adsRemoved: false,
      displayPrice: "$1.99",
      canPurchase: true,
      canRestore: true,
    });
    window.GBTApp.route("removeAds");
  });
  captures.push(await capture(page, outputDirectory, "08-remove-ads-199"));

  const missingTranslations = await page.evaluate(() =>
    window.GBTApp.getMissingTranslationKeys(),
  );
  assert.deepEqual(missingTranslations, [], `${locale} has missing translations`);
  assert.deepEqual(errors, [], `${locale} browser errors:\n${errors.join("\n")}`);
  await context.close();
  return captures;
}

await fs.mkdir(OUTPUT_ROOT, { recursive: true });
const html = await buildAndroidHtml();
const { server, url } = await startServer(html);
const browser = await chromium.launch({ headless: true });
const manifest = {
  generatedAt: new Date().toISOString(),
  dataset: {
    temporary: true,
    from: "2025-09-04",
    to: "2026-08-25",
    transactionCount: 48,
    note: "Synthetic storefront data; never embedded in the production application.",
  },
  viewport: {
    css: VIEWPORT,
    deviceScaleFactor: DEVICE_SCALE_FACTOR,
    pixels: {
      width: VIEWPORT.width * DEVICE_SCALE_FACTOR,
      height: VIEWPORT.height * DEVICE_SCALE_FACTOR,
    },
  },
  locales: {},
};

try {
  for (const locale of ["en-US", "es-PR"]) {
    manifest.locales[locale] = await captureLocale(browser, url, locale);
  }
} finally {
  await browser.close();
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

await fs.writeFile(
  path.join(OUTPUT_ROOT, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
console.log(`Created 16 Android storefront screenshots in ${OUTPUT_ROOT}`);
