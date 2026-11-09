# The slash-command glue tests of US3 (T040, PT-150-028, PT-150-029,
# PT-150-030): the registered `specstride` handler runs over the SAME golden
# fixtures the TypeScript reference is held to
# (`tests/glue-fixtures/slash-command.json`), with `subprocess.run` patched,
# and the pytest suite asserts identical argv and identical replies — plus
# that `subprocess.run` is never called with `shell=True` (H3).
import json
import os
import subprocess
import types

import pytest

import specstride
from specstride import _forward

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
FIXTURES = os.path.join(REPO_ROOT, "tests", "glue-fixtures", "slash-command.json")

SHIM = "/fixture/bin/specstride-hermes"
CONTROL = "/fixture/bin/specstride-host-hermes"


class FakeCtx:
    """A `ctx` that records every registration, as the manifest declares."""

    def __init__(self):
        self.commands = {}
        self.cli_commands = {}
        self.tools = {}
        self.skills = []

    def register_command(self, name, handler, *args, **kwargs):
        self.commands[name] = handler

    def register_cli_command(self, name, handler, *args, **kwargs):
        self.cli_commands[name] = handler

    def register_tool(self, name, **kwargs):
        self.tools[name] = kwargs

        def decorate(handler):
            return handler

        return decorate

    def register_skill(self, name, path):
        self.skills.append((name, path))


class HandlerCtx:
    """The per-invocation context the handler reads: the typed argv."""

    def __init__(self, argv, cwd=None):
        self.argv = argv
        self.cwd = cwd


@pytest.fixture()
def glue_home(tmp_path, monkeypatch):
    """A fixture root holding `_paths.json` and a `skills/` directory, as the
    installer would have written them (temporary homes only)."""
    root = tmp_path / "specstride-host"
    (root / "skills").mkdir(parents=True)
    (root / "_paths.json").write_text(json.dumps({"bin": os.path.dirname(SHIM)}))
    monkeypatch.setenv("SPECSTRIDE_HOST_ROOT", str(root))
    return root


@pytest.fixture()
def cases():
    with open(FIXTURES, "r", encoding="utf-8") as handle:
        return json.load(handle)["cases"]


@pytest.fixture()
def calls(monkeypatch):
    """Every `subprocess.run` call the glue makes, recorded; the exit, stdout
    and stderr come from the fixture's `stub_result` (the stub CLI)."""
    recorded = []

    def fake_run(argv, shell=False, capture_output=False, text=False, timeout=None, cwd=None):
        recorded.append({"argv": list(argv), "shell": shell, "cwd": cwd})
        last = recorded[-1]
        answer = fake_run.scripted[-1]
        return types.SimpleNamespace(
            returncode=answer["exit"], stdout=answer["stdout"], stderr=answer["stderr"]
        )

    fake_run.scripted = []
    monkeypatch.setattr(_forward.subprocess, "run", fake_run)
    return recorded


def expand(entry):
    return SHIM if entry == "$SHIM" else CONTROL if entry == "$CONTROL" else entry


def test_register_records_the_manifest_surface(glue_home):
    ctx = FakeCtx()
    specstride.register(ctx)
    assert "specstride" in ctx.commands
    assert "specstride" in ctx.cli_commands
    assert ctx.tools["specstride_status"] == {"toolset": "specstride", "default_off": True}
    assert ctx.tools["specstride_doctor"] == {"toolset": "specstride", "default_off": True}
    # The bundled skills of the build, registered by name.
    registered = [name for name, _path in ctx.skills]
    assert "specstride-run" in registered
    assert "specstride-doctor" in registered


def test_handler_over_every_golden_fixture(glue_home, cases, calls):
    handler = None
    ctx = FakeCtx()
    specstride.register(ctx)
    handler = ctx.commands["specstride"]
    assert handler is not None
    for item in cases:
        calls.clear()
        _forward.subprocess.run.scripted = [item["stub_result"]]
        invoked = HandlerCtx(item["raw_args"].split(), cwd=item["cwd"])
        reply = handler(invoked)
        assert reply == item["expected_reply"], item["name"]
        expected_argv = item["expected_argv"]
        if expected_argv is None:
            assert calls == [], item["name"]
        else:
            assert len(calls) == 1, item["name"]
            assert calls[0]["argv"] == [expand(entry) for entry in expected_argv], item["name"]
            assert calls[0]["cwd"] == item["cwd"], item["name"]


def test_subprocess_is_never_given_a_shell(glue_home, cases, calls):
    ctx = FakeCtx()
    specstride.register(ctx)
    handler = ctx.commands["specstride"]
    for item in cases:
        calls.clear()
        _forward.subprocess.run.scripted = [item["stub_result"]]
        handler(HandlerCtx(item["raw_args"].split(), cwd=item["cwd"]))
        for call in calls:
            assert call["shell"] is False, item["name"]


def test_missing_paths_json_replies_not_installed(tmp_path, monkeypatch):
    empty = tmp_path / "empty"
    empty.mkdir()
    monkeypatch.setenv("SPECSTRIDE_HOST_ROOT", str(empty))
    ctx = FakeCtx()
    specstride.register(ctx)
    handler = ctx.commands["specstride"]
    reply = handler(HandlerCtx(["status"]))
    assert reply == "Specstride not installed — run specstride-host-hermes install"


def test_unknown_verb_reaches_no_subprocess(glue_home, calls):
    ctx = FakeCtx()
    specstride.register(ctx)
    handler = ctx.commands["specstride"]
    reply = handler(HandlerCtx(["deploy"]))
    assert reply.startswith("refused — verbs:")
    assert calls == []


def test_real_subprocess_always_uses_shell_false(glue_home, monkeypatch):
    """The unpatched `run` helper passes shell=False literally."""
    source = open(os.path.join(REPO_ROOT, "hermes-plugin", "specstride", "_forward.py"), encoding="utf-8").read()
    assert "shell=False" in source
    assert "shell=True" not in source
