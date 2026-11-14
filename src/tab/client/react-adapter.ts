/**
 * The React adapter of the dashboard tab (T058; F151-FR-049). The only file
 * that turns the pure element tree (tree.ts) into React elements, and only
 * through `sdk.React.createElement` — a member of the closed SDK set (the
 * build's bundle test fails the build on any read outside the closed set,
 * and no copy of React is bundled; React arrives from
 * `window.__HERMES_PLUGIN_SDK__`).
 */
import type { ElementNode, VNode } from "./tree.ts";
import type { AcceptedView } from "../../kanban/view-read.ts";
import { boardOf } from "./board-model.ts";
import { boardTreeOf } from "./board-tree.ts";

/** The `React`-like surface the adapter needs of the SDK (`sdk.React`). */
export interface ReactLike {
  createElement(
    type: string,
    props: Record<string, unknown> | null,
    ...children: unknown[]
  ): unknown;
}

/** Turn one pure element tree into React elements (text stays text; attrs
 *  map to props; booleans carry the adapter's presence semantics). */
export function adaptTree(node: VNode, React: ReactLike): unknown {
  if (typeof node === "string") return node;
  const attrs: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(node.attrs)) {
    if (value === true) attrs[name] = "";
    else if (value === false || value === undefined || value === null) continue;
    else attrs[name] = value;
  }
  const children = node.children.map((child) => adaptTree(child, React));
  return React.createElement(node.tag, attrs, ...children);
}

/** The adapter bound to an SDK object (reads only the closed member `React`). */
export function reactAdapterOf(sdk: { React: unknown }): (node: VNode) => unknown {
  const React = sdk.React as ReactLike;
  return (node) => adaptTree(node, React);
}

/** An `ElementNode` with event props attached at adapter time (the pure tree
 *  never carries functions). */
interface WiredNode {
  tag: string;
  attrs: Record<string, unknown>;
  children: unknown[];
}

/** Attach the inspector's event handlers to the wired nodes of the tree:
 *  the detail buttons toggle, Escape and the close control clear. */
function wire(node: WiredNode, toggle: (id: string) => void, close: () => void): void {
  const id = node.attrs["data-kanban-card-id"];
  if (typeof id === "string") {
    node.attrs.onClick = () => toggle(id);
    node.attrs.onKeyDown = (event: { key: string }) => {
      if (event.key === "Enter" || event.key === " ") toggle(id);
    };
  }
  if (node.attrs["data-kanban-detail-close"] !== undefined) {
    node.attrs.onClick = close;
  }
  if (node.attrs["data-kanban-detail"] !== undefined) {
    node.attrs.onKeyDown = (event: { key: string }) => {
      if (event.key === "Escape") close();
    };
  }
  for (const child of node.children) {
    if (typeof child === "object" && child !== null && "attrs" in (child as WiredNode)) {
      wire(child as WiredNode, toggle, close);
    }
  }
}

export interface BoardComponentDeps {
  /** The plugin SDK: `React` (elements and `useState`) for the component. */
  sdk: { React: unknown };
  /** The accepted view to render (already fetched by the caller). */
  view: AcceptedView;
}

/**
 * The board component (T058, T070 — US4, US6): renders the board tree for
 * `view` and the current selection. Opening or closing a detail is client
 * state only — no fetch, no lane change (F151-FR-047). The detail button
 * toggles (click, Enter, Space; a second activation closes), Escape and the
 * close control clear the selection.
 */
export function createBoardComponent(deps: BoardComponentDeps): () => unknown {
  const React = deps.sdk.React as ReactLike & { useState: (initial: unknown) => [unknown, (next: unknown) => void] };
  if (typeof React.useState !== "function") throw new TypeError("createBoardComponent: sdk.React.useState is required");
  return () => {
    const [selection, setSelection] = React.useState(null);
    const board = boardOf(deps.view, selection as string | null);
    const tree = boardTreeOf(board);
    const toggle = (id: string) => setSelection(selection === id ? null : id);
    const close = () => setSelection(null);
    wire(tree as unknown as WiredNode, toggle, close);
    return adaptTree(tree, React);
  };
}
