/// <reference types="vite/client" />

import type {
  CapturePauseState,
  ClipboardWriteContent,
  DirectPasteResult,
  PrivacySettings,
} from "../preload/privacy";

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
    }>;
  }
}

export {};
