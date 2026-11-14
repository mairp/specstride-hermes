/**
 * Test helper: an inert fake of the Hermes plugin SDK (`window.__HERMES_PLUGIN_SDK__`).
 *
 * The fake is a Proxy over EXACTLY the closed-set member names, so reading any
 * name outside the closed set — at the top level or inside `hooks` /
 * `components` / `utils` — throws immediately. Used by tests/tab to prove the
 * built bundle reads no SDK member beyond the closed set (T055).
 */

/** Top-level SDK members (src/kanban/generated/closed-sets.ts `closedSetSdkMembers`). */
export const SDK_MEMBER_NAMES: readonly string[] = [
  "sdkVersion",
  "React",
  "hooks",
  "api",
  "fetchJSON",
  "authedFetch",
  "buildWsUrl",
  "buildWsAuthParam",
  "components",
  "utils",
  "useI18n",
];

/** Members inside `sdk.hooks` (Hermes web/src/plugins/registry.ts). */
export const SDK_HOOK_NAMES: readonly string[] = [
  "useState",
  "useEffect",
  "useCallback",
  "useMemo",
  "useRef",
  "useContext",
  "createContext",
  "useToast",
  "useConfirmDelete",
];

/** Members inside `sdk.components`. */
export const SDK_COMPONENT_NAMES: readonly string[] = [
  "Card",
  "CardHeader",
  "CardTitle",
  "CardContent",
  "Badge",
  "Button",
  "Checkbox",
  "ConfirmDialog",
  "Dialog",
  "DialogClose",
  "DialogContent",
  "DialogDescription",
  "DialogFooter",
  "DialogHeader",
  "DialogTitle",
  "Input",
  "Label",
  "Select",
  "SelectOption",
  "Separator",
  "Tabs",
  "TabsList",
  "TabsTrigger",
  "Toast",
  "PluginSlot",
];

/** Members inside `sdk.utils`. */
export const SDK_UTILS_NAMES: readonly string[] = ["cn", "timeAgo", "isoTimeAgo"];

/** Exact rejection message shape for any non-member read. */
export const SDK_NON_MEMBER_PREFIX = "not a member of __HERMES_PLUGIN_SDK__: ";

function inertValue(name: string): unknown {
  // Plain function markers; deterministic and inert (no React, no behaviour).
  return function sdkFakeMember() {
    return name;
  };
}

function makeClosedProxy(names: readonly string[], label: string): unknown {
  const allowed = new Set<string>(names);
  return new Proxy({}, {
    get(_target, prop) {
      const key = String(prop);
      if (!allowed.has(key)) {
        throw new Error(`${SDK_NON_MEMBER_PREFIX}${label ? label + "." : ""}${key}`);
      }
      return inertValue(key);
    },
    has(_target, prop) {
      return allowed.has(String(prop));
    },
    ownKeys() {
      return [...names];
    },
    getOwnPropertyDescriptor(_target, prop) {
      const key = String(prop);
      if (!allowed.has(key)) return undefined;
      return { configurable: true, enumerable: true, value: inertValue(key) };
    },
  });
}

/** Build the fake SDK object: a Proxy over exactly `closedSetSdkMembers`. */
export function createSdkFake(): Record<string, unknown> {
  const nested = new Map<string, unknown>([
    ["hooks", makeClosedProxy(SDK_HOOK_NAMES, "hooks")],
    ["components", makeClosedProxy(SDK_COMPONENT_NAMES, "components")],
    ["utils", makeClosedProxy(SDK_UTILS_NAMES, "utils")],
  ]);
  const allowed = new Set<string>(SDK_MEMBER_NAMES);
  const target: Record<string, unknown> = { sdkVersion: "0" };
  return new Proxy(target, {
    get(tgt, prop) {
      const key = String(prop);
      if (key === "sdkVersion") return tgt.sdkVersion;
      if (!allowed.has(key)) {
        throw new Error(`${SDK_NON_MEMBER_PREFIX}${key}`);
      }
      if (nested.has(key)) return nested.get(key);
      return inertValue(key);
    },
    has(_tgt, prop) {
      return allowed.has(String(prop));
    },
    ownKeys() {
      return [...SDK_MEMBER_NAMES];
    },
    getOwnPropertyDescriptor(_tgt, prop) {
      const key = String(prop);
      if (!allowed.has(key)) return undefined;
      return { configurable: true, enumerable: true, value: inertValue(key) };
    },
  });
}

export interface PluginRegistration {
  name: string;
  fn: unknown;
}

/** Recorded `window.__HERMES_PLUGINS__.register` calls. */
export interface FakePlugins {
  register(name: string, fn: unknown): void;
  calls: PluginRegistration[];
}

/** Build the recording `__HERMES_PLUGINS__` registry. */
export function createPluginsFake(): FakePlugins {
  const calls: PluginRegistration[] = [];
  return {
    calls,
    register(name: string, fn: unknown) {
      calls.push({ name, fn });
    },
  };
}

/**
 * Run `fn` with `globalThis.window` stubbed to carry the fake SDK and a
 * recording `__HERMES_PLUGINS__`. Restores/prior window afterwards.
 */
export function withFakeWindow<T>(
  fn: (window: Record<string, unknown>) => Promise<T> | T,
): Promise<T> | T {
  const prior = (globalThis as { window?: unknown }).window;
  const stub: Record<string, unknown> = {};
  stub.__HERMES_PLUGIN_SDK__ = createSdkFake();
  const plugins = createPluginsFake();
  stub.__HERMES_PLUGINS__ = plugins;
  (globalThis as { window?: unknown }).window = stub;
  try {
    return fn(stub);
  } finally {
    if (prior === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window?: unknown }).window = prior;
    }
  }
}
