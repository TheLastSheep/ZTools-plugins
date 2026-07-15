import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const pkg = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
const workspace = await readFile(new URL("pnpm-workspace.yaml", root), "utf8");

assert.equal(pkg.private, true);
assert.equal(pkg.packageManager, "pnpm@11.7.0");
assert.equal(pkg.scripts.test, "vitest run");
assert.match(workspace, /packages\/\*/);
assert.match(workspace, /apps\/\*/);
