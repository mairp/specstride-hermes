/**
 * The argv recorder shared by the Hermes host's stubs (tests/stubs): every
 * stub appends one JSON line `{probe, argv, cwd}` to `$STUB_LOG`, so a test asserts
 * the exact argv a host component sent (F150-FR-005, F150-FR-010, F150-FR-029).
 * It also answers from `$STUB_SCRIPT`, a JSON file mapping an argv prefix →
 * `{stdout, stderr, exit, delayMs}`: the longest matching prefix wins, an
 * exact match always does; `delayMs` delays the answer (T003 of feature 151).
 * The stub Specstride CLI marks the shim's `--protocol` probe with
 * `probe: true` (F151-FR-051), so a test counts verbs without counting the
 * probe; `stdin` is carried on the line when the stub captures it, and a call
 * the stub refuses is logged with `refused: true` (T004 of feature 151).
 */
import { appendFileSync, readFileSync } from "node:fs";

export function recordAndScript(options = {}) {
  const { probe = false, stdin, refused = false } = options;
  const argv = process.argv.slice(2);
  try {
    if (process.env.STUB_LOG) {
      const line = { probe, argv, cwd: process.cwd() };
      if (stdin !== undefined) line.stdin = stdin;
      if (refused) line.refused = true;
      appendFileSync(process.env.STUB_LOG, JSON.stringify(line) + "\n");
    }
  } catch {
    // A stub never fails because its log is unwritable.
  }
  let script = {};
  try {
    // The stub hermes reads its own script file (`$STUB_HERMES_SCRIPT`,
    // T004 of feature 151); `$STUB_SCRIPT` overrides it where both are set.
    if (process.env.STUB_HERMES_SCRIPT) {
      script = JSON.parse(readFileSync(process.env.STUB_HERMES_SCRIPT, "utf8"));
    }
    if (process.env.STUB_SCRIPT) {
      script = { ...script, ...JSON.parse(readFileSync(process.env.STUB_SCRIPT, "utf8")) };
    }
  } catch {
    script = {};
  }
  const key = argv.join(" ");
  const answer = Object.hasOwn(script, key)
    ? script[key]
    : (() => {
        let best = null;
        for (const prefix of Object.keys(script)) {
          if (key === prefix || key.startsWith(prefix + " ")) {
            if (best === null || prefix.length > best.length) best = prefix;
          }
        }
        return best === null ? undefined : script[best];
      })();
  return { argv, answer };
}

export function emit(answer) {
  if (answer === undefined || answer === null) return false;
  if (answer.stdout) process.stdout.write(answer.stdout + "\n");
  if (answer.stderr) process.stderr.write(answer.stderr + "\n");
  process.exit(answer.exit ?? 0);
}
