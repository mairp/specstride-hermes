/**
 * T052 (PT-151-023, PT-151-039; F151-SC-004, F151-SC-008) — the view
 * poller, against the stubbed fetch of contracts/plugin-api.md:
 *
 * - one outstanding request at a time;
 * - 5 s cadence after a good answer, backoff 1 → 30 s after a failure;
 * - the stale line is set on a failure and REMOVED by the next `view`,
 *   `unchanged` or `no-run` answer (F151-FR-039);
 * - a 404, a 500, an HTML body with status 200, a body that does not parse,
 *   an object without a known `answer` and a thrown fetch each give the ONE
 *   unavailable line and no partial board (F151-FR-023);
 * - nothing throws out of the poller.
 *
 * Time is modeled, never waited on: the injected scheduler records (ms, fn)
 * pairs the tests pump by hand. No real timer, no network.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  createPoller,
  UNAVAILABLE_LINE,
  type Poller,
  type PollerDeps,
} from "../../src/tab/client/poller.ts";
import { closedSetApiAnswers } from "../../src/kanban/generated/closed-sets.ts";

/** A recorded scheduler tick. */
interface Tick {
  readonly ms: number;
  readonly fn: () => void;
}

/** A hand-driven fake clock: ticks are pumped by the tests, never by time. */
function fakeClock() {
  const ticks: Tick[] = [];
  const schedule = (ms: number, fn: () => void): (() => void) => {
    const tick: Tick = { ms, fn };
    ticks.push(tick);
    return () => {
      const i = ticks.indexOf(tick);
      if (i >= 0) ticks.splice(i, 1);
    };
  };
  return {
    ticks,
    schedule,
    /** Pump one tick and drop it. */
    pump(): void {
      const tick = ticks.shift();
      assert.ok(tick, "no scheduled tick to pump");
      tick.fn();
    },
  };
}

/** A scripted fetch: each call shifts the next response (or thrown error). */
function scriptedFetch(
  script: ReadonlyArray<
    { status: number; contentType?: string; body: string } | { throws: string }
  >,
) {
  const calls: number[] = [];
  const fetch: PollerDeps["fetch"] = (url: string) => {
    calls.push(calls.length);
    void url;
    const next = script[calls.length - 1];
    if (next === undefined) {
      return new Promise(() => {}); // hangs: the test drives only scripted calls
    }
    if ("throws" in next) return Promise.reject(new Error(next.throws));
    return Promise.resolve({ status: next.status, contentType: next.contentType, body: next.body });
  };
  return { fetch, calls };
}

const JSON_TYPE = "application/json";

/** One good `view` answer as the route would answer it. */
function viewAnswer(cursor = "c1"): string {
  return JSON.stringify({
    answer: "view",
    source: "engine",
    cursor,
    lastGoodAt: "2026-11-11T12:00:00.000Z",
    view: {
      schema: "specstride.view/1",
      now: "2026-11-11T12:00:00.000Z",
      runId: "run-1",
      state: "running",
      cards: [{ id: "k1", feature: "f", phase: 1, lane: "approved", ruleId: null, flags: { dead: false, stale: false, yielded: false } }],
    },
  });
}

/** Drive the poller through one fetch: call, await, pump the follow-up. */
async function driveOne(poller: Poller, clock: ReturnType<typeof fakeClock>): Promise<void> {
  clock.pump();
  await Promise.resolve();
  await new Promise<void>((resolve) => {
    // let the fetch promise chain settle; the poller must not throw
    setTimeout_0_p().then(resolve);
  });
  void poller;
}

/** A macrotask turn without real time significance (one immediate tick). */
function setTimeout_0_p(): Promise<void> {
  const g = globalThis as { setTimeout: (fn: () => void, ms?: number) => unknown };
  return new Promise((resolve) => g.setTimeout(resolve, 0));
}

test("poller: one outstanding request at a time", async () => {
  const clock = fakeClock();
  let resolveFirst: (v: { status: number; body: string }) => void = () => {};
  let calls = 0;
  const fetch: PollerDeps["fetch"] = () => {
    calls += 1;
    if (calls === 1) {
      return new Promise((resolve) => {
        resolveFirst = resolve;
      });
    }
    return Promise.resolve({ status: 200, contentType: JSON_TYPE, body: viewAnswer() });
  };
  const answers: unknown[] = [];
  const poller = createPoller({
    fetch,
    onAnswer: (a) => answers.push(a),
    onLine: () => {},
    schedule: clock.schedule,
  });
  poller.start();
  clock.pump(); // first request leaves
  await Promise.resolve();
  clock.pump(); // must NOT be a second request while the first hangs
  assert.equal(calls, 1, "no second fetch while one request is outstanding");
  resolveFirst({ status: 200, body: viewAnswer() });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(answers.length, 1, "the hanging answer is delivered once settled");
  clock.pump();
  await Promise.resolve();
  assert.ok(calls >= 2, "a new request may leave only after the answer");
  poller.stop();
});

test("poller: 5 s cadence after a good answer", async () => {
  const clock = fakeClock();
  const { fetch } = scriptedFetch([
    { status: 200, contentType: JSON_TYPE, body: viewAnswer() },
  ]);
  const poller = createPoller({
    fetch,
    onAnswer: () => {},
    onLine: () => {},
    schedule: clock.schedule,
  });
  poller.start();
  clock.pump(); // first request
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(clock.ticks.length, 1, "one follow-up is scheduled after the answer");
  assert.equal(clock.ticks[0].ms, 5_000, "cadence after a good answer is 5 s");
  poller.stop();
});

test("poller: backoff 1, 2, 4, 8, 16, 30 s after failures", async () => {
  const clock = fakeClock();
  const fail = { status: 500, contentType: JSON_TYPE, body: "boom" };
  const { fetch } = scriptedFetch([fail, fail, fail, fail, fail, fail, fail]);
  const poller = createPoller({
    fetch,
    onAnswer: () => {},
    onLine: () => {},
    schedule: clock.schedule,
  });
  poller.start();
  const expected = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000];
  for (const ms of expected) {
    clock.pump(); // request leaves
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(clock.ticks.length, 1, `a retry is scheduled after the failure (next ${ms} ms)`);
    assert.equal(clock.ticks[0].ms, ms, "backoff step");
    // (the poller's settle replaces its single follow-up tick in place;
    //  no manual shift is needed — shifting would double-consume it)
  }
  poller.stop();
});

test("poller: stale line is set on failure and removed by view/unchanged/no-run", async () => {
  const clock = fakeClock();
  const lines: string[] = [];
  const { fetch } = scriptedFetch([
    { status: 500, contentType: JSON_TYPE, body: "boom" },
    { status: 200, contentType: JSON_TYPE, body: JSON.stringify({ answer: "unchanged", cursor: "c1" }) },
    { status: 500, contentType: JSON_TYPE, body: "boom" },
    { status: 200, contentType: JSON_TYPE, body: JSON.stringify({ answer: "no-run" }) },
    { status: 500, contentType: JSON_TYPE, body: "boom" },
    { status: 200, contentType: JSON_TYPE, body: viewAnswer() },
  ]);
  const poller = createPoller({
    fetch,
    onAnswer: () => {},
    onLine: (l) => lines.push(l),
    schedule: clock.schedule,
  });
  poller.start();
  const steps = ["unchanged", "no-run", "view"] as const;
  for (const kind of steps) {
    clock.pump();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(poller.stale, true, `the stale line is held after the failure before ${kind}`);
    assert.deepEqual(lines, [UNAVAILABLE_LINE], `exactly the unavailable line is set before ${kind}`);
    lines.length = 0;
    clock.pump();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(poller.stale, false, `the stale line is removed by the ${kind} answer`);
    assert.deepEqual(lines, [], `no line is re-emitted by the ${kind} answer`);
    // (the poller's settle replaces its single follow-up tick in place;
    //  no manual shift is needed — shifting would double-consume it)
  }
  poller.stop();
});

test("poller: every error case gives the one unavailable line and no partial board", async () => {
  const cases: { name: string; response: { status: number; contentType?: string; body: string } | { throws: string } }[] = [
    { name: "404", response: { status: 404, contentType: JSON_TYPE, body: JSON.stringify({ error: "no route" }) } },
    { name: "500", response: { status: 500, contentType: JSON_TYPE, body: "boom" } },
    { name: "HTML body with 200", response: { status: 200, contentType: "text/html", body: "<html>spa</html>" } },
    { name: "unparseable body", response: { status: 200, contentType: JSON_TYPE, body: "{not json" } },
    { name: "object without a known answer", response: { status: 200, contentType: JSON_TYPE, body: JSON.stringify({ hello: 1 }) } },
    { name: "thrown fetch", response: { throws: "socket down" } },
  ];
  for (const { name, response } of cases) {
    const clock = fakeClock();
    const answers: unknown[] = [];
    const lines: string[] = [];
    const { fetch } = scriptedFetch([response]);
    const poller = createPoller({
      fetch,
      onAnswer: (a) => answers.push(a),
      onLine: (l) => lines.push(l),
      schedule: clock.schedule,
    });
    poller.start();
    await driveOne(poller, clock);
    assert.equal(answers.length, 0, `${name}: no partial board reaches the callback`);
    assert.deepEqual(lines, [UNAVAILABLE_LINE], `${name}: exactly the one unavailable line`);
    assert.equal(poller.stale, true, `${name}: the stale state is held`);
    poller.stop();
  }
});

test("poller: answers outside the closed set are unavailable too", async () => {
  const clock = fakeClock();
  const answers: unknown[] = [];
  const lines: string[] = [];
  // an `answer` value the closed set does not know is an unknown answer
  assert.ok(!closedSetApiAnswers.includes("bogus" as never), "sanity: bogus is outside the closed set");
  const { fetch } = scriptedFetch([
    { status: 200, contentType: JSON_TYPE, body: JSON.stringify({ answer: "bogus" }) },
  ]);
  const poller = createPoller({ fetch, onAnswer: (a) => answers.push(a), onLine: (l) => lines.push(l), schedule: clock.schedule });
  poller.start();
  await driveOne(poller, clock);
  assert.equal(answers.length, 0, "no unknown answer reaches the callback");
  assert.deepEqual(lines, [UNAVAILABLE_LINE], "an unknown answer reads as unavailable");
  poller.stop();
});

test("poller: nothing throws out of the poller", async () => {
  const clock = fakeClock();
  const { fetch } = scriptedFetch([{ throws: "sync-ish reject" }]);
  const poller = createPoller({ fetch, onAnswer: () => {}, onLine: () => {}, schedule: clock.schedule });
  await assert.doesNotReject(async () => {
    poller.start();
    clock.pump();
    await setTimeout_0_p();
    await setTimeout_0_p();
    clock.pump();
    await setTimeout_0_p();
    poller.stop();
  }, "driving failures must not reject out of the poller");
});
