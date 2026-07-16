import { describe, expect, it } from "vitest";

import {
  historyFixture,
  pasteStackKeyboardFixture,
  selectionKeyboardFixture,
} from "@pasteboard-pro/contract-fixtures";
import { pasteboardTokens } from "@pasteboard-pro/design-tokens";

import {
  createPasteboardState,
  keyboardAction,
  visualState,
} from "../src/state";

describe("Vue canonical state", () => {
  it("replays the shared selection keyboard fixture", () => {
    const state = createPasteboardState({
      items: historyFixture.filter((item) =>
        selectionKeyboardFixture.orderedIds.includes(item.id),
      ),
      orderedIds: selectionKeyboardFixture.orderedIds,
      selection: selectionKeyboardFixture.initial,
    });

    for (const step of selectionKeyboardFixture.steps) {
      state.handleKeyboard(step.event);
      expect(state.selection.selected).toEqual(step.expectedSelected);
      expect(state.selection.anchor).toBe(step.expectedAnchor);
      expect(state.selection.focus).toBe(step.expectedFocus);
    }
  });

  it("replays the shared Paste Stack fixture", () => {
    const state = createPasteboardState({
      items: historyFixture,
      pasteStack: pasteStackKeyboardFixture.initial,
    });

    for (const step of pasteStackKeyboardFixture.steps) {
      state.dispatchPasteStack(step.action);
      expect(state.pasteStack.itemIds).toEqual(step.expectedItemIds);
      expect(state.pasteStack.direction).toBe(step.expectedDirection);
    }
  });

  it("filters through the shared query engine and repairs selection", () => {
    const state = createPasteboardState({
      items: historyFixture,
      selection: {
        selected: ["text-old"],
        anchor: "text-old",
        focus: "text-old",
      },
    });

    state.setQuery("type:image invoice");

    expect(state.visibleItems.map((item) => item.id)).toEqual(["image-new"]);
    expect(state.selection).toEqual({
      selected: ["image-new"],
      anchor: "image-new",
      focus: "image-new",
    });
  });

  it("maps Quick Paste 1-9 to visible items without consuming state", () => {
    const state = createPasteboardState({ items: historyFixture });

    expect(
      state.handleKeyboard({
        key: "2",
        metaKey: false,
        shiftKey: false,
        altKey: false,
      }),
    ).toEqual({ type: "quick-paste", itemId: state.visibleItems[1]?.id });
    expect(
      state.handleKeyboard({
        key: "9",
        metaKey: false,
        shiftKey: false,
        altKey: false,
      }),
    ).toBeNull();
  });

  it("moves single selection with arrows and exposes paste/preview effects", () => {
    const state = createPasteboardState({ items: historyFixture });
    const firstId = state.visibleItems[0]!.id;
    const secondId = state.visibleItems[1]!.id;

    state.replaceSelection(firstId);
    expect(
      state.handleKeyboard({
        key: "ArrowRight",
        metaKey: false,
        shiftKey: false,
        altKey: false,
      }),
    ).toBeNull();
    expect(state.selection.selected).toEqual([secondId]);
    expect(
      state.handleKeyboard({
        key: "Enter",
        metaKey: false,
        shiftKey: false,
        altKey: false,
      }),
    ).toEqual({ type: "paste", itemIds: [secondId] });
    expect(
      state.handleKeyboard({
        key: " ",
        metaKey: false,
        shiftKey: false,
        altKey: false,
      }),
    ).toEqual({ type: "preview", itemId: secondId });
  });
});

describe("visual state", () => {
  it("maps every dock edge and compact mode to shared tokens", () => {
    expect(visualState("bottom", "expanded")).toEqual({
      dockClass: "shelf--bottom",
      cardWidth: pasteboardTokens.expandedCardWidth,
      transitionMs: pasteboardTokens.dockTransitionMs,
    });
    expect(visualState("left", "compact")).toEqual({
      dockClass: "shelf--left",
      cardWidth: pasteboardTokens.compactCardWidth,
      transitionMs: pasteboardTokens.dockTransitionMs,
    });
  });

  it("translates host keyboard events into shared reducer actions", () => {
    expect(
      keyboardAction(
        { key: "a", metaKey: true, shiftKey: false, altKey: false },
        ["a", "b"],
      ),
    ).toEqual({ type: "select-all", orderedIds: ["a", "b"] });
    expect(
      keyboardAction(
        { key: "ArrowLeft", metaKey: false, shiftKey: true, altKey: false },
        ["a", "b"],
      ),
    ).toEqual({ type: "extend", orderedIds: ["a", "b"], direction: -1 });
  });
});
