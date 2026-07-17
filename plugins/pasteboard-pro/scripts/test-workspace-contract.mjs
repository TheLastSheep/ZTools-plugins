import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const pkg = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
const workspace = await readFile(new URL("pnpm-workspace.yaml", root), "utf8");
const tsconfig = JSON.parse(
  await readFile(new URL("tsconfig.json", root), "utf8"),
);
const [pullRequestWorkflow, releaseWorkflow] = await Promise.all([
  readFile(new URL("../../.github/workflows/build-pr-plugin.yml", root), "utf8"),
  readFile(new URL("../../.github/workflows/build-and-release.yml", root), "utf8"),
]);
const normalizedWorkspace = workspace.replaceAll("\r\n", "\n");

assert.equal(pkg.private, true);
assert.equal(pkg.packageManager, "pnpm@11.7.0");
assert.equal(pkg.scripts.test, "vitest run");
assert.equal(
  pkg.scripts["test:release-archive"],
  "node scripts/test-release-archive.mjs",
);
assert.equal(
  pkg.scripts["test:visual-artifact"],
  "node scripts/test-visual-artifact.mjs",
);
assert.equal(
  pkg.scripts["verify:visual-artifact"],
  "node scripts/verify-visual-artifact.mjs",
);
assert.equal(
  pkg.scripts["benchmark:search"],
  "node scripts/benchmark-pasteboardpro.mjs",
);
assert.equal(
  pkg.scripts.build,
  "pnpm --filter @pasteboard-pro/atools build && pnpm --filter @pasteboard-pro/ztools build",
);
assert.equal(
  normalizedWorkspace,
  "packages:\n  - packages/*\n  - apps/*\n\nallowBuilds:\n  esbuild: true\n",
);
assert.deepEqual(tsconfig.files, []);
assert.equal(Array.isArray(tsconfig.references), true);
assert.equal(tsconfig.references.some((entry) => entry.path === "./apps/atools"), true);
await readFile(new URL("scripts/verify-release-archive.mjs", root), "utf8");
for (const workflow of [pullRequestWorkflow, releaseWorkflow]) {
  assert.match(workflow, /pnpm test:release-archive/u);
  assert.match(workflow, /pnpm test:visual-artifact/u);
  assert.match(workflow, /pnpm verify:visual-artifact/u);
  assert.match(workflow, /Verify final PasteboardPro release archive/u);
  assert.match(workflow, /verify-release-archive\.mjs/u);
  assert.match(workflow, /pasteboardpro-archive-verification\.json/u);
  assert.match(workflow, /attest-vision-helper\.mjs/u);
  assert.match(workflow, /pasteboard-vision-attestation\.json/u);
  assert.match(workflow, /--helper-attestation=/u);
}
assert.match(pullRequestWorkflow, /--require-helper-signature=adhoc/u);
assert.match(releaseWorkflow, /--require-helper-signature=developer-id/u);
assert.match(releaseWorkflow, /--require-gatekeeper/u);
