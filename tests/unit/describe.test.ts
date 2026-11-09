/**
 * The capability-description tests of the Hermes host (T018, PT-150-015):
 * the packaging form, the six declarations through the kit's helpers, and
 * the unknown-capability rule of annex H §H.1 (ignored, never an error).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { CAPABILITIES, type CapabilityDeclaration } from "@specstride/host-kit";
import {
  hermesDeclarations,
  hermesDescribe,
  hermesDescribeCapabilities,
  hermesRendering,
  HERMES_HOOK_EVENTS,
} from "../../src/describe.ts";

test("the packaging form is the Hermes one", () => {
  assert.equal(
    hermesRendering.packagingForm,
    "skill directories in a Hermes skill root plus the `specstride` plugin",
  );
  assert.equal(hermesRendering.descriptionCap, 1024);
});

test("every one of the six capabilities is declared, in annex order", () => {
  assert.deepEqual(
    hermesDeclarations.map((declaration) => declaration.capability),
    CAPABILITIES,
  );
});

test("the present and absent capabilities of Hermes", () => {
  const description = hermesDescribe();
  assert.deepEqual(description.hooks, HERMES_HOOK_EVENTS);
  assert.equal(description.background, null, "no background primitive: the declared fallback applies");
  assert.equal(description.model, false);
  assert.equal(description.stateRootWritable, true);
  assert.equal(description.skillNaming.descriptionCap, 1024);
});

test("each declaration carries a host fact and a pin", () => {
  for (const declaration of hermesDeclarations) {
    assert.match(declaration.hostFact, /^HF-/);
    assert.notEqual(declaration.pin, "");
    assert.match(declaration.requirement, /^F150-/);
  }
});

test("an unknown capability is ignored and reported, never an error", () => {
  const result = hermesDescribeCapabilities([...CAPABILITIES, "hyperdrive"]);
  assert.equal(result.declared.length, CAPABILITIES.length);
  assert.deepEqual(result.ignored, ["hyperdrive"]);
  // The description grows no key of its own.
  assert.ok(!("hyperdrive" in (hermesDescribe() as unknown as Record<string, unknown>)));
});

test("the fallbacks in use are the annex's, only for the absent capabilities", () => {
  const description = hermesDescribe();
  const absent = hermesDeclarations.filter((d: CapabilityDeclaration) => !d.present);
  assert.deepEqual(
    absent.map((declaration) => declaration.capability).sort(),
    ["evals", "model", "background"].sort(),
  );
  for (const declaration of absent) {
    assert.equal((description as unknown as Record<string, unknown>)[declaration.capability] === null ||
      (description as unknown as Record<string, unknown>)[declaration.capability] === false, true);
  }
});
