/**
 * The fake `/proc` of the workspace reader tests (T006).
 *
 * A closed little kernel: per-fixture processes with their `stat` fields
 * (pid, comm, state, ppid, starttime in ticks), their `cmdline`, and the
 * boot time (btime) and clock ticks per second (clkTck) of the machine.
 * A test simulates zombies (`state: "Z"`), exits (`exitProcess` removes the
 * pid) and PID reuse (`reusePid` puts a new process behind an old pid with
 * a different `starttime`), and asserts on `reads()` which of the accessors
 * were called and with which pids.
 *
 * `statLine(pid)` produces the real kernel `stat` layout (comm in
 * parentheses, the fields space-separated, the fields after comm shifted by
 * one), so a reader can parse it exactly as it would parse `/proc`.
 */
export type ProcFixture = {
  pid: number;
  /** The process name, without parentheses (default `specstride`). */
  comm?: string;
  /** One process state character; `Z` is a zombie. */
  state?: string;
  ppid?: number;
  /** Process start time in clock ticks since boot. */
  starttime?: number;
  /** argv, already split; served by `cmdline(pid)`. */
  cmdline?: string[];
};

export type ProcPortOptions = {
  /** Seconds of the `btime` field of `/proc/stat`. */
  btime?: number;
  /** Clock ticks per second (the `CLK_TCK` of the record). */
  clkTck?: number;
  processes?: ProcFixture[];
};

export type ProcStatRecord = {
  pid: number;
  comm: string;
  state: string;
  ppid: number;
  /** Ticks since boot. */
  starttime: number;
  /** Seconds since boot, derived with clkTck. */
  ageSeconds: number;
};

export class NoSuchProcessError extends Error {
  constructor(pid: number) {
    super(`proc-port: no process ${pid}`);
    this.name = "NoSuchProcessError";
  }
}

export type ProcPort = {
  btime: number;
  clkTck: number;
  /** The parsed `stat` of one pid. */
  stat(pid: number): ProcStatRecord;
  /** The raw `/proc/<pid>/stat` line, kernel layout. */
  statLine(pid: number): string;
  /** The raw `/proc/<pid>/cmdline` bytes (NUL-separated, trailing NUL). */
  cmdline(pid: number): Buffer;
  cmdlineArgv(pid: number): string[];
  /** The two lines of `/proc/stat` the reader may read. */
  procStat(): string;
  pids(): number[];
  /** Bring a process up (or replace one). */
  setProcess(fixture: ProcFixture): void;
  /** Simulate an exit: the pid disappears. */
  exitProcess(pid: number): void;
  /** Simulate a zombie: the pid stays, its state becomes `Z`. */
  zombify(pid: number): void;
  /** Simulate PID reuse: same pid, new process, different starttime. */
  reusePid(pid: number, next: Omit<ProcFixture, "pid">): void;
  /** Every read, in order: `stat:<pid>`, `cmdline:<pid>`, `proc-stat`. */
  reads(): string[];
};

export function createProcPort(options: ProcPortOptions = {}): ProcPort {
  const btime = options.btime ?? 1_700_000_000;
  const clkTck = options.clkTck ?? 100;
  const processes = new Map<number, Required<Omit<ProcFixture, "cmdline">> & Pick<ProcFixture, "cmdline">>();
  for (const fixture of options.processes ?? []) {
    processes.set(fixture.pid, {
      pid: fixture.pid,
      comm: fixture.comm ?? "specstride",
      state: fixture.state ?? "S",
      ppid: fixture.ppid ?? 1,
      starttime: fixture.starttime ?? 1000,
      cmdline: fixture.cmdline ?? ["specstride", "run"],
    });
  }
  const reads: string[] = [];

  function requireProcess(pid: number) {
    const process = processes.get(pid);
    if (!process) throw new NoSuchProcessError(pid);
    return process;
  }

  const port: ProcPort = {
    btime,
    clkTck,
    stat(pid) {
      reads.push(`stat:${pid}`);
      const process = requireProcess(pid);
      return {
        pid: process.pid,
        comm: process.comm,
        state: process.state,
        ppid: process.ppid,
        starttime: process.starttime,
        ageSeconds: Math.max(0, Math.floor((process.starttime) / clkTck)),
      };
    },
    statLine(pid) {
      const record = port.stat(pid);
      // Kernel layout: pid (comm) state ppid ... starttime is field 22.
      const fields = new Array<string>(22).fill("0");
      fields[0] = String(record.pid);
      fields[1] = record.state;
      fields[2] = String(record.ppid);
      fields[20] = String(record.starttime);
      return `${record.pid} (${record.comm}) ${fields.slice(1).join(" ")}`;
    },
    cmdline(pid) {
      reads.push(`cmdline:${pid}`);
      const process = requireProcess(pid);
      return Buffer.from((process.cmdline ?? []).join("\0") + "\0", "utf8");
    },
    cmdlineArgv(pid) {
      return port.cmdline(pid)
        .toString("utf8")
        .split("\0")
        .filter((part) => part !== "");
    },
    procStat() {
      reads.push("proc-stat");
      return `btime ${btime}\n`;
    },
    pids() {
      return [...processes.keys()].sort((a, b) => a - b);
    },
    setProcess(fixture) {
      processes.set(fixture.pid, {
        pid: fixture.pid,
        comm: fixture.comm ?? "specstride",
        state: fixture.state ?? "S",
        ppid: fixture.ppid ?? 1,
        starttime: fixture.starttime ?? 1000,
        cmdline: fixture.cmdline ?? ["specstride", "run"],
      });
    },
    exitProcess(pid) {
      requireProcess(pid);
      processes.delete(pid);
    },
    zombify(pid) {
      requireProcess(pid).state = "Z";
    },
    reusePid(pid, next) {
      requireProcess(pid); // reuse is only reuse if the pid existed
      processes.set(pid, {
        pid,
        comm: next.comm ?? "specstride",
        state: next.state ?? "S",
        ppid: next.ppid ?? 1,
        // A new process starts later: a different starttime is what the
        // reader uses to tell the reuse from the original holder.
        starttime: next.starttime ?? 999_999,
        cmdline: next.cmdline ?? ["other", "process"],
      });
    },
    reads() {
      return [...reads];
    },
  };
  return port;
}
