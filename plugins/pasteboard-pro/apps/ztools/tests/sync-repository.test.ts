import { describe, expect, it } from "vitest";

import { historyFixture } from "@pasteboard-pro/contract-fixtures";
import { PasteItemSchema } from "@pasteboard-pro/core";

import {
  ZToolsCanonicalClipboardStore,
  type ZToolsDocumentDatabase,
} from "../preload/clipboard-store";
import { ZToolsSyncEntityRepository } from "../preload/sync-repository";

function database(): ZToolsDocumentDatabase {
  const documents = new Map<string, Record<string, unknown>>();
  let revision = 0;
  return {
    async get(id) {
      const value = documents.get(id);
      if (value === undefined) throw { status: 404 };
      return structuredClone(value);
    },
    async put(document) {
      revision += 1;
      documents.set(String(document._id), {
        ...structuredClone(document),
        _rev: `${revision}-test`,
      });
      return { ok: true };
    },
    async remove(value) {
      if (typeof value !== "object" || value === null || !("_id" in value)) {
        throw new TypeError("invalid document");
      }
      documents.delete(String(value._id));
      return { ok: true };
    },
    async allDocs(options) {
      const start = String(options.startkey ?? "");
      const end = String(options.endkey ?? "\uffff");
      return {
        rows: [...documents.entries()]
          .filter(([id]) => id >= start && id <= end)
          .map(([id, doc]) => ({ id, doc: structuredClone(doc) })),
      };
    },
  };
}

describe("ZTools sync entity repository", () => {
  it("turns local deletion into a tombstone and permits only a newer live edit to return", async () => {
    const db = database();
    const clipboard = new ZToolsCanonicalClipboardStore(db, {
      deviceId: "host-a",
      now: () => 2_000_000_000_000,
    });
    const item = PasteItemSchema.parse(historyFixture[0]);
    await clipboard.put({
      item,
      origin: { host: "ztools", hostItemId: "host-item", hostType: "text" },
    });
    await clipboard.deleteRecords([item.id]);

    const repository = new ZToolsSyncEntityRepository(db, "host-a");
    expect(await repository.listEntities()).toEqual([
      expect.objectContaining({ id: item.id, deleted: true, entityType: "paste_item" }),
    ]);

    const revived = PasteItemSchema.parse({
      ...item,
      title: "Newer remote title",
      updatedAt: "2033-05-18T03:33:20.001Z",
      fieldClocks: {
        ...item.fieldClocks,
        title: { wallMs: 2_000_000_000_001, counter: 1, deviceId: "host-b" },
      },
    });
    await repository.applyEntities([revived]);
    expect(await repository.listEntities()).toEqual([
      expect.objectContaining({ id: item.id, title: "Newer remote title" }),
    ]);
  });
});
