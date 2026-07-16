import { describe, expect, it } from "vitest";

import type { ZToolsDocumentDatabase } from "../preload/clipboard-store";
import type { KeychainSecretStore } from "../preload/keychain";
import { saveSyncConfiguration } from "../preload/sync-config";
import { ZToolsSyncStore } from "../preload/sync-store";

describe("sync configuration", () => {
  it("derives the vault key and persists both secrets only in Keychain", async () => {
    let document: Record<string, unknown> | undefined;
    const secrets = new Map<string, string>();
    const database: ZToolsDocumentDatabase = {
      async get() {
        if (document === undefined) throw { status: 404 };
        return structuredClone(document);
      },
      async put(next) {
        document = { ...structuredClone(next), _rev: "1-test" };
        return { ok: true };
      },
    };
    const keychain: KeychainSecretStore = {
      async save(account, secret) { secrets.set(account, secret); },
      async load(account) { return secrets.get(account); },
      async delete(account) { secrets.delete(account); },
    };
    const settings = await saveSyncConfiguration(
      new ZToolsSyncStore(database),
      keychain,
      {
        enabled: true,
        baseUrl: "https://dav.example.com/PasteboardPro/v1/",
        username: "alice",
        webdavPassword: "dav-secret",
        syncPassword: "sync-secret",
        syncFileContents: false,
      },
      () => new Uint8Array(16).fill(7),
    );

    expect(secrets.get("webdav")).toBe("dav-secret");
    expect(Buffer.from(secrets.get("vault-key")!, "base64")).toHaveLength(32);
    expect(settings.vaultSaltHex).toBe("07070707070707070707070707070707");
    expect(JSON.stringify(document)).not.toMatch(/dav-secret|sync-secret/);
  });
});
