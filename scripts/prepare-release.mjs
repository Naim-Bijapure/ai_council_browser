#!/usr/bin/env node
/**
 * Copies the latest WXT zip from .output/ into releases/ai-council-browser-v{version}.zip
 * so GitHub Releases (or manual sharing) has a stable artifact path.
 *
 * Usage: npm run release
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = join(root, ".output");
const releasesDir = join(root, "releases");

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const version = pkg.version ?? "0.0.0";

if (!existsSync(outputDir)) {
  console.error("No .output/ directory found. Run `npm run zip` first.");
  process.exit(1);
}

const zips = readdirSync(outputDir)
  .filter((name) => name.endsWith(".zip"))
  .map((name) => {
    const path = join(outputDir, name);
    return { name, path, mtime: statSync(path).mtimeMs };
  })
  .sort((a, b) => b.mtime - a.mtime);

if (zips.length === 0) {
  console.error("No .zip found in .output/. Run `npm run zip` first.");
  process.exit(1);
}

const source = zips[0];
mkdirSync(releasesDir, { recursive: true });

const destName = `ai-council-browser-v${version}.zip`;
const destPath = join(releasesDir, destName);
copyFileSync(source.path, destPath);

console.log(`Release zip ready: ${destPath}`);
console.log(`Source artifact:   ${source.path}`);
console.log("");
console.log("Next steps:");
console.log("  1. Unzip and Load unpacked (see INSTALL.md)");
console.log("  2. Or publish a GitHub Release:");
console.log(
  `     gh release create v${version} ${destPath} --title "v${version} — Dev preview" --notes "Pre-built extension for load-unpacked install. See INSTALL.md."`
);
