import { describe, expect, it } from "vitest";

import { orderKeyBetween } from "../src/index";

const BASE62_PATTERN = /^[0-9A-Za-z]+$/;

function expectBetween(
  key: string,
  before?: string,
  after?: string,
): void {
  expect(key).toMatch(BASE62_PATTERN);
  if (before !== undefined) {
    expect(key > before).toBe(true);
  }
  if (after !== undefined) {
    expect(key < after).toBe(true);
  }
}

describe("orderKeyBetween", () => {
  it("uses the deterministic initial key and the exact simple midpoint", () => {
    expect(orderKeyBetween()).toBe("a0");
    expect(orderKeyBetween("a0", "a2")).toBe("a1");
  });

  it("creates a valid key between adjacent order keys", () => {
    const key = orderKeyBetween("a0", "a1");

    expectBetween(key, "a0", "a1");
  });

  it("supports open lower and upper bounds", () => {
    expectBetween(orderKeyBetween(undefined, "a0"), undefined, "a0");
    expectBetween(orderKeyBetween("a0", undefined), "a0", undefined);
  });

  it("supports repeated unique inserts in the same gap", () => {
    const first = orderKeyBetween("a0", "a1");
    const second = orderKeyBetween("a0", first);
    const third = orderKeyBetween("a0", second);

    expect(new Set([first, second, third]).size).toBe(3);
    expectBetween(first, "a0", "a1");
    expectBetween(second, "a0", first);
    expectBetween(third, "a0", second);
  });

  it("rejects invalid ranges and characters", () => {
    expect(() => orderKeyBetween("a1", "a1")).toThrow(RangeError);
    expect(() => orderKeyBetween("a2", "a1")).toThrow(RangeError);
    expect(() => orderKeyBetween("a-", "b0")).toThrow(TypeError);
    expect(() => orderKeyBetween("a0", "b_")).toThrow(TypeError);
  });

  it("requires rebalancing for an unrepresentable prefix gap", () => {
    expect(() => orderKeyBetween("a", "a0")).toThrow(RangeError);
  });
});
