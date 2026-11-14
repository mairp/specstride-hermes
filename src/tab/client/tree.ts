/**
 * The element tree of the *Specstride* dashboard tab (T057; F151-FR-020,
 * F151-FR-049; contracts/presentation.md, contracts/tab-manifest.md).
 *
 * Rendering is a pure function of the view and the selection (lesson L18,
 * dsh F121-FR-009): the builders here hold no clock and no randomness, and
 * `serialize` gives a byte-equal string for equal trees, which is what the
 * per-change tests assert on (PT-151-019, PT-151-020). Nothing here touches
 * the DOM; `react-adapter.ts` is the only file that turns these nodes into
 * React elements through the SDK. Text is inserted as text, never as markup
 * (constitution III): there is no HTML sink in this file, and the build scan
 * fails the build if one appears (F151-FR-049).
 *
 * Origin: shape after specstride-dsh `packages/dsh-kanban/src/shared/`
 * (`tree.ts`) at `ab8093e`; this feature's own node shape.
 */

/** An attribute value. `true` renders the attribute as present with an empty
 * value; `false`, `undefined` and `null` omit it. */
export type AttrValue = string | number | boolean | undefined | null;

/** A text node. Only `txt` produces one, so every string of a rendered tree
 * is a text node (T048) and carries no markup. */
export type TextNode = string;

/** An element node: a tag, its attributes and its children, in order. */
export interface ElementNode {
  readonly tag: string;
  readonly attrs: Readonly<Record<string, AttrValue>>;
  readonly children: readonly VNode[];
}

export type VNode = TextNode | ElementNode;

/** Control characters (C0, DEL, C1) never reach a rendered tree: they are
 * replaced by a space (F151-FR-044; the tab shows what the view carries and
 * nothing a file smuggled in). */
const CONTROL_RE = /[\u0000-\u0008\u000b-\u001f\u007f\u0080-\u009f]/g;

/** A text node; control characters become spaces and markup characters are
 * escaped, so a string can never render as markup (F151-FR-049). */
export function txt(value: string | number): TextNode {
  return String(value)
    .replace(CONTROL_RE, " ")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function flatten(children: readonly unknown[]): VNode[] {
  const out: VNode[] = [];
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) {
      out.push(...flatten(child as readonly unknown[]));
    } else if (typeof child === "string" || typeof child === "number") {
      out.push(txt(child));
    } else {
      out.push(child as ElementNode);
    }
  }
  return out;
}

/** An element node. Attributes with `false`/`undefined`/`null` are omitted;
 * array children are flattened; text children go through `txt`. */
export function el(
  tag: string,
  attrs: Record<string, AttrValue> = {},
  ...children: readonly unknown[]
): ElementNode {
  const clean: Record<string, AttrValue> = {};
  for (const name of Object.keys(attrs)) {
    const value = attrs[name];
    if (value === false || value === undefined || value === null) continue;
    clean[name] = typeof value === "string" ? value.replace(CONTROL_RE, " ") : value;
  }
  return { tag, attrs: clean, children: flatten(children) };
}

function escText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escAttr(s: string): string {
  return escText(s).replace(/"/g, "&quot;");
}

/** The byte-equal serialization of a tree: attributes in sorted order, so
 * equal inputs give equal strings (F151-FR-020; PT-151-020). Text nodes are
 * already escaped by `txt`, so they serialize verbatim. */
export function serialize(node: VNode): string {
  if (typeof node === "string") return node;
  const names = Object.keys(node.attrs).sort();
  let open = `<${node.tag}`;
  for (const name of names) {
    const value = node.attrs[name];
    open += value === true ? ` ${name}=""` : ` ${name}="${escAttr(String(value))}"`;
  }
  if (node.children.length === 0) return `${open}></${node.tag}>`;
  return `${open}>${node.children.map(serialize).join("")}</${node.tag}>`;
}
