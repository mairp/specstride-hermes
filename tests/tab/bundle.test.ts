/**
 * T055 tests-first bundle test (RED until `scripts/build-tab.ts` output exists).
 *
 * Evaluates hermes-plugin/specstride/dashboard/dist/index.js in a stub window
 * carrying the closed-set SDK fake, and asserts the registration contract and
 * manifest shape. Fails with a clear assertion while the bundle is absent.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { createSdkFake, withFakeWindow, SDK_MEMBER_NAMES } from "../helpers/sdk-fake.ts";

const BUNDLE_PATH = "hermes-plugin/specstride/dashboard/dist/index.js";
const MANIFEST_PATH = "hermes-plugin/specstride/dashboard/manifest.json";

function readBundleText(): string {
  let text: string;
  try {
    text = readFileSync(BUNDLE_PATH, "utf8");
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    assert.fail(
      `bundle missing or unreadable at ${BUNDLE_PATH} (run scripts/build-tab.ts): ${e.code ?? err}`,
    );
  }
  assert.ok(text.length > 0, `bundle at ${BUNDLE_PATH} must be non-empty`);
  return text;
}

test("bundle registers 'specstride' exactly once, with a function, inside a stub window", () => {
  withFakeWindow((win) => {
    const text = readBundleText();
    assert.doesNotThrow(
      () => {
        vm.runInNewContext(text, { window: win }, { filename: BUNDLE_PATH });
      },
      "bundle must evaluate in a window-only environment without throwing",
    );
    const calls = (win.__HERMES_PLUGINS__ as { calls: Array<{ name: string; fn: unknown }> }).calls;
    assert.equal(
      calls.length,
      1,
      `register must be called exactly once, got ${calls.length}`,
    );
    assert.equal(calls[0].name, "specstride", "register name must be 'specstride'");
    assert.equal(typeof calls[0].fn, "function", "registered component must be a function");
  });
});

test("bundle reads no SDK member outside the closed set", () => {
  withFakeWindow((win) => {
    const text = readBundleText();
    // Any non-member read makes the fake SDK throw; this also re-confirms the
    // registered set is the closed set.
    assert.doesNotThrow(() => {
      vm.runInNewContext(text, { window: win }, { filename: BUNDLE_PATH });
    }, "bundle must not read any SDK member outside closedSetSdkMembers");
    const sdk = win.__HERMES_PLUGIN_SDK__ as Record<string, unknown>;
    for (const name of SDK_MEMBER_NAMES) {
      assert.notEqual(sdk[name], undefined, `closed member '${name}' should remain readable`);
    }
    assert.throws(
      () => (sdk as Record<string, unknown>).doesNotExist,
      /not a member of __HERMES_PLUGIN_SDK__: doesNotExist/,
      "sanity: the fake still rejects invented members",
    );
  });
});

test("manifest.json declares tab.path '/specstride', position 'after:kanban', entry, css, api, and no tab.override", () => {
  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as Record<string, unknown>;
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    assert.fail(
      `manifest missing or unreadable at ${MANIFEST_PATH}: ${e.code ?? err}`,
    );
  }
  const tab = manifest.tab as Record<string, unknown> | undefined;
  assert.notEqual(tab, undefined, "manifest must have a 'tab' object");
  assert.equal(tab!.path, "/specstride", "tab.path must be '/specstride'");
  assert.equal(tab!.position, "after:kanban", "tab.position must be 'after:kanban'");
  assert.equal(tab!.override, undefined, "manifest must NOT have tab.override");
  assert.equal(typeof manifest.entry, "string", "manifest must declare 'entry'");
  assert.equal(typeof manifest.css, "string", "manifest must declare 'css'");
  assert.equal(typeof manifest.api, "string", "manifest must declare 'api'");
});

test("bundle contains no copy of React", () => {
  const text = readBundleText();
  const reactSignature = /react\.production|ReactElement|__SECRET_INTERNALS/;
  assert.doesNotMatch(
    text,
    reactSignature,
    "bundle must not embed React (it must come from window.__HERMES_PLUGIN_SDK__)",
  );
});
