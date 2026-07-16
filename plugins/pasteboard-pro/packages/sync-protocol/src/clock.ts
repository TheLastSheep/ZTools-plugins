import type { HybridClock } from "@pasteboard-pro/core";

export function compareClock(a: HybridClock, b: HybridClock): -1 | 0 | 1 {
  if (a.wallMs < b.wallMs) {
    return -1;
  }
  if (a.wallMs > b.wallMs) {
    return 1;
  }

  if (a.counter < b.counter) {
    return -1;
  }
  if (a.counter > b.counter) {
    return 1;
  }

  if (a.deviceId < b.deviceId) {
    return -1;
  }
  if (a.deviceId > b.deviceId) {
    return 1;
  }

  return 0;
}

export function pickNewer<T>(
  left: T,
  leftClock: HybridClock,
  right: T,
  rightClock: HybridClock,
): T {
  return compareClock(leftClock, rightClock) < 0 ? right : left;
}
