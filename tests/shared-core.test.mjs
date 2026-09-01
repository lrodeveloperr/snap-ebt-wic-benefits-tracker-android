import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const html = await readFile(new URL("../app.html", import.meta.url), "utf8");
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/gi)].map(
  (match) => match[1],
);

test("every inline application script parses", () => {
  assert.ok(scripts.length >= 5, "expected the canonical inline app scripts");
  scripts.forEach((source, index) => {
    assert.doesNotThrow(
      () => new vm.Script(source, { filename: `app-inline-${index + 1}.js` }),
      `inline script ${index + 1} must parse`,
    );
  });
});

function loadCore() {
  const context = {
    console,
    crypto: globalThis.crypto,
    Date,
    Math,
    JSON,
    structuredClone,
  };
  context.globalThis = context;
  vm.runInNewContext(scripts[0], context, { filename: "gbt-core.js" });
  return context.GBTCore;
}

test("canonical state starts behind the legal/onboarding gate", () => {
  const core = loadCore();
  const state = core.canonicalState();
  assert.equal(core.SCHEMA_VERSION, 27);
  assert.equal(state.schemaVersion, 27);
  assert.equal(state.onboarded, false);
  assert.equal(state.settings.legalAcceptance, null);
  assert.deepEqual(Array.from(state.basket.items), []);
});

test("money and quantity calculations stay exact in cents", () => {
  const core = loadCore();
  assert.equal(core.cents("$12.34"), 1234);
  assert.equal(
    core.itemTotalCents({
      priceKnown: true,
      unitPriceCents: 199,
      quantity: 1.5,
      quantityRaw: "1.5",
    }),
    299,
  );
  assert.equal(
    core.itemTotalCents({
      priceKnown: true,
      priceEntryMode: "LINE_TOTAL",
      lineTotalCents: 725,
    }),
    725,
  );
});

test("checkout validates then atomically updates a SNAP ledger", () => {
  const core = loadCore();
  const state = core.canonicalState();
  state.onboarded = true;
  state.settings.language = "en-US";
  state.snapCards = [
    {
      id: "snap-1",
      name: "SNAP 1",
      active: true,
      balance: 1_000,
      startingBalance: 1_000,
      transactions: [],
      reminder: core.normalizeReminder(null),
    },
  ];
  state.basket = {
    store: "Test Market",
    transactionDate: "2026-08-12",
    items: [
      {
        id: "item-1",
        name: "Apples",
        quantity: 1,
        quantityRaw: "1",
        unitPriceCents: 350,
        priceKnown: true,
        category: "produce",
        snapEligibility: "ELIGIBLE",
        funding: { mode: "SNAP", snapCardId: "snap-1" },
      },
    ],
  };

  const validation = core.validateBasketForCheckout(
    state,
    state.basket,
    "2026-08-12",
  );
  assert.deepEqual(Array.from(validation.blockers), []);

  const result = core.applyCheckoutTransaction(state, validation, {
    transactionDate: "2026-08-12",
    createdAt: "2026-08-12T12:00:00.000Z",
  });
  assert.equal(result.state.snapCards[0].balance, 650);
  assert.equal(result.state.history.length, 1);
  assert.equal(result.state.history[0].totalKnownCents, 350);
  assert.equal(result.state.basket.items.length, 0);
  assert.equal(state.snapCards[0].balance, 1_000, "input state stays unchanged");
});

test("insufficient SNAP funds block checkout without a plan mutation", () => {
  const core = loadCore();
  const state = core.canonicalState();
  state.snapCards = [
    {
      id: "snap-1",
      active: true,
      balance: 100,
      startingBalance: 100,
      transactions: [],
      reminder: core.normalizeReminder(null),
    },
  ];
  state.basket.items = [
    {
      id: "item-1",
      name: "Milk",
      quantity: 1,
      quantityRaw: "1",
      unitPriceCents: 250,
      priceKnown: true,
      snapEligibility: "ELIGIBLE",
      funding: { mode: "SNAP", snapCardId: "snap-1" },
    },
  ];
  const validation = core.validateBasketForCheckout(state);
  assert.ok(validation.blockers.some((item) => item.code === "SNAP_INSUFFICIENT"));
  assert.throws(
    () => core.applyCheckoutTransaction(state, validation),
    /CHECKOUT_PLAN_INVALID/,
  );
  assert.equal(state.snapCards[0].balance, 100);
});

test("idiot-test navigation exposes only Home, Shop, and History", () => {
  assert.match(
    html,
    /const primary=\[\s*\['home','nav\.home','home'\],\s*\['shop','nav\.shop','shop'\],\s*\['history','nav\.history','history'\]\s*\]/,
  );
  assert.ok(html.includes(".bottom-nav{grid-template-columns:repeat(3,1fr)}"));
});

test("Reports is removed from current navigation and redirected from legacy state", () => {
  assert.ok(!html.includes("data-route=\"reports\""));
  const core = loadCore();
  const migrated = core.migrateLegacyState({ schemaVersion: 24, route: "reports" });
  assert.equal(migrated.route, "history");
});

test("shopping is staged from store to groceries to funding to review", () => {
  assert.ok(html.includes("[['store','stream.store'],['groceries','stream.groceries'],['review','stream.review'],['finish','stream.finish']]"));
  assert.ok(html.includes("shopStageStrip('store')"));
  assert.ok(html.includes("shopStageStrip('groceries')"));
});

test("barcode entry is the first-class shopping action with manual fallbacks", () => {
  assert.ok(html.includes('data-action="scan-barcode"'));
  assert.ok(html.includes("type:'open-barcode-scanner'"));
  assert.ok(html.includes("showBarcodeFallback()"));
  assert.ok(html.includes("['ean13','ean8','upc_a','upc_e']"));
});

test("device language automatically selects en-US or es-PR", () => {
  assert.ok(html.includes("function resolveInitialLocale()"));
  assert.ok(html.includes("navigator.languages||[]"));
  assert.ok(html.includes("window.addEventListener('languagechange',()=>syncDeviceLocale())"));
});

test("onboarding keeps legal consent compact and benefit choice before setup", () => {
  assert.ok(html.includes("function onboardingSequence(){return ['legal','program'];}"));
  assert.ok(html.includes('id="onLegalCombined"'));
  assert.ok(html.includes("['LATER',tr('stream.later')]"));
  assert.ok(!html.includes("id=\"onSnapBalance\" class=\"money-entry\"") || html.includes("if(step==='snap')"));
});

test("prices use ordinary decimal input and exact cents internally", () => {
  const core = loadCore();
  assert.ok(html.includes('id="shopPriceInput" inputmode="decimal"'));
  assert.equal(core.cents("19.95"), 1995);
  assert.equal(core.cents("0.09"), 9);
});

test("reusable lists retain prior price, classification, and eligibility", () => {
  assert.ok(html.includes("previousPriceCents:i.priceKnown!==false&&i.unitPriceCents!=null?i.unitPriceCents:null"));
  assert.ok(html.includes("category:C.normalizeCategoryId(i.category)"));
  assert.ok(html.includes("snapEligibility:i.snapEligibility||'UNSURE'"));
  assert.ok(html.includes("priceRaw:Number.isSafeInteger(price)?R.centsToMoneyInput(price):''"));
});

test("unselected benefit programs are hidden from summaries and funding", () => {
  assert.ok(html.includes("if(enabled.has('SNAP'))cards.push"));
  assert.ok(html.includes("if(enabled.has('WIC'))cards.push"));
  assert.ok(html.includes("if(!(state.settings.enabledPrograms||[]).includes('WIC'))return []"));
});

test("WIC checkout updates quantity once without mutating the input state", () => {
  const core = loadCore();
  const state = core.canonicalState();
  state.wicCards = [{
    id: "wic-1",
    name: "WIC 1",
    active: true,
    transactions: [],
    reminder: core.normalizeReminder(null),
    allowances: [{
      id: "benefit-1",
      categoryId: "eggs",
      unit: "dozen",
      starting: 2,
      remaining: 2,
      startDate: "2026-08-01",
      expiryDate: "2026-08-31",
      active: true,
      transactions: [],
    }],
  }];
  state.basket.transactionDate = "2026-08-20";
  state.basket.items = [{
    id: "item-wic",
    name: "Eggs",
    quantity: 1,
    quantityRaw: "1",
    quantityUnit: "dozen",
    unitPriceCents: 399,
    priceKnown: true,
    funding: {
      mode: "WIC",
      wicCardId: "wic-1",
      allowanceId: "benefit-1",
      wicQuantity: 1,
      wicUnit: "dozen",
    },
  }];
  const validation = core.validateBasketForCheckout(state, state.basket, "2026-08-20");
  assert.deepEqual(Array.from(validation.blockers), []);
  const result = core.applyCheckoutTransaction(state, validation, { transactionDate: "2026-08-20" });
  assert.equal(result.state.wicCards[0].allowances[0].remaining, 1);
  assert.equal(state.wicCards[0].allowances[0].remaining, 2);
});

test("cash over budget warns but does not block checkout", () => {
  const core = loadCore();
  const state = core.canonicalState();
  state.cash.periodBudget = 1000;
  state.cash.spent = 900;
  state.basket.items = [{
    id: "cash-item",
    name: "Rice",
    quantity: 1,
    quantityRaw: "1",
    unitPriceCents: 250,
    priceKnown: true,
    funding: { mode: "CASH" },
  }];
  const validation = core.validateBasketForCheckout(state);
  assert.deepEqual(Array.from(validation.blockers), []);
  assert.ok(validation.warnings.some((item) => item.code === "CASH_OVER_BUDGET"));
});

test("duplicating a basket item assigns a fresh identifier", () => {
  assert.ok(html.includes("function duplicateBasketItem(id,{returnTo=null}={})"));
  assert.ok(html.includes("shopDraft.editingId=null;shopDraft.id=C.id()"));
});

test("WIC edits reject remaining quantities above the starting amount", () => {
  const core = loadCore();
  const errors = core.validateWicAllowanceEdit({
    starting: 2,
    remaining: 3,
    unit: "dozen",
    startDate: "2026-08-01",
    expiryDate: "2026-08-31",
  });
  assert.ok(errors.some((item) => item.code === "WIC_EDIT_REMAINING_EXCEEDS_STARTING"));
});

test("the embedded catalogs retain all reviewed stores and grocery items", () => {
  const stores = JSON.parse(html.match(/window\.STORES=(\[[\s\S]*?\]);window\.GROCERY_CATALOG=/)[1]);
  const catalog = JSON.parse(html.match(/window\.GROCERY_CATALOG=(\[[\s\S]*?\]);<\/script>/)[1]);
  assert.equal(stores.length, 243);
  assert.equal(catalog.length, 687);
});
