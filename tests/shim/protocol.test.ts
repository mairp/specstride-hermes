/**
 * The shim protocol tests (T016, PT-150-012): protocol 1 passes; 2 and 0
 * give the one refusal line and exit 4; a differing package version with
 * protocol 1 never refuses; the CLI's exit 3 and 70 pass through unchanged.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runShim, shimFixture, writeStubCli, type ShimFixture } from "./helper.ts";

const REFUSAL = "[SPECSTRIDE-REFUSE] action=protocol reason=protocol-mismatch";

function withFixture(fn: (fx: ShimFixture) => void): void {
  const fx = shimFixture();
  try {
    fn(fx);
  } finally {
    fx.cleanup();
  }
}

test("protocol 1 passes and the CLI runs", () => {
  withFixture((fx) => {
    writeStubCli(fx, 1);
    const run = runShim(fx, ["status"]);
    assert.equal(run.status, 0);
    assert.equal(run.stdout ?? "", "");
    assert.deepEqual(run.argvLines.map((line) => line.argv), [["--protocol"], ["status"]]);
  });
});

test("protocol 2 refuses with the one line and exit 4", () => {
  withFixture((fx) => {
    writeStubCli(fx, 2);
    const run = runShim(fx, ["status"]);
    assert.equal(run.status, 4);
    const lines = (run.stdout ?? "").split("\n").filter((line) => line.trim() !== "");
    assert.deepEqual(lines, [REFUSAL]);
  });
});

test("protocol 0 refuses the same way", () => {
  withFixture((fx) => {
    writeStubCli(fx, 0);
    const run = runShim(fx, ["wait", "--until-change"]);
    assert.equal(run.status, 4);
    assert.equal((run.stdout ?? "").trim(), REFUSAL);
  });
});

test("a non-integer answer to --protocol refuses", () => {
  withFixture((fx) => {
    const cli = join(fx.stubs, "specstride");
    writeFileSync(cli, "#!/usr/bin/env node\nconsole.log('1 (plus chatter)');\n");
    chmodSync(cli, 0o755);
    const run = runShim(fx, ["status"]);
    assert.equal(run.status, 4);
    assert.equal((run.stdout ?? "").trim(), REFUSAL);
  });
});

test("a differing package version with protocol 1 is not refused", () => {
  withFixture((fx) => {
    // A CLI of another package version, same protocol integer.
    const cli = join(fx.stubs, "specstride");
    writeFileSync(
      cli,
      [
        "#!/usr/bin/env node",
        "const argv = process.argv.slice(2);",
        'if (argv[0] === "--protocol") { console.log("1"); process.exit(0); }',
        'if (argv[0] === "--version") { console.log("9.9.9"); process.exit(0); }',
        "process.exit(0);",
      ].join("\n"),
    );
    chmodSync(cli, 0o755);
    const run = runShim(fx, ["status"]);
    assert.equal(run.status, 0);
    assert.doesNotMatch(run.stdout ?? "", /SPECSTRIDE-REFUSE/);
  });
});

test("exit 3 passes through unchanged", () => {
  withFixture((fx) => {
    writeStubCli(fx, 1, 3);
    const run = runShim(fx, ["reverse", "specification"]);
    assert.equal(run.status, 3);
    assert.doesNotMatch(run.stdout ?? "", /SPECSTRIDE-REFUSE/);
  });
});

test("exit 70 passes through unchanged", () => {
  withFixture((fx) => {
    writeStubCli(fx, 1, 70);
    const run = runShim(fx, ["doctor"]);
    assert.equal(run.status, 70);
  });
});
