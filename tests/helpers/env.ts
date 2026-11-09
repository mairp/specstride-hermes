/**
 * The fixture environment of the Hermes host's tests (T009): every test that
 * touches the filesystem runs against a temporary `HERMES_HOME`, a temporary
 * `XDG_STATE_HOME` and a temporary project root, with both stub binaries
 * first on PATH (F150-FR-021: "Tests MUST run only against a temporary
 * HERMES_HOME and project root").
 */
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const STUBS = join(ROOT, "tests", "stubs");

/**
 * Make a temporary fixture environment: `HERMES_HOME`, `XDG_STATE_HOME`,
 * a project root (with a `specs/` directory), and a log file for the stubs.
 * The returned `cleanup()` removes everything it made.
 * @returns {{home: string, stateHome: string, project: string, stubLog: string, cleanup: () => void}}
 */
export function tempHome() {
  const base = mkdtempSync(join(tmpdir(), "specstride-hermes-"));
  const home = join(base, "hermes-home");
  const stateHome = join(base, "state");
  const project = join(base, "project");
  const stubLog = join(base, "stub-log.jsonl");
  mkdirSync(home, { recursive: true });
  mkdirSync(stateHome, { recursive: true });
  mkdirSync(join(project, "specs"), { recursive: true });
  return {
    home,
    stateHome,
    project,
    stubLog,
    cleanup() {
      rmSync(base, { recursive: true, force: true });
    },
  };
}

/**
 * Run `fn` with both stubs first on PATH and `SPECSTRIDE_BIN`, `STUB_LOG`,
 * `HERMES_HOME` and `XDG_STATE_HOME` set to the fixture's paths.
 * @template T
 * @param {ReturnType<tempHome>} fx
 * @param {(fx: ReturnType<tempHome>) => T | Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function withStubs(fx, fn) {
  chmodSync(join(STUBS, "specstride"), 0o755);
  chmodSync(join(STUBS, "hermes"), 0o755);
  const env = {
    ...process.env,
    PATH: `${STUBS}:${process.env.PATH ?? ""}`,
    SPECSTRIDE_BIN: join(STUBS, "specstride"),
    STUB_LOG: fx.stubLog,
    HERMES_HOME: fx.home,
    XDG_STATE_HOME: fx.stateHome,
  };
  const previous = { ...process.env };
  Object.assign(process.env, env);
  try {
    return await fn(fx);
  } finally {
    for (const key of Object.keys(process.env)) {
      if (!(key in previous)) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

/** The JSON lines the stubs recorded, one `{argv, cwd}` per call. */
export function stubCalls(stubLog) {
  try {
    const text = readFileSync(stubLog, "utf8").trim();
    const lines = text === "" ? [] : text.split("\n");
    return JSON.parse("[" + lines.join(",") + "]");
  } catch {
    return [];
  }
}
