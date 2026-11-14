/**
 * The presentation table tests (T051; PT-151-025; contracts/presentation.md).
 *
 * Every member of the seven sets returns glyph, label, grayscale and token
 * from the generated table; an unknown member returns `?`, the raw value as
 * label, the set's unknown grayscale and `--color-border`; every badge in a
 * rendered tree carries glyph text, `aria-label` and `data-gray` together; and
 * no function of the file returns a lane (the table maps members to
 * presentation, never anything to a lane — F151-FR-025).
 *
 * T057 (`src/tab/client/{tree,presentation}.ts`) was checked against this
 * file: the tests were written with the implementation and both were judged
 * together, since the test is the check of the implementation.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { serialize, el, txt, type VNode } from "../../src/tab/client/tree.ts";
import {
  PRESENTATION_SETS,
  laneOf,
  attentionOf,
  budgetOf,
  taskStateOf,
  aliveOf,
  outcomeOf,
  launchStateOf,
  badge,
  LANES_SET,
} from "../../src/tab/client/presentation.ts";
import {
  closedSetLanes,
  closedSetAttentionKinds,
  closedSetBudgetLevels,
  closedSetLaunchStates,
} from "../../src/kanban/generated/closed-sets.ts";

const THIS_DIR = dirname(fileURLToPath(import.meta.url));

test("every member of the seven sets has glyph, label, grayscale and token", () => {
  assert.equal(PRESENTATION_SETS.length, 7, "the seven sets of F151-FR-025");
  for (const { set, key, of } of PRESENTATION_SETS) {
    assert.ok(set.members.length >= 1, `${set.id} has members`);
    for (const row of set.members) {
      const value = String(row[key]);
      const p = of(value);
      assert.equal(p.glyph, row.glyph, `${set.id}.${value} glyph`);
      assert.equal(p.label, row.label, `${set.id}.${value} label`);
      assert.equal(p.grayscale, row.grayscale, `${set.id}.${value} grayscale`);
      assert.equal(p.token, row.token, `${set.id}.${value} token`);
      assert.ok(p.grayscale >= 0 && p.grayscale <= 255, `${set.id}.${value} grayscale in 0..255`);
    }
  }
});

test("within a set, unknown included, any two grayscale values differ by at least 24", () => {
  for (const { set, key } of PRESENTATION_SETS) {
    const values = [...set.members.map((row) => Number(row.grayscale))];
    if (set.unknown) values.push(Number(set.unknown.grayscale));
    for (let i = 0; i < values.length; i++) {
      for (let j = i + 1; j < values.length; j++) {
        const d = Math.abs(values[i] - values[j]);
        assert.ok(
          d >= 24,
          `${set.id}: grayscale ${values[i]} and ${values[j]} differ by ${d} (< 24)`,
        );
      }
    }
    // the unknown row is part of the ladder through the lookups; it is
    // asserted per set in the unknown-member test below.
    void key;
  }
});

test("an unknown member returns ?, the raw value, the unknown grayscale and --color-border", () => {
  const stranger = "ninth-lane-of-a-future-engine";
  const laneUnknown = laneOf(stranger);
  assert.equal(laneUnknown.glyph, "?");
  assert.equal(laneUnknown.label, stranger, "the raw value is the label");
  assert.equal(laneUnknown.token, "--color-border");
  assert.equal(laneUnknown.grayscale, 112, "the lane table's unknown grayscale");

  assert.equal(attentionOf("never-heard-of").grayscale, 184);
  assert.equal(budgetOf("never-heard-of").grayscale, 168);
  assert.equal(taskStateOf("never-heard-of").grayscale, 88);
  assert.equal(aliveOf("never-heard-of").grayscale, 64);
  assert.equal(outcomeOf("never-heard-of").grayscale, 64);
  assert.equal(launchStateOf("never-heard-of").grayscale, 232);
  for (const p of [attentionOf("x"), budgetOf("x"), taskStateOf("x"), aliveOf("x"), outcomeOf("x"), launchStateOf("x")]) {
    assert.equal(p.glyph, "?");
    assert.equal(p.label, "x");
    assert.equal(p.token, "--color-border");
  }
  assert.equal(laneOf(null).label, "?", "a missing value is unknown too, with no raw text");
});

test("totality over the pinned engine enums (contracts and the tables agree)", () => {
  for (const lane of closedSetLanes) {
    const p = laneOf(lane);
    assert.notEqual(p.glyph, "?", `lane ${lane} must be known`);
    assert.notEqual(p.label, lane, `lane ${lane} must have a label of its own`);
  }
  for (const kind of closedSetAttentionKinds) {
    assert.notEqual(attentionOf(kind).glyph, "?", `kind ${kind} must be known`);
  }
  for (const level of closedSetBudgetLevels) {
    assert.notEqual(budgetOf(level).glyph, "?", `level ${level} must be known`);
  }
  for (const state of closedSetLaunchStates) {
    assert.notEqual(launchStateOf(state).glyph, "?", `launch state ${state} must be known`);
  }
});

test("glyphs and labels are pairwise distinct within a set (unknown included)", () => {
  for (const { set } of PRESENTATION_SETS) {
    const glyphs = set.members.map((row) => String(row.glyph));
    const labels = set.members.map((row) => String(row.label));
    if (set.unknown) {
      glyphs.push(String(set.unknown.glyph));
    }
    assert.equal(new Set(glyphs).size, glyphs.length, `${set.id} glyphs distinct`);
    assert.equal(new Set(labels).size, labels.length, `${set.id} labels distinct`);
  }
});

test("every badge in a rendered tree carries glyph text, aria-label and data-gray together", () => {
  const tree: VNode = el("div", { class: "sskh-board" }, [
    badge(LANES_SET, "proposing"),
    badge(LANES_SET, "a-lane-no-map-knows"),
    badge(PRESENTATION_SETS[1].set, "blocked-on-human"),
    badge(PRESENTATION_SETS[2].set, "over"),
    badge(PRESENTATION_SETS[6].set, "signalled"),
    txt("a plain text line"),
  ]);
  const s = serialize(tree);
  // glyph text present
  for (const glyph of ["▶", "?", "!", "✗", "‖"]) {
    assert.ok(s.includes(`>${glyph}<`), `glyph ${glyph} is a text node in ${s}`);
  }
  // aria-label and data-gray travel with every glyph (attributes are sorted
  // in the serialization, so each is asserted as its own substring)
  assert.ok(s.includes(`aria-label="Proposing"`), s);
  assert.ok(s.includes(`data-gray="160"`), s);
  assert.ok(s.includes(`aria-label="a-lane-no-map-knows"`) && s.includes(`data-gray="112"`), s);
  assert.ok(s.includes(`aria-label="Needs you"`), s);
  assert.ok(s.includes(`aria-label="Over"`), s);
  assert.ok(s.includes(`aria-label="stopped by a signal"`), s);
  // every badge span pairs an aria-label with a data-gray in the same tag
  for (const m of s.matchAll(/<span [^>]*>/g)) {
    const tagText = m[0];
    if (!tagText.includes("sskh-badge")) continue;
    assert.ok(tagText.includes("aria-label="), tagText);
    assert.ok(tagText.includes("data-gray="), tagText);
    assert.ok(tagText.includes("title="), tagText);
  }
  // the tint attribute: lanes by data-lane, other sets by data-tint
  assert.ok(s.includes(`data-lane="proposing"`), s);
  assert.ok(s.includes(`data-tint="blocked-on-human"`), s);
  assert.ok(s.includes(`data-tint="over"`), s);
  assert.ok(!s.includes("data-lane=\"over\""), "a non-lane set never carries data-lane");
});

test("no function of presentation.ts returns a lane", () => {
  // every exported lookup returns a presentation object: its members are the
  // four channels, never a lane string.
  for (const lane of [...closedSetLanes, "some-unknown-lane"]) {
    for (const p of [laneOf(lane), attentionOf(lane), budgetOf(lane), taskStateOf(lane), aliveOf(lane), outcomeOf(lane), launchStateOf(lane)]) {
      const returned = new Set(Object.keys(p));
      for (const key of returned) {
        assert.ok(
          ["glyph", "label", "grayscale", "token", "mix"].includes(key),
          `lookup returned a member named ${key} (not a presentation channel)`,
        );
      }
    }
    // a known member's answer is the table row's presentation, never the raw
    // input echoed back as the label (only unknowns show the raw value).
    const known = laneOf("proposing");
    assert.notEqual(known.label, "proposing");
  }
  // and the source names no column mapper: it maps members to presentation,
  // nothing to a lane (F151-FR-025).
  const source = readFileSync(join(THIS_DIR, "../../src/tab/client/presentation.ts"), "utf8");
  assert.ok(!/columnFor|columnOf|targetColumn/.test(source), "presentation.ts assigns no column");
  assert.ok(!/→|->\s*"(scheduled|done|archived|blocked|ready)"/.test(source), "presentation.ts returns no column");
});

test("serialize is byte-equal for equal trees and the builders are pure shapes", () => {
  const a = serialize(el("span", { class: "sskh-x", "data-gray": "160", title: "t" }, "a", el("em", {}, "b")));
  const b = serialize(el("span", { title: "t", class: "sskh-x", "data-gray": "160" }, ["a", [el("em", {}, "b")]]));
  assert.equal(a, b, "attribute order and array nesting do not change the bytes");
  assert.ok(a.startsWith(`<span`), a);
  // text is escaped; control characters become spaces (F151-FR-044 at the tree)
  assert.equal(serialize(txt("a<b & c")), "a&lt;b &amp; c");
  assert.equal(serialize(txt("a\u0007b")), "a b");
  const withAttr = serialize(el("span", { title: 'x"y' }));
  assert.ok(withAttr.includes("&quot;"), withAttr);
  // a false/undefined attribute is omitted; true renders present
  assert.equal(serialize(el("span", { "data-no": false, "data-yes": true })), `<span data-yes=""></span>`);
  // an empty element closes in place
  assert.equal(serialize(el("br")), "<br></br>");
});
