import {
  clampShelfBounds,
  type DockEdge,
  type Rect,
} from "@pasteboard-pro/design-tokens";

export type ShelfDisplay = Readonly<{
  id: string | number;
  workArea: Rect;
}>;

export type SavedShelfPlacement = Readonly<{
  displayId: string | number;
  edge: DockEdge;
}>;

export type BrowserWindowOptions = Readonly<{
  x: number;
  y: number;
  width: number;
  height: number;
  useContentSize: true;
  transparent: true;
  backgroundColor: "#00000000";
  frame: false;
  hasShadow: true;
  alwaysOnTop: true;
  skipTaskbar: true;
  minimizable: false;
  maximizable: false;
  fullscreenable: false;
  resizable: boolean;
  show: false;
  webPreferences: Readonly<{
    preload: "preload.js";
    nodeIntegration: false;
    contextIsolation: false;
    backgroundThrottling: false;
  }>;
}>;

export interface BrowserWindowHandle {
  isDestroyed(): boolean;
  show(): void;
  focus(): void;
  close(): void;
  setContentProtection(enabled: boolean): void;
}

export interface ShelfWindowHost {
  createBrowserWindow(
    url: string,
    options: BrowserWindowOptions,
    onReady?: () => void,
  ): BrowserWindowHandle;
  hideMainWindow(restorePreviousWindow?: boolean): void;
}

export type OpenShelfOptions = Readonly<{
  edge: DockEdge;
  contentProtection: boolean;
}>;

const BOTTOM_SHELF_WIDTH = 1_120;
const BOTTOM_SHELF_HEIGHT = 280;
const SIDE_SHELF_WIDTH = 380;
const SIDE_SHELF_HEIGHT = 720;
const FLOATING_MARGIN = 24;

function preferredBounds(display: ShelfDisplay, edge: DockEdge): Rect {
  const { workArea } = display;

  if (edge === "left" || edge === "right") {
    const width = Math.min(SIDE_SHELF_WIDTH, workArea.width);
    const height = Math.min(SIDE_SHELF_HEIGHT, workArea.height);
    return {
      x: edge === "left" ? workArea.x : workArea.x + workArea.width - width,
      y: workArea.y + (workArea.height - height) / 2,
      width,
      height,
    };
  }

  const width = Math.min(BOTTOM_SHELF_WIDTH, workArea.width);
  const height = Math.min(BOTTOM_SHELF_HEIGHT, workArea.height);
  return {
    x: workArea.x + (workArea.width - width) / 2,
    y:
      edge === "bottom"
        ? workArea.y + workArea.height - height
        : workArea.y + workArea.height - height - FLOATING_MARGIN,
    width,
    height,
  };
}

export function buildShelfWindowOptions(
  display: ShelfDisplay,
  edge: DockEdge,
): BrowserWindowOptions {
  const bounds = clampShelfBounds(preferredBounds(display, edge), display);

  return {
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: Math.round(bounds.width),
    height: Math.round(bounds.height),
    useContentSize: true,
    transparent: true,
    backgroundColor: "#00000000",
    frame: false,
    hasShadow: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    resizable: edge === "floating",
    show: false,
    webPreferences: {
      preload: "preload.js",
      nodeIntegration: false,
      contextIsolation: false,
      backgroundThrottling: false,
    },
  };
}

function sameDisplayId(left: string | number, right: string | number): boolean {
  return String(left) === String(right);
}

export function resolveShelfPlacement(
  displays: readonly ShelfDisplay[],
  saved: SavedShelfPlacement | undefined,
  fallbackDisplayId?: string | number,
): Readonly<{ display: ShelfDisplay; edge: DockEdge }> {
  if (displays.length === 0) {
    throw new RangeError("At least one display is required");
  }

  if (saved !== undefined) {
    const savedDisplay = displays.find((display) =>
      sameDisplayId(display.id, saved.displayId),
    );
    if (savedDisplay !== undefined) {
      return { display: savedDisplay, edge: saved.edge };
    }
  }

  const fallbackDisplay =
    fallbackDisplayId === undefined
      ? undefined
      : displays.find((display) =>
          sameDisplayId(display.id, fallbackDisplayId),
        );

  return { display: fallbackDisplay ?? displays[0]!, edge: "floating" };
}

export class ShelfWindowManager {
  private current: BrowserWindowHandle | undefined;

  constructor(private readonly host: ShelfWindowHost) {}

  open(display: ShelfDisplay, options: OpenShelfOptions): BrowserWindowHandle {
    if (this.current !== undefined && !this.current.isDestroyed()) {
      this.current.setContentProtection(options.contentProtection);
      this.current.show();
      this.current.focus();
      return this.current;
    }

    const url = `index.html?shelf=1&dock=${encodeURIComponent(options.edge)}&display=${encodeURIComponent(String(display.id))}`;
    let handle: BrowserWindowHandle | undefined;
    let readyBeforeAssignment = false;
    const finishOpening = (): void => {
      if (handle === undefined) {
        readyBeforeAssignment = true;
        return;
      }
      handle.show();
      handle.focus();
      this.host.hideMainWindow(false);
    };

    handle = this.host.createBrowserWindow(
      url,
      buildShelfWindowOptions(display, options.edge),
      finishOpening,
    );
    this.current = handle;
    handle.setContentProtection(options.contentProtection);

    if (readyBeforeAssignment) {
      finishOpening();
    }

    return handle;
  }

  close(): void {
    if (this.current !== undefined && !this.current.isDestroyed()) {
      this.current.close();
    }
    this.current = undefined;
  }
}
