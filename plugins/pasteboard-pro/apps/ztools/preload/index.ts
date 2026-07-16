import {
  mirrorHostHistory,
  ZToolsCanonicalClipboardStore,
  type HostClipboardApi,
  type ZToolsDocumentDatabase,
} from "./clipboard-store";

type SearchHistoryInput = Readonly<{
  query?: string;
  limit?: number;
}>;

type ZToolsHost = Readonly<{
  onPluginEnter(callback: (parameter: unknown) => void): void;
  registerTool(
    name: string,
    handler: (input?: SearchHistoryInput) => Promise<unknown>,
  ): void;
  getNativeId(): string;
  clipboard: HostClipboardApi &
    Readonly<{
      onChange(callback: () => void): void;
    }>;
  db: Readonly<{
    promises: ZToolsDocumentDatabase;
  }>;
  setSubInput?(callback: (details: unknown) => void, placeholder: string): void;
}>;

const host = (window as Window & { ztools?: ZToolsHost }).ztools;

if (host === undefined) {
  throw new Error("PasteboardPro must run inside ZTools");
}

const ztools: ZToolsHost = host;
const store = new ZToolsCanonicalClipboardStore(ztools.db.promises);
let synchronization = Promise.resolve();

function reportSynchronizationError(error: unknown): void {
  window.dispatchEvent(
    new CustomEvent("pasteboard-pro:sync-error", {
      detail: error instanceof Error ? error.message : String(error),
    }),
  );
}

function scheduleHistoryMirror(): void {
  synchronization = synchronization
    .then(async () => {
      const result = await mirrorHostHistory(ztools.clipboard, store, {
        deviceId: ztools.getNativeId(),
        pageSize: 100,
      });
      window.dispatchEvent(
        new CustomEvent("pasteboard-pro:history-mirrored", { detail: result }),
      );
    })
    .catch(reportSynchronizationError);
}

ztools.onPluginEnter((parameter) => {
  window.dispatchEvent(
    new CustomEvent("pasteboard-pro:host-enter", { detail: parameter }),
  );
  scheduleHistoryMirror();
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

ztools.registerTool("search_history", async () => ({ items: [], total: 0 }));
