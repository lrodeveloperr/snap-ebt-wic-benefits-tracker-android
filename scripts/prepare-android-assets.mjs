import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, readFile, rm } from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const APPROVED_ICON_SHA256 =
  "a2893e96e83fed237c7063747c1f41c10c30ea85e3911149c13b02bfa861f808";

const approvedIcon = await readFile("assets/icon.png");
const digest = createHash("sha256").update(approvedIcon).digest("hex");
if (digest !== APPROVED_ICON_SHA256) {
  throw new Error(
    `Refusing to generate Android assets from an unapproved icon: ${digest}`,
  );
}

await copyFile("assets/icon.png", "assets/brand-logo-ui.png");
await copyFile("assets/icon.png", "assets/splash-icon.png");

const foreground = "assets/android-icon-foreground.png";
const monochrome = "assets/android-icon-monochrome.png";
const temporaryForeground = "assets/.android-icon-foreground.tmp.png";

try {
  await execFileAsync("convert", [
    "assets/icon.png",
    "-fuzz",
    "18%",
    "-transparent",
    "#E2EEFD",
    "-resize",
    "80%",
    "-gravity",
    "center",
    "-background",
    "none",
    "-extent",
    "1024x1024",
    temporaryForeground,
  ]);
  await copyFile(temporaryForeground, foreground);
  await execFileAsync("convert", [
    temporaryForeground,
    "-channel",
    "RGB",
    "-fill",
    "black",
    "-colorize",
    "100",
    "+channel",
    monochrome,
  ]);
} catch (error) {
  throw new Error(
    `Android adaptive asset generation requires ImageMagick: ${String(error)}`,
  );
} finally {
  await rm(temporaryForeground, { force: true });
}

console.log(`Prepared Android assets from approved icon ${digest}`);
