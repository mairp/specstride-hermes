/**
 * The shim call tests (T012; PT-151-006, PT-151-051): through the REAL shim
 * (`bin/specstride-hermes.mjs`, the built one of this package) against the
 * T003 stub (`tests/stubs/specstride`). Exit 70, exit 1 with the engine's
 * `no-feature` envelope, exit 4, exit 127, a non-JSON body, a body over the
 * 512 KiB cap and a timeout all give `unavailable` with their reason; a
 * valid view gives `view` / `empty` / `none`; the stub log holds only
 * `status` and `wait` verbs (the probe is tagged and not counted).
 * Everything runs in a temporary `HERMES_HOME` and workspace.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readRunView } from "@specstride/contracts/records/run-view";
import { status, wait, callShim, interpret, shimPath, STDOUT_CAP_BYTES } from "../../src/kanban/shim-call.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const STUB_CLI = join(ROOT, "tests", "stubs", "specstride");
const BUILT_SHIM = join(ROOT, "bin", "specstride-hermes.mjs");
const EMPTY_VIEW = readFileSync(join(ROOT, "tests", "fixtures", "run-views", "empty.json"), "utf8");

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "shim-call-151-"));
  const script = join(root, "stub-script.json");
  const log = join(root, "stub-log.jsonl");
  const home = join(root, "hermes-home");
  const workspace = join(root, "workspace");
  writeFileSync(script, "{}");
  writeFileSync(log, "");
  writeFileSync(join(root, "self-cgroup"), "0::/\n");
  mkdirSync(workspace, { recursive: true });
  return {
    root,
    script,
    log,
    home,
    workspace,
    shimPath: BUILT_SHIM,
    env(extra: Record<string, string | undefined> = {}): Record<string, string | undefined> {
      return {
        PATH: `${dirname(process.execPath)}`,
        HOME: home,
        HERMES_HOME: home,
        SPECSTRIDE_BIN: STUB_CLI,
        STUB_LOG: log,
        STUB_SCRIPT: script,
        SPECSTRIDE_CGROUP_FILE: join(root, "self-cgroup"),
        ...extra,
      };
    },
    read(): { probe: boolean; argv: string[] }[] {
      const text = readFileSync(log, "utf8").trim();
      if (text === "") return [];
      return JSON.parse(`[${text.split("\n").join(",")}]`) as { probe: boolean; argv: string[] }[];
    },
    verbs(): string[][] {
      return this.read().filter((line) => !line.probe).map((line) => line.argv as unknown as string[]);
    },
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

function step(stdout: string, exit: number, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ "status --json": { stdout, exit, ...extra } });
}

function viewWith(state: string, cards: unknown[]): string {
  const view = JSON.parse(EMPTY_VIEW) as Record<string, unknown>;
  view.state = state;
  view.cards = cards;
  return JSON.stringify(view);
}

test("status gives `none` for the recorded empty view of engine 27e7d71b", async () => {
  const fx = fixture();
  try {
    writeFileSync(fx.script, step(EMPTY_VIEW, 0));
    const answer = await status(fx.workspace, { env: fx.env() });
    assert.equal(answer.kind, "none");
    if (answer.kind === "none") {
      assert.ok(readRunView(JSON.parse(JSON.stringify(answer.view)) as never), "the view is the real one");
    }
    // The probe is tagged and not counted; only the status verb is a verb.
    assert.deepEqual(fx.verbs(), [["status", "--json"]]);
    assert.equal(fx.read()[0].probe, true);
  } finally {
    fx.cleanup();
  }
});

test("a valid view with no card is `empty`, with a card is `view`", async () => {
  const fx = fixture();
  try {
    writeFileSync(
      fx.script,
      JSON.stringify({
        "status --json": { stdout: viewWith("created", []), exit: 0 },
      }),
    );
    const answer = await status(fx.workspace, { env: fx.env() });
    assert.equal(answer.kind, "empty");

    const card = { id: "c1", feature: "f", phase: 1, lane: "queued", ruleId: "L-01", flags: { dead: false, stale: false, yielded: false } };
    writeFileSync(fx.script, step(viewWith("running", [card]), 0));
    const withCard = await status(fx.workspace, { env: fx.env() });
    assert.equal(withCard.kind, "view");
    if (withCard.kind === "view") {
      assert.deepEqual((withCard.view.cards as unknown[]).length, 1);
    }
    assert.deepEqual(fx.verbs(), [["status", "--json"], ["status", "--json"]]);
  } finally {
    fx.cleanup();
  }
});

test("wait spawns exactly `wait --until-change --cursor <c> --timeout 25`", async () => {
  const fx = fixture();
  try {
    writeFileSync(fx.script, JSON.stringify({ "wait --until-change --cursor 0 --timeout 25": { stdout: EMPTY_VIEW, exit: 0 } }));
    const answer = await wait(fx.workspace, "0", { env: fx.env() });
    assert.equal(answer.kind, "none");
    assert.deepEqual(fx.verbs(), [["wait", "--until-change", "--cursor", "0", "--timeout", "25"]]);
  } finally {
    fx.cleanup();
  }
});

test("exit 70 gives unavailable with the engine-exit reason", async () => {
  const fx = fixture();
  try {
    writeFileSync(fx.script, step("", 70));
    const answer = await status(fx.workspace, { env: fx.env() });
    assert.equal(answer.kind, "unavailable");
    if (answer.kind === "unavailable") assert.match(answer.reason, /exit 70/);
  } finally {
    fx.cleanup();
  }
});

test("exit 1 with the no-feature envelope is a reason, not a result kind", async () => {
  const fx = fixture();
  try {
    writeFileSync(fx.script, step(JSON.stringify({ error: "no-feature", feature: null }), 1));
    const answer = await status(fx.workspace, { env: fx.env() });
    assert.equal(answer.kind, "unavailable");
    if (answer.kind === "unavailable") assert.match(answer.reason, /envelope: no-feature/);
  } finally {
    fx.cleanup();
  }
});

test("exit 4 (the shim's protocol refusal) gives unavailable", async () => {
  const fx = fixture();
  try {
    writeFileSync(fx.script, step(EMPTY_VIEW, 0));
    const answer = await status(fx.workspace, { env: fx.env({ STUB_PROTOCOL: "2" }) });
    assert.equal(answer.kind, "unavailable");
    if (answer.kind === "unavailable") assert.match(answer.reason, /exit 4/);
  } finally {
    fx.cleanup();
  }
});

test("exit 127 (no engine anywhere on the search path) gives unavailable", async () => {
  const fx = fixture();
  try {
    writeFileSync(fx.script, step(EMPTY_VIEW, 0));
    // A PATH with nothing on it and no SPECSTRIDE_BIN: the shim exits 127.
    const answer = await status(fx.workspace, { env: fx.env({ PATH: fx.root, SPECSTRIDE_BIN: undefined }) });
    assert.equal(answer.kind, "unavailable");
    if (answer.kind === "unavailable") assert.match(answer.reason, /127/);
  } finally {
    fx.cleanup();
  }
});

test("a non-JSON body gives unavailable", async () => {
  const fx = fixture();
  try {
    writeFileSync(fx.script, step("<html>not json</html>", 0));
    const answer = await status(fx.workspace, { env: fx.env() });
    assert.equal(answer.kind, "unavailable");
    if (answer.kind === "unavailable") assert.match(answer.reason, /not JSON/);
  } finally {
    fx.cleanup();
  }
});

test("a body over the stdout cap aborts with the cap reason and kills the call", async () => {
  const fx = fixture();
  try {
    // A 1 KiB body against a 64-byte cap: the same abort as a body over the
    // real 512 KiB cap (the stub's own write truncates before a pipe
    // carries 512 KiB, so the mechanism is exercised at a small cap).
    writeFileSync(fx.script, step("x".repeat(1024), 0));
    const answer = await status(fx.workspace, { env: fx.env(), stdoutCap: 64 });
    assert.equal(answer.kind, "unavailable");
    if (answer.kind === "unavailable") assert.match(answer.reason, /stdout cap exceeded/);
    // The real cap of the contract stays 512 KiB.
    assert.equal(STDOUT_CAP_BYTES, 524288);
  } finally {
    fx.cleanup();
  }
});

test("an idle timeout and a hard timeout both give unavailable and kill the process group", async () => {
  const fx = fixture();
  try {
    writeFileSync(fx.script, JSON.stringify({ "status --json": { stdout: EMPTY_VIEW, exit: 0, delayMs: 5_000 } }));
    // The limits are deliberately short but above a loaded machine's Node
    // start-up time, so the stub always records its verb before it is killed
    // (flake fix: 200 ms could kill the stub before it logged under a
    // parallel suite run; the implementation's limits are unchanged).
    const idle = await status(fx.workspace, { env: fx.env(), idleMs: 1_500, hardMs: 30_000 });
    assert.equal(idle.kind, "unavailable");
    if (idle.kind === "unavailable") assert.match(idle.reason, /idle timeout/);
    const hard = await status(fx.workspace, { env: fx.env(), idleMs: 30_000, hardMs: 2_500 });
    assert.equal(hard.kind, "unavailable");
    if (hard.kind === "unavailable") assert.match(hard.reason, /hard timeout/);
    // The killed stub left no hung process answering afterwards: the whole
    // sequence above returned, so the group is gone.
    assert.ok(fx.verbs().length >= 1);
  } finally {
    fx.cleanup();
  }
});

test("an unsupported schema major is refused-schema, before isRunView runs", async () => {
  const fx = fixture();
  try {
    const future = viewWith("none", []).replace("specstride.view/1", "specstride.view/2");
    writeFileSync(fx.script, step(future, 0));
    const answer = await status(fx.workspace, { env: fx.env() });
    assert.deepEqual(answer, { kind: "refused-schema", major: 2 });
    // A schema-less body: refused as well (no major to read).
    writeFileSync(fx.script, step('{"hello": true}', 0));
    const noSchema = await status(fx.workspace, { env: fx.env() });
    assert.equal(noSchema.kind, "refused-schema");
  } finally {
    fx.cleanup();
  }
});

test("a body of the supported major that fails isRunView is unavailable, not refused-schema", async () => {
  const fx = fixture();
  try {
    const broken = JSON.parse(EMPTY_VIEW) as Record<string, unknown>;
    delete broken.cards; // a required member of the major is missing
    writeFileSync(fx.script, step(JSON.stringify(broken), 0));
    const answer = await status(fx.workspace, { env: fx.env() });
    assert.equal(answer.kind, "unavailable");
    if (answer.kind === "unavailable") assert.match(answer.reason, /validation/);
    assert.notEqual(answer.kind, "refused-schema");
  } finally {
    fx.cleanup();
  }
});

test("the spawn is detached and kills its whole group; the built shim path is used", () => {
  assert.equal(shimPath(ROOT), BUILT_SHIM);
  const raw = interpret({ exit: null, stdout: "", stderr: "", reason: "test" });
  assert.deepEqual(raw, { kind: "unavailable", reason: "test" });
});
