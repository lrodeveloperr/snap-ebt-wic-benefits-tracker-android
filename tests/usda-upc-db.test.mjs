import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

const databasePath = new URL("../assets/gbt-usda-upc-2026-04.db", import.meta.url);
const partsPath = new URL("../assets/upc-db-parts/", import.meta.url);
const expectedSha256 =
  "59421c968a15ae48bc11340f872e3aa974c104d329327cb669febfc529644272";

test("bundles a compact, valid USDA food-only UPC lookup index", () => {
  const header = readFileSync(databasePath).subarray(0, 16).toString("utf8");
  assert.equal(header, "SQLite format 3\0");
  assert.ok(statSync(databasePath).size < 30 * 1024 * 1024);
  assert.equal(
    createHash("sha256").update(readFileSync(databasePath)).digest("hex"),
    expectedSha256,
  );

  const parts = readdirSync(partsPath)
    .filter((name) => name.startsWith("gbt-usda-upc-2026-04.db.part-"))
    .sort();
  assert.equal(parts.length, 44);
  assert.equal(
    parts.reduce(
      (size, name) => size + statSync(new URL(name, partsPath)).size,
      0,
    ),
    statSync(databasePath).size,
  );
  const partsHash = createHash("sha256");
  for (const name of parts) partsHash.update(readFileSync(new URL(name, partsPath)));
  assert.equal(partsHash.digest("hex"), expectedSha256);

  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    assert.equal(
      database.prepare("PRAGMA integrity_check").get().integrity_check,
      "ok",
    );
    const metadata = Object.fromEntries(
      database.prepare("SELECT key,value FROM metadata").all().map((row) => [
        row.key,
        row.value,
      ]),
    );
    assert.equal(metadata.schema_version, "1");
    assert.equal(metadata.market_country, "United States");
    assert.equal(metadata.eligibility_authority, "none");
    assert.match(metadata.source, /USDA FoodData Central/);
    assert.ok(Number(metadata.product_count) > 400_000);

    const columns = database.prepare("PRAGMA table_info(products)").all();
    assert.deepEqual(
      columns.map((column) => column.name),
      ["gtin", "name", "category"],
    );
    const sample = database
      .prepare(
        `SELECT products.gtin, products.name, categories.name AS category
           FROM products
           JOIN categories ON categories.id = products.category
          LIMIT 1`,
      )
      .get();
    assert.equal(typeof sample.gtin, "number");
    assert.equal(typeof sample.name, "string");
    assert.ok(sample.name.length > 0);
    assert.ok(
      [
        "other",
        "produce",
        "protein",
        "dairy",
        "grains",
        "pantry",
        "frozen",
        "beverages",
        "prepared",
        "snacks",
        "baby",
      ].includes(sample.category),
    );
  } finally {
    database.close();
  }
});
