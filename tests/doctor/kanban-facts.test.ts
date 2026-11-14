/**
 * The doctor facts of `host.kanban-plugin` (T075, T076; PT-151-030,
 * PT-151-053, PT-151-016; data-model.md "DoctorFacts"): with injected
 * observations the line reports each fact of the closed set "Doctor facts";
 * an unobserved fact reads `unknown` and keeps the severity at `info`, never
 * `ok`; the check never blocks a launch and `LAUNCH_CHECK_IDS` is unchanged;
 * the doctor stays within 150's time budget against the stubs.
 *
 * The store-side facts are read from a real temporary `HERMES_HOME` store
 * (the projector's atomic records); the unit, engine and host-CLI facts are
 * injected through `collectFindings`' seam. Everything runs against the stub
 * `hermes` and stub CLI on PATH. No model call.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import {
  collectFindings,
  kanbanFacts,
  KANBAN_FACT_IDS,
  LAUNCH_CHECK_IDS,
} from "../../src/doctor.ts";
import { tempHome, withStubs } from "../helpers/env.ts";

const ENABLED = [{ name: "specstride", enabled: true }, { name: "kanban", enabled: true }];
const DISABLED = [{ name: "specstride", enabled: true }, { name: "kanban", enabled: false }];

/** All facts observed, so a test can unset exactly one. */
const ALL_YES: Record<string, string> = {
  "kanban-enabled": "yes",
  "projector-alive": "yes",
  "tab-enabled": "yes",
  "map-version": "v1",
  "shim-on-unit-path": "yes",
  "engine-answers-protocol": "yes",
  "engine-path": "~/.local/specstride/bin/specstride",
  "engine-matches-pin": "yes",
  "host-cli-runs-installed": "yes",
  "engine-view-has-cards": "yes",
  "view-source": "engine",
};

/** Run `fn` under the stub environment, with plugins and injected facts. */
function underStubs(plugins, facts, fn) {
  const fx = tempHome();
  return withStubs(fx, async () => {
    process.env.STUB_PLUGINS = JSON.stringify({ plugins });
    try {
      return await fn(fx);
    } finally {
      delete process.env.STUB_PLUGINS;
    }
  });
}

function kanbanFinding(facts) {
  const f = collectFindings(facts).find((x) => x.id === "host.kanban-plugin");
  assert.ok(f, "the host.kanban-plugin finding exists");
  return f;
}

/** Parse the `fact value` pairs out of the message (values may hold `;`). */
function factsOf(message) {
  const out = {};
  const marks = KANBAN_FACT_IDS.map((id) => ({ id, at: message.indexOf(`${id} `) })).filter((m) => m.at >= 0);
  marks.sort((a, b) => a.at - b.at);
  const endOfFacts = message.indexOf("; notify-subscribe");
  for (let i = 0; i < marks.length; i++) {
    const from = marks[i].at + marks[i].id.length + 1;
    const to = i + 1 < marks.length ? marks[i + 1].at : endOfFacts;
    out[marks[i].id] = message.slice(from, to).trim().replace(/;$/, "");
  }
  return out;
}

test("every fact of the closed set is reported, in order, after the dash (PT-151-030)", () => {
  return underStubs(ENABLED, ALL_YES, () => {
    const f = kanbanFinding(ALL_YES);
    const seen = factsOf(f.message);
    for (const id of KANBAN_FACT_IDS) {
      assert.ok(id in seen, `the message carries ${id}`);
      assert.equal(seen[id], ALL_YES[id], `${id} carries its observed value`);
    }
    // The order on the line is the closed set's order.
    const positions = KANBAN_FACT_IDS.map((id) => f.message.indexOf(`${id} `));
    assert.deepEqual([...positions].sort((a, b) => a - b), positions, "facts appear in the closed set's order");
  });
});

test("a fully observed enabled Kanban reads ok; the notify-delivery fact stays unknown (PT-151-016)", () => {
  return underStubs(ENABLED, ALL_YES, () => {
    const f = kanbanFinding(ALL_YES);
    assert.equal(f.severity, "ok");
    assert.match(f.message, /notify-subscribe/);
    assert.match(f.message, /unknown \(U-151-05\)/);
    assert.match(f.message, /150 notifier|specstride\.notify\.telegram/);
    assert.equal(f.blocking, false);
  });
});

test("an unobserved fact reads unknown and keeps the severity at info, never ok (F151-FR-030)", () => {
  const cases = KANBAN_FACT_IDS.filter((id) => id !== "kanban-enabled");
  return underStubs(ENABLED, ALL_YES, () => {
    for (const id of cases) {
      const injected = { ...ALL_YES, [id]: "unknown" };
      const f = kanbanFinding(injected);
      assert.equal(f.severity, "info", `${id}: unknown keeps the line at info`);
      assert.match(factsOf(f.message)[id] ?? "", /unknown/);
    }
  });
});

test("an unobserved kanban-enabled keeps the whole line informational", () => {
  return underStubs(ENABLED, ALL_YES, () => {
    const f = kanbanFinding({ ...ALL_YES, "kanban-enabled": "unknown" });
    assert.notEqual(f.severity, "fail");
    assert.notEqual(f.severity, "ok");
    assert.match(f.message, /could not be observed/);
  });
});

test("the check never blocks a launch and LAUNCH_CHECK_IDS is unchanged", () => {
  return underStubs(DISABLED, ALL_YES, () => {
    const findings = collectFindings({});
    assert.deepEqual(LAUNCH_CHECK_IDS, ["host.cli-found"]);
    for (const x of findings) {
      if (x.id !== "host.cli-found") assert.equal(x.blocking, false, `${x.id} never blocks`);
    }
    const f = findings.find((x) => x.id === "host.kanban-plugin");
    assert.equal(f.blocking, false);
  });
});

test("the shim absent from the unit's PATH (present on the caller's) reads shim-on-unit-path: no", () => {
  return underStubs(ENABLED, ALL_YES, () => {
    const f = kanbanFinding({ ...ALL_YES, "shim-on-unit-path": "no" });
    assert.equal(factsOf(f.message)["shim-on-unit-path"], "no");
    assert.equal(factsOf(f.message)["kanban-enabled"], "yes");
  });
});

test("an engine that answers no --protocol reads no and names a ~-rooted path (PT-151-053)", () => {
  return underStubs(ENABLED, ALL_YES, () => {
    const f = kanbanFinding({ ...ALL_YES, "engine-answers-protocol": "no" });
    const seen = factsOf(f.message);
    assert.equal(seen["engine-answers-protocol"], "no");
    assert.match(seen["engine-path"], /^~/, "the engine path is ~-rooted, never absolute");
  });
});

test("a version or commit mismatch reads engine-matches-pin: no", () => {
  return underStubs(ENABLED, ALL_YES, () => {
    for (const value of ["no (version)", "no (commit)", "no"]) {
      const f = kanbanFinding({ ...ALL_YES, "engine-matches-pin": value });
      assert.match(factsOf(f.message)["engine-matches-pin"] ?? "", /^no/);
    }
  });
});

test("a matching version with no readable core-pin.json reads yes (version; commit unknown)", () => {
  return underStubs(ENABLED, ALL_YES, () => {
    const f = kanbanFinding({ ...ALL_YES, "engine-matches-pin": "yes (version; commit unknown)" });
    assert.equal(factsOf(f.message)["engine-matches-pin"], "yes (version; commit unknown)");
  });
});

test("a host CLI that cannot resolve its modules reads host-cli-runs-installed: no", () => {
  return underStubs(ENABLED, ALL_YES, () => {
    const f = kanbanFinding({ ...ALL_YES, "host-cli-runs-installed": "no" });
    assert.equal(factsOf(f.message)["host-cli-runs-installed"], "no");
  });
});

test("the store facts are read from the real projector store under HERMES_HOME", () => {
  return underStubs(ENABLED, ALL_YES, (fx) => {
    const dir = join(fx.home, "specstride-host", "kanban");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "run-a.json"),
      JSON.stringify({
        cards: [{ key: "specstride:run-a" }],
        source: "workspace-reader",
        signature: "s",
        lastGoodAt: "2026-11-12T10:00:00.000Z",
        stale: false,
      }) + "\n",
    );
    writeFileSync(
      join(dir, "run-b.json"),
      JSON.stringify({ cards: [], source: "engine", signature: "s", lastGoodAt: "2026-11-12T09:00:00.000Z", stale: true }) + "\n",
    );
    const facts = kanbanFacts({});
    assert.equal(facts["projector-alive"], "yes", "a non-stale record with lastGoodAt reads alive");
    assert.equal(facts["view-source"], "workspace-reader", "the newest record's source wins");
    assert.equal(facts["engine-view-has-cards"], "unknown", "the fact reads the newest record, which is reader-sourced");

    // Every record stale → projector not alive; an engine record with no cards reads no.
    writeFileSync(
      join(dir, "run-a.json"),
      JSON.stringify({ cards: [], source: "engine", signature: "s", lastGoodAt: "2026-11-12T10:00:00.000Z", stale: true }) + "\n",
    );
    const after = kanbanFacts({});
    assert.equal(after["projector-alive"], "no");
    assert.equal(after["engine-view-has-cards"], "no");

    // A torn record is skipped, not fatal.
    writeFileSync(join(dir, "run-c.json"), "{torn");
    assert.equal(kanbanFacts({})["view-source"], "engine");
  });
});

test("with no store the store facts read unknown, not guesses", () => {
  return underStubs(ENABLED, ALL_YES, () => {
    const facts = kanbanFacts({});
    assert.equal(facts["projector-alive"], "unknown");
    assert.equal(facts["engine-view-has-cards"], "unknown");
    assert.equal(facts["view-source"], "unknown");
  });
});

test("the doctor stays within 150's budget against the stubs (fact observation under 2 s)", () => {
  return underStubs(ENABLED, ALL_YES, () => {
    const start = Date.now();
    kanbanFacts(ALL_YES, ENABLED);
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 2000, `the fact observation took ${elapsed} ms`);
  });
});

test("the line carries the facts in --json too (same message)", () => {
  return underStubs(ENABLED, ALL_YES, () => {
    const f = kanbanFinding(ALL_YES);
    assert.match(f.message, /view-source engine/);
    assert.match(f.message, /map-version v1/);
  });
});
