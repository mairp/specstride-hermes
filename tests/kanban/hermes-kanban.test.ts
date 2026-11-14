/**
 * The kanban argv tests (T010; PT-151-008, PT-151-010, PT-151-013;
 * contracts/card-projection.md). The exact argv of every allowed verb, the
 * stdin body channel, the closed export set (ten functions, no generic
 * builder, no code path for a forbidden verb), and the absence of any disk
 * access — asserted through a recording file port that fails on any touch
 * under `$HERMES_HOME`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as kanban from "../../src/kanban/hermes-kanban.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(
  join(HERE, "..", "..", "src", "kanban", "hermes-kanban.ts"),
  "utf8",
);

const ALLOWED = [
  "create",
  "show",
  "list",
  "schedule",
  "edit",
  "complete",
  "archive",
  "promote",
  "block",
  "comment",
] as const;

const FORBIDDEN = [
  "claim",
  "heartbeat",
  "request-review",
  "link",
  "delete",
  "decompose",
  "specify",
  "swarm",
];

const HEAD = ["hermes", "-p", "specstride", "kanban"];
// Host facts (read 2026-11-13/14, `hermes kanban <verb> --help`, Hermes
// 0.22.2): only `create` accepts the guard flags; each verb's tail below is
// exactly what the real CLI parses.
const CREATE_TAIL = (key: string) => [
  "--tenant",
  "specstride",
  "--assignee",
  "specstride-projection",
  "--idempotency-key",
  key,
  "--workspace",
  "scratch",
  "--body-file",
  "-",
  "--json",
];

test("the module exports exactly the ten allowed verb functions and nothing else", () => {
  const names = Object.keys(kanban).sort();
  // The two guard exports of T043 (the pre-spawn assertion and its values)
  // are not verb functions; everything else is exactly the ten verbs.
  const guards = ["WRITE_GUARDS", "assertWriteGuards"];
  assert.deepEqual(
    names,
    [...ALLOWED.map((verb) => `kanban${verb[0].toUpperCase()}${verb.slice(1)}`), ...guards].sort(),
  );
  for (const name of names) {
    if (guards.includes(name)) continue;
    assert.equal(typeof (kanban as Record<string, unknown>)[name], "function", name);
  }
});

test("no forbidden verb exists as an export or a code path", () => {
  const source = SOURCE;
  for (const verb of FORBIDDEN) {
    assert.equal(
      (kanban as Record<string, unknown>)[verb],
      undefined,
      `${verb} must not be exported`,
    );
    // The verb name appears nowhere in the module: no builder accepts it.
    assert.ok(!source.includes(`"${verb}"`), `the module names the forbidden verb ${verb}`);
  }
});

test("there is no exported generic argv builder", () => {
  for (const name of Object.keys(kanban)) {
    assert.ok(!/build|argv|generic/i.test(name), `suspicious export: ${name}`);
  }
});

test("create builds the exact argv and carries the body on stdin", () => {
  const call = kanban.kanbanCreate({
    key: "specstride:r-1",
    title: "[running] alpha · r-1",
    body: "engine-state: running\n",
  });
  assert.deepEqual(call.argv, [
    ...HEAD,
    "create",
    "[running] alpha · r-1",
    ...CREATE_TAIL("specstride:r-1"),
  ]);
  assert.equal(call.stdin, "engine-state: running\n");
});

test("show, list, schedule, archive and promote build their exact argv", () => {
  const key = "specstride:r-1:p2";
  assert.deepEqual(kanban.kanbanShow({ key, id: "h-7" }).argv, [...HEAD, "show", "h-7", "--json"]);
  assert.deepEqual(kanban.kanbanList({ key }).argv, [...HEAD, "list", "--tenant", "specstride", "--json"]);
  assert.deepEqual(kanban.kanbanSchedule({ key, id: "h-7" }).argv, [...HEAD, "schedule", "h-7"]);
  assert.deepEqual(kanban.kanbanArchive({ key, id: "h-7" }).argv, [...HEAD, "archive", "h-7"]);
  assert.deepEqual(kanban.kanbanPromote({ key, id: "h-9" }).argv, [...HEAD, "promote", "h-9", "--json"]);
  for (const call of [
    kanban.kanbanShow({ key, id: "h-7" }),
    kanban.kanbanList({ key }),
    kanban.kanbanSchedule({ key, id: "h-7" }),
    kanban.kanbanArchive({ key, id: "h-7" }),
    kanban.kanbanPromote({ key, id: "h-9" }),
  ]) {
    assert.equal(call.stdin, "", "these verbs carry no body");
  }
});

test("edit builds its exact argv with the body on stdin", () => {
  const key = "specstride:r-1:p2";
  const call = kanban.kanbanEdit({
    key,
    id: "h-7",
    title: "[proposing] alpha phase 2 · p2",
    body: "engine-lane: proposing\n",
  });
  assert.deepEqual(call.argv, [
    ...HEAD,
    "edit",
    "h-7",
    "--title",
    "[proposing] alpha phase 2 · p2",
    "--body",
    "engine-lane: proposing\n",
  ]);
  assert.equal(call.stdin, "");
});

test("complete carries --result with the engine value", () => {
  const key = "specstride:r-1:p2";
  const call = kanban.kanbanComplete({ key, id: "h-7", result: "approved (engine)" });
  assert.deepEqual(call.argv, [
    ...HEAD,
    "complete",
    "h-7",
    "--result",
    "approved (engine)",
  ]);
});

test("block carries --kind needs_input and the verbatim text", () => {
  const key = "specstride:r-1:attn:alpha#run";
  const call = kanban.kanbanBlock({
    key,
    id: "h-11",
    text: "alpha: run ended failed in phase 2 (scope) — the critic refused",
  });
  assert.deepEqual(call.argv, [
    ...HEAD,
    "block",
    "h-11",
    "--kind",
    "needs_input",
    "alpha: run ended failed in phase 2 (scope) — the critic refused",
  ]);
  assert.equal(call.stdin, "");
});

test("comment carries the text and the common surface", () => {
  const key = "specstride:r-1:p2";
  const call = kanban.kanbanComment({ key, id: "h-7", text: "archived: the run was replaced" });
  assert.deepEqual(call.argv, [
    ...HEAD,
    "comment",
    "h-7",
    "archived: the run was replaced",
  ]);
  assert.equal(call.stdin, "");
});

test("every verb's tail is exactly what Hermes 0.22.2 parses (no create-only flag elsewhere)", () => {
  const calls = [
    kanban.kanbanCreate({ key: "k", title: "t", body: "b" }),
    kanban.kanbanShow({ key: "k", id: "i" }),
    kanban.kanbanList({ key: "k" }),
    kanban.kanbanSchedule({ key: "k", id: "i" }),
    kanban.kanbanEdit({ key: "k", id: "i", title: "t", body: "b" }),
    kanban.kanbanComplete({ key: "k", id: "i", result: "x" }),
    kanban.kanbanArchive({ key: "k", id: "i" }),
    kanban.kanbanPromote({ key: "k", id: "i" }),
    kanban.kanbanBlock({ key: "k", id: "i", text: "t" }),
    kanban.kanbanComment({ key: "k", id: "i", text: "t" }),
  ];
  for (const call of calls) {
    assert.equal(call.argv[0], "hermes");
    assert.deepEqual(call.argv.slice(1, 4), ["-p", "specstride", "kanban"]);
  }
  // The guard flags exist ONLY on create (host facts above); every other
  // verb carries none of them — except `list`, which accepts --tenant — so
  // the real CLI never answers "unrecognized arguments" to a projected call.
  for (const call of calls.slice(1)) {
    for (const flag of ["--assignee", "--idempotency-key", "--workspace", "--body-file"]) {
      assert.ok(!call.argv.includes(flag), `${flag} on ${call.argv[4]}`);
    }
    if (call.argv[4] !== "list") assert.ok(!call.argv.includes("--tenant"), `--tenant on ${call.argv[4]}`);
  }
  // Reads and column moves stay inside their recorded flag set.
  assert.deepEqual(kanban.kanbanShow({ key: "k", id: "i" }).argv.slice(5), ["i", "--json"]);
  assert.deepEqual(kanban.kanbanPromote({ key: "k", id: "i" }).argv.slice(5), ["i", "--json"]);
  assert.deepEqual(kanban.kanbanSchedule({ key: "k", id: "i" }).argv.slice(5), ["i"]);
  assert.deepEqual(kanban.kanbanArchive({ key: "k", id: "i" }).argv.slice(5), ["i"]);
});

test("every argv starts `hermes -p specstride kanban <verb>` in that order", () => {
  const verbs = [
    kanban.kanbanCreate({ key: "k", title: "t", body: "b" }).argv[4],
    kanban.kanbanShow({ key: "k", id: "i" }).argv[4],
    kanban.kanbanList({ key: "k" }).argv[4],
    kanban.kanbanSchedule({ key: "k", id: "i" }).argv[4],
    kanban.kanbanEdit({ key: "k", id: "i", title: "t", body: "b" }).argv[4],
    kanban.kanbanComplete({ key: "k", id: "i", result: "x" }).argv[4],
    kanban.kanbanArchive({ key: "k", id: "i" }).argv[4],
    kanban.kanbanPromote({ key: "k", id: "i" }).argv[4],
    kanban.kanbanBlock({ key: "k", id: "i", text: "t" }).argv[4],
    kanban.kanbanComment({ key: "k", id: "i", text: "t" }).argv[4],
  ];
  assert.deepEqual(verbs, [...ALLOWED]);
});

test("a recording file port sees no touch under HERMES_HOME while every verb is exercised", () => {
  const hermesHome = mkdtempSync(join(tmpdir(), "kanban-argv-home-"));
  const recorded: string[] = [];
  const require = createRequire(import.meta.url);
  const fs = require("node:fs") as Record<string, (...args: unknown[]) => unknown>;
  const originals: Record<string, ((...args: unknown[]) => unknown) | undefined> = {};
  const watch = (name: string) => {
    originals[name] = (fs as Record<string, ((...a: unknown[]) => unknown) | undefined>)[name] as never;
    (fs as Record<string, (...args: unknown[]) => unknown>)[name] = (...args: unknown[]) => {
      const first = args.find((a) => typeof a === "string" || a instanceof URL);
      if (first !== undefined) recorded.push(String(first));
      throw new Error(`fs.${name} was called while building kanban argv`);
    };
  };
  for (const name of [
    "openSync",
    "readFileSync",
    "writeFileSync",
    "appendFileSync",
    "existsSync",
    "statSync",
    "mkdirSync",
    "renameSync",
  ]) {
    watch(name);
  }
  try {
    const inputs = { key: "specstride:r-9", id: "h-1", title: "t", body: "b" };
    assert.doesNotThrow(() => {
      kanban.kanbanCreate(inputs);
      kanban.kanbanShow(inputs);
      kanban.kanbanList(inputs);
      kanban.kanbanSchedule(inputs);
      kanban.kanbanEdit(inputs);
      kanban.kanbanComplete({ ...inputs, result: "r" });
      kanban.kanbanArchive(inputs);
      kanban.kanbanPromote(inputs);
      kanban.kanbanBlock({ ...inputs, text: "t" });
      kanban.kanbanComment({ ...inputs, text: "t" });
    });
    const underHome = recorded.filter((p) => p.startsWith(hermesHome));
    assert.deepEqual(underHome, [], `the module opened: ${underHome.join(", ")}`);
    assert.equal(recorded.length, 0, `the module touched the filesystem: ${recorded.join(", ")}`);
  } finally {
    for (const [name, original] of Object.entries(originals)) {
      if (original !== undefined) (fs as Record<string, unknown>)[name] = original;
    }
    rmSync(hermesHome, { recursive: true, force: true });
  }
});
