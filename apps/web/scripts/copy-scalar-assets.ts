import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(scriptDir, "..");

// Resolve source from apps/web's own node_modules to avoid workspace hoisting
// ambiguity. bun installs @scalar/api-reference here as a devDependency.
const srcPath = resolve(
  webRoot,
  "node_modules/@scalar/api-reference/dist/browser/standalone.js",
);

const destDir = resolve(webRoot, "public/scalar");
const destPath = resolve(destDir, "standalone.js");

// Read version for log output (purely informational).
const pkgJsonPath = resolve(
  webRoot,
  "node_modules/@scalar/api-reference/package.json",
);
const pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf8")) as {
  version: string;
};

mkdirSync(destDir, { recursive: true });
copyFileSync(srcPath, destPath);

console.log(
  `Copied @scalar/api-reference@${pkgJson.version} standalone bundle → public/scalar/standalone.js`,
);
