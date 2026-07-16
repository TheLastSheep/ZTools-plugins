import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);

const readJson = async (path) =>
  JSON.parse(await readFile(new URL(path, root), "utf8"));

const manifest = await readJson("public/plugin.json");
const packageJson = await readJson("package.json");
const preloadPackage = await readJson("public/package.json");

assert.equal(packageJson.name, "@pasteboard-pro/ztools");
assert.equal(packageJson.private, true);
assert.equal(packageJson.type, "module");
assert.equal(
  packageJson.scripts.build,
  "pnpm run build:renderer && pnpm run build:preload",
);
assert.equal(packageJson.scripts.verify, "node scripts/verify-package.mjs");

assert.equal(manifest.name, "pasteboard-pro");
assert.equal(manifest.title, "PasteboardPro");
assert.equal(manifest.main, "index.html");
assert.equal(manifest.preload, "preload.js");
assert.equal(manifest.logo, "logo.svg");
assert.deepEqual(manifest.platform, ["darwin", "win32", "linux"]);
assert.equal("development" in manifest, false);

const entryFeature = manifest.features.find(
  (feature) => feature.code === "pasteboard-pro",
);
assert.ok(entryFeature);
assert.ok(entryFeature.cmds.includes("剪贴板"));
assert.ok(entryFeature.cmds.includes("PasteboardPro"));

const searchTool = manifest.tools.search_history;
assert.equal(searchTool.inputSchema.additionalProperties, false);
assert.deepEqual(searchTool.inputSchema.required, []);
assert.deepEqual(searchTool.outputSchema.required, ["items", "total"]);
assert.equal(searchTool.inputSchema.properties.limit.maximum, 100);

assert.deepEqual(preloadPackage, { type: "commonjs" });

for (const path of [
  "index.html",
  "public/logo.svg",
  "preload/index.ts",
  "src/main.ts",
  "src/App.vue",
  "vite.config.ts",
  "vite.preload.config.ts",
]) {
  await access(new URL(path, root));
}

console.log("PasteboardPro ZTools package contract verified");
