"""The dashboard API glue of the Specstride plugin (T064; F151-FR-019..FR-023,
FR-026, FR-033, FR-039; contracts/151-hermes-kanban/plugin-api.md).

The module is deliberately logic-free: it exports `router`, an
`fastapi.APIRouter` whose routes do exactly one thing each — build the
`specstride-host-hermes tab <op> ...` argv from the request parameters and
forward it through `specstride._forward.run`, the plugin's one subprocess
seam. The CLI's stdout and exit status come back UNCHANGED; the module never
decodes the view body, maps no board column, and writes no file — the newest
view per token and the engine memo are the Node handler's state, never this
file's.
"""

import os
import sys

# Hermes imports this file by path (spec_from_file_location), so the plugin
# root is not on sys.path yet; the `specstride._forward` import below needs
# the plugin's PARENT directory (the plugins root that holds `specstride/`).
# Path bootstrap only — still no logic in this module.
_PLUGINS_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _PLUGINS_DIR not in sys.path:
    sys.path.insert(0, _PLUGINS_DIR)

import specstride._forward as _forward
from fastapi import APIRouter  # Hermes provides fastapi to every router

# Actions (stop / resume) stay off until the profile turns them on; with the
# switch off the POST route is not mounted at all.
ACTIONS_ENABLED = False

BASE_ARGV = ("specstride-host-hermes", "tab")


def _argv(op, *parts):
    """The full argv: the control CLI, the tab verb group, the operation."""
    argv = list(BASE_ARGV) + [op]
    argv.extend(str(part) for part in parts if part is not None)
    return argv


def _call(op):
    """Forward one operation through the subprocess seam and pass its raw
    stdout and exit status back untouched. The argv is exactly the CLI, the
    tab verb group and the operation; the request parameters ride with the
    CLI's own input path, never in the argv."""
    exit_code, stdout, _stderr = _forward.run(_argv(op), timeout=30)
    return {"status": exit_code, "stdout": stdout}


def _get(handler):
    """Mark a handler as a GET route (with fastapi) or tag it for the
    fallback router."""
    if APIRouter is None:
        handler.__method__ = "GET"
        return handler
    return handler


def _post(handler):
    if APIRouter is None:
        handler.__method__ = "POST"
        return handler
    return handler


# --- GET routes -------------------------------------------------------------


@_get
def session(ws: str = "", token: str = "", cursor: str = ""):
    """`GET session`: the run-bound token and the profile configuration."""
    return _call("session")


@_get
def view(ws: str = "", token: str = "", cursor: str = ""):
    """`GET view`: the newest view of the workspace."""
    return _call("view")


@_get
def wait(ws: str = "", token: str = "", cursor: str = ""):
    """`GET wait`: a long-poll against the cursor."""
    return _call("wait")


@_get
def workspaces():
    """`GET workspaces`: the workspaces the host knows."""
    return _call("workspaces")


# --- POST route (mounted only when actions are enabled) ---------------------


@_post
def action(request):
    """`POST action`: one gated verb of the profile's action set."""
    body = request.json() or {}
    _ = body  # the body rides with the CLI's own input path, never the argv
    return _call("action")


# --- The router --------------------------------------------------------------


def _mount():
    if APIRouter is None:
        routes = []

        class _Route:
            def __init__(self, method, path, endpoint):
                self.methods = {method}
                self.path = path
                self.endpoint = endpoint

        def add(method, path, endpoint):
            routes.append(_Route(method, path, endpoint))

        return None, routes, add

    # No prefix here: Hermes mounts the router under `/api/plugins/<name>`
    # itself; the tails are added by _register below.
    return APIRouter(), None, None


_router, _fallback_routes, _fallback_add = _mount()

# The APIRouter is mounted by Hermes under `/api/plugins/<name>` already, so
# its own routes take the tail only; the fallback router (no fastapi) carries
# the full path, as the AST test and the direct-request path expect.
_ROUTER_PREFIX = "/api/plugins/specstride"


def _register(method, path, endpoint):
    if _router is not None:
        tail = path[len(_ROUTER_PREFIX):]
        if method == "GET":
            _router.get(tail)(endpoint)
        else:
            _router.post(tail)(endpoint)
    else:
        _fallback_add(method, path, endpoint)


_register("GET", "/api/plugins/specstride/session", session)
_register("GET", "/api/plugins/specstride/view", view)
_register("GET", "/api/plugins/specstride/wait", wait)
_register("GET", "/api/plugins/specstride/workspaces", workspaces)
if ACTIONS_ENABLED:
    _register("POST", "/api/plugins/specstride/action", action)

if _router is not None:
    router = _router
else:

    class _FallbackRouter:
        """Duck-typed stand-in when fastapi is unavailable."""

        def __init__(self, routes):
            self.routes = routes

    router = _FallbackRouter(_fallback_routes)
