import { mergeEntity, type Tombstone } from "@pasteboard-pro/sync-protocol";

import {
  ZToolsCanonicalClipboardStore,
  type ZToolsDocumentDatabase,
} from "./clipboard-store";
import { ZToolsPinboardStore } from "./pinboard-store";
import type { SyncEntity, SyncEntityRepository } from "./sync-runtime";

const TOMBSTONE_PREFIX = "pasteboard-pro:tombstone:";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function databaseStatus(error: unknown, status: number): boolean {
  return isRecord(error) && (error.status === status || error.statusCode === status);
}

function revision(value: unknown): string | undefined {
  return isRecord(value) && typeof value._rev === "string" ? value._rev : undefined;
}

function parsedTombstone(value: unknown): Tombstone | undefined {
  if (!isRecord(value) || value.type !== "pasteboard-pro-tombstone" || !isRecord(value.tombstone)) {
    return undefined;
  }
  const tombstone = value.tombstone;
  if (
    typeof tombstone.id !== "string" ||
    (tombstone.entityType !== "paste_item" && tombstone.entityType !== "pinboard") ||
    tombstone.deleted !== true ||
    typeof tombstone.deletedAt !== "string" ||
    typeof tombstone.sourceDeviceId !== "string" ||
    !isRecord(tombstone.clock) ||
    !Number.isSafeInteger(tombstone.clock.wallMs) ||
    !Number.isSafeInteger(tombstone.clock.counter) ||
    typeof tombstone.clock.deviceId !== "string"
  ) {
    return undefined;
  }
  return structuredClone(tombstone) as Tombstone;
}

function identity(entity: SyncEntity): string {
  if ("deleted" in entity) return `${entity.entityType}\0${entity.id}`;
  return `${"kind" in entity ? "paste_item" : "pinboard"}\0${entity.id}`;
}

export class ZToolsSyncEntityRepository implements SyncEntityRepository {
  private readonly clipboard: ZToolsCanonicalClipboardStore;
  private readonly pinboards: ZToolsPinboardStore;

  constructor(
    private readonly database: ZToolsDocumentDatabase,
    deviceId: string,
  ) {
    this.clipboard = new ZToolsCanonicalClipboardStore(database, { deviceId });
    this.pinboards = new ZToolsPinboardStore(database, { deviceId });
  }

  private async tombstones(): Promise<Tombstone[]> {
    if (this.database.allDocs === undefined) return [];
    const result = await this.database.allDocs({
      include_docs: true,
      startkey: TOMBSTONE_PREFIX,
      endkey: `${TOMBSTONE_PREFIX}\uffff`,
    });
    if (!isRecord(result) || !Array.isArray(result.rows)) {
      throw new TypeError("ZTools database returned invalid tombstone rows");
    }
    return result.rows.flatMap((row) =>
      isRecord(row) && parsedTombstone(row.doc) !== undefined
        ? [parsedTombstone(row.doc)!]
        : [],
    );
  }

  async listEntities(): Promise<SyncEntity[]> {
    const entities: SyncEntity[] = [
      ...(await this.clipboard.listRecords()).map((record) => record.item),
      ...(await this.pinboards.list()),
      ...(await this.tombstones()),
    ];
    const merged = new Map<string, SyncEntity>();
    for (const entity of entities) {
      const key = identity(entity);
      const current = merged.get(key);
      merged.set(
        key,
        current === undefined
          ? entity
          : (mergeEntity(current, entity) as SyncEntity),
      );
    }
    return [...merged.values()].map((entity) => structuredClone(entity));
  }

  private tombstoneDocumentId(tombstone: Tombstone): string {
    return `${TOMBSTONE_PREFIX}${tombstone.entityType}:${tombstone.id}`;
  }

  private async removeTombstone(entityType: Tombstone["entityType"], id: string): Promise<void> {
    if (this.database.remove === undefined) return;
    const documentId = `${TOMBSTONE_PREFIX}${entityType}:${id}`;
    try {
      await this.database.remove(await this.database.get(documentId));
    } catch (error) {
      if (!databaseStatus(error, 404)) throw error;
    }
  }

  private async putTombstone(tombstone: Tombstone): Promise<void> {
    const id = this.tombstoneDocumentId(tombstone);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      let current: unknown;
      try {
        current = await this.database.get(id);
      } catch (error) {
        if (!databaseStatus(error, 404)) throw error;
      }
      try {
        await this.database.put({
          _id: id,
          ...(revision(current) === undefined ? {} : { _rev: revision(current) }),
          type: "pasteboard-pro-tombstone",
          tombstone: structuredClone(tombstone),
        });
        return;
      } catch (error) {
        if (!databaseStatus(error, 409) || attempt === 2) throw error;
      }
    }
  }

  async applyEntities(entities: readonly SyncEntity[]): Promise<void> {
    for (const entity of entities) {
      if ("deleted" in entity) {
        if (entity.entityType === "paste_item") {
          await this.clipboard.removeSyncedItem(entity.id);
        } else {
          await this.pinboards.removeSynced(entity.id);
        }
        await this.putTombstone(entity);
      } else if ("kind" in entity) {
        await this.removeTombstone("paste_item", entity.id);
        await this.clipboard.putSyncedItem(entity);
      } else {
        await this.removeTombstone("pinboard", entity.id);
        await this.pinboards.putSynced(entity);
      }
    }
  }
}
