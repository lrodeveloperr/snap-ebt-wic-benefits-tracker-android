import { createHash } from "node:crypto";
import {
  createReadStream,
  createWriteStream,
  existsSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { once } from "node:events";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = resolve(SCRIPT_DIR, "..");
const OUTPUT = join(PROJECT_DIR, "assets", "gbt-usda-upc-2026-04.db");
const PARTS_DIR = join(PROJECT_DIR, "assets", "upc-db-parts");
const PART_PREFIX = "gbt-usda-upc-2026-04.db.part-";
const EXPECTED_PARTS = 44;
const EXPECTED_BYTES = 22_839_296;
const EXPECTED_SHA256 =
  "59421c968a15ae48bc11340f872e3aa974c104d329327cb669febfc529644272";

function sha256(path) {
  return new Promise((resolveHash, reject) => {
    const hash = createHash("sha256");
    const input = createReadStream(path);
    input.on("error", reject);
    input.on("data", (chunk) => hash.update(chunk));
    input.on("end", () => resolveHash(hash.digest("hex")));
  });
}

async function isExpectedDatabase(path) {
  return (
    existsSync(path) &&
    statSync(path).size === EXPECTED_BYTES &&
    (await sha256(path)) === EXPECTED_SHA256
  );
}

async function appendPart(part, output) {
  const input = createReadStream(part);
  for await (const chunk of input) {
    if (!output.write(chunk)) await once(output, "drain");
  }
}

async function assemble() {
  if (await isExpectedDatabase(OUTPUT)) {
    console.log("USDA food barcode database is ready.");
    return;
  }

  const parts = readdirSync(PARTS_DIR)
    .filter((name) => name.startsWith(PART_PREFIX))
    .sort();
  if (parts.length !== EXPECTED_PARTS) {
    throw new Error(
      `Expected ${EXPECTED_PARTS} USDA database parts; found ${parts.length}.`,
    );
  }

  const temporary = `${OUTPUT}.assembling`;
  rmSync(temporary, { force: true });
  const output = createWriteStream(temporary, { flags: "wx" });

  try {
    for (const part of parts) await appendPart(join(PARTS_DIR, part), output);
    const finished = once(output, "finish");
    output.end();
    await finished;
    if (!(await isExpectedDatabase(temporary))) {
      throw new Error("Assembled USDA database failed its size or SHA-256 check.");
    }
    renameSync(temporary, OUTPUT);
    console.log("Assembled and verified the USDA food barcode database.");
  } catch (error) {
    output.destroy();
    rmSync(temporary, { force: true });
    throw error;
  }
}

await assemble();
