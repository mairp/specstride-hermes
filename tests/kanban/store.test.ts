/**
 * The projection store tests (T011; PT-151-007): the file location under
 * `$HERMES_HOME/specstride-host/kanban/`, parent directories created on
 * demand, atomic saves (tmp + rename), save-then-reload deep-equal, and a
 * torn file read as an empty dataset with exactly ONE warning, silent on the
 * next read. Every test runs against a temporary `$HERMES_HOME`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyRecord, ProjectionStore, type ProjectionRecord } from "../../src/kanban/store.ts";

function fixture() {
  const home = mkdtempSync(join(tmpdir(), "kanban-store-"));
  const warnings: string[] = [];
  const store = new ProjectionStore(home, { warn: (m) => warnings.push(m) });
  return {
    home,
    store,
    warnings,
    pathOf: (runId: string) => join(home, "specstride-host", "kanban", `${runId}.json`),
    cleanup() {
      rmSync(home, { recursive: true, force: true });
    },
  };
}

function record(partial: Partial<ProjectionRecord> = {}): ProjectionRecord {
  return {
    cards: [
      {
        key: "specstride:r-1",
        role: "root",
        hermesId: "h-1",
        engineValue: "running",
        source: "engine",
        rule: null,
        column: "scheduled",
        title: "[running] alpha · r-1",
        body: "engine-state: running",
        assignee: "specstride-projection",
        tenant: "specstride",
        humanEdited: false,
        lastWrittenAt: "2026-11-11T12:00:00.000Z",
      },
    ],
    source: "engine",
    signature: "abcd1234",
    lastGoodAt: "2026-11-11T12:00:00.000Z",
    stale: false,
    ...partial,
  };
}

test("the store writes $HERMES_HOME/specstride-host/kanban/<run-id>.json and creates parents", () => {
  const fx = fixture();
  try {
    const runId = "r-1";
    fx.store.save(runId, record());
    const path = fx.pathOf(runId);
    assert.equal(fx.store.pathOf(runId), path);
    const onDisk = JSON.parse(readFileSync(path, "utf8")) as ProjectionRecord;
    assert.equal(onDisk.cards.length, 1);
    assert.equal(onDisk.signature, "abcd1234");
    // Parents were created (the dir did not exist before the save).
    assert.deepEqual(readdirSync(join(fx.home, "specstride-host", "kanban")), ["r-1.json"]);
  } finally {
    fx.cleanup();
  }
});

test("a save leaves no temporary file behind", () => {
  const fx = fixture();
  try {
    fx.store.save("r-2", record());
    fx.store.save("r-2", record({ signature: "efef5678" }));
    assert.deepEqual(readdirSync(join(fx.home, "specstride-host", "kanban")), ["r-2.json"]);
  } finally {
    fx.cleanup();
  }
});

test("save then reload gives back exactly what was stored", () => {
  const fx = fixture();
  try {
    const stored = record({
      source: "workspace-reader",
      cards: [
        {
          key: "specstride:r-3:p2",
          role: "stage",
          hermesId: "h-2",
          engineValue: "proposing",
          source: "workspace-reader",
          rule: "W1",
          column: "scheduled",
          title: "[proposing] alpha phase 2 · p2",
          body: "lane: proposing\nrule: W1 (W-proposing)\nsource: workspace-reader",
          assignee: "specstride-projection",
          tenant: "specstride",
          humanEdited: false,
          lastWrittenAt: "2026-11-11T12:30:00.000Z",
        },
      ],
      signature: "cafe0000",
      lastGoodAt: "2026-11-11T12:30:00.000Z",
      stale: false,
    });
    fx.store.save("r-3", stored);
    const loaded = fx.store.load("r-3");
    assert.deepEqual(loaded, stored);
  } finally {
    fx.cleanup();
  }
});

test("a torn file reads as the empty dataset and warns exactly once", () => {
  const fx = fixture();
  try {
    mkdirSync(join(fx.home, "specstride-host", "kanban"), { recursive: true });
    writeFileSync(fx.pathOf("r-4"), '{"cards":[{"key":"specstride:r-4"}', "utf8");
    const first = fx.store.load("r-4");
    assert.deepEqual(first, emptyRecord());
    assert.equal(first.cards.length, 0);
    assert.equal(first.stale, true);
    assert.equal(fx.warnings.length, 1);
    assert.ok(fx.warnings[0].includes("r-4.json"));
    // A subsequent read of the same torn file stays silent.
    const second = fx.store.load("r-4");
    assert.deepEqual(second, emptyRecord());
    assert.equal(fx.warnings.length, 1, `warnings: ${JSON.stringify(fx.warnings)}`);
  } finally {
    fx.cleanup();
  }
});

test("an unreadable file (missing, or a directory) reads as empty without a throw", () => {
  const fx = fixture();
  try {
    assert.deepEqual(fx.store.load("never-written"), emptyRecord());
    assert.equal(fx.warnings.length, 1);
    mkdirSync(join(fx.home, "specstride-host", "kanban"), { recursive: true });
    mkdirSync(fx.pathOf("r-dir"), { recursive: true });
    assert.deepEqual(fx.store.load("r-dir"), emptyRecord());
    assert.equal(fx.warnings.length, 2);
    assert.deepEqual(fx.store.load("r-dir"), emptyRecord());
    assert.equal(fx.warnings.length, 2, "the second read of the same path is silent");
  } finally {
    fx.cleanup();
  }
});

test("a non-JSON or shapeless file reads as empty; each distinct path warns once", () => {
  const fx = fixture();
  try {
    mkdirSync(join(fx.home, "specstride-host", "kanban"), { recursive: true });
    writeFileSync(fx.pathOf("r-5"), "not json at all", "utf8");
    writeFileSync(fx.pathOf("r-6"), '{"no":"cards here"}', "utf8");
    assert.deepEqual(fx.store.load("r-5"), emptyRecord());
    assert.deepEqual(fx.store.load("r-6"), emptyRecord());
    assert.equal(fx.warnings.length, 2);
    assert.deepEqual(fx.store.load("r-5"), emptyRecord());
    assert.equal(fx.warnings.length, 2);
  } finally {
    fx.cleanup();
  }
});

test("a good write clears the torn warning, so a later tear warns again", () => {
  const fx = fixture();
  try {
    mkdirSync(join(fx.home, "specstride-host", "kanban"), { recursive: true });
    writeFileSync(fx.pathOf("r-7"), "{torn", "utf8");
    fx.store.load("r-7");
    assert.equal(fx.warnings.length, 1);
    fx.store.save("r-7", record({ signature: "ff00ff00" }));
    assert.deepEqual(fx.store.load("r-7").signature, "ff00ff00");
    writeFileSync(fx.pathOf("r-7"), "{torn-again", "utf8");
    fx.store.load("r-7");
    assert.equal(fx.warnings.length, 2);
  } finally {
    fx.cleanup();
  }
});
