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
