import { randomBytes as nodeRandomBytes } from "node:crypto";

import {
  bytesToHex,
  deriveVaultKey,
  hexToBytes,
} from "@pasteboard-pro/sync-protocol/node-crypto";

import type { KeychainSecretStore } from "./keychain";
import type { SyncSettings, ZToolsSyncStore } from "./sync-store";

export type SaveSyncConfigurationInput = Readonly<{
  enabled: boolean;
  baseUrl: string;
  username: string;
  webdavPassword?: string;
  syncPassword?: string;
  syncFileContents: boolean;
}>;

export async function saveSyncConfiguration(
  store: ZToolsSyncStore,
  keychain: KeychainSecretStore,
  input: SaveSyncConfigurationInput,
  randomBytes: (size: number) => Uint8Array = nodeRandomBytes,
): Promise<SyncSettings> {
  const current = await store.getSettings();
  const baseUrl = input.baseUrl.trim();
  const username = input.username.trim();
  const webdavPassword = input.webdavPassword;
  const syncPassword = input.syncPassword;

  if (input.enabled && (baseUrl.length === 0 || username.length === 0)) {
    throw new TypeError("启用同步前需要填写 WebDAV 地址和用户名");
  }
  if (username.includes(":") || username.includes("\0")) {
    throw new TypeError("WebDAV 用户名不能包含冒号或 NUL 字符");
  }
  if (webdavPassword !== undefined && webdavPassword.length > 0) {
    await keychain.save(current.webdavCredentialAccount, webdavPassword);
  } else if (input.enabled && (await keychain.load(current.webdavCredentialAccount)) === undefined) {
    throw new TypeError("启用同步前需要保存 WebDAV 密码");
  }

  let vaultSaltHex = current.vaultSaltHex;
  if (syncPassword !== undefined && syncPassword.length > 0) {
    vaultSaltHex ??= bytesToHex(randomBytes(16));
    const key = await deriveVaultKey(syncPassword, hexToBytes(vaultSaltHex));
    await keychain.save(
      current.vaultKeyAccount,
      Buffer.from(key).toString("base64"),
    );
  } else if (input.enabled && (await keychain.load(current.vaultKeyAccount)) === undefined) {
    throw new TypeError("启用同步前需要设置剪贴板同步密码");
  }

  const settings: SyncSettings = {
    ...current,
    enabled: input.enabled,
    baseUrl,
    username,
    ...(vaultSaltHex === undefined ? {} : { vaultSaltHex }),
    syncFileContents: input.syncFileContents,
    status: {
      state: input.enabled ? "idle" : "disabled",
      pendingObjects: (await store.listObjects()).length,
      ...(current.status.lastSyncedAt === undefined
        ? {}
        : { lastSyncedAt: current.status.lastSyncedAt }),
    },
  };
  await store.putSettings(settings);
  return settings;
}
