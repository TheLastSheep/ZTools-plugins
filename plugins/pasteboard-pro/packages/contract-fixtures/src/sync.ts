import type { PasteItem, Pinboard } from "@pasteboard-pro/core";
import type { Tombstone } from "@pasteboard-pro/sync-protocol";

export const concurrentPasteItemEdits = {
  left: {
    id: "concurrent-paste-item",
    kind: "text",
    sourceApp: { bundleId: "com.apple.TextEdit", name: "TextEdit" },
    sourceDeviceId: "capture-device",
    copiedAt: "2026-07-15T10:00:00.000Z",
    updatedAt: "2026-07-16T10:02:00.000Z",
    contentFingerprint: "sha256:concurrent-paste-item:v1",
    title: "Local title",
    payload: {
      revision: "revision:concurrent-paste-item:v1",
      text: "Shared immutable payload",
    },
    pinboardId: "board-work",
    pinboardOrderKey: "a0",
    pinned: true,
    fieldClocks: {
      title: { wallMs: 2_000, counter: 0, deviceId: "local-device" },
      pinboardId: { wallMs: 1_000, counter: 0, deviceId: "local-device" },
    },
  },
  right: {
    id: "concurrent-paste-item",
    kind: "text",
    sourceApp: { bundleId: "com.apple.TextEdit", name: "TextEdit" },
    sourceDeviceId: "capture-device",
    copiedAt: "2026-07-15T10:00:00.000Z",
    updatedAt: "2026-07-16T10:03:00.000Z",
    contentFingerprint: "sha256:concurrent-paste-item:v1",
    title: "Remote title",
    payload: {
      revision: "revision:concurrent-paste-item:v1",
      text: "Shared immutable payload",
    },
    pinboardId: "board-reference",
    pinboardOrderKey: "a0",
    pinned: true,
    fieldClocks: {
      title: { wallMs: 1_500, counter: 0, deviceId: "remote-device" },
      pinboardId: { wallMs: 2_500, counter: 0, deviceId: "remote-device" },
    },
  },
  expected: {
    title: "Local title",
    pinboardId: "board-reference",
  },
} satisfies {
  left: PasteItem;
  right: PasteItem;
  expected: { title: string; pinboardId: string };
};

export const concurrentPinboardEdits = {
  left: {
    id: "concurrent-pinboard",
    name: "Project Work",
    color: "#4C6FFF",
    orderKey: "a0",
    createdAt: "2026-07-01T08:00:00.000Z",
    updatedAt: "2026-07-16T11:00:00.000Z",
    fieldClocks: {
      name: { wallMs: 3_000, counter: 0, deviceId: "local-device" },
      color: { wallMs: 1_000, counter: 0, deviceId: "local-device" },
    },
  },
  right: {
    id: "concurrent-pinboard",
    name: "Remote Work",
    color: "#FF8800",
    orderKey: "a0",
    createdAt: "2026-07-01T08:00:00.000Z",
    updatedAt: "2026-07-16T11:05:00.000Z",
    fieldClocks: {
      name: { wallMs: 2_000, counter: 0, deviceId: "remote-device" },
      color: { wallMs: 4_000, counter: 0, deviceId: "remote-device" },
    },
  },
  expected: {
    name: "Project Work",
    color: "#FF8800",
  },
} satisfies {
  left: Pinboard;
  right: Pinboard;
  expected: { name: string; color: string };
};

export const tombstoneFixture = {
  live: {
    id: "text-old",
    kind: "text",
    sourceApp: { bundleId: "com.apple.TextEdit", name: "TextEdit" },
    sourceDeviceId: "device-mac-studio",
    copiedAt: "2026-07-10T08:15:00.000Z",
    updatedAt: "2026-07-10T08:20:00.000Z",
    contentFingerprint: "sha256:text-old:v1",
    title: "Old live title",
    payload: {
      revision: "revision:text-old:v1",
      text: "Invoice #1042 is due on July 31 for USD 480.00.",
    },
    pinboardId: "board-work",
    pinboardOrderKey: "a0",
    pinned: true,
    fieldClocks: {
      title: { wallMs: 1_000, counter: 0, deviceId: "device-mac-studio" },
      payload: { wallMs: 1_100, counter: 0, deviceId: "device-mac-studio" },
      pinboardId: { wallMs: 1_200, counter: 0, deviceId: "device-mac-studio" },
      pinboardOrderKey: { wallMs: 1_300, counter: 0, deviceId: "device-mac-studio" },
      pinned: { wallMs: 1_400, counter: 0, deviceId: "device-mac-studio" },
    },
  },
  tombstone: {
    id: "text-old",
    entityType: "paste_item",
    deleted: true,
    deletedAt: "2026-07-16T12:00:00.000Z",
    sourceDeviceId: "device-macbook-air",
    clock: { wallMs: 2_000, counter: 0, deviceId: "device-macbook-air" },
  },
} satisfies { live: PasteItem; tombstone: Tombstone };

export const aes256GcmZeroVector = Object.freeze({
  algorithm: "AES-256-GCM",
  keyHex: "0000000000000000000000000000000000000000000000000000000000000000",
  nonceHex: "000000000000000000000000",
  plaintextHex: "00000000000000000000000000000000",
  aadHex: "",
  ciphertextHex: "cea7403d4d606b6e074ec5d3baf39d18",
  tagHex: "d0d1c8a799996bf0265b98b5d48ab919",
} as const);
