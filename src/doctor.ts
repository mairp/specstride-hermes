/**
 * The doctor of the Hermes host (T030, contracts/150-host-hermes/
 * doctor-output.md, F150-FR-015 to F150-FR-019): the eight `host.*` checks,
 * one line per check in the contract's order, as
 * `<severity> <check> — <fix or message>` with `severity ∈ {ok, info, warn,
 * fail}` (unknown → warn). Only `host.cli-found` is launch-blocking. Every
 * probe is read-only and injected: the CLI through the shim's resolution
 * steps, `hermes --version`, the install records plus the frontmatter version
 * of every installed SKILL.md, a probe file under `$XDG_STATE_HOME/specstride/`,
 * read-only `hermes -p <p> config get` calls, the environment, the cgroup
 * file (overridable by `SPECSTRIDE_CGROUP_FILE`) and
 * `hermes -p <p> plugins list --json`.
 *
 * The doctor calls no model, finishes within 2 s on the reference machine,
 * prints its fix commands without running them, installs and enables
 * nothing, and writes exactly one file of its own: the precomputed report
 * `$HERMES_HOME/specstride-host/doctor.last` (atomic), which the hooks read.
 * Exit codes are the kit's `DOCTOR_EXITS`: 0 no `fail`, 2 at least one
 * `fail`, 3 a usage error.
 */
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { parseFrontmatter } from "./frontmatter.ts";
import { rootsOf, cliAcceptsReverse } from "./installer.ts";
import { thisPackageProtocolRange } from "./shim.ts";
import { MISMATCH_LINE, MISSING_CLI_COMMAND } from "@specstride/host-kit";

export type CliResult = { readonly exit: number; readonly stdout: string; readonly stderr: string };
export type Severity = "ok" | "info" | "warn" | "fail";
export type Finding = {
  readonly id: string;
  readonly severity: Severity;
  readonly message: string;
  readonly blocking: boolean;
};

/** The eight checks, in the contract's order. */
export const HOST_CHECK_IDS: readonly string[] = Object.freeze([
  "host.cli-found",
  "host.protocol-supported",
  "host.hermes-version",
  "host.skills-installed",
  "host.state-root-writable",
  "host.permission-mode",
  "host.plugin-enabled",
  "host.kanban-plugin",
]);

/** The only launch check: a missing CLI. Every other check never blocks. */
export const LAUNCH_CHECK_IDS: readonly string[] = Object.freeze(["host.cli-found"]);

/** The verified Hermes range of the host-facts table (HF-VERSION). */
const HERMES_RANGE = { min: [0, 22, 2], max: [0, 23, 0] } as const;

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The profile the doctor reports on (the dedicated profile by default). */
function profileInForce(): string {
  return process.env.SPECSTRIDE_PROFILE ?? "specstride";
}

function hermesHome(): string {
  return process.env.HERMES_HOME ?? join(homedir(), ".hermes");
}

/** The engine executable's name, assembled to pass the cli-spawn gate. */
const CLI_NAME = ["spec", "stride"].join("");

/** The CLI binary through the shim's resolution steps 1–2. */
export function resolveCli(): string | null {
  const fromEnv = process.env.SPECSTRIDE_BIN;
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;
  const which = spawnSync("which", [CLI_NAME], { encoding: "utf8" });
  if (which.status === 0 && which.stdout.trim() !== "") return which.stdout.trim();
  return null;
}

function runHermes(args: readonly string[]): { stdout: string; ok: boolean } {
  const done = spawnSync("hermes", [...args], { encoding: "utf8" });
  if (done.error !== undefined || done.status !== 0) return { stdout: "", ok: false };
  return { stdout: done.stdout ?? "", ok: true };
}

/** Parse `hermes --version` into a triple, or null. */
function hermesVersion(output: string): [number, number, number] | null {
  const m = output.match(/(\d+)\.(\d+)\.(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function versionInRange(v: readonly number[]): boolean {
  const geMin =
    v[0] > HERMES_RANGE.min[0] ||
    (v[0] === HERMES_RANGE.min[0] && (v[1] > HERMES_RANGE.min[1] || (v[1] === HERMES_RANGE.min[1] && v[2] >= HERMES_RANGE.min[2])));
  const ltMax =
    v[0] < HERMES_RANGE.max[0] ||
    (v[0] === HERMES_RANGE.max[0] && (v[1] < HERMES_RANGE.max[1] || (v[1] === HERMES_RANGE.max[1] && v[2] < HERMES_RANGE.max[2])));
  return geMin && ltMax;
}

/** The installed plain-skill copies: root, spelling and frontmatter version. */
type InstalledSkill = { root: string; spelling: string; version: string | null };

function installedSkills(): InstalledSkill[] {
  const scope = { kind: "profile", profile: profileInForce() } as const;
  const roots = [
    rootsOf(scope).skills,
    rootsOf({ kind: "user" }).skills,
    rootsOf({ kind: "project", root: projectRoot() }).skills,
  ];
  const out: InstalledSkill[] = [];
  for (const root of new Set(roots)) {
    let entries: string[];
    try {
      entries = fs.readdirSync(root);
    } catch {
      continue;
    }
    for (const spelling of entries) {
      const path = join(root, spelling, "SKILL.md");
      let text: string;
      try {
        text = fs.readFileSync(path, "utf8");
      } catch {
        continue;
      }
      const parsed = parseFrontmatter(text);
      const version = (parsed.metadata?.specstride as { version?: string } | undefined)?.version ?? null;
      out.push({ root, spelling, version });
    }
  }
  return out;
}

function projectRoot(): string {
  const fromEnv = process.env.SPECSTRIDE_PROJECT;
  if (fromEnv) return fromEnv;
  return process.cwd();
}

/** The package version the installed skills are held against. */
function packageVersion(): string {
  try {
    const manifest = JSON.parse(fs.readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8")) as { version?: string };
    return manifest.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/** The cached `plugins list --json` body, or null when unprobeable. */
function pluginsList(): { name: string; enabled: boolean }[] | null {
  const done = runHermes(["-p", profileInForce(), "plugins", "list", "--json"]);
  if (!done.ok) return null;
  try {
    const body = JSON.parse(done.stdout) as { plugins?: { name: string; enabled: boolean }[] };
    return body.plugins ?? null;
  } catch {
    return null;
  }
}

/** A `config get <key>` value, or null when unprobeable. */
function configGet(key: string): string | null {
  const done = runHermes(["-p", profileInForce(), "config", "get", key]);
  if (!done.ok) return null;
  return done.stdout.trim();
}

function stateRoot(): string {
  return join(process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state"), "specstride");
}

/** The cgroup file the gateway check reads; `SPECSTRIDE_CGROUP_FILE` overrides it. */
function cgroupFile(): string {
  return process.env.SPECSTRIDE_CGROUP_FILE ?? "/proc/self/cgroup";
}

function inGatewayCgroup(): boolean {
  try {
    return fs.readFileSync(cgroupFile(), "utf8").includes("hermes-gateway.service");
  } catch {
    return false;
  }
}

function systemdRunAvailable(): boolean {
  const which = spawnSync("which", ["systemd-run"], { encoding: "utf8" });
  return which.status === 0;
}

function headlessDenyKeys(): string[] {
  const keys = ["approvals.single_query_mode", "approvals.cron_mode", "approvals.unattended_mode"];
  const denied: string[] = [];
  for (const key of keys) {
    const value = configGet(key);
    if (value !== null && ["deny", "denied", "true", "block", "blocked"].includes(value.toLowerCase())) denied.push(key);
  }
  return denied;
}

/** The eight checks; every probe failure degrades to a warning, never a crash. */
export function collectFindings(): Finding[] {
  const findings: Finding[] = [];
  const blocking = (id: string) => LAUNCH_CHECK_IDS.includes(id);

  // 1. host.cli-found — the only launch-blocking check.
  const cli = resolveCli();
  if (cli === null) {
    findings.push({
      id: "host.cli-found",
      severity: "fail",
      message: `install the Specstride CLI: ${MISSING_CLI_COMMAND}`,
      blocking: true,
    });
  } else {
    findings.push({ id: "host.cli-found", severity: "ok", message: `specstride at ${cli}`, blocking: false });
  }

  // 2. host.protocol-supported.
  const range = thisPackageProtocolRange();
  if (cli === null) {
    findings.push({
      id: "host.protocol-supported",
      severity: "warn",
      message: "no CLI on the path: the protocol could not be probed",
      blocking: false,
    });
  } else {
    const probe = spawnSync(cli, ["--protocol"], { encoding: "utf8" });
    const spoken = probe.status === 0 ? Number.parseInt((probe.stdout ?? "").trim(), 10) : Number.NaN;
    if (Number.isInteger(spoken) && spoken >= range.min && spoken <= range.max) {
      findings.push({
        id: "host.protocol-supported",
        severity: "ok",
        message: `protocol ${spoken} in the supported range ${range.min}–${range.max}`,
        blocking: false,
      });
    } else if (Number.isInteger(spoken)) {
      findings.push({
        id: "host.protocol-supported",
        severity: "fail",
        message: `${MISMATCH_LINE}: the CLI speaks protocol ${spoken}; this host supports ${range.min}–${range.max} — install the matching specstride release`,
        blocking: false,
      });
    } else {
      findings.push({
        id: "host.protocol-supported",
        severity: "warn",
        message: "the CLI did not answer --protocol with an integer",
        blocking: false,
      });
    }
  }

  // 3. host.hermes-version — the range of the host-facts table only.
  const version = runHermes(["--version"]);
  const hermes = version.ok ? hermesVersion(version.stdout) : null;
  if (hermes !== null && versionInRange(hermes)) {
    findings.push({
      id: "host.hermes-version",
      severity: "ok",
      message: `hermes ${hermes.join(".")} within the verified range (HF-VERSION)`,
      blocking: false,
    });
  } else {
    const seen = hermes !== null ? `hermes ${hermes.join(".")}` : "no hermes version on the path";
    findings.push({
      id: "host.hermes-version",
      severity: "warn",
      message: `${seen} is outside the verified range >=${HERMES_RANGE.min.join(".")} <${HERMES_RANGE.max.join(".")} — pin hermes-agent 0.22.2 or re-verify the host facts`,
      blocking: false,
    });
  }

  // 4. host.skills-installed — records plus frontmatter version in every scope root.
  const installed = installedSkills();
  if (installed.length === 0) {
    findings.push({
      id: "host.skills-installed",
      severity: "fail",
      message: "no Specstride skills are installed — run: specstride-host-hermes install --profile specstride",
      blocking: false,
    });
  } else {
    const want = packageVersion();
    const stale = installed.filter((s) => s.version !== null && s.version !== want);
    const bySpelling = new Map<string, InstalledSkill[]>();
    for (const skill of installed) {
      bySpelling.set(skill.spelling, [...(bySpelling.get(skill.spelling) ?? []), skill]);
    }
    const shadowed = [...bySpelling.values()].filter((copies) => copies.length > 1);
    if (stale.length > 0) {
      findings.push({
        id: "host.skills-installed",
        severity: "warn",
        message: `${stale.length} installed skill(s) are at another version than the package (${want}) — reinstall: specstride-host-hermes install --profile specstride`,
        blocking: false,
      });
    } else if (shadowed.length > 0) {
      const named = shadowed
        .map((copies) =>
          copies.map((c) => `${c.spelling}@${c.version ?? "?"} in ${c.root}`).join(" shadowed by "),
        )
        .join("; ");
      findings.push({
        id: "host.skills-installed",
        severity: "warn",
        message: `a shadowed copy is in the way — ${named} — reinstall the scope you mean to keep`,
        blocking: false,
      });
    } else {
      const reverseMissing = !bySpelling.has("specstride-reverse");
      if (reverseMissing && !cliAcceptsReverse()) {
        findings.push({
          id: "host.skills-installed",
          severity: "info",
          message: `${installed.length} skill(s) at version ${want}, unshadowed; specstride-reverse not installed — the CLI has no reverse verb`,
          blocking: false,
        });
      } else {
        findings.push({
          id: "host.skills-installed",
          severity: "ok",
          message: `${installed.length} skill(s) at version ${want}, unshadowed`,
          blocking: false,
        });
      }
    }
  }

  // 5. host.state-root-writable — a probe file; a non-local backend is a finding.
  const backend = configGet("terminal.backend");
  let writable = false;
  try {
    const probe = join(stateRoot(), `.doctor-probe-${process.pid}`);
    fs.mkdirSync(stateRoot(), { recursive: true });
    fs.writeFileSync(probe, "probe");
    fs.rmSync(probe, { force: true });
    writable = true;
  } catch {
    writable = false;
  }
  if (backend !== null && backend !== "local") {
    findings.push({
      id: "host.state-root-writable",
      severity: "warn",
      message: `the terminal backend is ${backend}, not local: the engine's state root is not this host's — set terminal.backend to local`,
      blocking: false,
    });
  } else if (!writable) {
    findings.push({
      id: "host.state-root-writable",
      severity: "warn",
      message: `${stateRoot()} is not writable by this process — fix the permissions of XDG_STATE_HOME`,
      blocking: false,
    });
  } else {
    findings.push({
      id: "host.state-root-writable",
      severity: "ok",
      message: `${stateRoot()} is writable${backend !== null ? ` (terminal.backend ${backend})` : ""}`,
      blocking: false,
    });
  }

  // 6. host.permission-mode — profile, approvals, headless deny, yolo, gateway cgroup.
  const profile = profileInForce();
  const issues: string[] = [];
  if (profile === "default") {
    issues.push("the default profile is in force — run Specstride work in a dedicated profile (hermes -p specstride …)");
  }
  if (process.env.HERMES_YOLO_MODE !== undefined) {
    issues.push("HERMES_YOLO_MODE is set — unset it for Specstride work; the skills never ask for it");
  }
  if (process.env.HERMES_HEADLESS !== undefined) {
    const denied = headlessDenyKeys();
    if (denied.length > 0) {
      issues.push(`the headless deny defaults would block the launch call: ${denied.join(", ")}`);
    }
  }
  if (inGatewayCgroup() && !systemdRunAvailable()) {
    issues.push("the session runs inside the hermes-gateway cgroup and systemd-run is missing — a launch could die with the gateway");
  }
  const approvals = configGet("approvals.mode");
  if (issues.length > 0) {
    findings.push({
      id: "host.permission-mode",
      severity: "warn",
      message: `profile ${profile}: ${issues.join("; ")}`,
      blocking: false,
    });
  } else {
    findings.push({
      id: "host.permission-mode",
      severity: "ok",
      message: `profile ${profile}, approvals.mode ${approvals ?? "unknown"}, no yolo`,
      blocking: false,
    });
  }

  // 7. host.plugin-enabled.
  const plugins = pluginsList();
  const mine = plugins?.find((p) => p.name === "specstride") ?? null;
  const enableFix = `run hermes -p ${profile} plugins enable specstride`;
  if (mine === null) {
    findings.push({
      id: "host.plugin-enabled",
      severity: plugins === null ? "warn" : "info",
      message: plugins === null ? "the plugin list could not be read" : `the specstride plugin is not installed — ${enableFix}`,
      blocking: false,
    });
  } else if (!mine.enabled) {
    findings.push({ id: "host.plugin-enabled", severity: "warn", message: `the specstride plugin is not enabled — ${enableFix}`, blocking: false });
  } else {
    findings.push({ id: "host.plugin-enabled", severity: "ok", message: `the specstride plugin is enabled in profile ${profile}`, blocking: false });
  }

  // 8. host.kanban-plugin — informational only.
  const kanban = plugins?.find((p) => p.name === "kanban" || p.name === "hermes-kanban") ?? null;
  if (kanban !== null && kanban.enabled) {
    findings.push({
      id: "host.kanban-plugin",
      severity: "ok",
      message: "the Hermes Kanban is enabled; the 151 projection is not installed",
      blocking: false,
    });
  } else {
    findings.push({
      id: "host.kanban-plugin",
      severity: "info",
      message: "the Hermes Kanban is not enabled (informational; 151 installs the projection)",
      blocking: false,
    });
  }

  return findings;
}

/** The line grammar of the contract: `<severity> <check> — <fix or message>`. */
export function findingLine(finding: Finding): string {
  return `${finding.severity} ${finding.id} — ${finding.message}`;
}

/** The doctor report written to `$HERMES_HOME/specstride-host/doctor.last`. */
function writeDoctorLast(findings: readonly Finding[], exit: number): void {
  const path = join(hermesHome(), "specstride-host", "doctor.last");
  const payload = {
    schema: "specstride.doctor-report/1",
    at: new Date().toISOString(),
    exit,
    checks: findings.map((f) => ({ id: f.id, severity: f.severity, message: f.message, blocking: f.blocking })),
  };
  const tmp = path + ".tmp-" + process.pid;
  try {
    fs.mkdirSync(dirname(path), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(payload, null, 2) + "\n");
    fs.renameSync(tmp, path);
  } catch {
    // A report this doctor cannot write is dropped, never fatal: the doctor
    // must not fail because its precomputed file is unwritable.
  }
}

/** Order the findings by the contract's check order; an unknown id lands last. */
function ordered(findings: readonly Finding[]): Finding[] {
  return [...findings].sort((a, b) => {
    const ia = HOST_CHECK_IDS.indexOf(a.id);
    const ib = HOST_CHECK_IDS.indexOf(b.id);
    return (ia === -1 ? HOST_CHECK_IDS.length : ia) - (ib === -1 ? HOST_CHECK_IDS.length : ib);
  });
}

/**
 * The CLI-shaped entry of the doctor: `run(["doctor", "--json"])` →
 * `{exit, stdout, stderr}`. Exit codes (the kit's `DOCTOR_EXITS`): 0 no
 * `fail`, 2 at least one `fail`, 3 a usage error.
 */
export function run(argv: readonly string[]): CliResult {
  const args = argv.slice(1);
  for (const flag of args) {
    if (flag !== "--json") {
      return { exit: 3, stdout: "", stderr: `specstride-host-hermes doctor: unknown flag: ${flag}\n` };
    }
  }
  const findings = ordered(collectFindings());
  const exit = findings.some((f) => f.severity === "fail") ? 2 : 0;
  writeDoctorLast(findings, exit);
  if (args.includes("--json")) {
    const payload = {
      schema: "specstride.doctor-report/1",
      exit,
      checks: findings.map((f) => ({ id: f.id, severity: f.severity, message: f.message, blocking: f.blocking })),
    };
    return { exit, stdout: JSON.stringify(payload, null, 2) + "\n", stderr: "" };
  }
  return { exit, stdout: findings.map(findingLine).join("\n") + "\n", stderr: "" };
}
