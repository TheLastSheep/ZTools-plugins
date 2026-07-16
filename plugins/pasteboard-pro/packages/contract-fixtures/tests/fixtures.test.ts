// @ts-expect-error -- The runtime is Node, while this workspace intentionally omits @types/node.
import { readdir, readFile } from "node:fs/promises";

import {
  PasteItemSchema,
  PinboardSchema,
  reducePasteStack,
  reduceSelection,
  searchPasteItems,
  type PasteStackState,
  type SelectionState,
} from "../../core/src/index";
import {
  mergeEntity,
  mergePasteItem,
  mergePinboard,
} from "../../sync-protocol/src/index";
import { describe, expect, it } from "vitest";

import {
  aes256GcmZeroVector,
  concurrentPasteItemEdits,
  concurrentPinboardEdits,
  historyFixture,
  pasteStackKeyboardFixture,
  pinboardFixture,
  selectionKeyboardFixture,
  tombstoneFixture,
} from "../src/index";
import { historyFixture as historySubmoduleFixture } from "../src/history";
import { selectionKeyboardFixture as keyboardSubmoduleFixture } from "../src/keyboard";
import { aes256GcmZeroVector as syncSubmoduleFixture } from "../src/sync";

const HISTORY_IDS = [
  "text-old",
  "image-new",
  "url-middle",
  "files-item",
  "color-item",
] as const;

const HISTORY_TIMESTAMPS = [
  ["2026-07-10T08:15:00.000Z", "2026-07-10T08:20:00.000Z"],
  ["2026-07-16T09:30:00.000Z", "2026-07-16T09:35:00.000Z"],
  ["2026-07-14T14:00:00.000Z", "2026-07-14T14:05:00.000Z"],
  ["2026-07-13T11:45:00.000Z", "2026-07-13T11:50:00.000Z"],
  ["2026-07-12T16:10:00.000Z", "2026-07-12T16:12:00.000Z"],
] as const;

const PINBOARD_TIMESTAMPS = [
  ["2026-07-01T08:00:00.000Z", "2026-07-10T08:20:00.000Z"],
  ["2026-07-02T08:00:00.000Z", "2026-07-16T09:35:00.000Z"],
] as const;

describe("history and pinboard contract fixtures", () => {
  it("parses every entity, keeps exact identities and timestamps, and freezes top arrays", () => {
    expect(historyFixture.map(({ id }) => id)).toEqual(HISTORY_IDS);
    expect(new Set(historyFixture.map(({ id }) => id)).size).toBe(
      HISTORY_IDS.length,
    );
    expect(
      historyFixture.map(({ copiedAt, updatedAt }) => [copiedAt, updatedAt]),
    ).toEqual(HISTORY_TIMESTAMPS);
    expect(
      pinboardFixture.map(({ createdAt, updatedAt }) => [createdAt, updatedAt]),
    ).toEqual(PINBOARD_TIMESTAMPS);
    expect(Object.isFrozen(historyFixture)).toBe(true);
    expect(Object.isFrozen(pinboardFixture)).toBe(true);

    for (const item of historyFixture) {
      expect(PasteItemSchema.parse(item)).toEqual(item);
      expect(Number.isNaN(Date.parse(item.copiedAt))).toBe(false);
      expect(Number.isNaN(Date.parse(item.updatedAt))).toBe(false);
    }
    for (const pinboard of pinboardFixture) {
      expect(PinboardSchema.parse(pinboard)).toEqual(pinboard);
      expect(Number.isNaN(Date.parse(pinboard.createdAt))).toBe(false);
      expect(Number.isNaN(Date.parse(pinboard.updatedAt))).toBe(false);
    }

    expect(pinboardFixture.map(({ id, orderKey }) => [id, orderKey])).toEqual([
      ["board-work", "a0"],
      ["board-reference", "a2"],
    ]);
    expect(
      historyFixture.filter(({ pinboardId }) => pinboardId).length,
    ).toBeGreaterThanOrEqual(2);
  });

  it("returns the fixed invoice ranking from real query scoring and capture times", () => {
    expect(
      searchPasteItems(historyFixture, "invoice").map(({ id }) => id),
    ).toEqual(["url-middle", "text-old", "image-new"]);
  });
});

describe("keyboard contract fixtures", () => {
  it("replays selection actions with the expected anchor and focus", () => {
    let state: SelectionState = structuredClone(
      selectionKeyboardFixture.initial,
    );

    for (const step of selectionKeyboardFixture.steps) {
      state = reduceSelection(state, step.action);
      expect(state.selected).toEqual(step.expectedSelected);
      expect(state.anchor).toBe(step.expectedAnchor);
      expect(state.focus).toBe(step.expectedFocus);
    }
  });

  it("replays paste-stack actions including deduplication and direction changes", () => {
    let state: PasteStackState = structuredClone(
      pasteStackKeyboardFixture.initial,
    );

    for (const step of pasteStackKeyboardFixture.steps) {
      state = reducePasteStack(state, step.action);
      expect(state).toEqual({
        itemIds: step.expectedItemIds,
        direction: step.expectedDirection,
      });
    }
  });
});

describe("sync contract fixtures", () => {
  it("merges concurrent field edits without mutating either fixture side", () => {
    const pasteSnapshot = structuredClone(concurrentPasteItemEdits);
    const pinboardSnapshot = structuredClone(concurrentPinboardEdits);

    const mergedPaste = mergePasteItem(
      concurrentPasteItemEdits.left,
      concurrentPasteItemEdits.right,
    );
    const mergedPinboard = mergePinboard(
      concurrentPinboardEdits.left,
      concurrentPinboardEdits.right,
    );

    expect({
      title: mergedPaste.title,
      pinboardId: mergedPaste.pinboardId,
    }).toEqual(concurrentPasteItemEdits.expected);
    expect({
      name: mergedPinboard.name,
      color: mergedPinboard.color,
    }).toEqual(concurrentPinboardEdits.expected);
    expect(concurrentPasteItemEdits).toEqual(pasteSnapshot);
    expect(concurrentPinboardEdits).toEqual(pinboardSnapshot);
  });

  it("lets the newer tombstone win without changing the live or deleted fixture", () => {
    const snapshot = structuredClone(tombstoneFixture);

    expect(
      mergeEntity(tombstoneFixture.live, tombstoneFixture.tombstone),
    ).toMatchObject({ id: "text-old", deleted: true });
    expect(tombstoneFixture).toEqual(snapshot);
  });
});

describe("AES-256-GCM fixed-byte contract vector", () => {
  it("keeps the exact NIST-style values, valid hex, byte lengths, and frozen identity", () => {
    expect(aes256GcmZeroVector).toEqual({
      algorithm: "AES-256-GCM",
      keyHex: "0000000000000000000000000000000000000000000000000000000000000000",
      nonceHex: "000000000000000000000000",
      plaintextHex: "00000000000000000000000000000000",
      aadHex: "",
      ciphertextHex: "cea7403d4d606b6e074ec5d3baf39d18",
      tagHex: "d0d1c8a799996bf0265b98b5d48ab919",
    });
    expect(Object.isFrozen(aes256GcmZeroVector)).toBe(true);

    for (const value of [
      aes256GcmZeroVector.keyHex,
      aes256GcmZeroVector.nonceHex,
      aes256GcmZeroVector.plaintextHex,
      aes256GcmZeroVector.aadHex,
      aes256GcmZeroVector.ciphertextHex,
      aes256GcmZeroVector.tagHex,
    ]) {
      expect(value).toMatch(/^(?:[0-9a-f]{2})*$/);
    }

    expect(aes256GcmZeroVector.keyHex.length / 2).toBe(32);
    expect(aes256GcmZeroVector.nonceHex.length / 2).toBe(12);
    expect(aes256GcmZeroVector.plaintextHex.length / 2).toBe(16);
    expect(aes256GcmZeroVector.ciphertextHex.length / 2).toBe(16);
    expect(aes256GcmZeroVector.tagHex.length / 2).toBe(16);
  });
});

describe("fixture source determinism and public imports", () => {
  it("does not generate runtime identities or timestamps", async () => {
    const sourceDirectory = new URL("../src/", import.meta.url);
    const sourceFiles = (await readdir(sourceDirectory)).filter((file: string) =>
      file.endsWith(".ts"),
    );
    const sources = await Promise.all(
      sourceFiles.map((file: string) =>
        readFile(new URL(file, sourceDirectory), "utf8"),
      ),
    );

    expect(sourceFiles.sort()).toEqual([
      "history.ts",
      "index.ts",
      "keyboard.ts",
      "sync.ts",
    ]);
    for (const source of sources) {
      expect(source).not.toContain("Date.now(");
      expect(source).not.toContain("Math.random(");
      expect(source).not.toContain("randomUUID(");
    }
  });

  it("exposes the root fixture API and each public source submodule", () => {
    expect(historySubmoduleFixture).toBe(historyFixture);
    expect(keyboardSubmoduleFixture).toBe(selectionKeyboardFixture);
    expect(syncSubmoduleFixture).toBe(aes256GcmZeroVector);
  });
});
