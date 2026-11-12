/**
 * The stub `hermes` Kanban verbs of 151 (T004): the stub records argv (and
 * piped stdin when asked), accepts `-p <profile>` in front of any Kanban
 * verb, answers `kanban <verb> --json` with an `{id, status}` JSON body
 * (or a scripted step from `$STUB_HERMES_SCRIPT`), and refuses a verb
 * outside the closed set with exit 2 and `refused: true` on its log line.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const STUB = join(ROOT, "tests", "stubs", "hermes");

type LogLine = { probe: boolean; argv: string[]; cwd: string; stdin?: string; refused?: boolean };

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "hermes-stub-151-"));
  const log = join(root, "stub-log.jsonl");
  const script = join(root, "stub-hermes-script.json");
  const run = (args: string[], env: Record<string, string | undefined> = {}) =>
    spawnSync(STUB, args, {
      encoding: "utf8",
      env: { PATH: process.env.PATH ?? "", STUB_LOG: log, ...env },
    });
  const read = (): LogLine[] => {
    try {
      const text = readFileSync(log, "utf8").trim();
      return text === "" ? [] : (JSON.parse("[" + text.split("\n").join(",") + "]") as LogLine[]);
    } catch {
      return [];
    }
  };
  return { root, log, script, run, read, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test("a known kanban verb with --json answers an {id, status} JSON body", () => {
  const fx = fixture();
  try {
    const run = fx.run(["kanban", "create", "--tenant", "specstride", "--json"]);
    assert.equal(run.status, 0, run.stderr);
    const body = JSON.parse((run.stdout ?? "").trim()) as { id: string; status: string };
    assert.equal(typeof body.id, "string");
    assert.equal(typeof body.status, "string");
  } finally {
    fx.cleanup();
  }
});

test("every kanban verb of the closed set answers and is recorded once", () => {
  const fx = fixture();
  try {
    const verbs = [
      "create", "show", "list", "schedule", "edit", "complete",
      "archive", "promote", "block", "comment", "dispatch",
    ];
    for (const verb of verbs) {
      const run = fx.run(["kanban", verb, "--json"]);
      assert.equal(run.status, 0, verb);
      const body = JSON.parse((run.stdout ?? "").trim()) as
        | { id: string; status: string }
        | { id: string; status: string }[];
      // `list` answers an array of cards; every other verb, one card.
      const card = Array.isArray(body) ? body[0] : body;
      assert.ok(card.id && card.status, `${verb}: ${run.stdout}`);
    }
    const lines = fx.read();
    assert.equal(lines.length, verbs.length);
    for (const line of lines) assert.notEqual(line.refused, true);
  } finally {
    fx.cleanup();
  }
});

test("an unknown kanban verb exits 2 and is logged refused", () => {
  const fx = fixture();
  try {
    const run = fx.run(["kanban", "claim", "--json"]);
    assert.equal(run.status, 2);
    assert.match(run.stderr ?? "", /refused/);
    const lines = fx.read();
    assert.equal(lines.length, 1, "exactly one log line");
    assert.equal(lines[0].refused, true);
    assert.deepEqual(lines[0].argv, ["kanban", "claim", "--json"]);
  } finally {
    fx.cleanup();
  }
});

test("a -p profile in front is preserved in argv and does not change the verb", () => {
  const fx = fixture();
  try {
    const run = fx.run(["-p", "specstride", "kanban", "show", "specstride:run-1", "--json"]);
    assert.equal(run.status, 0, run.stderr);
    JSON.parse((run.stdout ?? "").trim());
    const lines = fx.read();
    assert.equal(lines.length, 1);
    assert.deepEqual(lines[0].argv, ["-p", "specstride", "kanban", "show", "specstride:run-1", "--json"]);
  } finally {
    fx.cleanup();
  }
});

test("a scripted step from STUB_HERMES_SCRIPT is answered verbatim", () => {
  const fx = fixture();
  try {
    writeFileSync(
      fx.script,
      JSON.stringify({
        "kanban show specstride:run-1 --json": {
          stdout: JSON.stringify({ id: "specstride:run-1", status: "scheduled" }),
          exit: 0,
        },
      }),
    );
    const run = fx.run(["kanban", "show", "specstride:run-1", "--json"], {
      STUB_HERMES_SCRIPT: fx.script,
    });
    assert.equal(run.status, 0);
    assert.deepEqual(JSON.parse((run.stdout ?? "").trim()), {
      id: "specstride:run-1",
      status: "scheduled",
    });
  } finally {
    fx.cleanup();
  }
});

test("piped stdin is recorded when STUB_CAPTURE_STDIN=1", async () => {
  const fx = fixture();
  try {
    const child = spawnSync(STUB, ["kanban", "comment", "card-1", "--json"], {
      encoding: "utf8",
      input: "a comment body",
      env: {
        PATH: process.env.PATH ?? "",
        STUB_LOG: fx.log,
        STUB_CAPTURE_STDIN: "1",
      },
    });
    assert.equal(child.status, 0, child.stderr);
    const lines = fx.read();
    assert.equal(lines.length, 1);
    assert.equal(lines[0].stdin, "a comment body");
  } finally {
    fx.cleanup();
  }
});
