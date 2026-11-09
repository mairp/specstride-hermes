# Python 3.14 — thin glue (T044, contracts/150-host-hermes/plugin-manifest.md,
# H3, F150-FR-025): `register(ctx)` wires the `/specstride` command, the CLI
# command, the two read-only tools of the `specstride` toolset and the bundled
# skills. Every handler forwards to `bin/specstride-hermes` or the control
# CLI through `_forward.run`, or replies from the `/specstride` table of
# contracts/150-host-hermes/slash-command.md — a sequence of equality checks
# and lookups whose TypeScript reference is the host package's
# `glue-reference.ts` (the pytest suite proves both agree). No business
# logic, no `re`, no direct `subprocess` here. The hooks of the manifest are
# bound below (T062).
import json
import os

from . import _forward

TIMEOUT_SECONDS = 30
DEFAULT_REPLY = "Specstride not installed — run specstride-host-hermes install"

# Exit-code → reply prefix (contracts/slash-command.md).
CLI_NOT_FOUND_REPLY = "CLI not found — run /specstride doctor"
RUN_INVOCATION_REPLY = "type /specstride-run to start (invoking it is the consent)"
DRY_RUN_INVOCATION_REPLY = "type /specstride-run dry-run"
REFUSED_REPLY = (
    "refused — verbs: run, dry-run, status, stop, stop --now, resume, doctor"
)


def _read_table(name, default):
    """A lookup in a Node-written table, or its default."""
    try:
        with open(name, "r", encoding="utf-8") as handle:
            return json.load(handle)
    except Exception:
        return default


def _call(function, *args, **kwargs):
    """Call a registration hook, degrading when the host's signature differs:
    the glue degrades, never raises."""
    try:
        return function(*args, **kwargs)
    except TypeError:
        try:
            return function(*args)
        except Exception:
            return None
    except Exception:
        return None


def bin_directory():
    """The `bin/` the installer recorded, or None when `_paths.json` is
    missing. The file sits next to this file; the environment override
    exists only so the pytest suite can point the glue at a fixture
    directory."""
    here = os.path.dirname(os.path.abspath(__file__))
    root = os.environ.get("SPECSTRIDE_HOST_ROOT", here)
    try:
        with open(os.path.join(root, "_paths.json"), "r", encoding="utf-8") as handle:
            return json.load(handle)["bin"]
    except Exception:
        return None


def _paths_present():
    """Whether the installer's `_paths.json` exists next to this file."""
    return bin_directory() is not None


def normalize(raw):
    """Collapse whitespace; tolerate a leading slash. String handling only."""
    text = " ".join(raw.split())
    return text[1:] if text.startswith("/") else text


def forward_argv(raw_args):
    """The slash-command table: the typed verb → `(argv, cwd, installed)`.
    `status` goes through the shim; `doctor` through the control CLI; the
    state-changing verbs forward ONLY because they were typed — this
    function is only ever called with what the user typed (H1)."""
    bin_dir = bin_directory()
    if bin_dir is None:
        return None, None, False
    verb = normalize(raw_args)
    shim = os.path.join(bin_dir, "specstride-hermes")
    control = os.path.join(bin_dir, "specstride-host-hermes")
    if verb == "status":
        return [shim, "status"], None, True
    if verb == "doctor":
        return [control, "doctor"], None, True
    if verb == "stop":
        return [shim, "stop"], None, True
    if verb == "stop --now":
        return [shim, "stop", "--now"], None, True
    if verb == "resume":
        return [shim, "resume"], None, True
    return None, None, True


def reply_for(argv, verb, result):
    """The exit-code → reply mapping (contracts/slash-command.md): 127 → the
    install line; 4 → the refusal line verbatim; otherwise the CLI's own
    output verbatim, stdout preferred. Output is DATA, never a prompt."""
    if argv is None:
        normalized = normalize(verb)
        if normalized == "run":
            return RUN_INVOCATION_REPLY
        if normalized == "dry-run":
            return DRY_RUN_INVOCATION_REPLY
        return REFUSED_REPLY
    exit_code, stdout, stderr = result
    if exit_code == 127:
        return CLI_NOT_FOUND_REPLY
    text = stdout if stdout else stderr
    return text.rstrip("\n")


def command_reply(raw_args, cwd=None, timeout=TIMEOUT_SECONDS):
    """The whole table, composed: typed arguments → reply. Only an installed
    plugin with a decided argv reaches `_forward.run`."""
    argv, _child_cwd, installed = forward_argv(raw_args)
    if not installed:
        return DEFAULT_REPLY
    if argv is None:
        return reply_for(None, raw_args, (0, "", ""))
    result = _forward.run(argv, timeout=timeout, cwd=cwd)
    return reply_for(argv, raw_args, result)


def command_handler(ctx):
    """The `specstride` slash/CLI verb: the table over the typed argv."""
    raw = " ".join(getattr(ctx, "argv", []) or [])
    return command_reply(raw, cwd=getattr(ctx, "cwd", None))


def status_tool(ctx):
    """Forward `status` through the shim; read-only."""
    bin_dir = bin_directory()
    if bin_dir is None:
        return DEFAULT_REPLY
    _code, stdout, stderr = _forward.run(
        [os.path.join(bin_dir, "specstride-hermes"), "status"],
        cwd=getattr(ctx, "cwd", None),
    )
    return stdout if stdout else stderr


def doctor_tool(ctx):
    """Forward the host doctor through the control CLI; read-only."""
    bin_dir = bin_directory()
    if bin_dir is None:
        return DEFAULT_REPLY
    _code, stdout, stderr = _forward.run(
        [os.path.join(bin_dir, "specstride-host-hermes"), "doctor"],
        cwd=getattr(ctx, "cwd", None),
    )
    return stdout if stdout else stderr


def bundled_skills():
    """The names of the built bundled skills under `skills/` next to this
    file (they ship with the plugin); a directory read, nothing more."""
    here = os.path.dirname(os.path.abspath(__file__))
    try:
        entries = os.listdir(os.path.join(here, "skills"))
    except Exception:
        return []
    return sorted(name for name in entries if not name.startswith("."))


def register(ctx):
    """Register the commands, tools and bundled skills of the plugin."""
    _call(ctx.register_command, "specstride", command_handler)
    register_cli_command = getattr(ctx, "register_cli_command", None)
    if callable(register_cli_command):
        _call(register_cli_command, "specstride", command_handler)

    # Tools of the `specstride` toolset, default-off and read-only: the host
    # approves nothing and the tools change nothing (Principle II).
    register_tool = ctx.register_tool
    for name, kwargs, handler in (
        ("specstride_status", {"toolset": "specstride", "default_off": True}, status_tool),
        ("specstride_doctor", {"toolset": "specstride", "default_off": True}, doctor_tool),
    ):
        returned = _call(register_tool, name, **kwargs)
        if callable(returned):
            _call(returned, handler)

    # The bundled `specstride:*` copies of the build (F150-FR-002): explicit
    # loads only. register_skill may be absent on a validator's probe.
    register_skill = getattr(ctx, "register_skill", None)
    if callable(register_skill):
        for name in bundled_skills():
            here = os.path.dirname(os.path.abspath(__file__))
            root = os.environ.get("SPECSTRIDE_HOST_ROOT", here)
            _call(register_skill, name, os.path.join(root, "skills", name))

    # The hooks of the manifest (T062), bound in phase 8.
    _register_hooks(ctx)


# ---------------------------------------------------------------------------
# The hooks of US6 (T062, contracts/150-host-hermes/plugin-manifest.md,
# F150-FR-038 to F150-FR-042): thin glue over Node-written tables and the
# watcher's precomputed status line. Every hook is wrapped in
# `try/except → None` with a 5 s self-check (H5); the two pre_* hooks stay
# silent in a Kanban worker, a cron session and a run's own child session;
# nothing here spawns a process or imports a pattern library — the rules live
# in `guard.json`, written by the host package's Node build.
# ---------------------------------------------------------------------------

import hashlib
import os
import time

HOOK_BOUND_SECONDS = 5.0
SILENT_SOURCES = ("kanban", "cron")

# The last `.seq` counter given per `session_id` (integer comparison only).
_SEQ_GIVEN = {}


def _hook(fn):
    """`try/except → None` plus the 5 s self-check: a hook that raises, or
    that runs past its bound, is as if it were absent."""
    def wrapped(ctx=None, *args, **kwargs):
        started = time.monotonic()
        try:
            result = fn(ctx, *args, **kwargs)
        except Exception:
            return None
        if time.monotonic() - started > HOOK_BOUND_SECONDS:
            return None
        return result

    wrapped.__name__ = getattr(fn, "__name__", "hook")
    return wrapped


def _attr(obj, name, default=None):
    """One attribute read with a default; the glue makes no decision beyond
    this read and the comparisons below."""
    value = getattr(obj, name, default)
    return default if value is None else value


def _hermes_home():
    return os.environ.get("HERMES_HOME") or os.path.join(os.path.expanduser("~"), ".hermes")


def _session_source(ctx):
    value = _attr(ctx, "session_source")
    if value is None:
        value = os.environ.get("HERMES_SESSION_SOURCE")
    return value


def _is_child(ctx):
    value = _attr(ctx, "child")
    if value is not None:
        return bool(value)
    return os.environ.get("SPECSTRIDE_CHILD") == "1"


def _is_silent(ctx):
    """Silence in a Kanban worker, a cron session or a run's own child."""
    source = _session_source(ctx)
    return _is_child(ctx) or (source is not None and source in SILENT_SOURCES)


def _workspace_of(ctx):
    return _attr(ctx, "workspace") or _attr(ctx, "cwd") or os.getcwd()


def _status_paths(workspace):
    key = hashlib.sha256(workspace.encode("utf-8")).hexdigest()[:16]
    directory = os.path.join(_hermes_home(), "specstride-host", "status")
    return os.path.join(directory, key + ".line"), os.path.join(directory, key + ".seq")


def _read_text(path):
    with open(path, "r", encoding="utf-8") as handle:
        return handle.read()


def _write_atomic(path, text):
    """One atomic file write: temporary file in the same directory, then a
    single rename. The only write the hooks make."""
    directory = os.path.dirname(path)
    temporary = path + ".tmp"
    with open(temporary, "w", encoding="utf-8") as handle:
        handle.write(text)
    os.replace(temporary, path)


@_hook
def pre_llm_call(ctx=None):
    """The session-start and prompt lines (F150-FR-038, F150-FR-039): the
    precomputed line once at the first turn when a run exists, and on later
    turns only when the counter differs from the one last given in this
    session. `{"context": "Specstride: <line>"}` or None."""
    if _is_silent(ctx):
        return None
    session_id = str(_attr(ctx, "session_id", ""))
    workspace = _workspace_of(ctx)
    line_file, seq_file = _status_paths(workspace)
    line = _read_text(line_file).rstrip("\n")
    if line == "":
        return None
    try:
        given = int(_SEQ_GIVEN.get(session_id))
    except (TypeError, ValueError):
        given = None
    payload_given = _attr(ctx, "last_seq_given")
    if payload_given is not None:
        given = int(payload_given)
    first_turn = bool(_attr(ctx, "is_first_turn", session_id not in _SEQ_GIVEN))
    if not first_turn:
        try:
            counter = int(_read_text(seq_file).strip())
        except Exception:
            counter = None
        if given is not None and counter == given:
            return None
    _SEQ_GIVEN[session_id] = _read_counter(seq_file)
    return {"context": "Specstride: " + line}


def _read_counter(seq_file):
    try:
        return int(_read_text(seq_file).strip())
    except Exception:
        return None


@_hook
def pre_tool_call(ctx=None):
    """The launch guardrail (F150-FR-040): apply the rules of
    `guard.json` — plain `in` tests on the command string — and block with
    the rule's reason and fix; any launch while `blocking` is true is blocked
    with the doctor's fix. A missing or invalid table is a no-op. The hook
    never approves anything."""
    if _is_silent(ctx):
        return None
    command = _attr(ctx, "command")
    if command is None:
        argv = getattr(ctx, "argv", None) or []
        command = " ".join(str(part) for part in argv)
    if "launch" not in command:
        return None
    table = _read_table(os.path.join(_hermes_home(), "specstride-host", "guard.json"), None)
    if not isinstance(table, dict) or not isinstance(table.get("blocking"), bool):
        return None
    if not isinstance(table.get("rules"), list):
        return None
    if table["blocking"]:
        fix = table.get("fix")
        if not isinstance(fix, str):
            fix = "run specstride-host-hermes doctor"
        return {
            "decision": "block",
            "reason": "the last doctor result holds a launch-blocking finding",
            "fix": fix,
        }
    for rule in table["rules"]:
        if not isinstance(rule, dict):
            continue
        contains = rule.get("contains")
        absent = rule.get("absent")
        if not isinstance(contains, list) or not isinstance(absent, list):
            continue
        if any(literal not in command for literal in contains):
            continue
        if any(literal in command for literal in absent):
            continue
        return {"decision": "block", "reason": rule.get("reason"), "fix": rule.get("fix")}
    return None


@_hook
def on_session_end(ctx=None):
    """The host-limit request (F150-FR-041): a session that ends on a
    provider usage limit inside a run's own child writes one atomic request
    file the watcher forwards once the engine has the verb (U-150-08). The
    hook spawns nothing and returns None."""
    if not _is_child(ctx):
        return None
    reason = str(_attr(ctx, "turn_exit_reason", "") or "")
    if "usage_limit" not in reason:
        return None
    session_id = str(_attr(ctx, "session_id", "") or "unknown")
    request = {
        "kind": "host-limit",
        "sessionId": session_id,
        "provider": str(_attr(ctx, "provider", "unknown")),
        "at": str(_attr(ctx, "at", "") or ""),
    }
    directory = os.path.join(_hermes_home(), "specstride-host", "inbox")
    os.makedirs(directory, exist_ok=True)
    _write_atomic(
        os.path.join(directory, session_id + ".json"),
        json.dumps(request, indent=2) + "\n",
    )
    return None


HOOKS = {
    "pre_llm_call": pre_llm_call,
    "pre_tool_call": pre_tool_call,
    "on_session_end": on_session_end,
}


def _register_hooks(ctx):
    """Bind the four manifest hook rows (the two `pre_llm_call` rows share
    one handler); a host without `register_hook` gets nothing."""
    register_hook = getattr(ctx, "register_hook", None)
    if not callable(register_hook):
        return
    for name, handler in HOOKS.items():
        _call(register_hook, name, handler)
