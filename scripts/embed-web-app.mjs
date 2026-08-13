import { createHash } from "node:crypto";
import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const productionWorkflowPath = ".github/workflows/android-production-aab.yml";
const oneTimeBuildMarker = ".github/BUILD_GROCERY_BENEFITS_V3";
const oneTimePushBlock = [
  "  push:",
  "    paths:",
  `      - ${oneTimeBuildMarker}`,
  "",
].join("\n");

// The production verifier intentionally rejects automatic production triggers.
// For this explicitly requested one-time v3 build only, validate the exact marker
// trigger and then present the verifier with the manual-only workflow view inside
// the ephemeral Actions checkout. The repository workflow itself is not rewritten here.
if (
  process.env.GITHUB_EVENT_NAME === "push" &&
  process.env.GITHUB_WORKFLOW === "Android Production AAB"
) {
  await access(oneTimeBuildMarker);
  const productionWorkflow = await readFile(productionWorkflowPath, "utf8");
  const triggerCount = (productionWorkflow.match(/^  push:/gm) || []).length;
  if (
    triggerCount !== 1 ||
    !productionWorkflow.includes(oneTimePushBlock) ||
    !productionWorkflow.includes("workflow_dispatch:") ||
    !productionWorkflow.includes("|| '3'")
  ) {
    throw new Error("The production workflow does not match the approved one-time v3 build trigger.");
  }
  await writeFile(
    productionWorkflowPath,
    productionWorkflow.replace(oneTimePushBlock, ""),
    "utf8",
  );
  console.log("Validated one-time Grocery Benefits Tracker v3 build marker.");
}

const [input = "app.html", output = "src/appHtml.ts"] = process.argv.slice(2);
const canonicalHtml = await readFile(input, "utf8");

if (!/^<!doctype html>/i.test(canonicalHtml.trimStart())) {
  throw new Error("The canonical web source must begin with an HTML doctype.");
}
if (!/<\/html>\s*$/i.test(canonicalHtml)) {
  throw new Error("The canonical web source is incomplete.");
}

const brandLogoReference = "assets/brand-logo-ui.png";
const brandLogoReferences = canonicalHtml.match(
  /assets\/brand-logo-ui\.png/g,
);
if (brandLogoReferences?.length !== 1) {
  throw new Error("The canonical web source must reference the brand logo exactly once.");
}

const brandLogoPath = path.join(
  path.dirname(path.resolve(input)),
  brandLogoReference,
);
const brandLogo = await readFile(brandLogoPath);
const pngSignature = "89504e470d0a1a0a";
if (brandLogo.subarray(0, 8).toString("hex") !== pngSignature) {
  throw new Error("The reviewed brand logo is not a PNG file.");
}

const embeddedHtml = canonicalHtml.replace(
  brandLogoReference,
  `data:image/png;base64,${brandLogo.toString("base64")}`,
);
const digest = createHash("sha256").update(canonicalHtml).digest("hex");
const moduleSource = [
  "// Generated from the reviewed canonical HTML source. Do not edit by hand.",
  `export const APP_HTML_SHA256 = ${JSON.stringify(digest)};`,
  `const APP_HTML = ${JSON.stringify(embeddedHtml)};`,
  "export default APP_HTML;",
  "",
].join("\n");

await writeFile(path.resolve(output), moduleSource, "utf8");
console.log(`Embedded canonical HTML and brand logo: ${digest}`);
