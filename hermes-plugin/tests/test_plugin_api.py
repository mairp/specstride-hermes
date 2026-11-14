# Tests-first unit for T056 (feature 151): the dashboard plugin API glue
# (contracts/151-hermes-kanban/plugin-api.md, F151-FR-019..FR-023, FR-026,
# FR-033, FR-039). `specstride/dashboard/plugin_api.py` does NOT exist yet —
# it is implemented in T064 — so every test below fails with an explicit
# message instead of erroring at collection: the module is imported INSIDE
# each test.
#
# Checks (each with its own failure message):
#   1. the router exposes the GET routes `session`, `view`, `wait`,
#      `workspaces` and (when actions are enabled) the POST `action` route —
#      exactly the route table of plugin-api.md.
#   2. every route forwards its argv to `specstride-host-hermes tab <op> …`
#      through a RECORDING stub (in-process monkeypatch, no real subprocess)
#      and returns the subprocess's stdout and exit status UNCHANGED.
#   3. the module parses no view, maps no lane, writes no file, and imports
#      nothing outside the Python standard library plus the Hermes-provided
#      router import (checked over the module's AST).
#
# Deterministic: no real subprocess, no filesystem writes.
import ast
import io
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
PLUGIN_ROOT = os.path.dirname(HERE)
if PLUGIN_ROOT not in sys.path:
    sys.path.insert(0, PLUGIN_ROOT)

try:
    import pytest
except ImportError:  # a plain `python3` run needs no pytest
    pytest = None

if pytest is not None:
    _fixture = pytest.fixture
else:
    def _fixture(*args, **kwargs):
        def decorate(func):
            return func
        return decorate

MODULE_PATH = os.path.join(PLUGIN_ROOT, "specstride", "dashboard", "plugin_api.py")

# The route table of contracts/151-hermes-kanban/plugin-api.md.
GET_ROUTES = {"session", "view", "wait", "workspaces"}
POST_ROUTES = {"action"}

# The closed allow-list of imports (stdlib + what Hermes gives a router:
# `fastapi.APIRouter`; `specstride._forward` is the plugin's own stdlib-only
# subprocess seam, part of the Hermes plugin package).
ALLOWED_IMPORT_ROOTS = {
    "json",
    "os",
    "sys",
    "types",
    "typing",
    "subprocess",
    "asyncio",
    "functools",
    "urllib",
    "specstride._forward",
    "specstride.dashboard._forward",
    "fastapi",
}

LACKING = (
    "plugin_api.py not implemented yet (T064): "
    "hermes-plugin/specstride/dashboard/plugin_api.py is missing"
)


def _fail(message):
    """Fail the current check with a clear message, under pytest and under a
    plain `python3` run alike."""
    if pytest is not None:
        pytest.fail(message)
    raise AssertionError(message)


def _skip(reason):
    if pytest is not None:
        pytest.skip(reason)
    print(f"SKIPPED: {reason}")


def _load_plugin_api():
    """Import the module inside the test; a missing module is a clear
    per-test failure, not a collection error."""
    if not os.path.exists(MODULE_PATH):
        _fail(LACKING)
    import importlib

    try:
        return importlib.import_module("specstride.dashboard.plugin_api")
    except ModuleNotFoundError as error:
        _fail(
            "plugin_api.py not implemented yet (T064): import failed with "
            f"ModuleNotFoundError: {error}"
        )
    except Exception as error:  # a present module that fails to import
        _fail(
            f"plugin_api.py failed to import: {type(error).__name__}: {error}"
        )


def _route_entries(router):
    """Yield (method, path) pairs from an APIRouter-like object without
    requiring fastapi to be installed (duck-typed introspection)."""
    entries = []
    routes = getattr(router, "routes", None)
    if routes is None:
        raise AssertionError(
            "plugin_api.router exposes no `routes` attribute — it is not an "
            "APIRouter-like object"
        )
    for route in routes:
        path = getattr(route, "path", None)
        methods = getattr(route, "methods", None)
        if methods is None and isinstance(route, (list, tuple)) and len(route) == 2:
            methods, path = route[0], route[1]
        if isinstance(methods, str):
            methods = {methods}
        for method in sorted(methods or {""}):
            entries.append((method, path))
    return entries


def _tail(path):
    """The last path segment, so `GET /api/plugins/specstride/session` and
    `session` both compare against the contract table."""
    return path.rstrip("/").rsplit("/", 1)[-1]


def _make_recorded_calls(monkeypatch):
    """A RECORDING stub: `specstride._forward.run` (the plugin's one
    subprocess seam) and `subprocess.run` are both replaced in-process; no
    real subprocess ever runs. Each call is logged with its argv."""
    calls = []
    import specstride._forward as forward

    def fake_forward_run(argv, timeout=30, cwd=None):
        calls.append({"argv": list(argv), "timeout": timeout, "cwd": cwd})
        return fake_forward_run.result

    fake_forward_run.result = (0, '{"answer":"view"}', "")

    def fake_subprocess_run(argv, **kwargs):
        calls.append({"argv": list(argv), **kwargs})
        return fake_subprocess_run.result

    fake_subprocess_run.result = type(
        "R", (), {"returncode": 0, "stdout": '{"answer":"view"}', "stderr": ""}
    )()

    monkeypatch.setattr(forward, "run", fake_forward_run)
    monkeypatch.setattr("subprocess.run", fake_subprocess_run)
    return calls


@_fixture()
def recorded_calls(monkeypatch):
    return _make_recorded_calls(monkeypatch)


# ---------------------------------------------------------------------------
# 1. The route set matches the contract's table.
# ---------------------------------------------------------------------------


def test_router_exposes_get_routes():
    plugin_api = _load_plugin_api()
    router = getattr(plugin_api, "router", None)
    assert router is not None, (
        "plugin_api.py exports no `router` (the contract: it exports `router`, "
        "an APIRouter-like object)"
    )
    got = {(m, _tail(p)) for m, p in _route_entries(router) if m == "GET"}
    missing = GET_ROUTES - {t for _, t in got}
    assert not missing, (
        f"router is missing the GET route(s) {sorted(missing)} of the "
        "contract table (plugin-api.md: session, view, wait, workspaces); got "
        f"{sorted(got)}"
    )
    unknown = {t for _, t in got} - GET_ROUTES
    assert not unknown, (
        f"router registers GET route(s) outside the closed contract table: "
        f"{sorted(unknown)}"
    )


def test_router_exposes_post_action_route():
    plugin_api = _load_plugin_api()
    """POST `action` is registered when actions are enabled (the contract:
    with actions off the route is not mounted). The test accepts either the
    mounted POST route or an explicit actions-disabled switch; an otherwise
    closed route set without any of the two fails."""
    router = plugin_api.router
    got = {(m, _tail(p)) for m, p in _route_entries(router)}
    has_action = ("POST", "action") in got
    if has_action:
        return
    switch = getattr(plugin_api, "ACTIONS_ENABLED", None)
    if switch is False:
        _skip("actions are disabled in plugin_api (route intentionally absent)")
    _fail(
        "router registers no POST `action` route and declares no "
        "`ACTIONS_ENABLED = False` — the contract table requires POST action "
        f"when actions are enabled; got {sorted(got)}"
    )


# ---------------------------------------------------------------------------
# 2. Every route shells out to `specstride-host-hermes tab <op>` and returns
#    stdout and exit status UNCHANGED.
# ---------------------------------------------------------------------------

EXPECTED_OPERATIONS = {
    "session": "session",
    "view": "view",
    "wait": "wait",
    "workspaces": "workspaces",
    "action": "action",
}

RAW_STDOUT = '{"answer":"view","view":{},"source":"engine","cursor":"c1"}'
RAW_STATUS = 7  # a non-zero code must survive unchanged


def _make_failing_stub(calls):
    """The recording stub answers a distinguishable raw stdout and a raw
    non-zero exit status, proving both pass through untouched."""
    import specstride._forward as forward

    forward.run.result = (RAW_STATUS, RAW_STDOUT, "")
    import subprocess as _subprocess

    _subprocess.run.result = type(
        "R", (), {"returncode": RAW_STATUS, "stdout": RAW_STDOUT, "stderr": ""}
    )()
    return calls


@_fixture()
def failing_stub(recorded_calls):
    return _make_failing_stub(recorded_calls)


PARAMETRIZE = (
    pytest.mark.parametrize if pytest is not None else (lambda a, b: (lambda f: f))
)


@PARAMETRIZE("op", ["session", "view", "wait", "workspaces"])
def test_get_route_forwards_to_tab_cli(op, failing_stub):
    plugin_api = _load_plugin_api()
    result = _call_get_route(plugin_api, op)
    _assert_forwarded(failing_stub, op)
    _assert_passthrough(result)


def test_post_action_route_forwards_to_tab_cli(failing_stub):
    plugin_api = _load_plugin_api()
    result = _call_post_action(plugin_api)
    if result is None:
        _skip("POST action route not mounted (actions disabled)")
    _assert_forwarded(failing_stub, "action")
    _assert_passthrough(result)


def _call_get_route(plugin_api, op):
    handler = _route_handler(plugin_api, "GET", op)
    kwargs = {"ws": "ws1", "token": "tok", "cursor": "c1"}
    return _invoke(handler, kwargs)


def _call_post_action(plugin_api):
    handler = _route_handler(plugin_api, "POST", "action")
    if handler is None:
        return None
    body = {"token": "tok", "verb": "stop", "confirm": True}
    return _invoke(handler, {}, body=body)


def _route_handler(plugin_api, method, tail):
    for route in plugin_api.router.routes:
        path = getattr(route, "path", None)
        methods = getattr(route, "methods", None) or set()
        if path is not None and _tail(path) == tail and method in methods:
            handler = getattr(route, "endpoint", None) or getattr(
                route, "dependant", None
            )
            handler = getattr(handler, "endpoint", handler) if handler else None
            if handler is None:
                handler = getattr(route, "handler", None)
            assert handler is not None, (
                f"cannot reach the endpoint function of {method} {path} on the "
                "router (no endpoint/handler attribute) — the router is not an "
                "APIRouter-like object"
            )
            return handler
    return None


def _invoke(handler, kwargs, body=None):
    """Call the endpoint with plain kwargs; a request-like first parameter
    is filled with a minimal stand-in, so the stub does all the work."""
    import inspect

    sig = inspect.signature(handler)
    params = list(sig.parameters.values())
    args = []
    call_kwargs = dict(kwargs)
    if params and params[0].name in ("request", "req", "_request"):
        args.append(_FakeRequest(body=body))
        call_kwargs = {k: v for k, v in kwargs.items() if k in sig.parameters}
    call_kwargs = {k: v for k, v in call_kwargs.items() if k in sig.parameters}
    try:
        return handler(*args, **call_kwargs)
    except TypeError as error:
        _fail(
            f"could not invoke the {handler!r} endpoint with plain kwargs "
            f"{call_kwargs}: {error}"
        )


class _FakeRequest:
    """Minimal request stand-in: query params and a JSON body."""

    def __init__(self, body=None):
        self.query_params = {"ws": "ws1", "token": "tok", "cursor": "c1"}
        self._body = body

    def json(self):
        return self._body or {}

    async def is_json(self):
        return True


def _assert_forwarded(calls, op):
    assert calls, (
        f"the `{op}` route never called the CLI — every route must forward to "
        "`specstride-host-hermes tab <op>`"
    )
    argv = calls[0]["argv"]
    assert argv[:4] == ["specstride-host-hermes", "tab", op] or argv[:3] == [
        "specstride-host-hermes",
        "tab",
    ], (
        f"the `{op}` route called the CLI with argv {argv}; the contract "
        f"requires it to start with "
        f"{['specstride-host-hermes', 'tab', op]}"
    )
    assert not calls[0].get("shell"), (
        "the route must not use a shell (`shell=True`) to reach the CLI"
    )


def _assert_passthrough(result):
    assert result is not None, "the route returned nothing"
    exit_code, stdout = _exit_and_stdout(result)
    assert exit_code == RAW_STATUS, (
        f"the route did not return the subprocess's exit status UNCHANGED: "
        f"expected {RAW_STATUS}, got {exit_code!r}"
    )
    assert stdout == RAW_STDOUT, (
        f"the route did not return the subprocess's stdout UNCHANGED: expected "
        f"the raw line {RAW_STDOUT!r}, got {stdout!r}"
    )


def _exit_and_stdout(result):
    for names in (("returncode", "status", "code", "exit_code"),):
        for name in names:
            if hasattr(result, name):
                return getattr(result, name), getattr(result, "stdout", "")
    if isinstance(result, tuple):
        if len(result) >= 2 and isinstance(result[0], int):
            return result[0], result[1]
        if len(result) == 2:
            return result[1], result[0]
    if isinstance(result, dict):
        status = result.get("status", result.get("returncode", result.get("code")))
        return status, result.get("stdout", "")
    _fail(
        f"the route returned {type(result).__name__}, which carries neither a "
        "status attribute, nor a (status, stdout) tuple, nor a dict — the "
        "contract requires the raw stdout and exit status to come back unchanged"
    )


# ---------------------------------------------------------------------------
# 3. No logic in Python: no view parsing, no lane mapping, no file writes,
#    and an AST-checked closed import allow-list.
# ---------------------------------------------------------------------------


def _source():
    if not os.path.exists(MODULE_PATH):
        _fail(LACKING)
    with open(MODULE_PATH, "r", encoding="utf-8") as handle:
        return handle.read()


def _tree():
    return ast.parse(_source(), filename=MODULE_PATH)


def test_module_parses_no_view():
    """No `json.loads` of a view body: the module never decodes the view."""
    tree = _tree()
    offenders = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Call):
            func = node.func
            name = getattr(func, "attr", None) or getattr(func, "id", None)
            if name == "loads":
                offenders.append(ast.dump(func))
    assert not offenders, (
        "plugin_api.py parses a view body with json.loads at "
        f"{offenders} — the module parses no view: the Node CLI's answer goes "
        "back to the client untouched"
    )


def test_module_maps_no_lane():
    """No lane constants: the module maps no lane."""
    text = _source()
    offenders = [
        line
        for line in text.splitlines()
        if "lane" in line.lower() and not line.lstrip().startswith("#")
    ]
    assert not offenders, (
        "plugin_api.py mentions lanes — the module maps no lane: "
        f"{offenders[:5]}"
    )


def test_module_writes_no_file():
    """No `open(..., 'w')`, no `.write` on a path: the module writes no file."""
    tree = _tree()
    offenders = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "open":
            mode = None
            for kwarg in node.keywords:
                if kwarg.arg == "mode" and isinstance(kwarg.value, ast.Constant):
                    mode = kwarg.value.value
            if len(node.args) >= 2 and isinstance(node.args[1], ast.Constant):
                mode = node.args[1].value
            if mode is not None and any(c in str(mode) for c in "wax+"):
                offenders.append(f"open(..., {mode!r})")
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr in ("write_text", "write_bytes"):
            offenders.append(f".{node.func.attr}(...)")
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == "write":
            owner = node.func.value
            if isinstance(owner, ast.Call) and isinstance(owner.func, ast.Name) and owner.func.id == "open":
                offenders.append("open(...).write(...)")
    assert not offenders, (
        f"plugin_api.py writes files: {offenders} — the engine memo beside the "
        "newest view per token is the only state the handler holds; it writes "
        "no file"
    )


def test_module_imports_only_stdlib_and_hermes_router():
    """The AST imports stay inside stdlib + `fastapi.APIRouter` (Hermes-
    provided) + the plugin's own `_forward` seam."""
    tree = _tree()
    imported = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                imported.add(alias.name)
        elif isinstance(node, ast.ImportFrom):
            module = node.module or ""
            if node.col_offset == 0:  # absolute imports only
                imported.add(module)
            else:  # a relative import inside the plugin package
                imported.add("specstride" + ("." + module if module else ""))
    outside = sorted(
        name for name in imported if name not in ALLOWED_IMPORT_ROOTS
    )
    assert not outside, (
        f"plugin_api.py imports outside the closed allow-list {sorted(ALLOWED_IMPORT_ROOTS)}: "
        f"{outside} — the module imports nothing outside the Python standard "
        "library and what Hermes gives a router (fastapi.APIRouter), plus the "
        "plugin's own stdlib-only `_forward` seam"
    )


class _StubPatch:
    """The slice of `monkeypatch` the fixtures need, for the plain runner."""

    def __init__(self):
        self._undo = []

    def setattr(self, target, name=None, value=None):
        if isinstance(target, str):  # "module.attr" string form
            target, name, value = target, None, name
        if name is None:  # "module.attr" string form
            module_path, _, attr = target.rpartition(".")
            module = sys.modules.get(module_path) or __import__(
                module_path, fromlist=[attr]
            )
            old = getattr(module, attr)
            setattr(module, attr, value)
            self._undo.append((module, attr, old))
        else:
            old = getattr(target, name)
            setattr(target, name, value)
            self._undo.append((target, name, old))


if __name__ == "__main__":
    # Plain `python3` runner (pytest-less environments): run every test
    # function, resolving its fixture parameters in-process, and report a
    # clear failure line for each.
    import inspect

    failures = []
    module = sys.modules[__name__]
    patch = _StubPatch()
    fixture_values = {"recorded_calls": None}
    for name in sorted(dir(module)):
        if name.startswith("test_") and callable(getattr(module, name)):
            func = getattr(module, name)
            for param in getattr(func, "params", [None]):
                try:
                    kwargs = {}
                    for pname in inspect.signature(func).parameters:
                        if pname == "recorded_calls":
                            if fixture_values[pname] is None:
                                fixture_values[pname] = _make_recorded_calls(patch)
                            kwargs[pname] = fixture_values[pname]
                        elif pname == "failing_stub":
                            if fixture_values["recorded_calls"] is None:
                                fixture_values["recorded_calls"] = _make_recorded_calls(patch)
                            kwargs[pname] = _make_failing_stub(fixture_values["recorded_calls"])
                    if param is None:
                        func(_load_plugin_api(), **kwargs)
                    else:
                        func(_load_plugin_api(), op=param, **kwargs)
                except (KeyboardInterrupt, SystemExit):
                    raise
                except BaseException as error:
                    failures.append(f"{name}[{param}]: {error}")
    if failures:
        print(f"{len(failures)} check(s) failed (expected: T064 not implemented):")
        for line in failures:
            print(f"  - {line}")
        sys.exit(1)
    print("all plugin_api checks passed")
