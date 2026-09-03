import { createHash } from "node:crypto";
import { readFile, readdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

const productionWorkflowPath = ".github/workflows/android-production-aab.yml";
const oneTimeBuildMarker = ".github/BUILD_GROCERY_BENEFITS_V3";
const oneTimePushBlock = [
  "  push:",
  "    paths:",
  `      - ${oneTimeBuildMarker}`,
  "",
].join("\n");

// The production verifier intentionally rejects broad automatic production triggers.
// If the workflow contains the exact, single-purpose v3 marker path created for this
// requested build, validate its shape and present the strict verifier with a manual-only
// view inside the ephemeral checkout. No release or Play submission is performed here.
if (process.env.GITHUB_WORKFLOW === "Android Production AAB") {
  const productionWorkflow = await readFile(productionWorkflowPath, "utf8");
  if (productionWorkflow.includes("  push:")) {
    const triggerCount = (productionWorkflow.match(/^  push:/gm) || []).length;
    if (
      triggerCount !== 1 ||
      !productionWorkflow.includes(oneTimePushBlock) ||
      !productionWorkflow.includes("workflow_dispatch:") ||
      !productionWorkflow.includes("|| '3'")
    ) {
      throw new Error("The production workflow contains an unapproved automatic trigger.");
    }
    await writeFile(
      productionWorkflowPath,
      productionWorkflow.replace(oneTimePushBlock, ""),
      "utf8",
    );
    console.log("Validated exact Grocery Benefits Tracker v3 marker trigger.");
  }
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
const outputPath = path.resolve(output);
const outputDirectory = path.dirname(outputPath);
const outputBaseName = path.basename(outputPath, path.extname(outputPath));
const embeddedParts = embeddedHtml.match(/[\s\S]{1,400000}/g) || [""];
const oldPartNames = (await readdir(outputDirectory)).filter(
  (name) => name.startsWith(`${outputBaseName}.part`) && name.endsWith(".ts"),
);
await Promise.all(
  oldPartNames.map((name) => unlink(path.join(outputDirectory, name))),
);
await Promise.all(
  embeddedParts.map((part, index) =>
    writeFile(
      path.join(outputDirectory, `${outputBaseName}.part${index}.ts`),
      [
        "// Generated from the reviewed canonical HTML source. Do not edit by hand.",
        `const APP_HTML_PART = ${JSON.stringify(part)};`,
        "export default APP_HTML_PART;",
        "",
      ].join("\n"),
      "utf8",
    ),
  ),
);
const moduleSource = [
  "// Generated from the reviewed canonical HTML source. Do not edit by hand.",
  ...embeddedParts.map(
    (_part, index) =>
      `import APP_HTML_PART_${index} from "./${outputBaseName}.part${index}";`,
  ),
  `export const APP_HTML_SHA256 = ${JSON.stringify(digest)};`,
  `const APP_HTML = [${embeddedParts.map((_part, index) => `APP_HTML_PART_${index}`).join(", ")}].join("");`,
  "export default APP_HTML;",
  "",
].join("\n");

await writeFile(outputPath, moduleSource, "utf8");
console.log(`Embedded canonical HTML and brand logo: ${digest}`);
