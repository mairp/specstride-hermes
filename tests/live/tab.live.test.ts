/**
 * The live dashboard-tab lane (T078; PT-151-050, PT-151-022, PT-151-023;
 * settles U-151-12). Against the REAL Hermes 0.22.2 dashboard in a temporary
 * `HERMES_HOME`, with NO model configured and no credentials:
 *
 * - the host is installed `--with-kanban` into the temporary home;
 * - the real dashboard is started on a free 127.0.0.1 port with a session
 *   token (`HERMES_DASHBOARD_SESSION_TOKEN`, the seam the June-2026
 *   hardening keeps authoritative on loopback);
 * - with the token, the plugin list (`/api/dashboard/plugins`) names
 *   `specstride` and reports `tab.path: /specstride`;
 * - the tab bundle (`dist/index.js`) and the stylesheet (`dist/style.css`)
 *   are served with 200 and their expected content types;
 * - `GET /api/plugins/specstride/workspaces` answers JSON when authorized;
 * - the same request without the token answers 401;
 * - a route of a disabled plugin answers what U-151-12 records on Hermes
 *   0.22.2 — 404 JSON, never the SPA page — and the observed
 *   `<status> <content-type>` is written to
 *   `evals/probe-results/<date>-kanban-tab.txt`.
 *
 * The lane is `skipped` — never `passed` — when Hermes 0.22.2 is absent or
 * under the per-change runner (`npm test`; Principle XVII). It calls no
 * model. Short: one dashboard start, a handful of HTTP reads.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const PINNED_VERSION = "0.22.2";
const TOKEN = "specstride-tab-lane-token";

function hermesVersion(bin = "hermes"): { version: string; raw: string } | null {
  const run = spawnSync(bin, ["--version"], { encoding: "utf8", timeout: 30_000 });
  if (run.status !== 0 && (run.stdout ?? "") === "") return null;
  const raw = (run.stdout ?? "") + (run.stderr ?? "");
  const match = raw.match(/(\d+\.\d+\.\d+)/);
  return match === null ? null : { version: match[1], raw: raw.trim() };
}

const version = hermesVersion();
// T079: the per-change runner (`npm test`) includes this lane; it answers
// `skipped` there and is run for real only with `npm run test:live`.
const PER_CHANGE_SKIP =
  process.env.SPECSTRIDE_PER_CHANGE === "1"
    ? "per-change run (npm test): run this lane explicitly with npm run test:live"
    : undefined;
const SKIP_REASON =
  PER_CHANGE_SKIP ??
  (version === null
    ? "hermes is not on PATH"
    : version.version !== PINNED_VERSION
      ? `unpinned hermes version ${version.version} != ${PINNED_VERSION}`
      : undefined);

/** A free loopback port: the OS assigns one, the listener closes again. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as { port: number }).port;
      server.close(() => resolve(port));
    });
  });
}

interface Answer {
  readonly status: number;
  readonly contentType: string;
  readonly body: string;
}

async function get(url: string, token?: string): Promise<Answer> {
  const headers: Record<string, string> = {};
  if (token !== undefined) headers["X-Hermes-Session-Token"] = token;
  const response = await fetch(url, { headers });
  return {
    status: response.status,
    contentType: response.headers.get("content-type") ?? "",
    body: await response.text(),
  };
}

/** Read a JSON object, or null when the body does not parse. */
function jsonOf(answer: Answer): Record<string, unknown> | null {
  try {
    return JSON.parse(answer.body) as Record<string, unknown>;
  } catch {
    return null;
  }
}

test("live tab lane: the real dashboard serves the specstride tab and 401s without the token", { skip: SKIP_REASON, timeout: 300_000 }, async () => {
  assert.ok(version !== null && version.version === PINNED_VERSION);
  const context: string[] = [`hermes --version: ${version.raw}`];
  const home = mkdtempSync(join(tmpdir(), "specstride-tab-"));
  const env = {
    ...process.env,
    HERMES_HOME: home,
    HERMES_DASHBOARD_SESSION_TOKEN: TOKEN,
    PATH: `${join(ROOT, "bin")}:${process.env.PATH ?? ""}`,
  };

  // Install with the Kanban part, into the temporary home. No model is
  // configured anywhere in this lane.
  const install = spawnSync(
    process.execPath,
    [join(ROOT, "bin", "specstride-host-hermes.mjs"), "install", "--user", "--with-kanban"],
    { encoding: "utf8", timeout: 120_000, env },
  );
  assert.equal(install.status, 0, `install --with-kanban failed: ${install.stderr}`);
  context.push(`install: ok (--user --with-kanban)`);
  // User plugins need the allow-list entry (plugins_cmd.py).
  const enable = spawnSync("hermes", ["plugins", "enable", "specstride"], { encoding: "utf8", timeout: 60_000, env, cwd: home });
  context.push(`plugins enable: exit ${enable.status}`);

  const port = await freePort();
  const dashboard = spawn("hermes", ["dashboard", "--host", "127.0.0.1", "--port", String(port), "--no-open"], {
    env,
    cwd: home,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let dashboardLog = "";
  dashboard.stdout?.on("data", (chunk: Buffer) => (dashboardLog += chunk.toString()));
  dashboard.stderr?.on("data", (chunk: Buffer) => (dashboardLog += chunk.toString()));

  try {
    // Wait for the dashboard to answer, with the token.
    const base = `http://127.0.0.1:${port}`;
    let list: Answer | null = null;
    const deadline = Date.now() + 180_000;
    while (Date.now() < deadline) {
      if (dashboard.exitCode !== null) throw new Error(`dashboard exited early (${dashboard.exitCode}): ${dashboardLog}`);
      try {
        const answer = await get(`${base}/api/dashboard/plugins`, TOKEN);
        if (answer.status === 200) {
          list = answer;
          break;
        }
      } catch {
        // Not listening yet.
      }
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
    assert.ok(list !== null, `the dashboard never answered on ${base}: ${dashboardLog}`);

    // The plugin list names specstride and reports tab.path /specstride.
    const rows = (JSON.parse(list.body) as Array<Record<string, unknown>>);
    const specstride = rows.find((row) => row["name"] === "specstride");
    assert.ok(specstride !== undefined, `the plugin list holds no specstride entry: ${list.body.slice(0, 400)}`);
    const tab = specstride["tab"] as { path?: string } | undefined;
    assert.equal(tab?.path, "/specstride", `tab.path is ${JSON.stringify(tab)}`);

    // The bundle and the stylesheet are served, with their content types.
    const entry = String(specstride["entry"] ?? "dist/index.js");
    const css = String(specstride["css"] ?? "dist/style.css");
    const bundle = await get(`${base}/dashboard-plugins/specstride/${entry}`);
    assert.equal(bundle.status, 200, `bundle: ${bundle.status}`);
    assert.match(bundle.contentType, /javascript/i);
    const stylesheet = await get(`${base}/dashboard-plugins/specstride/${css}`);
    assert.equal(stylesheet.status, 200, `stylesheet: ${stylesheet.status}`);
    assert.match(stylesheet.contentType, /text\/css/i);

    // Authorized: the workspaces route answers JSON.
    const authorized = await get(`${base}/api/plugins/specstride/workspaces`, TOKEN);
    context.push(`workspaces (with token): ${authorized.status} ${authorized.contentType}`);
    assert.match(authorized.contentType, /application\/json/i, `workspaces content type: ${authorized.contentType}`);
    assert.ok(jsonOf(authorized) !== null, `workspaces body is not JSON: ${authorized.body.slice(0, 200)}`);

    // The same request without the token: 401 first (HF-DASH-API-404).
    const anonymous = await get(`${base}/api/plugins/specstride/workspaces`);
    context.push(`workspaces (no token): ${anonymous.status}`);
    assert.equal(anonymous.status, 401, `unauthenticated workspaces answered ${anonymous.status}`);

    // U-151-12: a route of a disabled plugin answers what the host fact
    // records on 0.22.2 — 404 JSON, never the SPA page. Disable the plugin
    // (which also removes it from the tab list), then ask the route again.
    const disable = spawnSync("hermes", ["plugins", "disable", "specstride"], { encoding: "utf8", timeout: 60_000, env, cwd: home });
    context.push(`plugins disable: exit ${disable.status}`);
    const rescan = await get(`${base}/api/dashboard/plugins/rescan`, TOKEN);
    context.push(`rescan: ${rescan.status}`);
    const disabledRoute = await get(`${base}/api/plugins/specstride/workspaces`, TOKEN);
    context.push(`disabled route: ${disabledRoute.status} ${disabledRoute.contentType}`);
    assert.notEqual(disabledRoute.status, 200, "a disabled plugin's route must not answer 200");
    assert.match(disabledRoute.contentType, /application\/json/i, `disabled route content type: ${disabledRoute.contentType}`);
    const disabledBody = jsonOf(disabledRoute);
    assert.ok(disabledBody !== null && disabledBody["detail"] !== undefined, `disabled route body: ${disabledRoute.body.slice(0, 200)}`);

    // Record what U-151-12 observed: "<status> <content-type>".
    mkdirSync(join(ROOT, "evals", "probe-results"), { recursive: true });
    const reportPath = join(ROOT, "evals", "probe-results", `${new Date().toISOString().slice(0, 10)}-kanban-tab.txt`);
    const lines = [
      `date: ${new Date().toISOString()}`,
      `hermes: ${version.raw}`,
      ...context,
      `U-151-12 disabled-plugin route: ${disabledRoute.status} ${disabledRoute.contentType}`,
      "",
    ];
    writeFileSync(reportPath, lines.join("\n"));
  } finally {
    dashboard.kill("SIGTERM");
    // Give the process a moment, then force it.
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    if (dashboard.exitCode === null) dashboard.kill("SIGKILL");
    rmSync(home, { recursive: true, force: true });
  }
});

test("the live tab lane is skipped without Hermes 0.22.2 (never passed)", () => {
  if (process.env.SPECSTRIDE_PER_CHANGE === "1") return; // skipped by the runner's own seam
  if (version !== null && version.version === PINNED_VERSION) return;
  assert.ok(SKIP_REASON !== undefined, "an absent Hermes must give a skip reason");
});
