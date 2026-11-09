/**
 * The systemd user unit checks (T058): the shipped unit matches the template
 * the watcher prints, carries `Restart=on-failure` and `Environment=
 * HERMES_HOME=…`, has no relation to `hermes-gateway.service`, and
 * `watch --print-unit` only prints — nothing is installed automatically.
 */
import { strict as assert } from "node:assert";
import test from "node:test";
import { readFileSync } from "node:fs";
import { WATCH_UNIT_ENABLE_COMMAND, WATCH_UNIT_TEMPLATE, watchUnitPath } from "../../src/watch/index.ts";
import { addWorkspaces, cliCalls, runWatchOnce, watchFixture, writeScript } from "./fixture.ts";

const CHANGE_LINE = "run=run-1 st=running cursor=5 next=/specstride status";

test("the shipped unit is the printed template, with no gateway relation", () => {
  const shipped = readFileSync(watchUnitPath(), "utf8");
  assert.equal(shipped, WATCH_UNIT_TEMPLATE, "systemd/specstride-hermes-watch.service must match the template");
  assert.ok(shipped.includes("ExecStart=specstride-host-hermes watch"));
  assert.ok(shipped.includes("Restart=on-failure"));
  assert.ok(shipped.includes("Environment=HERMES_HOME="));
  assert.ok(!shipped.includes("hermes-gateway"), "the unit names no gateway relation");
  assert.ok(shipped.includes("[Install]"));
});

test("watch --print-unit prints the unit and the enable command, and installs nothing", () => {
  const fx = watchFixture();
  try {
    addWorkspaces(fx, 1);
    writeScript(fx, { wait: { stdout: CHANGE_LINE, exit: 0 } });
    const run = runWatchOnce(fx, {}, ["watch", "--print-unit"]);
    assert.equal(run.status, 0, run.stderr);
    const printed = run.stdout;
    assert.ok(printed.includes("[Unit]"), printed);
    assert.ok(printed.includes("ExecStart=specstride-host-hermes watch"));
    assert.ok(printed.includes("Restart=on-failure"));
    assert.ok(printed.includes(`Environment=HERMES_HOME=${fx.home}`), printed);
    assert.ok(printed.includes(WATCH_UNIT_ENABLE_COMMAND), printed);
    assert.ok(printed.includes("Install by hand"), printed);
    assert.ok(!printed.includes("hermes-gateway"), "no gateway relation");
    // Nothing ran: no systemctl, no CLI call at all.
    assert.equal(cliCalls(fx).length, 0);
    const stubLog = cliCalls(fx);
    assert.equal(stubLog.length, 0);
  } finally {
    fx.cleanup();
  }
});
