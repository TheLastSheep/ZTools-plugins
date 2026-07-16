/// <reference types="vite/client" />

import type {
  CapturePauseState,
  ClipboardWriteContent,
  DirectPasteResult,
  PrivacySettings,
} from "../preload/privacy";
import type { SaveSyncConfigurationInput } from "../preload/sync-config";
import type { SyncSettings } from "../preload/sync-store";

declare global {
  interface Window {
    pasteboardPro?: Readonly<{
      searchHistory(
        query?: string,
        limit?: number,
      ): Promise<Readonly<{ items: unknown[]; total: number }>>;
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
      retrySync(): Promise<SyncSettings>;
    }>;
  }
}

export {};
