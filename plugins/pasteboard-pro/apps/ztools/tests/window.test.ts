import { describe, expect, it } from "vitest";

import {
  buildShelfWindowOptions,
  resolveShelfPlacement,
  ShelfWindowManager,
  type BrowserWindowHandle,
  type ShelfWindowHost,
} from "../preload/window";

const primaryDisplay = {
  id: "primary",
  workArea: { x: 0, y: 24, width: 1440, height: 876 },
};

describe("ZTools shelf window geometry", () => {
  it("builds a frameless bottom shelf against the visible work area", () => {
    expect(buildShelfWindowOptions(primaryDisplay, "bottom")).toMatchObject({
      x: 160,
      y: 620,
      width: 1120,
      height: 280,
      transparent: true,
      frame: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      backgroundColor: "#00000000",
      webPreferences: { preload: "preload.js" },
    });
  });

  it("places side shelves on negative-coordinate displays", () => {
    const secondary = {
      id: "secondary",
      workArea: { x: -1920, y: 0, width: 1920, height: 1080 },
    };

    expect(buildShelfWindowOptions(secondary, "left")).toMatchObject({
      x: -1920,
      y: 180,
      width: 380,
      height: 720,
    });
    expect(buildShelfWindowOptions(secondary, "right")).toMatchObject({
      x: -380,
      y: 180,
      width: 380,
      height: 720,
    });
  });

  it("restores a saved display when present and falls back safely when removed", () => {
    const secondary = {
      id: 2,
      workArea: { x: 1440, y: 0, width: 1920, height: 1080 },
    };

    expect(
      resolveShelfPlacement(
        [primaryDisplay, secondary],
        { displayId: 2, edge: "right" },
        "primary",
      ),
    ).toMatchObject({ display: secondary, edge: "right" });
    expect(
      resolveShelfPlacement(
        [primaryDisplay],
        { displayId: 2, edge: "right" },
        "primary",
      ),
    ).toMatchObject({ display: primaryDisplay, edge: "floating" });
  });
});

describe("ZTools shelf lifecycle", () => {
  it("creates one shelf, applies content protection, and reuses it", () => {
    const calls: string[] = [];
    const windowHandle: BrowserWindowHandle = {
      isDestroyed: () => false,
      show: () => calls.push("show"),
      focus: () => calls.push("focus"),
      close: () => calls.push("close"),
      setContentProtection: (enabled) => calls.push(`protect:${enabled}`),
    };
    const host: ShelfWindowHost = {
      createBrowserWindow(url, options, onReady) {
        calls.push(`create:${url}`);
        expect(options).toMatchObject({ x: 160, y: 620 });
        onReady?.();
        return windowHandle;
      },
      hideMainWindow(restorePreviousWindow) {
        calls.push(`hide:${restorePreviousWindow}`);
      },
    };
    const manager = new ShelfWindowManager(host);

    expect(
      manager.open(primaryDisplay, {
        edge: "bottom",
        contentProtection: true,
      }),
    ).toBe(windowHandle);
    expect(
      manager.open(primaryDisplay, {
        edge: "bottom",
        contentProtection: true,
      }),
    ).toBe(windowHandle);

    expect(calls.filter((call) => call.startsWith("create:"))).toHaveLength(1);
    expect(calls).toContain("protect:true");
    expect(calls).toContain("hide:false");
    expect(calls.slice(-2)).toEqual(["show", "focus"]);
  });

  it("recreates a destroyed shelf and can close the active handle", () => {
    let destroyed = false;
    let created = 0;
    let closed = 0;
    const host: ShelfWindowHost = {
      createBrowserWindow() {
        created += 1;
        destroyed = false;
        return {
          isDestroyed: () => destroyed,
          show() {},
          focus() {},
          close() {
            closed += 1;
            destroyed = true;
          },
          setContentProtection() {},
        };
      },
      hideMainWindow() {},
    };
    const manager = new ShelfWindowManager(host);

    manager.open(primaryDisplay, { edge: "floating", contentProtection: false });
    destroyed = true;
    manager.open(primaryDisplay, { edge: "floating", contentProtection: false });
    manager.close();

    expect(created).toBe(2);
    expect(closed).toBe(1);
  });
});
