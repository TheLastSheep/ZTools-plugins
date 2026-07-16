import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const pkg = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
const workspace = await readFile(new URL("pnpm-workspace.yaml", root), "utf8");
const tsconfig = JSON.parse(
  await readFile(new URL("tsconfig.json", root), "utf8"),
);
const normalizedWorkspace = workspace.replaceAll("\r\n", "\n");

assert.equal(pkg.private, true);
assert.equal(pkg.packageManager, "pnpm@11.7.0");
assert.equal(pkg.scripts.test, "vitest run");
assert.equal(pkg.scripts.build, "pnpm --filter @pasteboard-pro/ztools build");
assert.equal(
  normalizedWorkspace,
  "packages:\n  - packages/*\n  - apps/*\n",
);
assert.deepEqual(tsconfig.files, []);
assert.equal(Array.isArray(tsconfig.references), true);
