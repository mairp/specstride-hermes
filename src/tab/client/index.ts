/**
 * The dashboard tab entry (T058; contracts/151-hermes-kanban/tab-manifest.md).
 *
 * This file becomes the bundle `dist/index.js`: `scripts/build-tab.ts` wraps
 * the client sources (with the generated closed sets) in one IIFE that
 * registers the tab ONCE under `window.__HERMES_PLUGINS__.register(
 * "specstride", …)`. The registered component reads the SDK only through the
 * closed set (`React` through the adapter; `hooks.useEffect` for the poller
 * cycle) and renders the pure element tree (tree.ts → board-model.ts →
 * board-tree.ts) — no markup sink, no clock, no randomness.
 */
import { boardOf } from "./board-model.ts";
import { boardTreeOf } from "./board-tree.ts";
import { createPoller } from "./poller.ts";
import { adaptTree, reactAdapterOf } from "./react-adapter.ts";
import type { VNode } from "./tree.ts";

/** The window surface the tab relies on. */
interface TabWindow {
  __HERMES_PLUGINS__: { register(name: string, fn: unknown): void };
  __HERMES_PLUGIN_SDK__: Record<string, unknown>;
}

/** Render the board tree of one view through the adapter. */
export function renderBoard(view: unknown, adapt: (node: VNode) => unknown): unknown {
  const board = boardOf(view, null);
  return adapt(boardTreeOf(board));
}

const win = (globalThis as { window?: unknown }).window as TabWindow | undefined;
if (win !== undefined && typeof win.__HERMES_PLUGINS__?.register === "function") {
  win.__HERMES_PLUGINS__.register("specstride", function specstrideDashboard(_props: unknown) {
    const sdk = win.__HERMES_PLUGIN_SDK__;
    const adapt = reactAdapterOf({ React: sdk.React });
    const hooks = sdk.hooks as { useEffect: (fn: () => void, deps: unknown[]) => void };
    if (typeof hooks?.useEffect === "function") {
      hooks.useEffect(() => {
        const sdkFetch = sdk.fetchJSON;
        createPoller({
          fetch: typeof sdkFetch === "function" ? sdkFetch : () => Promise.resolve(undefined),
          onAnswer: () => {},
          onLine: () => {},
        }).start();
      }, []);
    }
    return adaptTree(
      boardTreeOf(boardOf({}, new Set())),
      adapt,
    );
  });
}
