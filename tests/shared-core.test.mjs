import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const html = await readFile(new URL("../app.html", import.meta.url), "utf8");
const nativeApp = await readFile(new URL("../App.tsx", import.meta.url), "utf8");
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

function loadEnhancedCatalog() {
  const context = { JSON };
  context.globalThis = context;
  context.window = context;
  vm.runInNewContext(scripts[2], context, { filename: "gbt-catalog.js" });
  context.C = { clone: (value) => JSON.parse(JSON.stringify(value)) };
  context.SUPPORTED_LOCALES = ["en-US", "es-PR"];
  const start = html.indexOf("const GROCERY_CATALOG_ADDITIONS");
  const end = html.indexOf("\n\nfunction canonicalizeLocale", start);
  assert.ok(start >= 0 && end > start, "catalog enhancement block must exist");
  vm.runInNewContext(html.slice(start, end), context, { filename: "gbt-catalog-enhancements.js" });
  return context.GROCERY_CATALOG;
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

test("native notification consent survives every normalization path", () => {
  const core = loadCore();
  const state = core.canonicalState();
  assert.equal(state.settings.localNotificationsEnabled, false);
  state.settings.localNotificationsEnabled = true;
  assert.equal(core.normalizeState(state).settings.localNotificationsEnabled, true);
  assert.equal(core.migrateLegacyState(state).settings.localNotificationsEnabled, true);
});

test("cash periods fast-forward after long inactivity without repeated rollover prompts", () => {
  const core = loadCore();
  for (const config of [
    { start: "2020-01-01", cycle: "weekly" },
    { start: "2020-01-01", cycle: "biweekly" },
    { start: "2020-01-31", cycle: "monthly" },
    { start: "2020-01-01", cycle: "custom", customDays: 3 },
  ]) {
    const empty = core.canonicalState();
    empty.cash = core.makeCashPeriod({ baseBudget: 0, ...config });
    const advanced = core.processExpiredCashPeriod(empty, "2026-09-02");
    assert.equal(advanced.changed, true, config.cycle);
    assert.equal(advanced.pending, false, config.cycle);
    assert.ok(advanced.state.cash.start <= "2026-09-02", config.cycle);
    assert.ok(advanced.state.cash.end >= "2026-09-02", config.cycle);
    assert.equal(advanced.state.cash.periodHistory.length, 1, config.cycle);
  }

  const remainder = core.canonicalState();
  remainder.cash = core.makeCashPeriod({
    baseBudget: 1_000,
    start: "2020-01-01",
    cycle: "custom",
    customDays: 1,
  });
  const pending = core.processExpiredCashPeriod(remainder, "2026-09-02");
  assert.equal(pending.pending, true);
  assert.equal(pending.state.cash.pendingRollover.nextStart, "2026-09-02");
  const carried = core.applyRolloverChoice(pending.state, "carry");
  assert.equal(carried.cash.start, "2026-09-02");
  assert.equal(carried.cash.end, "2026-09-02");
  assert.equal(carried.cash.carryover, 1_000);
  assert.equal(core.processExpiredCashPeriod(carried, "2026-09-02").pending, false);
});

test("Cash amount edits preserve the active period while timing changes archive it", () => {
  const core = loadCore();
  const state = core.canonicalState();
  setCashPeriod(state, { start: "2026-08-01", end: "2026-08-31", spent: 250 });
  state.cash.baseBudget = 1_000;
  state.cash.periodBudget = 1_000;
  const amountOnly = core.updateCashBudgetAmount(state, 1_500);
  assert.equal(amountOnly.cash.periodId, "cash-current");
  assert.equal(amountOnly.cash.start, "2026-08-01");
  assert.equal(amountOnly.cash.end, "2026-08-31");
  assert.equal(amountOnly.cash.spent, 250);
  assert.equal(amountOnly.cash.periodBudget, 1_500);

  let retimed = core.resetCashTiming(state, {
    cycle: "weekly",
    start: "2026-09-02",
    customDays: 21,
  });
  retimed = core.updateCashBudgetAmount(retimed, 2_000);
  assert.notEqual(retimed.cash.periodId, "cash-current");
  assert.equal(retimed.cash.start, "2026-09-02");
  assert.equal(retimed.cash.spent, 0);
  assert.equal(retimed.cash.baseBudget, 2_000);
  assert.equal(retimed.cash.periodHistory[0].id, "cash-current");
  assert.equal(retimed.cash.periodHistory[0].spent, 250);
  assert.equal(retimed.cash.periodHistory[0].baseBudget, 1_000);
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
  state.cash.baseBudget = 299;
  state.cash.periodBudget = 299;
  state.cash.start = "2026-09-01";
  state.cash.end = "2026-09-30";
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
  assert.ok(html.includes('data-action="scan-barcode"'));
  assert.ok(html.includes("type:'open-barcode-scanner'"));
  assert.ok(html.includes("showBarcodeFallback()"));
  assert.ok(html.includes("['ean13','ean8','upc_a','upc_e']"));
});

test("barcode normalization preserves symbology and validates GS1 check digits", () => {
  const start = html.indexOf("function barcodeCheckDigit");
  const end = html.indexOf("function showBarcodeFallback", start);
  assert.ok(start >= 0 && end > start, "barcode helpers must exist");
  const context = {};
  vm.runInNewContext(
    `${html.slice(start, end)};this.normalizeBarcode=normalizeBarcode;`,
    context,
  );

  assert.equal(context.normalizeBarcode("036000291452", "upc_a"), "00036000291452");
  assert.equal(context.normalizeBarcode("4006381333931", "ean13"), "04006381333931");
  assert.equal(context.normalizeBarcode("96385074", "ean8"), "00000096385074");
  // The same eight digits can be valid UPC-E and EAN-8. The scanner's format
  // must decide whether the value is expanded or simply padded to GTIN-14.
  assert.equal(context.normalizeBarcode("01234565", "upc_e"), "00012345000065");
  assert.equal(context.normalizeBarcode("01234565", "ean8"), "00000001234565");
  assert.equal(
    context.normalizeBarcode("01234565", "upc_e"),
    context.normalizeBarcode("012345000065", "upc_a"),
  );
  assert.equal(
    context.normalizeBarcode("036000291452", "upc_a"),
    context.normalizeBarcode("0036000291452", "ean13"),
  );
  assert.equal(context.normalizeBarcode("036000291453", "upc_a"), "");
  assert.equal(context.normalizeBarcode("21234565", "upc_e"), "");
  assert.equal(context.normalizeBarcode("UPC 036000291452", "upc_a"), "");
});

test("Android scanner passes barcode type through and every result is surfaced", () => {
  assert.ok(nativeApp.includes('"ean13",\n  "ean8",\n  "upc_a",\n  "upc_e",'));
  assert.ok(nativeApp.includes('const value = /^\\d+$/.test(rawValue) ? rawValue : displayValue;'));
  assert.ok(nativeApp.includes('const format = String(result.type || "").toLowerCase();'));
  assert.ok(nativeApp.includes('finishBarcodeScanner("complete", value, format);'));
  assert.ok(nativeApp.includes("GBTBarcodeScanner?.${result}(${argumentsList})"));
  assert.ok(html.includes("function applyBarcodeResult(value,format='',nativeRecord=null,context=null)"));
  for (const key of ["stream.barcodeMatched", "stream.barcodeNew", "stream.barcodeInvalid"]) {
    assert.ok(html.includes(`tr('${key}'`), `${key} must be shown to the user`);
  }
  assert.ok(html.includes("cancel:context=>{if(!barcodeScanContextMatches(context))return;activeBarcodeScan=null;toast(tr('stream.scanCancelled'))"));
  assert.ok(nativeApp.includes("Alert.alert(copy.cameraPermissionTitle, copy.cameraPermissionBody"));
  assert.ok(nativeApp.includes("copy.cameraOpenFailedBody"));
  assert.ok(nativeApp.includes("copy.scannerStartFailedBody"));
  assert.ok(html.includes("catch(_){activeBarcodeScan=null;toast(tr('stream.scanUnavailable'))"));
});

test("a newly scanned barcode is learned only with the atomic basket save", () => {
  const submit = html.match(/function handleEntryFormSubmit\(e\)\{[^\n]+\}/)?.[0] || "";
  assert.ok(submit.includes("triggerEntryFormAction(e.target)"));
  assert.ok(!submit.includes("barcodeMappings"));
  const atomicAdd = html.match(/addOrUpdateItem=async function\(\)\{[\s\S]*?\n\};/)?.[0] || "";
  assert.ok(atomicAdd.includes("next.barcodeMappings[learnedBarcode]"));
  assert.ok(atomicAdd.includes("await commitCritical(next)"));
});

test("primary screens use top app-bar headers and funding is promoted", () => {
  assert.ok(html.includes("const TOPBAR_TITLE_ROUTES=new Set(['home','shop','history']);"));
  assert.ok(html.includes("normalizePagePresentation(currentRoute)"));
  assert.ok(html.includes("page.querySelector(':scope > .page-head')?.remove()"));
  assert.ok(html.includes("form.insertBefore(funding,details)"));
  assert.ok(html.includes("fundingMode:'UNSURE'"));
});

test("grocery entry requires an explicit payment choice before scan or typing", () => {
  assert.ok(html.includes('id="fundingChoice" class="payment-first"'));
  assert.ok(html.includes("const validPayment=['SNAP','CASH','WIC'].includes(d.fundingMode)"));
  assert.ok(html.includes("if(!['SNAP','CASH','WIC'].includes(d.fundingMode))errors.push(['fundingChoice'"));
  assert.ok(html.includes("if(d.fundingMode==='WIC'){const pair=selectedWicPair(d);if(!pair)"));
  assert.ok(html.includes("opts.push(['CASH',tr('funding.cash')]);"));
  assert.ok(!html.includes("opts.push(['CASH',tr('funding.cash')],['UNSURE',tr('funding.unsure')])"));
});

test("SNAP and Cash use the short grocery-price-quantity-add loop", () => {
  assert.ok(html.includes('"shop.addAndNext": "Add & next grocery"'));
  assert.ok(html.includes('"shop.optionalDetails": "Optional details"'));
  assert.ok(html.includes("if(cards.length<=1)return ''"), "one SNAP card should not add a selector");
  assert.ok(html.includes("if(d.fundingMode==='CASH')return ''"), "Cash should not add a funding detail panel");
  assert.ok(html.includes("${normalFields}<div id=\"shopErrorSummary\""));
  assert.ok(html.includes("setTimeout(()=>el('shopPriceInput')?.focus(),0)"));
});

test("WIC entry uses inventory selection and keeps buying quantity aligned", () => {
  assert.ok(html.includes("function chooseWicInventoryLine"));
  assert.ok(html.includes("function setWicBuyingNow"));
  assert.ok(html.includes("tr('wic.inventoryTitle')"));
  assert.ok(html.includes("tr('wic.buyingNow')"));
  assert.ok(html.includes("d.quantityUnit=pair.allowance.unit"));
  assert.ok(html.includes("d.quantityRaw=raw"));
});

test("basket review exposes funding and before-deduction-after balances", () => {
  assert.ok(html.includes('data-action="go-to-basket"'));
  assert.ok(html.includes("function checkoutBalanceImpactHtml(validation)"));
  for (const key of ["checkout.before", "checkout.deduction", "checkout.after"]) {
    assert.ok(html.includes(`tr('${key}')`));
  }
  assert.ok(html.includes("plan.snapDeltas"));
  assert.ok(html.includes("plan.wicDeltas"));
  assert.ok(html.includes("plan.cashDeltaCents"));
});

test("suggestions stay closed until typing and rank contiguous matches", () => {
  assert.ok(html.includes("function suggestionMatchRank(terms,query)"));
  assert.ok(html.includes("if(!query)return []"));
  assert.ok(html.includes("else if(term.startsWith(query))"));
  assert.ok(html.includes("else if(term.includes(query))"));
  assert.ok(html.includes("query.length>0&&list.length>0"));
});

test("home keeps card and budget management available after setup", () => {
  assert.ok(html.includes('id="homeManageFunding"'));
  assert.ok(html.includes("tr('home.manageFunding')"));
});

test("legal links fill the onboarding row", () => {
  assert.ok(html.includes(".onboard-legal-links.two-links{grid-template-columns:repeat(2,minmax(0,1fr))}"));
  assert.ok(html.includes('class="onboard-legal-links two-links"'));
});

test("saved baskets can be created outside the shopping flow", () => {
  assert.ok(html.includes('id="homeSavedBaskets"'));
  assert.ok(html.includes("function newSavedBasketDraft()"));
  assert.ok(html.includes('data-action="standalone-saved-create"'));
  assert.ok(html.includes("function saveStandaloneBasket()"));
});

test("saved-basket checklist restores price and quantity but always remaps payment", () => {
  const start = html.indexOf("function savedItemsForLoad");
  const end = html.indexOf("\nloadSavedPrompt=", start);
  assert.ok(start >= 0 && end > start, "active saved-basket loader must exist");
  const context = {
    strictSavedQuantity: (item) => ({ value: Number(item.quantityRaw), raw: item.quantityRaw }),
    C: { id: () => "loaded-1", normalizeCategoryId: (value) => value || "other" },
    R: { centsToMoneyInput: (value) => (value / 100).toFixed(2) },
  };
  vm.runInNewContext(
    `${html.slice(start, end)};this.savedItemsForLoad=savedItemsForLoad;`,
    context,
  );
  const [loaded] = context.savedItemsForLoad({
    createdAt: "2026-08-20T12:00:00.000Z",
    items: [{
      name: "Bread",
      quantityRaw: "3",
      quantityUnit: "each",
      previousPriceCents: 199,
      previousPriceEntryMode: "UNIT_PRICE",
      category: "bakery",
      suggestedFunding: "SNAP",
    }],
  });
  assert.equal(loaded.quantity, 3);
  assert.equal(loaded.quantityRaw, "3");
  assert.equal(loaded.unitPriceCents, 199);
  assert.equal(loaded.priceRaw, "1.99");
  assert.equal(loaded.priceKnown, true);
  assert.equal(loaded.funding.mode, "UNSURE");
  assert.equal(loaded.funding.needsResolution, true);
  assert.ok(html.includes("suggestedFunding:null"));
  assert.ok(html.includes("price=parseEntryMoney(priceRaw)"));
  assert.ok(html.includes("if(!price.ok){toast(tr(priceRaw?'entry.invalidNumber':'entry.required'))"));
});

test("Shop relevance checklist keeps Scan and Lists out of the WIC inventory path", () => {
  const start = html.indexOf("renderShop=function()");
  const end = html.indexOf("\ndocument.addEventListener('click',event=>", start);
  assert.ok(start >= 0 && end > start, "active Shop renderer must exist");
  const renderer = html.slice(start, end);
  const wicStart = renderer.indexOf("const wicEntry=");
  const normalStart = renderer.indexOf("const itemEntry=", wicStart);
  const wicOnly = renderer.slice(wicStart, normalStart);
  assert.ok(wicOnly.includes("tr('stream.wicNoScan')"));
  assert.ok(!wicOnly.includes('data-action="scan-barcode"'));
  assert.ok(!wicOnly.includes('data-route="saved"'));
  assert.ok(renderer.includes("${state.savedBaskets.length?`<button type=\"button\" data-route=\"saved\""));
  assert.ok(renderer.includes('data-action="scan-barcode"'));
  assert.ok(renderer.includes("d.fundingMode==='WIC'?wicEntry"));
});

test("quantity and automatic-date checklist matches the simplified shopping contract", () => {
  const start = html.indexOf("renderShop=function()");
  const end = html.indexOf("\ndocument.addEventListener('click',event=>", start);
  const renderer = html.slice(start, end);
  assert.ok(renderer.includes('id="quantityInput" class="stepper"'));
  assert.ok(!renderer.includes('<input id="quantityInput"'));
  assert.ok(renderer.includes('data-action="shop-quantity-minus"'));
  assert.ok(renderer.includes('data-action="shop-quantity-plus"'));
  assert.ok(html.includes('data-action="wic-quantity-minus"'));
  assert.ok(html.includes('data-action="wic-quantity-plus"'));
  assert.ok(html.includes('id="wicQtyInput" class="money-entry"'));
  assert.ok(!renderer.includes("shopTransactionDate"));
  assert.ok(html.includes("validate:()=>C.validateBasketForCheckout(state,state.basket,today())"));
  assert.ok(html.includes("resume:async()=>{await processRuntimeTransitions()"));
  assert.ok(nativeApp.includes('"window.GBTApp?.resume?.(); true;"'));
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

test("complete non-dollar WIC inventory purchases are not counted as unknown-price history", () => {
  const core = loadCore();
  const state = makeWicState(core);
  state.basket.transactionDate = "2026-08-20";
  state.basket.items = [wicItem({ priceKnown: false })];
  const validation = core.validateBasketForCheckout(state, state.basket, "2026-08-20");
  assert.equal(validation.blockers.length, 0);
  const result = core.applyCheckoutTransaction(state, validation, {
    transactionDate: "2026-08-20",
  });
  assert.equal(result.record.unknownPriceCount, 0);
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

test("history correction supports partial non-dollar WIC plus Cash", () => {
  const core = loadCore();
  const state = makeWicState(core);
  setCashPeriod(state);
  state.basket.items = [wicItem({
    id: "partial-correction",
    quantity: 2,
    quantityUnit: "dozen",
    unitPriceCents: 600,
    funding: { mode: "CASH" },
  })];
  const checkout = core.applyCheckoutTransaction(
    state,
    core.validateBasketForCheckout(state, state.basket, "2026-08-20"),
    { transactionDate: "2026-08-20" },
  ).state;
  const transaction = checkout.history[0];
  const correction = core.correctHistoryItemFunding(
    checkout,
    transaction.id,
    transaction.items[0].id,
    {
      ...transaction.items[0],
      funding: {
        mode: "WIC",
        wicCardId: "wic-1",
        allowanceId: "benefit-1",
        wicQuantity: 1,
        wicUnit: "dozen",
        remainderType: "CASH",
      },
    },
  );
  assert.deepEqual(Array.from(correction.validation.blockers), []);
  assert.equal(correction.state.wicCards[0].allowances[0].remaining, 23);
  assert.equal(correction.state.cash.spent, 600);
  assert.deepEqual(
    Array.from(correction.state.history[0].items[0].allocations, (row) => row.type),
    ["WIC", "CASH"],
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
  assert.throws(
    () => core.applyCheckoutTransaction(state, valid, { transactionDate: "2026-09-20" }),
    (error) => error?.code === "CHECKOUT_PLAN_INVALID" && error?.meta?.blockers?.includes("CASH_PERIOD_UNAVAILABLE"),
  );
  assert.equal(state.cash.spent, 0);
  assert.equal(state.history.length, 0);
});

test("checkout recomputes stale plans against the current basket and ledger", () => {
  const core = loadCore();
  const state = core.canonicalState();
  setCashPeriod(state, { start: "2026-08-01", end: "2026-08-31" });
  state.basket.items = [{ id: "cash-1", name: "Rice", quantity: 1, quantityRaw: "1", unitPriceCents: 500, priceKnown: true, funding: { mode: "CASH" } }];
  const staleBasketPlan = core.validateBasketForCheckout(state, state.basket, "2026-08-20");
  state.basket.items[0].unitPriceCents = 800;
  const recalculated = core.applyCheckoutTransaction(state, staleBasketPlan, { transactionDate: "2026-08-20" });
  assert.equal(recalculated.state.cash.spent, 800);
  assert.equal(recalculated.record.totalKnownCents, 800);

  const snapState = core.canonicalState();
  addSnapCard(core, snapState, 500);
  setCashPeriod(snapState);
  snapState.basket.items = [{ id: "snap-1-item", name: "Beans", quantity: 1, quantityRaw: "1", unitPriceCents: 500, priceKnown: true, snapEligibility: "ELIGIBLE", funding: { mode: "SNAP", snapCardId: "snap-1" } }];
  const staleLedgerPlan = core.validateBasketForCheckout(snapState, snapState.basket, "2026-08-20");
  snapState.snapCards[0].balance = 100;
  assert.throws(
    () => core.applyCheckoutTransaction(snapState, staleLedgerPlan, { transactionDate: "2026-08-20" }),
    (error) => error?.code === "CHECKOUT_PLAN_INVALID",
  );
  assert.equal(snapState.snapCards[0].balance, 100);
  assert.equal(snapState.history.length, 0);
});

test("checkout uses the transaction date's current cash period, never a stale plan period", () => {
  const core = loadCore();
  const state = core.canonicalState();
  setCashPeriod(state, { start: "2026-09-01", end: "2026-09-30", spent: 50 });
  state.cash.periodHistory = [{ id: "cash-aug", start: "2026-08-01", end: "2026-08-31", periodBudget: 5_000, spent: 100 }];
  state.basket.items = [{ id: "cash-1", name: "Rice", quantity: 1, quantityRaw: "1", unitPriceCents: 500, priceKnown: true, funding: { mode: "CASH" } }];
  const augustPlan = core.validateBasketForCheckout(state, state.basket, "2026-08-20");
  const september = core.applyCheckoutTransaction(state, augustPlan, { transactionDate: "2026-09-20" });
  assert.equal(september.record.cashPeriodId, "cash-current");
  assert.equal(september.state.cash.spent, 550);
  assert.equal(september.state.cash.periodHistory[0].spent, 100);
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

test("history correction never rewrites a transaction when its Cash ledger is missing", () => {
  const core = loadCore();
  const state = core.canonicalState();
  addSnapCard(core, state);
  setCashPeriod(state, { start: "2026-08-01", end: "2026-08-31" });
  state.basket.items = [{ id: "item-1", name: "Rice", quantity: 1, quantityRaw: "1", unitPriceCents: 500, priceKnown: true, snapEligibility: "ELIGIBLE", funding: { mode: "CASH" } }];
  const checked = core.applyCheckoutTransaction(state, core.validateBasketForCheckout(state, state.basket, "2026-08-20"), { transactionDate: "2026-08-20" }).state;
  checked.cash.periodId = "replacement-period";
  checked.cash.periodHistory = [];
  const before = structuredClone(checked);
  const tx = checked.history[0];
  const replacement = { ...tx.items[0], funding: { mode: "SNAP", snapCardId: "snap-1" } };
  assert.throws(
    () => core.correctHistoryItemFunding(checked, tx.id, tx.items[0].id, replacement),
    (error) => error?.code === "CASH_PERIOD_UNAVAILABLE_CORRECTION",
  );
  assert.throws(
    () => core.correctHistoryTransactionDetails(checked, tx.id, { store: tx.store, transactionDate: tx.transactionDate, items: [replacement] }),
    (error) => error?.code === "CASH_PERIOD_UNAVAILABLE_CORRECTION",
  );
  assert.equal(JSON.stringify(checked), JSON.stringify(before));
});

test("removing the last Cash allocation clears the history Cash period link", () => {
  const core = loadCore();
  const state = core.canonicalState();
  addSnapCard(core, state);
  setCashPeriod(state, { start: "2026-08-01", end: "2026-08-31" });
  state.basket.items = [{ id: "item-1", name: "Rice", quantity: 1, quantityRaw: "1", unitPriceCents: 500, priceKnown: true, snapEligibility: "ELIGIBLE", funding: { mode: "CASH" } }];
  const checked = core.applyCheckoutTransaction(state, core.validateBasketForCheckout(state, state.basket, "2026-08-20"), { transactionDate: "2026-08-20" }).state;
  const tx = checked.history[0];
  const corrected = core.correctHistoryItemFunding(checked, tx.id, tx.items[0].id, { ...tx.items[0], funding: { mode: "SNAP", snapCardId: "snap-1" } });
  assert.deepEqual(Array.from(corrected.validation.blockers), []);
  assert.equal(corrected.state.history[0].cashPeriodId, null);
  assert.equal(corrected.state.cash.spent, 0);
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
  const bundledCatalog = JSON.parse(html.match(/window\.GROCERY_CATALOG=(\[[\s\S]*?\]);<\/script>/)[1]);
  const catalog = loadEnhancedCatalog();
  assert.equal(stores.length, 243);
  assert.equal(bundledCatalog.length, 687);
  assert.equal(catalog.length, 696);
  assert.equal(new Set(catalog.map((item) => item.id)).size, catalog.length);
});

test("common grocery search checklist is complete in English and Puerto Rican Spanish", () => {
  const catalog = loadEnhancedCatalog();
  const normalize = (value) => String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
  const check = (locale, queries) => {
    for (const query of queries) {
      const normalized = normalize(query);
      const found = catalog.some((item) => [
        item.labels?.[locale],
        ...(item.aliases?.[locale] || []),
      ].some((term) => normalize(term).includes(normalized)));
      assert.ok(found, `${locale} common grocery query is missing: ${query}`);
    }
  };
  check("en-US", [
    "bread", "biscuits", "chicken", "fish", "meat", "rice", "beans", "milk",
    "eggs", "cheese", "cereal", "pasta", "flour", "sugar", "salt", "oil",
    "coffee", "tea", "juice", "water", "potatoes", "onions", "tomatoes",
    "lettuce", "carrots", "apples", "bananas", "oranges", "tortillas",
    "crackers", "cookies", "yogurt", "butter", "peanut butter", "soap",
    "diapers", "toilet paper", "plantains", "yuca", "scallions", "goat", "oxtail",
  ]);
  check("es-PR", [
    "pan", "biscuits", "pollo", "pescado", "carne", "arroz", "habichuelas",
    "leche", "huevos", "queso", "cereal", "pasta", "harina", "azúcar", "sal",
    "aceite", "café", "té", "jugo", "agua", "papas", "cebollas", "tomates",
    "lechuga", "zanahorias", "manzanas", "guineos", "naranjas", "tortillas",
    "galletas saladas", "galletas dulces", "yogur", "mantequilla", "jabón",
    "pañales", "papel higiénico", "plátanos", "yuca", "cebollines", "cabra", "rabo",
  ]);
});

test("plain grocery queries rank a generic localized result first", () => {
  const catalog = loadEnhancedCatalog();
  const normalize = (value) => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  const rank = (term, query) => {
    const value = normalize(term);
    if (value === query) return 0;
    if (value.startsWith(query)) return 1;
    if (value.split(/\s+/).some((word) => word.startsWith(query))) return 2;
    return value.includes(query) ? 3 : Infinity;
  };
  const first = (locale, query) => catalog
    .map((item, order) => ({ item, order, rank: Math.min(...[
      item.labels?.[locale],
      ...(item.aliases?.[locale] || []),
    ].map((term) => rank(term, normalize(query)))) }))
    .filter((row) => Number.isFinite(row.rank))
    .sort((a, b) => a.rank - b.rank || a.order - b.order)[0]?.item?.labels?.[locale];
  assert.equal(first("en-US", "bread"), "Bread");
  assert.equal(first("en-US", "biscuits"), "Biscuits");
  assert.equal(first("en-US", "chicken"), "Chicken");
  assert.equal(first("es-PR", "pan"), "Pan");
  assert.equal(first("es-PR", "pollo"), "Pollo");
});

test("shopping category checklist covers every catalog item", () => {
  const catalog = loadEnhancedCatalog();
  const allowed = new Set([
    "baby", "beverages", "dairy", "frozen", "grains", "household", "other",
    "pantry", "pet", "prepared", "produce", "protein", "snacks",
  ]);
  for (const item of catalog) {
    assert.ok(allowed.has(item.reportCategoryId), `${item.id} has no valid shopping category`);
    assert.ok(!("nutritionGroupId" in item), `${item.id} must not contain nutrition tagging`);
    assert.ok(!("verifiedNutrition" in item), `${item.id} must not contain nutrient facts`);
    for (const locale of ["en-US", "es-PR"]) {
      assert.ok(String(item.labels?.[locale] || "").trim(), `${item.id} needs ${locale} label`);
      assert.ok(Array.isArray(item.aliases?.[locale]), `${item.id} needs ${locale} aliases`);
    }
  }
  assert.equal(catalog.find((item) => item.id === "g0557")?.reportCategoryId, "grains");
  for (const id of ["g0662", "g0663", "g0664"]) {
    assert.equal(catalog.find((item) => item.id === id)?.reportCategoryId, "pantry");
  }
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

test("imported history is read-only in every core mutation API", () => {
  const core = loadCore();
  const state = core.canonicalState();
  setCashPeriod(state);
  state.history = [{
    id: "imported-1",
    importedHistory: true,
    status: "COMPLETED",
    store: "Imported Market",
    transactionDate: "2026-08-12",
    cashPeriodId: null,
    items: [{ id: "item-1", name: "Rice", quantity: 1, quantityRaw: "1", unitPriceCents: 500, priceKnown: true, allocations: [] }],
  }];
  const replacement = { ...state.history[0].items[0], funding: { mode: "CASH" } };
  for (const mutate of [
    () => core.correctHistoryItemFunding(state, "imported-1", "item-1", replacement),
    () => core.correctHistoryTransactionDetails(state, "imported-1", { store: "Other", transactionDate: "2026-08-12", items: [replacement] }),
  ]) {
    assert.throws(mutate, (error) => error?.code === "CHECKOUT_PLAN_INVALID");
  }
  assert.equal(state.history[0].store, "Imported Market");
});

test("WIC reversal blocks an over-restoration after manual reconciliation", () => {
  const core = loadCore();
  const state = makeWicState(core, { allowanceUnit: "dozen", remaining: 2 });
  state.basket.items = [wicItem({ quantity: 1, wicQuantity: 1 })];
  const completed = core.applyCheckoutTransaction(state, core.validateBasketForCheckout(state, state.basket, "2026-08-20"), { transactionDate: "2026-08-20" }).state;
  completed.wicCards[0].allowances[0].remaining = 2;
  const before = structuredClone(completed);
  assert.throws(
    () => core.voidHistoryTransaction(completed, completed.history[0].id),
    (error) => error?.code === "WIC_LEDGER_CHANGED",
  );
  assert.equal(JSON.stringify(completed), JSON.stringify(before));
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

  const catalog = loadEnhancedCatalog();
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
  assert.ok(html.includes("function barcodeScanContextMatches(context)"));
  assert.ok(html.includes("cancel:context=>{if(!barcodeScanContextMatches(context))return"));
  assert.ok(html.includes("window.GBTAndroidBack=handleAndroidBack"));
});

test("dependent grocery values are cleared when their meaning changes", () => {
  assert.ok(html.includes("else if(e.target.id==='priceEntryMode'){const d=ensureShopDraft();d.priceEntryMode=e.target.value;d.priceKnown=false;d.priceRaw='';"));
  assert.ok(html.includes("else if(e.target.id==='quantityUnit'){const d=ensureShopDraft();if(d.quantityUnit!==e.target.value){d.quantityUnit=e.target.value;d.quantityRaw='';"));
  assert.ok(!html.includes("if(e.target.id==='quantityUnit'){const d=ensureShopDraft();d.quantityUnit=e.target.value;"));
  assert.ok(!html.includes("if(e.target.id==='priceEntryMode'){const d=ensureShopDraft();d.priceEntryMode=e.target.value;scheduleDraftPersistence"));
});

test("durable writes and checkout use captured revisions to reject lost updates", () => {
  assert.ok(html.includes("baseRevision=expectedRevision"));
  assert.ok(html.includes("durableStore.commit(candidate,{expectedRevision:baseRevision})"));
  assert.ok(html.includes("if(checkoutCommitInFlight)return"));
  assert.ok(html.includes("commitCritical(next,{expectedRevision:checkoutRevision})"));
});

test("durable settings wait for successful commits before the UI advances", () => {
  assert.ok(html.includes("e.target.id==='privacySetting'){const next=C.clone(state)"));
  assert.ok(html.includes("e.target.id==='programJurisdictionSetting'){const next=C.clone(state)"));
  assert.ok(!html.includes("state.settings.privacyEnabled=e.target.checked;privacyReveal=false;persist()"));
  assert.ok(!html.includes("state.settings.programJurisdiction=e.target.value;persist()"));
});

test("late review fixes remain wired into the active UI paths", () => {
  assert.ok(html.includes("if(timingChanged){confirmCashTiming();return;}const next=C.updateCashBudgetAmount"));
  assert.ok(html.includes("setFieldError('correctionWicQty',q.code);focusFirstError();return;"));
  assert.ok(!html.includes("wicQuantity:(()=>{"));
  assert.ok(html.includes("next=mergeImportedSuggestions(R.applyImportPlan"));
  assert.ok(html.includes("function mergeImportedSuggestions(target,records)"));
  assert.ok(html.includes("function hasNativeReminderCandidates(nextState)"));
  assert.ok(html.includes("kind:'PERIOD_CLOSED'"));
  assert.ok(html.includes("lastReplacedBasket?`<div class=\"notice info\">${tr('saved.replacedUndo')}"));
  assert.ok(html.includes("fundingCheck.blockers.find(x=>x.itemId===candidate.id)"));
  assert.ok(!html.includes("if(pair?.allowance.unit==='$'){item.funding.remainderType"));
  assert.ok(html.includes("if(item.priceKnown!==false&&item.unitPriceCents!=null){basketItem.funding.remainderType"));
  const periodFlow = html.match(/async function applyWicPeriod\(\)\{[^\n]+/)?.[0] || "";
  assert.ok(periodFlow.indexOf("if(source&&") < periodFlow.indexOf("if(duplicate&&"));
  assert.ok(html.includes("function wicReservedInBasket(d,cardId,allowanceId)"));
  assert.ok(html.includes("availableNow=Math.max(0,Number(x.allowance.remaining)-wicReservedInBasket"));
  assert.ok(html.includes("next.basket.transactionDate=today()"));
});

test("history import suggestions merge without erasing learned shopping recents", () => {
  const start = html.indexOf("function mergeImportedSuggestions");
  const end = html.indexOf("function correctionWicRows", start);
  assert.ok(start >= 0 && end > start);
  const context = {
    R: {
      normalizeStore(value) {
        const display = String(value || "").trim();
        return { storeDisplayName: display, storeNormalizedKey: display.toLowerCase() };
      },
    },
    normalizeSearch: (value) => String(value || "").trim().toLowerCase(),
    recentItemEntry: (raw) => typeof raw === "string" ? { name: raw } : raw,
  };
  vm.runInNewContext(`${html.slice(start, end)};this.mergeImportedSuggestions=mergeImportedSuggestions;`, context);
  const target = { recentStores: ["Local Market"], recentItems: [{ name: "Local bread" }] };
  context.mergeImportedSuggestions(target, [{
    store: "Imported Mart",
    items: [{ name: "Imported beans", category: "pantry" }],
  }]);
  assert.deepEqual(Array.from(target.recentStores), ["Imported Mart", "Local Market"]);
  assert.deepEqual(Array.from(target.recentItems, (row) => row.name), ["Imported beans", "Local bread"]);
});

test("learned barcode records retain the product details needed on the next scan", () => {
  assert.ok(html.includes("brand:item.brand||'',category:C.normalizeCategoryId(item.category),quantityUnit:item.quantityUnit||'each'"));
  assert.ok(html.includes("d.brand=known.brand||''"));
  assert.ok(html.includes("known.category||'other'"));
  assert.ok(html.includes("d.quantityUnit=known.quantityUnit||'each'"));
});
