/**
 * The tasks.md parser of the workspace reader (T015; PT-151-034;
 * contracts/workspace-reader.md §3, F151-FR-034).
 *
 * Ported from specstride-dsh `packages/dsh-kanban/src/server/workspace-view.ts`
 * lines 107–133 and `run-detail.ts` lines 89–211 at `ab8093e` — the phase and
 * scope extraction of dsh's workspace view, with the attribution the port
 * asks for. Read-only: lines in, records out; fenced code is skipped, so a
 * `tasks.md` that SHOWS a `## Phase` inside a code block does not parse one.
 */

export interface ParsedTask {
  /** The task id, e.g. `T018`. */
  id: string;
  /** The task text after the id and its tags. */
  text: string;
  done: boolean;
  /** The `[P]` tag: parallelizable. */
  parallel: boolean;
  /** The `[USn]` tags, e.g. `["US7"]`. */
  stories: string[];
  /** Backticked file references of the task text, in order. */
  files: string[];
}

export interface ParsedPhase {
  number: number;
  title: string;
  tasks: ParsedTask[];
  /** The `**Goal**:` line of the phase, or null. */
  goal: string | null;
  /** The `**Independent Test**:` line, or null. */
  independentTest: string | null;
  /** The `**Checkpoint**:` line, or null. */
  checkpoint: string | null;
}

export interface ParsedScope {
  /** Backticked file references of the goal, test and checkpoint lines. */
  files: string[];
  tasksDone: number;
  tasksTotal: number;
  /** One row per task with the `[P]` tag. */
  parallel: ParsedTask[];
  /** One row per task carrying an `[USn]` tag, keyed by story. */
  stories: Record<string, ParsedTask[]>;
  phases: ParsedPhase[];
}

const PHASE_HEADING = /^##\s+Phase\s+(\d+):\s+(.+?)\s*$/;
const TASK_LINE = /^-\s+\[( |x|X)\]\s+(\S+)\s+(.*)$/;
const FENCE = /^\s*(```|~~~)/;
const FILE_REF = /`([^`]+\.(?:ts|mts|mjs|js|py|md|json|ya?ml|toml))`/g;

/** Strip the tags of a task text: `[P]`, `[USn]`, and nothing else. */
function splitTags(rest: string): { text: string; parallel: boolean; stories: string[] } {
  let parallel = false;
  const stories: string[] = [];
  let text = rest.trim();
  for (;;) {
    const bracket = /^\[([^\]]+)\]\s*/.exec(text);
    if (bracket === null) break;
    const tag = bracket[1];
    if (tag === "P") parallel = true;
    else if (/^US\d+$/.test(tag)) stories.push(tag);
    else break; // a bracket that is not a tag ends the tag run
    text = text.slice(bracket[0].length);
  }
  return { text, parallel, stories };
}

function filesOf(text: string): string[] {
  const files: string[] = [];
  for (const match of text.matchAll(FILE_REF)) files.push(match[1]);
  return files;
}

function labeledLine(label: string, body: string): string | null {
  const heading = new RegExp(`^\\*\\*${label}\\*\\*:\\s*(.*)$`);
  for (const line of body.split("\n")) {
    const match = heading.exec(line.trim());
    if (match !== null) return match[1].trim();
  }
  return null;
}

/**
 * Parse the `## Phase N: <title>` headings and their ticked tasks. Lines
 * inside a fenced code block (``` or ~~~) are skipped.
 */
export function parsePhases(text: string): ParsedPhase[] {
  const phases: ParsedPhase[] = [];
  let current: ParsedPhase | null = null;
  const sectionLines: string[] = [];
  let fenced: string | null = null;
  const close = (): void => {
    if (current === null) return;
    const body = sectionLines.join("\n");
    current.goal = labeledLine("Goal", body);
    current.independentTest = labeledLine("Independent Test", body);
    current.checkpoint = labeledLine("Checkpoint", body);
  };
  for (const line of text.split("\n")) {
    const fence = FENCE.exec(line);
    if (fence !== null) {
      // A fence closes only on its own marker (``` closes ```, ~~~ closes ~~~).
      const marker = fence[1][0];
      fenced = fenced === null ? marker : fenced === marker ? null : fenced;
      continue;
    }
    if (fenced !== null) continue;
    const heading = PHASE_HEADING.exec(line);
    if (heading !== null) {
      close();
      sectionLines.length = 0;
      current = { number: Number(heading[1]), title: heading[2].trim(), tasks: [], goal: null, independentTest: null, checkpoint: null };
      phases.push(current);
      continue;
    }
    if (current === null) continue;
    const task = TASK_LINE.exec(line);
    if (task !== null) {
      const { text: taskText, parallel, stories } = splitTags(task[3]);
      current.tasks.push({
        id: task[2],
        done: task[1] !== " ",
        text: taskText,
        parallel,
        stories,
        files: filesOf(taskText),
      });
      continue;
    }
    sectionLines.push(line);
  }
  close();
  return phases;
}

/**
 * Parse the scopes of a tasks.md: the goal, the independent test, the
 * checkpoint, the tasks with `[P]` and `[USn]`, and the file references.
 */
export function parseScopes(text: string): ParsedScope {
  const phases = parsePhases(text);
  const tasks = phases.flatMap((phase) => phase.tasks);
  const stories: Record<string, ParsedTask[]> = {};
  for (const task of tasks) {
    for (const story of task.stories) {
      (stories[story] ??= []).push(task);
    }
  }
  const files = filesOf(
    phases
      .map((phase) => [phase.goal, phase.independentTest, phase.checkpoint].filter((line) => line !== null).join("\n"))
      .join("\n"),
  );
  return {
    files,
    tasksDone: tasks.filter((task) => task.done).length,
    tasksTotal: tasks.length,
    parallel: tasks.filter((task) => task.parallel),
    stories,
    phases,
  };
}
