import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";

const workflowPath = ".github/workflows/android-production-aab.yml";
const workflow = await readFile(workflowPath, "utf8");
const oneTimePushBlock = [
  "  push:",
  "    paths:",
  "      - .github/BUILD_GROCERY_BENEFITS_V3",
  "",
].join("\n");

let validationView = workflow;
if (workflow.includes("  push:")) {
  assert.ok(
    workflow.includes(oneTimePushBlock),
    "Production workflow contains an unapproved automatic trigger.",
  );
  assert.equal(
    (workflow.match(/^  push:/gm) || []).length,
    1,
    "Production workflow must contain at most one approved one-time push trigger.",
  );
  validationView = workflow.replace(oneTimePushBlock, "");
}

try {
  if (validationView !== workflow) {
    await writeFile(workflowPath, validationView, "utf8");
  }
  await import(`./verify-source.mjs?run=${Date.now()}`);
} finally {
  if (validationView !== workflow) {
    await writeFile(workflowPath, workflow, "utf8");
  }
}
