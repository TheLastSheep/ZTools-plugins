import path from "node:path";

import {
  mirrorHostHistory,
  ZToolsCanonicalClipboardStore,
  type HostClipboardApi,
  type ZToolsDocumentDatabase,
} from "./clipboard-store";
import { createOcrClient } from "./ocr";
import { createKeychainSecretStore } from "./keychain";
import {
  isCapturePaused,
  performDirectPaste,
  shouldPersistClipboard,
  ZToolsPrivacySettingsStore,
  type CapturePauseState,
  type ClipboardPasteHost,
  type ClipboardPrivacyInput,
  type ClipboardWriteContent,
  type DirectPasteResult,
  type PrivacySettings,
} from "./privacy";
import { ZToolsPinboardStore } from "./pinboard-store";
import { executeRetentionPrune } from "./retention";
import {
  saveSyncConfiguration,
  type SaveSyncConfigurationInput,
} from "./sync-config";
import { ZToolsSyncStore, type SyncSettings } from "./sync-store";
import { createSearchHistoryHandler } from "./tools";
import {
  ShelfWindowManager,
  type BrowserWindowHandle,
  type BrowserWindowOptions,
  type ShelfDisplay,
} from "./window";

type ZToolsDisplay = Readonly<{
  id: string | number;
  bounds: Readonly<{ x: number; y: number; width: number; height: number }>;
  workArea: Readonly<{ x: number; y: number; width: number; height: number }>;
}>;

type ZToolsHost = Readonly<{
  onPluginEnter(callback: (parameter: unknown) => void): void;
  registerTool(
    name: string,
    handler: (input?: unknown) => Promise<unknown>,
  ): void;
  getNativeId(): string;
  clipboard: HostClipboardApi &
    ClipboardPasteHost &
    Readonly<{
      onChange(callback: () => void): void;
    }>;
  db: Readonly<{
    promises: ZToolsDocumentDatabase;
  }>;
  setSubInput?(callback: (details: unknown) => void, placeholder: string): void;
  getCursorScreenPoint(): Readonly<{ x: number; y: number }>;
  getDisplayNearestPoint(point: Readonly<{ x: number; y: number }>): ZToolsDisplay;
  createBrowserWindow(
    url: string,
    options: BrowserWindowOptions,
    onReady?: () => void,
  ): BrowserWindowHandle;
  hideMainWindow(restorePreviousWindow?: boolean): void;
}>;

type PasteboardProBridge = Readonly<{
  searchHistory(query?: string, limit?: number): Promise<Readonly<{ items: unknown[]; total: number }>>;
  getPrivacySettings(): Promise<PrivacySettings>;
  setCapturePause(pause: CapturePauseState): Promise<PrivacySettings>;
  pasteHostItem(hostItemId: string): Promise<DirectPasteResult>;
  pasteContent(content: ClipboardWriteContent): Promise<DirectPasteResult>;
  pasteItem(itemId: string): Promise<DirectPasteResult>;
  listPinboards(): Promise<unknown[]>;
  createPinboard(name: string, color: string): Promise<unknown>;
  renamePinboard(id: string, name: string): Promise<unknown>;
  movePinboard(
    id: string,
    beforeId?: string,
    afterId?: string,
  ): Promise<unknown>;
  assignItemsToPinboard(
    itemIds: readonly string[],
    pinboardId: string | undefined,
  ): Promise<unknown[]>;
  recognizeItem(itemId: string): Promise<string>;
  getSyncSettings(): Promise<SyncSettings>;
  saveSyncSettings(input: SaveSyncConfigurationInput): Promise<SyncSettings>;
}>;

const host = (window as Window & { ztools?: ZToolsHost }).ztools;

if (host === undefined) {
  throw new Error("PasteboardPro must run inside ZTools");
}

const ztools: ZToolsHost = host;
const isShelfWindow =
  new URLSearchParams(window.location.search).get("shelf") === "1";
const store = new ZToolsCanonicalClipboardStore(ztools.db.promises, {
  deviceId: ztools.getNativeId(),
});
const privacyStore = new ZToolsPrivacySettingsStore(ztools.db.promises);
const pinboardStore = new ZToolsPinboardStore(ztools.db.promises, {
  deviceId: ztools.getNativeId(),
});
const syncStore = new ZToolsSyncStore(ztools.db.promises);
const keychain = createKeychainSecretStore();
const shelfWindows = new ShelfWindowManager(ztools);
const ocrClient = createOcrClient({
  helperPath: path.join(__dirname, "pasteboard-vision"),
});
let synchronization = Promise.resolve();
let shelfRefreshTimer: number | undefined;
let lastRetentionRun = 0;
const RETENTION_INTERVAL_MS = 24 * 60 * 60 * 1_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function privacyInput(
  rawItem: unknown,
  text: string | undefined,
): ClipboardPrivacyInput {
  if (!isRecord(rawItem)) {
    return text === undefined ? {} : { text };
  }
  const sourceBundleId =
    typeof rawItem.appBundleId === "string"
      ? rawItem.appBundleId
      : typeof rawItem.bundleId === "string"
        ? rawItem.bundleId
        : undefined;
  return {
    ...(sourceBundleId === undefined ? {} : { sourceBundleId }),
    ...(text === undefined ? {} : { text }),
    ...(rawItem.transient === true || rawItem.isTransient === true
      ? { transient: true }
      : {}),
    ...(rawItem.confidential === true || rawItem.isConfidential === true
      ? { confidential: true }
      : {}),
  };
}

function activeDisplay(): ShelfDisplay {
  const display = ztools.getDisplayNearestPoint(ztools.getCursorScreenPoint());
  return { id: display.id, workArea: { ...display.workArea } };
}

function reportSynchronizationError(error: unknown): void {
  window.dispatchEvent(
    new CustomEvent("pasteboard-pro:sync-error", {
      detail: error instanceof Error ? error.message : String(error),
    }),
  );
}

async function runRetentionIfDue(): Promise<void> {
  const now = Date.now();
  if (now - lastRetentionRun < RETENTION_INTERVAL_MS) {
    return;
  }
  try {
    const result = await executeRetentionPrune(store, {
      days: 90,
      maxBlobBytes: 1_073_741_824,
      now,
    });
    window.dispatchEvent(
      new CustomEvent("pasteboard-pro:retention-completed", { detail: result }),
    );
    lastRetentionRun = now;
  } catch (error) {
    lastRetentionRun = now - RETENTION_INTERVAL_MS + 5 * 60 * 1_000;
    window.dispatchEvent(
      new CustomEvent("pasteboard-pro:retention-error", {
        detail: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}

function scheduleHistoryMirror(): void {
  synchronization = synchronization
    .then(async () => {
      const privacy = await privacyStore.get();
      const result = await mirrorHostHistory(ztools.clipboard, store, {
        deviceId: ztools.getNativeId(),
        pageSize: 100,
        shouldPersist: (rawItem, record) =>
          !isCapturePaused(privacy.pause) &&
          shouldPersistClipboard(
            privacyInput(rawItem, record.item.payload.text),
            privacy.rules,
          ),
      });
      window.dispatchEvent(
        new CustomEvent("pasteboard-pro:history-mirrored", { detail: result }),
      );
      await runRetentionIfDue();
    })
    .catch(reportSynchronizationError);
}

if (!isShelfWindow) {
  ztools.onPluginEnter((parameter) => {
    window.dispatchEvent(
      new CustomEvent("pasteboard-pro:host-enter", { detail: parameter }),
    );
    scheduleHistoryMirror();
    shelfWindows.open(activeDisplay(), {
      edge: "bottom",
      contentProtection: true,
    });
  });

  ztools.clipboard.onChange(scheduleHistoryMirror);

  ztools.setSubInput?.(
    (details) => {
      window.dispatchEvent(
        new CustomEvent("pasteboard-pro:host-search", { detail: details }),
      );
    },
    "搜索剪贴板历史",
  );
} else {
  ztools.clipboard.onChange(() => {
    if (shelfRefreshTimer !== undefined) {
      window.clearTimeout(shelfRefreshTimer);
    }
    shelfRefreshTimer = window.setTimeout(() => {
      shelfRefreshTimer = undefined;
      window.dispatchEvent(new CustomEvent("pasteboard-pro:history-changed"));
    }, 250);
  });
}

if (!isShelfWindow) {
  ztools.registerTool("search_history", createSearchHistoryHandler(store));
}

const bridge: PasteboardProBridge = {
  searchHistory: (query = "", limit = 1_000) =>
    store.search(query, Math.max(1, Math.min(10_000, Math.floor(limit)))),
  getPrivacySettings: () => privacyStore.get(),
  async setCapturePause(pause) {
    const current = await privacyStore.get();
    const updated = { ...current, pause };
    await privacyStore.put(updated);
    return updated;
  },
  pasteHostItem: (hostItemId) =>
    performDirectPaste({ type: "host", hostItemId }, ztools.clipboard),
  pasteContent: (content) =>
    performDirectPaste({ type: "content", content }, ztools.clipboard),
  async pasteItem(itemId) {
    const record = await store.findRecordByItemId(itemId);
    if (record === undefined) {
      throw new RangeError("Clipboard item no longer exists");
    }
    return performDirectPaste(
      { type: "host", hostItemId: record.origin.hostItemId },
      ztools.clipboard,
    );
  },
  listPinboards: () => pinboardStore.list(),
  createPinboard: (name, color) => pinboardStore.create(name, color),
  renamePinboard: (id, name) => pinboardStore.rename(id, name),
  movePinboard: (id, beforeId, afterId) =>
    pinboardStore.moveBetween(id, beforeId, afterId),
  async assignItemsToPinboard(itemIds, pinboardId) {
    if (
      pinboardId !== undefined &&
      !(await pinboardStore.list()).some((pinboard) => pinboard.id === pinboardId)
    ) {
      throw new RangeError("Pinboard does not exist");
    }
    return store.assignToPinboard(itemIds, pinboardId);
  },
  async recognizeItem(itemId) {
    if (process.platform !== "darwin") {
      throw new Error("本地 Vision OCR 仅支持 macOS");
    }
    const record = await store.findRecordByItemId(itemId);
    const imagePath = record?.origin.imagePath;
    if (record === undefined || imagePath === undefined) {
      throw new RangeError("该记录没有可识别的本地图片");
    }
    const text = await ocrClient.recognize(imagePath);
    await store.updateOcrText(itemId, text);
    return text;
  },
  getSyncSettings: () => syncStore.getSettings(),
  saveSyncSettings: (input) =>
    saveSyncConfiguration(syncStore, keychain, input),
};

(window as Window & { pasteboardPro?: PasteboardProBridge }).pasteboardPro = bridge;
