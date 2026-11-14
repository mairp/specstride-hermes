/**
 * The React adapter of the dashboard tab (T058; F151-FR-049). The only file
 * that turns the pure element tree (tree.ts) into React elements, and only
 * through `sdk.React.createElement` — a member of the closed SDK set (the
 * build's bundle test fails the build on any read outside the closed set,
 * and no copy of React is bundled; React arrives from
 * `window.__HERMES_PLUGIN_SDK__`).
 */
import type { ElementNode, VNode } from "./tree.ts";

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
