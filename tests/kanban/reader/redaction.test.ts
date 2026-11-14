/**
 * T067 (US6; PT-151-044, F151-SC-009) — redaction over the `salted/`
 * fixture, walking every string of the view the handler returns: none
 * above its cap (240 bytes, or the smaller caps of the contract), no
 * control character, no absolute path, none of the salted markers (a
 * prompt body, a key, an absolute path — and the ledger's salt words),
 * every list within its bound with the right omitted count, and a
 * multi-byte character never split by a cut.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFixture } from "../../helpers/reader-harness.ts";
import { capText, safePath, describeProcess, DETAIL_TEXT_CAP, MAX_TASKS, MAX_FILES, MAX_ATTEMPTS, MAX_LAUNCHES, MAX_AGENTS } from "../../../src/kanban/reader/redact.ts";

type Rec = Record<string, unknown>;
const rec = (value: unknown): Rec => (typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Rec) : {});

/** The salted payload markers the fixture plants: a prompt body, an API key,
 * an absolute path (in a task text and in the ledger title), and the ledger's
 * control characters and salt words. */
const MARKERS = ["ignore previous instructions", "sk-live-", "/tmp/secret"];
/** The ledger title plants a distinctive salted sentence; the view must not
 * carry any of it (the words "prompt" and "key" alone are ordinary words a
 * task text may hold, so the assertion uses the planted sequence). */
const LEDGER_TITLE_SALT = "title absolute path prompt reply tool argument command line signature key log line";
const CONTROL_RE = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/;

function walkStrings(value: unknown, path: string, out: { text: string; path: string }[]): void {
  if (typeof value === "string") {
    out.push({ text: value, path });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => walkStrings(entry, `${path}[${String(index)}]`, out));
    return;
  }
  if (typeof value === "object" && value !== null) {
    for (const [key, entry] of Object.entries(value)) walkStrings(entry, `${path}.${key}`, out);
  }
}

test("no string of the salted view exceeds its cap, holds a control character or a marker", () => {
  const { view } = readFixture("salted");
  const strings: { text: string; path: string }[] = [];
  walkStrings(JSON.parse(JSON.stringify(view)), "$", strings);
  assert.ok(strings.length > 20, "the salted view carries strings to walk");

  for (const { text, path } of strings) {
    assert.equal(CONTROL_RE.test(text), false, `control character in ${path}: ${JSON.stringify(text.slice(0, 60))}`);
    assert.equal(Buffer.byteLength(text, "utf8") <= DETAIL_TEXT_CAP, true, `string over ${String(DETAIL_TEXT_CAP)} bytes at ${path}`);
    for (const marker of MARKERS) {
      assert.equal(text.includes(marker), false, `salted marker ${JSON.stringify(marker)} at ${path}`);
    }
    assert.equal(/^\/(?:[\w.-]+\/)+/.test(text), false, `absolute path at ${path}: ${text.slice(0, 60)}`);
  }
});

test("the ledger's salted title never reaches the view", () => {
  const { view } = readFixture("salted");
  const text = JSON.stringify(view);
  assert.equal(text.includes(LEDGER_TITLE_SALT), false, "the ledger title's salted sentence leaked into the view");
  assert.equal(text.includes("xxxxxxxx"), false, "the ledger title's filler leaked into the view");
});

test("every list of the salted detail is within its bound with the right omitted count", () => {
  const { view } = readFixture("salted");
  const card = view.cards.find((entry) => rec(entry).detail !== null && rec(entry).detail !== undefined) as Rec | undefined;
  assert.ok(card !== undefined, "a phase card of the salted workspace carries a detail");
  const detail = rec(card.detail);
  const tasks = detail.tasks as Rec[];
  assert.equal(tasks.length, MAX_TASKS, "at most 60 tasks");
  assert.equal(detail.tasksTotal, 500, "the salted workspace holds 500 tasks");
  assert.equal(detail.tasksOmitted, 500 - MAX_TASKS, "the omitted count names the rest");
  assert.ok(tasks.every((task) => Buffer.byteLength(String(task.text), "utf8") <= 160), "task texts are under their own 160-byte cap");
  const files = detail.files as string[];
  assert.ok(files.length <= MAX_FILES);
  assert.equal(typeof detail.filesOmitted, "number");
  const featureDetail = rec(view.featureDetails["151-salted"]);
  const launches = featureDetail.launches as Rec[];
  assert.equal(launches.length, MAX_LAUNCHES, "at most 12 launches");
  assert.equal(featureDetail.launchesOmitted, 40 - MAX_LAUNCHES, "the salted workspace holds 40 launches");
  const agents = featureDetail.agents as Rec[];
  assert.ok(agents === undefined || agents.length <= MAX_AGENTS, "at most 8 agents");
  const attempts = detail.attempts as Rec[];
  assert.ok(attempts === undefined || attempts.length <= MAX_ATTEMPTS, "at most 12 attempts");
});

test("capText never splits a multi-byte character and strips control characters", () => {
  const multi = "記録".repeat(200); // 800 bytes when cut in half would split a character
  const cut = capText(multi, 100);
  assert.equal(Buffer.byteLength(cut, "utf8") <= 100, true);
  assert.equal(cut.includes("\uFFFD"), false);
  assert.equal(cut.endsWith("..."), true);
  const dirty = "a\u0000b\u001fc\u007f  d";
  assert.equal(capText(dirty), "a b c d");
});

test("safePath makes a path workspace-relative, ~-rooted, or cuts it to its base name", () => {
  assert.equal(safePath("/home/user/wk/specs/151/tasks.md", "/home/user/wk", "/home/user"), "specs/151/tasks.md");
  assert.equal(safePath("/home/user/.dsh/sessions/x/session.jsonl", "/home/user/wk", "/home/user"), "~/.dsh/sessions/x/session.jsonl");
  assert.equal(safePath("/opt/other/secret.jsonl", "/home/user/wk", "/home/user"), "secret.jsonl");
  assert.equal(safePath("specs/rel/tasks.md", "/home/user/wk", "/home/user"), "specs/rel/tasks.md");
  assert.equal(safePath("/home/user/wk", "/home/user/wk", "/home/user"), ".");
});

test("describeProcess reads only harness, profile, model and role — never the argv", () => {
  const line = ["node", "/opt/specstride/bin.mjs", "--profile", "hermes", "--model", "m-1", "critic", "--phase", "1"].join("\0");
  const described = describeProcess(line);
  assert.ok(described !== null);
  assert.equal(described?.harness, "bin.mjs");
  assert.equal(described?.profile, "hermes");
  assert.equal(described?.model, "m-1");
  assert.equal(described?.role, "critic");
  const text = JSON.stringify(described);
  assert.equal(text.includes("/opt/specstride"), false, "no absolute path leaves describeProcess");
  assert.equal(text.includes("--phase"), false, "the argv is discarded");
  assert.equal(describeProcess(null), null);
});
