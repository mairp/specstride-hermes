/**
 * The live Hermes lane of the probe (T066, PT-150-049, research R11): it
 * runs only where `hermes --version` prints 0.22.2 (HF-VERSION-FMT), and is
 * reported `skipped` otherwise (Principle XVII). It needs no credential and
 * makes no model call: it installs the built tree into a temporary
 * `HERMES_HOME` and drives the model-free Hermes commands that settle the
 * host-facts rows U-150-01, U-150-03 and U-150-12 — `skills list`
 * (HF-SKILLS-LIST), `plugins validate` (HF-PLUGINS-VALIDATE),
 * `plugins list --json` (HF-PLUGINS-LIST), `plugins disable`
 * (HF-PLUGINS-DISABLE) and `config get` with the `config.yaml` mtime
 * unchanged (HF-CONFIG-GET).
 *
 * The results are written to `evals/probe-results/<date>-hermes-lane.txt`; a
 * PERSON bumps the matching host-facts rows' `verifiedOn` from that file.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const PINNED_VERSION = "0.22.2";

/** The parsed `hermes --version`, or null when Hermes is absent. */
function hermesVersion(bin = "hermes"): { version: string; raw: string } | null {
  const run = spawnSync(bin, ["--version"], { encoding: "utf8", timeout: 30_000 });
  if (run.status !== 0 && run.stdout === "") return null;
  const raw = (run.stdout ?? "") + (run.stderr ?? "");
  const match = raw.match(/(\d+\.\d+\.\d+)/);
  return match === null ? null : { version: match[1], raw: raw.trim() };
}

const version = hermesVersion();

/**
 * The runner-level skip reason: the lane is declared `skipped` to node:test
 * unless `hermes --version` prints exactly the pinned 0.22.2 (HF-VERSION-FMT).
 * No install, no Hermes command and no probe file happen in the skipped case —
 * the test body never runs.
 */
const SKIP_REASON =
  version === null
    ? "hermes is not on PATH"
    : version.version !== PINNED_VERSION
      ? `unpinned hermes version ${version.version} != ${PINNED_VERSION}`
      : undefined;

/** Run one Hermes command with the temporary home, capturing everything. */
function hermes(home: string, argv: readonly string[], timeoutMs = 120_000) {
  return spawnSync("hermes", argv, {
    encoding: "utf8",
    timeout: timeoutMs,
    env: { ...process.env, HERMES_HOME: home },
  });
}

test("live hermes lane", { skip: SKIP_REASON }, (t) => {
  assert.ok(version !== null && version.version === PINNED_VERSION);
  const context = { steps: [] as string[] };
  context.steps.push(`hermes --version (HF-VERSION-FMT): ${version.raw}`);

    // The temporary home and the install of the built tree.
    const home = mkdtempSync(join(tmpdir(), "specstride-live-home-"));
    const profile = "specstride-probe";
    let failed = false;
    try {
      const install = spawnSync(
        process.execPath,
        [join(ROOT, "bin", "specstride-host-hermes.mjs"), "install", "--user"],
        { encoding: "utf8", timeout: 120_000, env: { ...process.env, HERMES_HOME: home } },
      );
      context.steps.push(
        `install --user: exit ${install.status}\n${(install.stdout ?? "") + (install.stderr ?? "")}`.trim(),
      );
      if (install.status !== 0) failed = true;

      // U-150-01 / HF-SKILLS-LIST: does the loader accept the render?
      const skills = hermes(home, ["skills", "list"]);
      const skillsOut = (skills.stdout ?? "") + (skills.stderr ?? "");
      const accepted =
        skills.status === 0 && skillsOut.includes("specstride-run");
      context.steps.push(
        `hermes skills list (HF-SKILLS-LIST, U-150-01): exit ${skills.status}, render accepted=${accepted}\n${skillsOut}`.trim(),
      );

      // U-150-12: the model-free catalog gate of the plugin.
      const validate = spawnSync("hermes", ["plugins", "validate", "hermes-plugin/specstride"], {
        encoding: "utf8",
        timeout: 120_000,
        cwd: ROOT,
        env: { ...process.env, HERMES_HOME: home },
      });
      context.steps.push(
        `hermes plugins validate hermes-plugin/specstride (U-150-12): exit ${validate.status}\n${(validate.stdout ?? "") + (validate.stderr ?? "")}`.trim(),
      );

      // HF-PLUGINS-LIST / HF-PLUGINS-DISABLE in the temporary profile. A
      // profile must exist first (`hermes profile create`, recorded as the
      // settling step of the profile commands).
      const create = hermes(home, ["profile", "create", profile]);
      context.steps.push(
        `hermes profile create ${profile}: exit ${create.status}\n${(create.stdout ?? "") + (create.stderr ?? "")}`.trim(),
      );
      const list = hermes(home, ["-p", profile, "plugins", "list", "--json"]);
      context.steps.push(
        `hermes -p ${profile} plugins list --json (HF-PLUGINS-LIST): exit ${list.status}\n${(list.stdout ?? "") + (list.stderr ?? "")}`.trim(),
      );
      const disable = hermes(home, ["-p", profile, "plugins", "disable", "specstride"]);
      context.steps.push(
        `hermes -p ${profile} plugins disable specstride (HF-PLUGINS-DISABLE): exit ${disable.status}\n${(disable.stdout ?? "") + (disable.stderr ?? "")}`.trim(),
      );

      // HF-CONFIG-GET: `config get` writes nothing (the mtimes are
      // unchanged), for the home config and the profile's config.
      const configFiles = [join(home, "config.yaml"), join(home, "profiles", profile, "config.yaml")];
      const before = configFiles.map((f) => (existsSync(f) ? statSync(f).mtimeMs : -1));
      const configGet = hermes(home, ["-p", profile, "config", "get", "approvals.mode"]);
      const after = configFiles.map((f) => (existsSync(f) ? statSync(f).mtimeMs : -1));
      const wroteNothing = before.every((b, i) => b === after[i]);
      context.steps.push(
        `hermes -p ${profile} config get approvals.mode (HF-CONFIG-GET): exit ${configGet.status}, wroteNothing=${wroteNothing}, output=${((configGet.stdout ?? "") + (configGet.stderr ?? "")).trim()}`,
      );
    } finally {
      writeProbeResult(context, version.raw);
      rmSync(home, { recursive: true, force: true });
    }
    assert.equal(failed, false, "the install into the temporary home failed");
  // The lane records; a person bumps the host-facts rows from its results.
  assert.ok(context.steps.length >= 1);
  t.diagnostic(context.steps.join("\n"));
});

/** Write the probe result of this run to evals/probe-results/. */
function writeProbeResult(context: { steps: readonly string[] }, rawVersion: string) {
  const directory = join(ROOT, "evals", "probe-results");
  mkdirSync(directory, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  const header = `hermes lane — ${date} — hermes ${rawVersion} — ran\n`;
  const body = context.steps.map((s) => `- ${s}`).join("\n") + "\n";
  const file = join(directory, `${date}-hermes-lane.txt`);
  writeFileSync(file, header + body);
  // A person reads this file and bumps the matching host-facts rows.
  assert.ok(existsSync(file));
  assert.ok(readFileSync(file, "utf8").startsWith(header.slice(0, 20)));
}
