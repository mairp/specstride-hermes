# Python 3.14 — thin glue (T044, contracts/150-host-hermes/plugin-manifest.md,
# H3, F150-FR-025): `register(ctx)` wires the `/specstride` command, the CLI
# command, the two read-only tools of the `specstride` toolset and the bundled
# skills. Every handler forwards to `bin/specstride-hermes` or the control
# CLI through `_forward.run`, or replies from the `/specstride` table of
# contracts/150-host-hermes/slash-command.md — a sequence of equality checks
# and lookups whose TypeScript reference is the host package's
# `glue-reference.ts` (the pytest suite proves both agree). No business
# logic, no `re`, no direct `subprocess` here. The hooks of the manifest are
# bound in a later phase (T062).
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
