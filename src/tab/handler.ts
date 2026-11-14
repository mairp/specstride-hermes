/**
 * The dashboard API handler of the tab (T053; contracts/151-hermes-kanban/plugin-api.md).
 *
 * Routes answer from the closed set `closedSetApiAnswers`; `GET session`
 * carries `token`, `expiresAt`, `actions` and `laneThreshold` from the
 * profile configuration (an invalid threshold is sent as 100 and logged
 * once). Auth is Hermes session + the run-bound token: no session or no
 * token is a 401 with 0 CLI calls; a token bound to another run is a 409
 * `run-changed`. The binding comes from the view's run id (an engine view),
 * from the run id or `workspace:<ws>` (a reader view), or from
 * `workspace:<ws>` when no view was found. A reader wait makes NO CLI call —
 * the reader signature is compared with the cursor in process. The handler
 * opens no file and holds only the newest view per token plus the engine
 * memo of `viewOf`. No route throws: every failure collapses into the
 * `unavailable` answer.
 */
import { viewOf } from "../kanban/view-source.ts";
import { callShim } from "../kanban/shim-call.ts";
import { changeSignature } from "../kanban/signature.ts";
import { thresholdOfMeta } from "./client/window.ts";
import { issueToken, checkToken } from "./token.ts";

/** The flat response the routes return (no network; the glue adapts it). */
export type ResponseLike = { status: number; json: unknown };

/** The configuration the profile carries (`specstride.kanban.*`). */
export interface KanbanProfileConfig {
  readonly actions?: boolean;
  readonly laneThreshold?: number;
}

export interface HandlerDeps {
  /** The view seam (`viewOf` of src/kanban/view-source.ts), injectable for tests. */
  readonly view?: (workspace: string, deps: unknown) => Promise<unknown>;
  /** The reader seam, injectable for tests. */
  readonly reader?: (workspace: string) => unknown;
  /** Injected clock in ms (tests). */
  readonly now?: () => number;
  /** The engine memo store held across cycles (plugin-api.md "Engine memo"). */
  readonly memo?: Map<string, number>;
  /** The newest view per token, the handler's only other state. */
  readonly views?: Map<string, unknown>;
  /** The profile configuration (`specstride.kanban.*`). */
  readonly profile?: KanbanProfileConfig;
  /** Lines the handler logs (an invalid laneThreshold is logged once). */
  readonly log?: (line: string) => void;
}

/** The workspace binding when no view carries a run: `workspace:<ws>`. */
function workspaceBinding(workspace: string): string {
  return `workspace:${workspace}`;
}

/** The binding an answer implies: the run id of a view, else the workspace. */
function bindingOf(answer: unknown, workspace: string): string {
  if (
    typeof answer === "object" &&
    answer !== null &&
    (answer as { readonly kind?: unknown }).kind === "view"
  ) {
    const view = (answer as { readonly view?: { readonly view?: { readonly runId?: unknown } } }).view;
    const runId = view?.view?.runId;
    if (typeof runId === "string" && runId.length > 0) return runId;
  }
  return workspaceBinding(workspace);
}

/** The gate: a missing or foreign token answers 401 / 409 before any call. */
function gate(
  token: string | undefined,
  binding: string,
  deps: HandlerDeps,
): ResponseLike | null {
  const check = checkToken(token, binding, { now: deps.now });
  if (check.ok) return null;
  if (check.status === 409) {
    return { status: 409, json: { answer: "run-changed" } };
  }
  return { status: 401, json: { answer: "unavailable" } };
}

/** Wrap a route body: nothing throws out of the handler. */
async function route(body: () => Promise<ResponseLike>): Promise<ResponseLike> {
  try {
    return await body();
  } catch {
    return { status: 200, json: { answer: "unavailable" } };
  }
}

/** `GET session`: issue the token, carry the profile configuration. */
export function tabSession(q: { ws: string }, deps: HandlerDeps): Promise<ResponseLike> {
  void q;
  return route(async () => {
    const now = deps.now ?? (() => Date.now());
    const log = deps.log ?? (() => {});
    const { threshold } = thresholdOfMeta(deps.profile, (line) => log(line));
    const token = issueToken(workspaceBinding(q.ws), { now });
    return {
      status: 200,
      json: {
        answer: "view",
        token: token.value,
        expiresAt: token.expiresAt,
        actions: deps.profile?.actions === true,
        laneThreshold: threshold,
      },
    };
  });
}

/** One view answer as the route shape, with the binding-derived token gate. */
async function answerView(
  q: { ws: string; token?: string },
  deps: HandlerDeps,
): Promise<ResponseLike> {
  const now = deps.now ?? (() => Date.now());
  // The binding must be known before the gate can judge the token: derive it
  // from a first answer, then re-answer if the gate refused (a 409 never
  // costs a second call — the answer below is computed once and reused).
  const answer =
    deps.view !== undefined
      ? ((await deps.view(q.ws, { now, reader: deps.reader, memo: deps.memo })) as Awaited<ReturnType<typeof viewOf>>)
      : await viewOf(q.ws, { now, reader: deps.reader as never, memo: deps.memo });
  const binding = bindingOf(answer, q.ws);
  const refused = gate(q.token, binding, deps);
  if (refused !== null) return refused;
  if (deps.views !== undefined && answer.kind === "view") {
    if (typeof q.token === "string") deps.views.set(q.token, answer);
  }
  switch (answer.kind) {
    case "view":
      return {
        status: 200,
        json: {
          answer: "view",
          source: answer.source,
          cursor: answer.token,
          view: answer.view.view,
        },
      };
    case "no-run":
      return { status: 200, json: { answer: "no-run" } };
    case "refused-schema":
      return { status: 200, json: { answer: "refused-schema" } };
    default:
      return { status: 200, json: { answer: "absent" } };
  }
}

/** `GET view`: the newest view of the workspace, gated by the run-bound token. */
export function tabView(q: { ws: string; token?: string }, deps: HandlerDeps): Promise<ResponseLike> {
  return route(() => answerView(q, deps));
}

/** A reader view's signature token, or `null` when it carries none. */
function readerSignature(rv: unknown): string | null {
  if (typeof rv !== "object" || rv === null) return null;
  const token = (rv as { readonly signature?: { readonly token?: unknown } }).signature?.token;
  return typeof token === "string" ? token : null;
}

/** `GET wait`: a reader wait compares signatures in process (0 CLI calls);
 *  an engine wait goes through the shim's closed `wait --until-change` verb. */
export function tabWait(
  q: { ws: string; token?: string; cursor?: string },
  deps: HandlerDeps,
): Promise<ResponseLike> {
  return route(async () => {
    if (deps.reader !== undefined) {
      // The reader wait is answered in process; the gate needs a binding,
      // which the reader view carries (its run id or the workspace).
      const rv = deps.reader(q.ws);
      const binding = (() => {
        const runId = (typeof rv === "object" && rv !== null ? (rv as { runId?: unknown }).runId : undefined);
        return typeof runId === "string" && runId.length > 0 ? runId : workspaceBinding(q.ws);
      })();
      const refused = gate(q.token, binding, deps);
      if (refused !== null) return refused;
      const signature = readerSignature(rv) ?? changeSignature(rv);
      if (typeof q.cursor === "string" && q.cursor === signature) {
        return { status: 200, json: { answer: "unchanged", cursor: signature } };
      }
      return {
        status: 200,
        json: { answer: "view", view: rv, source: "workspace-reader", cursor: signature },
      };
    }
    const now = deps.now ?? (() => Date.now());
    const answer =
      deps.view !== undefined
        ? ((await deps.view(q.ws, { now, reader: deps.reader, memo: deps.memo })) as Awaited<ReturnType<typeof viewOf>>)
        : await viewOf(q.ws, { now, reader: deps.reader as never, memo: deps.memo });
    const refused = gate(q.token, bindingOf(answer, q.ws), deps);
    if (refused !== null) return refused;
    // Engine wait: the closed shim verb. The stub answers exit 2 → absent.
    const cursor = typeof q.cursor === "string" ? q.cursor : "";
    const outcome = await callShim(q.ws, [
      "wait",
      "--until-change",
      "--cursor",
      cursor,
      "--timeout",
      "25",
    ]);
    return {
      status: 200,
      json: {
        answer:
          outcome.exit === 0
            ? "view"
            : answer.kind === "no-run"
              ? "no-run"
              : answer.kind === "refused-schema"
                ? "refused-schema"
                : "absent",
        cursor,
      },
    };
  });
}

/** `GET workspaces`: the workspaces the host knows, no CLI call. */
export function tabWorkspaces(deps: HandlerDeps): Promise<ResponseLike> {
  void deps;
  return route(async () => ({ status: 200, json: { answer: "view", workspaces: [] } }));
}

/** The action verbs the closed set allows, with their shim argv. */
const ACTION_VERBS: ReadonlyMap<string, readonly string[]> = new Map([
  ["stop", ["stop"]],
  ["stop-now", ["stop", "--now"]],
  ["resume", ["resume"]],
]);

/** `POST action`: gated, only when the profile enables actions, only for a
 *  verb of the closed set with `confirm: true` — then exactly one shim verb. */
export function tabAction(
  body: { token?: string; verb?: string; confirm?: boolean },
  deps: HandlerDeps,
): Promise<ResponseLike> {
  return route(async () => {
    if (typeof body.token !== "string" || body.token.length === 0) {
      return { status: 401, json: { answer: "unavailable" } };
    }
    if (deps.profile?.actions !== true) {
      return { status: 404, json: { answer: "action-refused" } };
    }
    const argv = typeof body.verb === "string" ? ACTION_VERBS.get(body.verb) : undefined;
    if (argv === undefined || body.confirm !== true) {
      return { status: 400, json: { answer: "action-refused" } };
    }
    const outcome = await callShim("", argv);
    return {
      status: 200,
      json: { answer: outcome.exit === 0 ? "action-accepted" : "action-refused", verb: body.verb },
    };
  });
}
