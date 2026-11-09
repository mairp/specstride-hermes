/**
 * The argv recorder shared by the Hermes host's stubs (tests/stubs): every
 * stub appends one JSON line `{argv, cwd}` to `$STUB_LOG`, so a test asserts
 * the exact argv a host component sent (F150-FR-005, F150-FR-010, F150-FR-029).
 * It also answers from `$STUB_SCRIPT`, a JSON file mapping an argv prefix →
 * `{stdout, stderr, exit}`: the longest matching prefix wins, an exact match
 * always does.
 */
import { appendFileSync, readFileSync } from "node:fs";

export function recordAndScript() {
  const argv = process.argv.slice(2);
  try {
    if (process.env.STUB_LOG) {
      appendFileSync(process.env.STUB_LOG, JSON.stringify({ argv, cwd: process.cwd() }) + "\n");
    }
  } catch {
    // A stub never fails because its log is unwritable.
  }
  let script = {};
  try {
    if (process.env.STUB_SCRIPT) {
      script = JSON.parse(readFileSync(process.env.STUB_SCRIPT, "utf8"));
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
