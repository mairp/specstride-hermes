/**
 * The shim resolution tests (T015, PT-150-011): `SPECSTRIDE_BIN` wins over
 * the search path; a missing CLI exits 127 with one line; the shim's own
 * directory is excluded from the search; and a shim named `specstride` is
 * refused by the build. No network, no write outside the temporary home.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runShim, shimFixture, writeStubCli, type ShimFixture } from "./helper.ts";
import { SHIM_FILE_NAME, assertShimFileName } from "../../src/shim.ts";

function withFixture(fn: (fx: ShimFixture) => void): void {
  const fx = shimFixture();
  try {
    fn(fx);
  } finally {
    fx.cleanup();
  }
}

test("SPECSTRIDE_BIN wins over the search path", () => {
  withFixture((fx) => {
    // The PATH stub would fail the run with exit 7 if the shim picked it.
    writeStubCli(fx, 1, 7, "specstride");
    const explicit = writeStubCli(fx, 1, 0, "explicit-cli");
    const run = runShim(fx, ["status"], {
      SPECSTRIDE_BIN: explicit,
      PATH: `${fx.stubs}:/usr/bin:/bin`,
    });
    assert.equal(run.status, 0, `the explicit CLI answered: ${run.stderr}`);
    assert.deepEqual(run.argvLines.map((line) => line.argv), [["--protocol"], ["status"]]);
  });
});

test("a missing CLI exits 127 with exactly one line", () => {
  withFixture((fx) => {
    const run = runShim(fx, ["status"], {
      PATH: join(process.execPath, ".."),
      SPECSTRIDE_BIN: undefined,
    });
    assert.equal(run.status, 127);
    const stderrLines = (run.stderr ?? "").split("\n").filter((line) => line.trim() !== "");
    assert.equal(stderrLines.length, 1, "exactly one line of output");
    assert.match(stderrLines[0], /Specstride CLI not found/);
    assert.match(stderrLines[0], /npm install -g specstride@0\.0\.0/);
    assert.equal(run.stdout ?? "", "");
  });
});

test("the shim's own directory is excluded from the search path", () => {
  withFixture((fx) => {
    // A CLI sitting NEXT TO the shim must not be found; the stubs copy is.
    writeStubCli(fx, 1, 0, "specstride");
    const nextToShim = join(fx.bin, "specstride");
    writeFileSync(
      nextToShim,
      "#!/usr/bin/env node\nimport { appendFileSync } from 'node:fs';\nappendFileSync(process.env.STUB_CLI_LOG, JSON.stringify({ argv: ['SHIM-DIR-CLI'] }) + '\\n');\n",
    );
    chmodSync(nextToShim, 0o755);
    const run = runShim(fx, ["status"], {
      PATH: `${fx.bin}:${fx.stubs}:/usr/bin:/bin`,
      SPECSTRIDE_BIN: undefined,
    });
    assert.equal(run.status, 0);
    assert.ok(!run.argvLines.some((line) => line.argv.includes("SHIM-DIR-CLI")));
  });
});

test("a shim named specstride is refused by the build", () => {
  assert.equal(SHIM_FILE_NAME, "specstride-hermes");
  assert.throws(() => assertShimFileName("specstride"), /engine.s own executable/);
  assert.throws(() => assertShimFileName("specstride.mjs"), /engine.s own executable/);
  assert.equal(assertShimFileName("specstride-hermes"), "specstride-hermes");
});

test("the shim fetches, installs and writes nothing but the watch list it owns", () => {
  withFixture((fx) => {
    const before = readdirSync(fx.home).sort();
    const run = runShim(fx, ["status"], { PATH: join(process.execPath, "..") });
    assert.equal(run.status, 127);
    assert.deepEqual(readdirSync(fx.home).sort(), before);
  });
});
