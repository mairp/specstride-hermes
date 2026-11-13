/**
 * The reader harness (T018-T022): adapts the test FsPort and the fake
 * /proc port to the reader's FilePort/ProcPort and runs
 * `readWorkspaceView` over a committed fixture or an ad-hoc tree.
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FsPort, workspacePort, type FsPortOptions } from "./fs-port.ts";
import { createProcPort, type ProcFixture, type ProcPort as FakeProc } from "./proc-port.ts";
import type { FilePort, ProcPort } from "../../src/kanban/reader/ports.ts";
import { readWorkspaceView, type ReaderView } from "../../src/kanban/reader/index.ts";

/** The reader's FilePort over the test FsPort (guard included). */
export function filePortOf(port: FsPort): FilePort {
  return {
    list: (path) => port.readdir(path),
    read: (path) => port.readFile(path),
    exists: (path) => port.exists(path),
    size: (path) => port.stat(path).size,
    bytes: (path, limit) => port.bytes(path, limit),
  };
}

/** The reader's ProcPort over the fake /proc port. */
export function procPortOf(fake: FakeProc): ProcPort {
  return {
    stat: (pid) => {
      try {
        return fake.statLine(pid);
      } catch {
        return null;
      }
    },
    cmdline: (pid) => {
      try {
        return fake.cmdline(pid);
      } catch {
        return null;
      }
    },
    bootTimeMs: () => fake.btime * 1000,
  };
}

export interface HarnessOptions {
  /** Now, for staleness and silence (default `2026-11-11T09:00:10Z`). */
  now?: string;
  processes?: ProcFixture[];
  btime?: number;
  clkTck?: number;
}

export interface HarnessResult {
  view: ReaderView;
  fs: FsPort;
  proc: FakeProc;
  refusals: string[];
}

/** Run the reader over a committed fixture (`tests/fixtures/workspaces/<name>`). */
export function readFixture(name: string, options: HarnessOptions = {}): HarnessResult {
  const fake = createProcPort({ btime: options.btime ?? 1_700_000_000, clkTck: options.clkTck ?? 100, processes: options.processes ?? [] });
  const port = workspacePort(name);
  const view = readWorkspaceView(".", {
    fs: filePortOf(port),
    proc: procPortOf(fake),
    now: new Date(options.now ?? "2026-11-11T09:00:10Z"),
    home: ".",
  });
  return { view, fs: port, proc: fake, refusals: port.refusals };
}

/** Run the reader over an ad-hoc tree (written under a tmpdir). */
export function readTree(tree: Record<string, string>, options: HarnessOptions & { skip?: (path: string) => boolean } = {}): HarnessResult {
  const root = mkdtempSync(join(tmpdir(), "reader-us7-"));
  try {
    for (const [path, text] of Object.entries(tree)) {
      if (options.skip !== undefined && options.skip(path)) continue;
      const full = join(root, path);
      mkdirSync(join(full, ".."), { recursive: true });
      writeFileSync(full, text, "utf8");
    }
    const fake = createProcPort({ btime: options.btime ?? 1_700_000_000, clkTck: options.clkTck ?? 100, processes: options.processes ?? [] });
    const port = new FsPort({ root, home: root } as FsPortOptions);
    const view = readWorkspaceView(".", {
      fs: filePortOf(port),
      proc: procPortOf(fake),
      now: new Date(options.now ?? "2026-11-11T09:00:10Z"),
      home: ".",
    });
    return { view, fs: port, proc: fake, refusals: port.refusals };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
