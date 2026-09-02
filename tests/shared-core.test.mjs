import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const html = await readFile(new URL("../app.html", import.meta.url), "utf8");
const nativeApp = await readFile(new URL("../App.tsx", import.meta.url), "utf8");
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/gi)].map(
  (match) => match[1],
);
const minimalFlowStart = html.indexOf("/* Minimal Shop flow:");
const minimalFlowEnd = html.indexOf("async function init()", minimalFlowStart);
const minimalFlow = html.slice(minimalFlowStart, minimalFlowEnd);

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

function loadCoreWithRemediation() {
  const context = {
    console,
    crypto: globalThis.crypto,
    Date,
    Math,
    JSON,
    structuredClone,
    TextEncoder,
    TextDecoder,
    Blob,
    Response,
  };
  context.globalThis = context;
  context.window = context;
  vm.runInNewContext(scripts[0], context, { filename: "gbt-core.js" });
  vm.runInNewContext(scripts[3], context, { filename: "gbt-remediation.js" });
  return { core: context.GBTCore, remediation: context.GBTRemediation };
}

function setCashPeriod(state, { start = "2026-08-01", end = "2026-08-31", spent = 0 } = {}) {
  state.cash.periodId = "cash-current";
  state.cash.start = start;
  state.cash.end = end;
  state.cash.periodBudget = 10_000;
  state.cash.spent = spent;
}

function addSnapCard(core, state, balance = 10_000) {
  state.settings.enabledPrograms = [...new Set([...(state.settings.enabledPrograms || []), "SNAP"])];
  state.snapCards = [{
    id: "snap-1",
    name: "SNAP 1",
    active: true,
    balance,
    startingBalance: balance,
    transactions: [],
    reminder: core.normalizeReminder(null),
  }];
}

function makeWicState(core, { allowanceUnit = "dozen", remaining = 24 } = {}) {
  const state = core.canonicalState();
  state.settings.enabledPrograms = ["WIC"];
  setCashPeriod(state);
  state.wicCards = [{
    id: "wic-1",
    name: "WIC 1",
    active: true,
    transactions: [],
    reminder: core.normalizeReminder(null),
    allowances: [{
      id: "benefit-1",
      categoryId: "custom",
      unit: allowanceUnit,
      starting: remaining,
      remaining,
      startDate: "2026-08-01",
      expiryDate: "2026-08-31",
      active: true,
      transactions: [],
    }],
  }];
  return state;
}

function wicItem({
  quantity = 1,
  quantityUnit = "dozen",
  unitPriceCents = 600,
  priceKnown = true,
  wicQuantity = quantity,
  wicUnit = "dozen",
  remainderType = "",
  remainderSnapCardId = "",
} = {}) {
  return {
    id: "wic-item",
    name: "WIC grocery",
    quantity,
    quantityRaw: String(quantity),
    quantityUnit,
    unitPriceCents: priceKnown ? unitPriceCents : null,
    priceKnown,
    category: "other",
    snapEligibility: "ELIGIBLE",
    funding: {
      mode: "WIC",
      wicCardId: "wic-1",
      allowanceId: "benefit-1",
      wicQuantity,
      wicUnit,
      remainderType,
      remainderSnapCardId,
    },
  };
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
  state.settings.enabledPrograms = ["SNAP"];
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

test("cash checkout completes through transaction remediation", async () => {
  const { core, remediation } = loadCoreWithRemediation();
  const state = core.canonicalState();
  state.onboarded = true;
  state.settings.language = "en-US";
  state.settings.programJurisdiction = "US_SNAP";
  setCashPeriod(state, { start: "2026-09-01", end: "2026-09-30" });
  state.cash.baseBudget = 299;
  state.cash.periodBudget = 299;
  state.basket = {
    store: "Walmart",
    transactionDate: "2026-09-01",
    items: [
      {
        id: "cash-item-1",
        name: "Apples",
        quantity: 1,
        quantityRaw: "1",
        quantityUnit: "each",
        unitPriceCents: 200,
        priceKnown: true,
        category: "produce",
        snapEligibility: "UNSURE",
        funding: { mode: "CASH" },
      },
      {
        id: "cash-item-2",
        name: "Eggs",
        quantity: 1,
        quantityRaw: "1",
        quantityUnit: "each",
        unitPriceCents: 299,
        priceKnown: true,
        category: "dairy",
        snapEligibility: "UNSURE",
        funding: { mode: "CASH" },
      },
    ],
  };

  const validation = core.validateBasketForCheckout(
    state,
    state.basket,
    "2026-09-01",
  );
  assert.equal(validation.blockers.length, 0);
  assert.ok(
    validation.warnings.some((warning) => warning.code === "CASH_OVER_BUDGET"),
  );

  const result = core.applyCheckoutTransaction(state, validation, {
    transactionDate: "2026-09-01",
    createdAt: "2026-09-01T12:00:00.000Z",
  });
  const transaction = await remediation.validateHistoryTransaction(
    result.record,
    {
      path: "checkout.transaction",
      sourceMeta: {
        sourceLocale: "en-US",
        sourceProgramJurisdiction: "US_SNAP",
      },
    },
  );

  assert.equal(transaction.totalKnownCents, 499);
  assert.equal(result.state.cash.spent, 499);
  assert.equal(result.state.history.length, 1);
  assert.equal(result.state.basket.items.length, 0);
});

test("insufficient SNAP funds block checkout without a plan mutation", () => {
  const core = loadCore();
  const state = core.canonicalState();
  state.settings.enabledPrograms = ["SNAP"];
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
  assert.ok(minimalFlow.includes('data-action="scan-barcode"'));
  assert.ok(minimalFlow.includes("type:'open-barcode-scanner'"));
  assert.ok(minimalFlow.includes("d.entryMode='SCANNED'"));
  assert.ok(minimalFlow.includes("d.entryMode='MANUAL'"));
  assert.ok(minimalFlow.includes("['ean13','ean8','upc_a','upc_e']"));
});

test("Shop progressively reveals only the controls required by the selected route", () => {
  assert.ok(html.includes("const TOPBAR_TITLE_ROUTES=new Set();"));
  assert.ok(html.includes("normalizePagePresentation(currentRoute)"));
  assert.ok(minimalFlow.includes('data-action="choose-shop-mode"'));
  assert.ok(minimalFlow.includes('id="wicItemSelect"'));
  assert.ok(minimalFlow.includes("d.fundingMode==='WIC'?minimalWicEntryHtml"));
  assert.ok(minimalFlow.includes("d.entryMode==='MANUAL'"));
  assert.ok(!minimalFlow.includes('id="shopTransactionDate"'));
  assert.ok(!minimalFlow.includes('id="priceEntryMode"'));
  assert.ok(!minimalFlow.includes('id="itemBrandInput"'));
});

test("saved baskets load as exact checkout-ready templates", () => {
  assert.ok(html.includes('id="homeSavedBaskets"'));
  assert.ok(minimalFlow.includes("function exactSavedItem"));
  assert.ok(minimalFlow.includes("funding=C.clone(item.funding||item.suggestedFunding"));
  assert.ok(minimalFlow.includes("unitPriceCents:storedPrice,priceKnown:known"));
  assert.ok(minimalFlow.includes("quantity:quantity.value,quantityRaw:quantity.raw"));
  assert.ok(!minimalFlow.includes('data-action="standalone-saved-create"'));
});

test("numeric fields are routed through one in-app keypad", () => {
  assert.ok(html.includes("function prepareNumericInputs(root=document)"));
  assert.ok(html.includes("input.dataset.action='open-number-pad'"));
  assert.ok(html.includes("function openNumberPadForInput(inputId)"));
});

test("device language automatically selects en-US or es-PR", () => {
  assert.ok(html.includes("function resolveInitialLocale()"));
  assert.ok(html.includes("navigator.languages||[]"));
  assert.ok(html.includes("window.addEventListener('languagechange',()=>syncDeviceLocale())"));
});

test("settings stacks program guidance and provides a persistent language selector", () => {
  assert.ok(html.includes(".program-setting>span,.program-setting>div{display:grid;gap:3px}"));
  assert.ok(html.includes(".settings-list>.setting-row,.purchase-settings>.setting-row,.legal-settings>.setting-row{padding:14px 0}"));
  assert.ok(html.includes('id="languageSetting"'));
  assert.ok(html.includes("next.settings.language=target.value"));
  assert.ok(html.includes("state?.onboarded&&VALID_LOCALES.has(state?.settings?.language)"));
});

test("Help gives a minimal numbered guide for the complete shopping flow", () => {
  assert.ok(html.includes('<ol class="help-steps">'));
  assert.ok(html.includes("[1,2,3,4,5,6].map"));
  assert.ok(html.includes('"help.step5Body": "Tap Review. Fix any notice, then tap Complete checkout."'));
  assert.ok(html.includes('"help.step6Body": "After checkout, tap Save list. Next time, load that Saved Basket."'));
});

test("onboarding finishes after legal consent and opens the self-explanatory home setup", () => {
  assert.ok(html.includes("function onboardingSequence(){return ['legal'];}"));
  assert.ok(html.includes('id="onLegalCombined"'));
  assert.ok(!html.includes("if(step==='program')body="));
  assert.ok(html.includes("next.settings.enabledPrograms=[];next.settings.enabledProgramsChosen=true;"));
});

test("prices use ordinary decimal input and exact cents internally", () => {
  const core = loadCore();
  assert.ok(html.includes('id="shopPriceInput" inputmode="decimal"'));
  assert.equal(core.cents("19.95"), 1995);
  assert.equal(core.cents("0.09"), 9);
});

test("saved baskets preserve price, quantity, payment mapping, and automatic validation notices", () => {
  assert.ok(minimalFlow.includes("items:state.basket.items.map(item=>exactSavedItem(item,today()))"));
  assert.ok(minimalFlow.includes("suggestedFunding:C.clone(funding)"));
  assert.ok(minimalFlow.includes("compactBasketValidationHtml()"));
  assert.ok(minimalFlow.includes("C.validateBasketForCheckout(state,state.basket,today())"));
  assert.ok(minimalFlow.includes("for(const issue of validation.warnings)"));
});

test("SNAP balance actions save on the first tap", () => {
  assert.ok(minimalFlow.includes("preMinimalPreviewSnapSave(id,mode)"));
  assert.ok(minimalFlow.includes("if(snapEditDraft)void saveSnap()"));
});

test("unselected benefit programs are hidden from summaries and funding", () => {
  assert.ok(html.includes("if(enabled.has('SNAP'))cards.push"));
  assert.ok(html.includes("if(enabled.has('WIC'))cards.push"));
  assert.ok(html.includes("if(!(state.settings.enabledPrograms||[]).includes('WIC'))return []"));
});

test("WIC checkout updates quantity once without mutating the input state", () => {
  const core = loadCore();
  const state = core.canonicalState();
  state.settings.enabledPrograms = ["WIC"];
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

test("non-dollar WIC requires full quantity coverage or an explicit remainder", () => {
  const core = loadCore();
  const state = makeWicState(core);
  state.basket.transactionDate = "2026-08-20";
  state.basket.items = [wicItem({ quantity: 2, wicQuantity: 1 })];

  let validation = core.validateBasketForCheckout(state, state.basket, "2026-08-20");
  assert.ok(validation.blockers.some((row) => row.code === "WIC_REMAINDER_UNRESOLVED"));
  assert.equal(validation.plan, null);

  state.basket.items[0].funding.remainderType = "CASH";
  validation = core.validateBasketForCheckout(state, state.basket, "2026-08-20");
  assert.deepEqual(Array.from(validation.blockers), []);
  assert.equal(validation.plan.cashDeltaCents, 600);
  assert.deepEqual(
    Array.from(validation.plan.itemAllocations[0].allocations, (row) => [row.type, row.amountCents]),
    [["WIC", 600], ["CASH", 600]],
  );
  const result = core.applyCheckoutTransaction(state, validation, { transactionDate: "2026-08-20" });
  assert.equal(result.state.wicCards[0].allowances[0].remaining, 23);
  assert.equal(result.state.cash.spent, 600);
});

test("non-dollar WIC converts compatible units before deciding coverage", () => {
  const core = loadCore();
  const variants = [
    { allowanceUnit: "each", quantityUnit: "dozen", quantity: 1, wicQuantity: 12 },
    { allowanceUnit: "dozen", quantityUnit: "each", quantity: 12, wicQuantity: 1 },
    { allowanceUnit: "oz", quantityUnit: "lb", quantity: 1, wicQuantity: 16 },
    { allowanceUnit: "lb", quantityUnit: "oz", quantity: 16, wicQuantity: 1 },
    { allowanceUnit: "qt", quantityUnit: "gal", quantity: 1, wicQuantity: 4 },
    { allowanceUnit: "fl oz", quantityUnit: "half gal", quantity: 1, wicQuantity: 64 },
    { allowanceUnit: "package", quantityUnit: "package", quantity: 2, wicQuantity: 2 },
  ];
  for (const variant of variants) {
    const state = makeWicState(core, { allowanceUnit: variant.allowanceUnit, remaining: 100 });
    state.basket.items = [wicItem({
      quantity: variant.quantity,
      quantityUnit: variant.quantityUnit,
      wicQuantity: variant.wicQuantity,
      wicUnit: variant.allowanceUnit,
    })];
    const validation = core.validateBasketForCheckout(state, state.basket, "2026-08-20");
    assert.deepEqual(Array.from(validation.blockers), [], JSON.stringify(variant));
    assert.equal(validation.plan.cashDeltaCents, 0);
    assert.equal(validation.plan.itemAllocations[0].allocations[0].amountCents, variant.quantity * 600);
  }
});

test("non-dollar WIC rejects incompatible, excessive, and unpriced partial coverage", () => {
  const core = loadCore();
  const incompatible = makeWicState(core, { allowanceUnit: "package" });
  incompatible.basket.items = [wicItem({ quantityUnit: "each", wicUnit: "package" })];
  assert.ok(core.validateBasketForCheckout(incompatible, incompatible.basket, "2026-08-20").blockers.some((row) => row.code === "WIC_PURCHASE_UNIT_MISMATCH"));

  const excessive = makeWicState(core);
  excessive.basket.items = [wicItem({ quantity: 1, wicQuantity: 2 })];
  assert.ok(core.validateBasketForCheckout(excessive, excessive.basket, "2026-08-20").blockers.some((row) => row.code === "WIC_AMOUNT_EXCEEDS_PURCHASE"));

  const unknown = makeWicState(core);
  unknown.basket.items = [wicItem({ quantity: 2, wicQuantity: 1, priceKnown: false, remainderType: "CASH" })];
  assert.ok(core.validateBasketForCheckout(unknown, unknown.basket, "2026-08-20").blockers.some((row) => row.code === "WIC_REMAINDER_PRICE_REQUIRED"));
});

test("a partial non-dollar WIC purchase can allocate the exact remainder to SNAP", () => {
  const core = loadCore();
  const state = makeWicState(core);
  addSnapCard(core, state, 2_000);
  state.basket.items = [wicItem({
    quantity: 3,
    unitPriceCents: 500,
    wicQuantity: 1,
    remainderType: "SNAP",
    remainderSnapCardId: "snap-1",
  })];
  const validation = core.validateBasketForCheckout(state, state.basket, "2026-08-20");
  assert.deepEqual(Array.from(validation.blockers), []);
  assert.equal(validation.plan.snapDeltas["snap-1"], 1_000);
  assert.deepEqual(
    Array.from(validation.plan.itemAllocations[0].allocations, (row) => [row.type, row.amountCents]),
    [["WIC", 500], ["SNAP", 1_000]],
  );
});

test("Cash checkout requires a current or archived period for its transaction date", () => {
  const core = loadCore();
  const state = core.canonicalState();
  setCashPeriod(state, { start: "2026-09-01", end: "2026-09-30" });
  state.basket.items = [{
    id: "cash-1", name: "Rice", quantity: 1, quantityRaw: "1", quantityUnit: "each",
    unitPriceCents: 500, priceKnown: true, funding: { mode: "CASH" },
  }];
  const missing = core.validateBasketForCheckout(state, state.basket, "2026-08-20");
  assert.ok(missing.blockers.some((row) => row.code === "CASH_PERIOD_UNAVAILABLE"));
  assert.throws(() => core.applyCheckoutTransaction(state, missing, { transactionDate: "2026-08-20" }), /CHECKOUT_PLAN_INVALID/);
  assert.equal(state.cash.spent, 0);

  state.cash.periodHistory = [{ id: "cash-aug", start: "2026-08-01", end: "2026-08-31", periodBudget: 5_000, spent: 100 }];
  const archived = core.validateBasketForCheckout(state, state.basket, "2026-08-20");
  assert.deepEqual(Array.from(archived.blockers), []);
  const result = core.applyCheckoutTransaction(state, archived, { transactionDate: "2026-08-20" });
  assert.equal(result.state.cash.periodHistory[0].spent, 600);
  assert.equal(result.record.cashPeriodId, "cash-aug");
});

test("checkout defensively rejects a stale Cash plan for a different period", () => {
  const core = loadCore();
  const state = core.canonicalState();
  setCashPeriod(state, { start: "2026-08-01", end: "2026-08-31" });
  state.basket.items = [{ id: "cash-1", name: "Rice", quantity: 1, quantityRaw: "1", unitPriceCents: 500, priceKnown: true, funding: { mode: "CASH" } }];
  const valid = core.validateBasketForCheckout(state, state.basket, "2026-08-20");
  assert.throws(() => core.applyCheckoutTransaction(state, valid, { transactionDate: "2026-09-20" }), /CASH_PERIOD_UNAVAILABLE/);
  assert.equal(state.cash.spent, 0);
  assert.equal(state.history.length, 0);
});

test("SNAP plus Cash requires two positive allocations and never records zero Cash", () => {
  const core = loadCore();
  const state = core.canonicalState();
  addSnapCard(core, state);
  setCashPeriod(state);
  state.basket.items = [{
    id: "split-1", name: "Beans", quantity: 1, quantityRaw: "1", quantityUnit: "each",
    unitPriceCents: 500, priceKnown: true, snapEligibility: "ELIGIBLE",
    funding: { mode: "SPLIT", snapCardId: "snap-1", split: { snapCents: 500, cashCents: 0 } },
  }];
  const zeroCash = core.validateBasketForCheckout(state, state.basket, "2026-08-20");
  assert.ok(zeroCash.blockers.some((row) => row.code === "INVALID_SPLIT"));
  assert.equal(zeroCash.plan, null);
  const defensivePlan = core.calculateFundingAllocations(state, state.basket, "2026-08-20");
  assert.deepEqual(Array.from(defensivePlan.itemAllocations[0].allocations, (row) => row.type), ["SNAP"]);

  state.basket.items[0].funding.split = { snapCents: 300, cashCents: 200 };
  const valid = core.validateBasketForCheckout(state, state.basket, "2026-08-20");
  assert.deepEqual(Array.from(valid.blockers), []);
  const result = core.applyCheckoutTransaction(state, valid, { transactionDate: "2026-08-20" });
  assert.deepEqual(Array.from(result.record.items[0].allocations, (row) => row.type), ["SNAP", "CASH"]);
  assert.ok(result.record.items[0].allocations.every((row) => row.amountCents > 0));
});

test("enabledPrograms is authoritative for every SNAP and WIC funding path", () => {
  const core = loadCore();
  const snapState = core.canonicalState();
  addSnapCard(core, snapState);
  snapState.settings.enabledPrograms = [];
  setCashPeriod(snapState);
  const base = { id: "p-1", name: "Food", quantity: 1, quantityRaw: "1", quantityUnit: "each", unitPriceCents: 500, priceKnown: true, snapEligibility: "ELIGIBLE" };
  for (const funding of [
    { mode: "SNAP", snapCardId: "snap-1" },
    { mode: "SPLIT", snapCardId: "snap-1", split: { snapCents: 300, cashCents: 200 } },
  ]) {
    snapState.basket.items = [{ ...base, funding }];
    const validation = core.validateBasketForCheckout(snapState, snapState.basket, "2026-08-20");
    assert.ok(validation.blockers.some((row) => row.code === "SNAP_PROGRAM_DISABLED"));
  }

  const wicState = makeWicState(core);
  addSnapCard(core, wicState);
  wicState.settings.enabledPrograms = ["WIC"];
  wicState.basket.items = [wicItem({ quantity: 2, wicQuantity: 1, remainderType: "SNAP", remainderSnapCardId: "snap-1" })];
  assert.ok(core.validateBasketForCheckout(wicState, wicState.basket, "2026-08-20").blockers.some((row) => row.code === "SNAP_PROGRAM_DISABLED"));

  wicState.settings.enabledPrograms = ["SNAP"];
  wicState.basket.items = [wicItem()];
  assert.ok(core.validateBasketForCheckout(wicState, wicState.basket, "2026-08-20").blockers.some((row) => row.code === "WIC_PROGRAM_DISABLED"));
  assert.equal(core.getActiveWicCards(wicState).length, 0);
});

test("history correction to Cash fails atomically when no Cash period exists", () => {
  const core = loadCore();
  const state = core.canonicalState();
  addSnapCard(core, state);
  setCashPeriod(state, { start: "2026-09-01", end: "2026-09-30" });
  state.basket.items = [{ id: "item-1", name: "Apples", quantity: 1, quantityRaw: "1", quantityUnit: "each", unitPriceCents: 500, priceKnown: true, snapEligibility: "ELIGIBLE", funding: { mode: "SNAP", snapCardId: "snap-1" } }];
  const checked = core.applyCheckoutTransaction(state, core.validateBasketForCheckout(state, state.basket, "2026-08-20"), { transactionDate: "2026-08-20" }).state;
  const before = structuredClone(checked);
  const tx = checked.history[0];
  const correction = core.correctHistoryItemFunding(checked, tx.id, tx.items[0].id, { ...tx.items[0], funding: { mode: "CASH" } });
  assert.strictEqual(correction.state, checked);
  assert.ok(correction.validation.blockers.some((row) => row.code === "CASH_PERIOD_UNAVAILABLE"));
  assert.equal(JSON.stringify(checked), JSON.stringify(before));

  const detailCorrection = core.correctHistoryTransactionDetails(checked, tx.id, {
    store: tx.store,
    transactionDate: tx.transactionDate,
    items: tx.items.map((item) => ({ ...item, funding: { mode: "CASH" } })),
  });
  assert.strictEqual(detailCorrection.state, checked);
  assert.ok(detailCorrection.validation.blockers.some((row) => row.code === "CASH_PERIOD_UNAVAILABLE"));
  assert.equal(JSON.stringify(checked), JSON.stringify(before));
});

test("history correction applies Cash to the archived transaction-date period", () => {
  const core = loadCore();
  const state = core.canonicalState();
  addSnapCard(core, state);
  setCashPeriod(state, { start: "2026-09-01", end: "2026-09-30" });
  state.cash.periodHistory = [{ id: "cash-aug", start: "2026-08-01", end: "2026-08-31", periodBudget: 5_000, spent: 100 }];
  state.basket.items = [{ id: "item-1", name: "Apples", quantity: 1, quantityRaw: "1", quantityUnit: "each", unitPriceCents: 500, priceKnown: true, snapEligibility: "ELIGIBLE", funding: { mode: "SNAP", snapCardId: "snap-1" } }];
  const checked = core.applyCheckoutTransaction(state, core.validateBasketForCheckout(state, state.basket, "2026-08-20"), { transactionDate: "2026-08-20" }).state;
  const tx = checked.history[0];
  const correction = core.correctHistoryItemFunding(checked, tx.id, tx.items[0].id, { ...tx.items[0], funding: { mode: "CASH" } });
  assert.deepEqual(Array.from(correction.validation.blockers), []);
  assert.equal(correction.state.cash.periodHistory[0].spent, 600);
  assert.equal(correction.state.history[0].items[0].allocations[0].type, "CASH");
});

test("history corrections preserve the recorded jurisdiction snapshot", () => {
  const core = loadCore();
  const state = core.canonicalState();
  state.settings.programJurisdiction = "US_SNAP";
  addSnapCard(core, state);
  setCashPeriod(state);
  state.basket = { store: "Market", transactionDate: "2026-08-20", items: [{ id: "item-1", name: "Apples", quantity: 1, quantityRaw: "1", quantityUnit: "each", unitPriceCents: 500, priceKnown: true, snapEligibility: "ELIGIBLE", funding: { mode: "SNAP", snapCardId: "snap-1" } }] };
  const checked = core.applyCheckoutTransaction(state, core.validateBasketForCheckout(state, state.basket, "2026-08-20"), { transactionDate: "2026-08-20" }).state;
  checked.settings.programJurisdiction = "PUERTO_RICO_PAN";
  const tx = checked.history[0];
  const itemCorrection = core.correctHistoryItemFunding(checked, tx.id, tx.items[0].id, { ...tx.items[0], funding: { mode: "SNAP", snapCardId: "snap-1" } });
  assert.equal(itemCorrection.state.history[0].programJurisdiction, "US_SNAP");
  assert.equal(itemCorrection.state.history[0].provenance.sourceProgramJurisdiction, "US_SNAP");

  const correctedTx = itemCorrection.state.history[0];
  const details = core.correctHistoryTransactionDetails(itemCorrection.state, correctedTx.id, {
    store: "Other Market",
    transactionDate: "2026-08-21",
    items: correctedTx.items.map((item) => ({ ...item, funding: { mode: "SNAP", snapCardId: "snap-1" } })),
  });
  assert.deepEqual(Array.from(details.validation.blockers), []);
  assert.equal(details.state.history[0].programJurisdiction, "US_SNAP");
  assert.equal(details.state.history[0].provenance.sourceProgramJurisdiction, "US_SNAP");
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

test("voiding a local checkout atomically restores every ledger", () => {
  const core = loadCore();
  const state = makeWicState(core, { allowanceUnit: "dozen", remaining: 2 });
  state.settings.enabledPrograms = ["SNAP", "WIC"];
  addSnapCard(core, state, 2_000);
  setCashPeriod(state, { start: "2026-08-01", end: "2026-08-31" });
  state.basket = {
    store: "Test Market",
    transactionDate: "2026-08-12",
    items: [
      {
        id: "snap-item",
        name: "Apples",
        quantity: 1,
        quantityRaw: "1",
        quantityUnit: "each",
        unitPriceCents: 300,
        priceKnown: true,
        category: "produce",
        snapEligibility: "ELIGIBLE",
        funding: { mode: "SNAP", snapCardId: "snap-1" },
      },
      {
        ...wicItem({ quantity: 1, unitPriceCents: 400, wicQuantity: 1 }),
        id: "wic-item",
      },
      {
        id: "cash-item",
        name: "Soap",
        quantity: 1,
        quantityRaw: "1",
        quantityUnit: "each",
        unitPriceCents: 200,
        priceKnown: true,
        category: "household",
        snapEligibility: "NOT_ELIGIBLE",
        funding: { mode: "CASH" },
      },
    ],
  };

  const validation = core.validateBasketForCheckout(state, state.basket, "2026-08-12");
  assert.deepEqual(Array.from(validation.blockers), []);
  const completed = core.applyCheckoutTransaction(state, validation, {
    transactionDate: "2026-08-12",
    createdAt: "2026-08-12T12:00:00.000Z",
  }).state;
  assert.equal(completed.snapCards[0].balance, 1_700);
  assert.equal(completed.wicCards[0].allowances[0].remaining, 1);
  assert.equal(completed.cash.spent, 200);

  const restored = core.voidHistoryTransaction(completed, completed.history[0].id);
  assert.equal(restored.snapCards[0].balance, 2_000);
  assert.equal(restored.wicCards[0].allowances[0].remaining, 2);
  assert.equal(restored.cash.spent, 0);
  assert.equal(restored.history[0].status, "VOIDED");
  assert.ok(restored.history[0].voidedAt);
  assert.throws(
    () => core.voidHistoryTransaction(restored, restored.history[0].id),
    (error) => error?.code === "CHECKOUT_PLAN_INVALID",
  );
});

test("English and Puerto Rican Spanish catalogs are complete and in parity", () => {
  const context = { console };
  context.globalThis = context;
  context.window = context;
  const messageOverlays = [...html.matchAll(
    /Object\.assign\(MESSAGES\[['"](?:en-US|es-PR)['"]\], \{[\s\S]*?\n\}\);/g,
  )].map((match) => match[0]).join("\n");
  vm.runInNewContext(
    `${scripts[1]}\n${messageOverlays}\nglobalThis.__messages = MESSAGES;`,
    context,
    {
      filename: "gbt-messages.js",
    },
  );
  const english = context.__messages["en-US"];
  const spanish = context.__messages["es-PR"];
  const englishKeys = Object.keys(english).sort();
  const spanishKeys = Object.keys(spanish).sort();
  assert.deepEqual(spanishKeys, englishKeys, "both locales must expose identical keys");
  for (const key of englishKeys) {
    assert.ok(String(english[key]).trim(), `English translation is empty: ${key}`);
    assert.ok(String(spanish[key]).trim(), `Spanish translation is empty: ${key}`);
  }
  const literalKeys = new Set(
    [...html.matchAll(/\btr\(\s*['"]([^'"]+)['"]/g)].map((match) => match[1]),
  );
  for (const key of literalKeys) {
    assert.ok(key in english, `literal UI key is missing in English: ${key}`);
    assert.ok(key in spanish, `literal UI key is missing in Spanish: ${key}`);
  }
  const pluralKeys = new Set(
    [...html.matchAll(/\bkeyedPlural\(\s*['"]([^'"]+)['"]/g)].map((match) => match[1]),
  );
  for (const key of pluralKeys) {
    for (const suffix of ["one", "other"]) {
      assert.ok(`${key}.${suffix}` in english, `plural key is missing in English: ${key}.${suffix}`);
      assert.ok(`${key}.${suffix}` in spanish, `plural key is missing in Spanish: ${key}.${suffix}`);
    }
  }

  const catalogContext = {};
  catalogContext.globalThis = catalogContext;
  catalogContext.window = catalogContext;
  vm.runInNewContext(scripts[2], catalogContext, { filename: "gbt-catalog.js" });
  const catalog = catalogContext.GROCERY_CATALOG;
  assert.ok(Array.isArray(catalog) && catalog.length > 0, "the grocery catalog must load");
  for (const item of catalog) {
    assert.ok(String(item.labels?.["en-US"] || "").trim(), `${item.id} needs an English label`);
    assert.ok(String(item.labels?.["es-PR"] || "").trim(), `${item.id} needs a Spanish label`);
  }

  const dynamicKeys = new Set();
  for (const category of new Set(catalog.map((item) => item.reportCategoryId || "other"))) {
    dynamicKeys.add(`category.${category}`);
  }
  const wicPresetBlock = html.match(/const WIC_PRESETS=\[([\s\S]*?)\n\];/)?.[1] || "";
  for (const match of wicPresetBlock.matchAll(/\{id:'([^']+)',units:/g)) {
    dynamicKeys.add(`wic.category.${match[1]}`);
  }
  const { remediation } = loadCoreWithRemediation();
  for (const unit of remediation.UNIT_ALLOWLIST) {
    if (unit !== "$") {
      const unitKey = String(unit)
        .replace(/[^a-z0-9]+/gi, "_")
        .replace(/^_|_$/g, "");
      dynamicKeys.add(`unit.${unitKey}`);
    }
  }
  for (const match of html.matchAll(/generatedNameKey:'([^']+)'/g)) dynamicKeys.add(match[1]);
  for (const key of dynamicKeys) {
    assert.ok(key in english, `dynamic UI key is missing in English: ${key}`);
    assert.ok(key in spanish, `dynamic UI key is missing in Spanish: ${key}`);
  }
});

test("native Android copy is complete in English and Puerto Rican Spanish", () => {
  const match = nativeApp.match(/const NATIVE_COPY = (\{[\s\S]*?\n\}) as const;/);
  assert.ok(match, "the native translation catalog must exist");
  const copy = vm.runInNewContext(`(${match[1]})`);
  const englishKeys = Object.keys(copy["en-US"]).sort();
  const spanishKeys = Object.keys(copy["es-PR"]).sort();
  assert.deepEqual(spanishKeys, englishKeys, "native translation keys must match");
  const referencedKeys = new Set(
    [...nativeApp.matchAll(/\b(?:copy|nativeCopy|scannerCopy)\.([a-zA-Z0-9_]+)/g)]
      .map((reference) => reference[1]),
  );
  for (const key of englishKeys) {
    assert.ok(String(copy["en-US"][key]).trim(), `native English copy is empty: ${key}`);
    assert.ok(String(copy["es-PR"][key]).trim(), `native Spanish copy is empty: ${key}`);
  }
  for (const key of referencedKeys) {
    assert.ok(key in copy["en-US"], `native copy key is missing in English: ${key}`);
    assert.ok(key in copy["es-PR"], `native copy key is missing in Spanish: ${key}`);
  }
});

test("reviewed UI safeguards remain wired into the canonical source", () => {
  assert.ok(html.includes("requested==='shop'&&!shoppingSetupReady()"));
  assert.ok(!html.includes("!shoppingSetupReady()&&!state.basket.items.length"));
  assert.ok(html.includes('id="priceEntryMode"'));
  assert.ok(html.includes('id="historySearch"'));
  assert.ok(html.includes("${historyTransferHtml()}"));
  assert.ok(html.includes("funding:{mode:'UNSURE',needsResolution:true}"));
  assert.ok(html.includes("priceKnown:false"));
  assert.ok(html.includes("cancel:()=>{}"));
  assert.ok(html.includes("window.GBTAndroidBack=handleAndroidBack"));
});
