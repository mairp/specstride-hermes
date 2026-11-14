/**
 * T055 tests-first: unit tests for the SDK fake helper itself.
 * tests/helpers/sdk-fake.ts is a real, implemented helper — these must pass.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  createSdkFake,
  createPluginsFake,
  withFakeWindow,
  SDK_MEMBER_NAMES,
  SDK_HOOK_NAMES,
  SDK_COMPONENT_NAMES,
  SDK_UTILS_NAMES,
  SDK_NON_MEMBER_PREFIX,
} from "../helpers/sdk-fake.ts";

test("sdk fake exposes exactly the closed-set top-level members", () => {
  const sdk = createSdkFake();
  for (const name of SDK_MEMBER_NAMES) {
    assert.notEqual(sdk[name], undefined, `top-level member '${name}' must read fine`);
  }
});

test("sdk fake nested hooks/components/utils expose exactly their closed lists", () => {
  const sdk = createSdkFake();
  const hooks = sdk.hooks as Record<string, unknown>;
  for (const name of SDK_HOOK_NAMES) {
    assert.notEqual(hooks[name], undefined, `hooks.${name} must read fine`);
  }
  const components = sdk.components as Record<string, unknown>;
  for (const name of SDK_COMPONENT_NAMES) {
    assert.notEqual(components[name], undefined, `components.${name} must read fine`);
  }
  const utils = sdk.utils as Record<string, unknown>;
  for (const name of SDK_UTILS_NAMES) {
    assert.notEqual(utils[name], undefined, `utils.${name} must read fine`);
  }
});

test("sdk fake throws the exact message for an invented top-level member", () => {
  const sdk = createSdkFake();
  assert.throws(
    () => (sdk as Record<string, unknown>).doesNotExist,
    (err: unknown) =>
      err instanceof Error &&
      err.message === "not a member of __HERMES_PLUGIN_SDK__: doesNotExist",
    "reading an invented top-level member must throw the exact closed-set message",
  );
});

test("sdk fake throws for invented members inside hooks/components/utils", () => {
  const sdk = createSdkFake();
  const cases: Array<[string, Record<string, unknown>, string]> = [
    ["hooks", sdk.hooks as Record<string, unknown>, "hooks.useVanillaState"],
    ["components", sdk.components as Record<string, unknown>, "components.NotAComponent"],
    ["utils", sdk.utils as Record<string, unknown>, "utils.deepClone"],
  ];
  for (const [label, holder, nestedName] of cases) {
    assert.throws(
      () => holder[nestedName.split(".")[1]],
      (err: unknown) =>
        err instanceof Error &&
        err.message === `not a member of __HERMES_PLUGIN_SDK__: ${nestedName}`,
      `${label} must reject invented member '${nestedName}' with the closed-set message`,
    );
  }
});

test("sdk fake is otherwise inert: members are inert markers, non-objects are tolerated", () => {
  const sdk = createSdkFake();
  assert.equal(typeof (sdk.fetchJSON as unknown as (...a: unknown[]) => unknown), "function");
  // A member value invoked does nothing harmful and returns only its name.
  assert.equal((sdk.authedFetch as unknown as (...a: unknown[]) => unknown)(), "authedFetch");
});

test("plugins fake records register calls", () => {
  const plugins = createPluginsFake();
  const fn = () => {};
  plugins.register("specstride", fn);
  assert.deepEqual(plugins.calls, [{ name: "specstride", fn }]);
});

test("withFakeWindow installs and restores the stub window", async () => {
  const hadWindow = "window" in globalThis;
  const priorWindow = (globalThis as { window?: unknown }).window;
  const result = withFakeWindow((win) => {
    assert.equal(win.__HERMES_PLUGINS__ !== undefined, true, "stub window must carry __HERMES_PLUGINS__");
    assert.notEqual(win.__HERMES_PLUGIN_SDK__, undefined, "stub window must carry the fake SDK");
    assert.equal(
      typeof (win.__HERMES_PLUGINS__ as { register: unknown }).register,
      "function",
      "__HERMES_PLUGINS__.register must be a function",
    );
    return 42;
  });
  assert.equal(result, 42);
  assert.equal((globalThis as { window?: unknown }).window, priorWindow);
  assert.equal("window" in globalThis, hadWindow);
});

test("every exported name list matches the closed-set counts", () => {
  assert.equal(SDK_MEMBER_NAMES.length, 11);
  assert.equal(SDK_HOOK_NAMES.length, 9);
  assert.equal(SDK_COMPONENT_NAMES.length, 25);
  assert.equal(SDK_UTILS_NAMES.length, 3);
  assert.match(SDK_NON_MEMBER_PREFIX, /^not a member of __HERMES_PLUGIN_SDK__: $/);
});
