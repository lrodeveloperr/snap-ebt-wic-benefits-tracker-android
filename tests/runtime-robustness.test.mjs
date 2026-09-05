import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";

const require = createRequire(import.meta.url);
const { JSDOM, VirtualConsole } = require("jsdom");
const html = await readFile(new URL("../app.html", import.meta.url), "utf8");
const wait = (milliseconds = 250) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

async function launch(indexedDBFactory = new IDBFactory()) {
  const errors = [];
  const messages = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", (error) => errors.push(error));
  const dom = new JSDOM(html, {
    runScripts: "dangerously",
    pretendToBeVisual: true,
    url: "https://snap-ebt-wic.local/?runtimeTest=1",
    virtualConsole,
    beforeParse(window) {
      window.indexedDB = indexedDBFactory;
      window.structuredClone = structuredClone;
      window.TextEncoder = TextEncoder;
      window.TextDecoder = TextDecoder;
      window.Response = Response;
      window.Blob = Blob;
      window.HTMLElement.prototype.scrollTo = () => {};
      Object.defineProperty(window, "crypto", { value: crypto, configurable: true });
      Object.defineProperty(window.navigator, "language", {
        value: "en-US",
        configurable: true,
      });
      window.ReactNativeWebView = {
        postMessage(value) {
          messages.push(JSON.parse(value));
        },
      };
    },
  });
  await wait();
  return { dom, errors, messages, window: dom.window };
}

function acceptedState(window) {
  const state = window.GBTCore.canonicalState();
  state.onboarded = true;
  state.settings.language = "en-US";
  state.settings.programJurisdiction = "US_SNAP";
  state.settings.enabledPrograms = ["SNAP"];
  state.settings.enabledProgramsChosen = true;
  state.settings.legalAcceptance = {
    version: "2026-08-11",
    acceptedAt: "2026-09-05T12:00:00.000Z",
    ageConfirmed: true,
    termsAccepted: true,
    privacyAcknowledged: true,
  };
  state.snapCards = [{
    id: "snap-1",
    name: "SNAP",
    active: true,
    balance: 100_000,
    startingBalance: 100_000,
    transactions: [],
    reminder: window.GBTCore.normalizeReminder(null),
  }];
  return state;
}

test("clean cold launch always reveals a root view", async () => {
  const app = await launch();
  assert.ok(app.window.GBTApp);
  const shellHidden = app.window.document.querySelector("#shell")?.classList.contains("hidden");
  const onboardingHidden = app.window.document
    .querySelector("#onboarding")
    ?.classList.contains("hidden");
  assert.equal(shellHidden && onboardingHidden, false);
  assert.equal(app.errors.length, 0);
  app.dom.window.close();
});

test("a correctly hashed state with an invalid date cannot blank launch", async () => {
  const indexedDBFactory = new IDBFactory();
  const writer = await launch(indexedDBFactory);
  const badState = acceptedState(writer.window);
  badState.cash.start = "2026-02-30";
  const store = writer.window.GBTRemediation.createDurableStorage({
    enableBroadcast: false,
  });
  const initialized = await store.init();
  assert.equal(initialized.ok, true);
  const committed = await store.commit(badState, {
    expectedRevision: initialized.revision,
  });
  assert.equal(committed.ok, true);
  writer.dom.window.close();

  const reader = await launch(indexedDBFactory);
  const shellHidden = reader.window.document.querySelector("#shell")?.classList.contains("hidden");
  const onboardingHidden = reader.window.document
    .querySelector("#onboarding")
    ?.classList.contains("hidden");
  assert.equal(shellHidden && onboardingHidden, false);
  assert.match(reader.window.GBTApp.getState().cash.start, /^\d{4}-\d{2}-\d{2}$/);
  reader.dom.window.close();
});

test("a deeply malformed but authentic durable state is repaired on launch", async () => {
  const indexedDBFactory = new IDBFactory();
  const writer = await launch(indexedDBFactory);
  const badState = acceptedState(writer.window);
  badState.route = "missing-screen";
  badState.settings = [];
  badState.cash = "not-an-object";
  badState.snapCards = [null, 7, { id: "same", balance: "NaN", transactions: [null] }, { id: "same", balance: 10 }];
  badState.wicCards = [{ id: "wic", allowances: [null, { id: "a", starting: "bad", remaining: 99, unit: "unknown" }] }];
  badState.basket = { store: { bad: true }, transactionDate: "9999-99-99", items: [null, "food", { id: "x", name: "Food", quantity: "huge", priceKnown: true, unitPriceCents: "199", funding: [] }] };
  badState.history = [null, { id: "h", transactionDate: "2026-02-30", items: [null] }];
  badState.savedBaskets = [{ id: "s", items: [null] }];
  badState.recentItems = [null, 1, { name: "Milk" }];
  badState.barcodeMappings = { bad: "value", "00036000291452": { name: "Food" } };
  const store = writer.window.GBTRemediation.createDurableStorage({ enableBroadcast: false });
  const initialized = await store.init();
  assert.equal((await store.commit(badState, { expectedRevision: initialized.revision })).ok, true);
  writer.dom.window.close();

  const reader = await launch(indexedDBFactory);
  const repaired = reader.window.GBTApp.getState();
  assert.equal(repaired.route, "home");
  assert.ok(repaired.cash && typeof repaired.cash === "object");
  assert.equal(repaired.snapCards.length, 2);
  assert.notEqual(repaired.snapCards[0].id, repaired.snapCards[1].id);
  assert.equal(repaired.basket.items.length, 1);
  assert.equal(repaired.basket.items[0].priceKnown, false);
  assert.ok(reader.window.document.querySelector("#shell:not(.hidden), #onboarding:not(.hidden)"));
  assert.equal(reader.errors.length, 0);
  reader.dom.window.close();
});

test("the frozen Shop flow still reaches the native scanner bridge", async () => {
  const app = await launch();
  const state = acceptedState(app.window);
  state.basket.store = "Test Market";
  app.window.GBTApp.setStateForTest(state);
  app.window.GBTApp.route("shop");
  await wait(30);
  app.window.document
    .querySelector('[data-action="choose-shop-mode"][data-value="SNAP"]')
    ?.click();
  await wait(30);
  const scan = app.window.document.querySelector('[data-action="scan-barcode"]');
  assert.ok(scan);
  scan.click();
  assert.ok(app.messages.some((message) => message.type === "open-barcode-scanner"));
  app.dom.window.close();
});
