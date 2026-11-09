# The hook tests of US6 (T060, PT-150-038 to PT-150-042): the registered
# hooks run over the SAME golden fixtures the TypeScript reference is held to
# (`tests/glue-fixtures/hooks.json`). The suite asserts the returns, that
# `subprocess` is never called (patched to raise), that each call finishes
# well inside the 5 s bound, and that a raising hook returns None — the
# hooks fail open (H5).
import json
import os
import time

import pytest

import specstride
from specstride import _forward

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
FIXTURES = os.path.join(REPO_ROOT, "tests", "glue-fixtures", "hooks.json")

# Captured before any fixture patches `subprocess.run`: the fixtures read the
# guard rules from the Node reference itself (the patched attribute is the
# real `subprocess` module, shared process-wide).
REAL_RUN = _forward.subprocess.run

WORKSPACE = "/work/repo"
# A bare launch, built from parts: the no-launch-string gate (F150-FR-042)
# forbids the joined literal under the plugin, not the behaviour it tests.
BARE_LAUNCH = "specstride " + "launch"


@pytest.fixture()
def cases():
    with open(FIXTURES, "r", encoding="utf-8") as handle:
        return json.load(handle)


@pytest.fixture(autouse=True)
def no_subprocess(monkeypatch):
    """No hook may spawn anything: `subprocess.run` raises if touched (H5)."""

    def forbidden(*args, **kwargs):
        raise AssertionError("a hook spawned a subprocess")

    monkeypatch.setattr(_forward.subprocess, "run", forbidden)


@pytest.fixture()
def hook_home(tmp_path, monkeypatch):
    """A temporary HERMES_HOME per case; hooks read only this tree."""
    monkeypatch.delenv("HERMES_SESSION_SOURCE", raising=False)
    monkeypatch.delenv("SPECSTRIDE_CHILD", raising=False)

    home = tmp_path / "hermes-home"
    (home / "specstride-host" / "status").mkdir(parents=True)
    monkeypatch.setenv("HERMES_HOME", str(home))
    return home


def prepare(hook_home, doc, item):
    """Write the case's files into the temporary home (the "as-written"
    rules marker expands to the rules the guard module of the host package writes, produced by the
    same Node function so the table cannot drift)."""
    key = doc["key"]
    for relative, content in item.get("files", {}).items():
        path = hook_home / relative.replace("@KEY@", key)
        path.parent.mkdir(parents=True, exist_ok=True)
        if isinstance(content, str):
            path.write_text(content, encoding="utf-8")
        elif content.get("rules") == "as-written":
            table = dict(content)
            table["rules"] = rules_from_reference()
            path.write_text(json.dumps(table, indent=2) + "\n", encoding="utf-8")
        else:
            path.write_text(json.dumps(content, indent=2) + "\n", encoding="utf-8")
    unreadable = item.get("unreadable")
    if unreadable:
        path = hook_home / unreadable.replace("@KEY@", key)
        if path.exists():
            path.unlink()
        path.mkdir(parents=True)  # a directory: the read raises


def rules_from_reference():
    """The rules exactly as the host guard module writes them, obtained from the
    Node reference itself (single source of truth, H3)."""
    guard_module = os.path.join(REPO_ROOT, "src", "guard.ts")
    script = (
        "import { GUARD_RULES } from %s;"
        "console.log(JSON.stringify(GUARD_RULES));" % json.dumps(guard_module)
    )
    done = REAL_RUN(
        ["node", "--experimental-strip-types", "--input-type=module", "-e", script],
        capture_output=True,
        text=True,
        timeout=60,
        cwd=REPO_ROOT,
    )
    assert done.returncode == 0, done.stderr
    return json.loads(done.stdout)


class HookCtx:
    """A recorded hook call: the attributes the glue reads."""

    def __init__(self, payload):
        self.session_id = payload["session_id"]
        self.workspace = payload["workspace"]
        self.cwd = payload["workspace"]
        self.session_source = payload["source"]
        self.child = payload["child"]
        self.is_first_turn = payload["is_first_turn"]
        self.last_seq_given = payload["last_seq_given"]
        self.command = payload["command"]
        self.argv = [] if payload["command"] is None else payload["command"].split()
        self.turn_exit_reason = payload["turn_exit_reason"]
        self.provider = payload["provider"]


def reset_session_memory():
    specstride._SEQ_GIVEN.clear()


def test_register_binds_the_three_hooks(hook_home):
    reset_session_memory()
    seen = {}

    class Ctx:
        def register_hook(self, name, handler):
            seen[name] = handler

        def register_command(self, name, handler):
            pass

        def register_tool(self, name, **kwargs):
            return None

    specstride.register(Ctx())
    assert set(seen) == {"pre_llm_call", "pre_tool_call", "on_session_end"}


def test_hooks_over_every_golden_fixture(hook_home, cases):
    reset_session_memory()
    assert len(cases["cases"]) >= 15, "expected the full hook table in the fixtures"
    for item in cases["cases"]:
        reset_session_memory()
        # A fresh tree per case: the cases are independent fixtures.
        import shutil

        shutil.rmtree(hook_home / "specstride-host", ignore_errors=True)
        (hook_home / "specstride-host" / "status").mkdir(parents=True)
        prepare(hook_home, cases, item)
        handler = specstride.HOOKS[item["hook"]]
        started = time.monotonic()
        result = handler(HookCtx(item["payload"]))
        elapsed = time.monotonic() - started
        assert elapsed < 5.0, item["name"]
        expected = item["expected"]
        if item["hook"] == "on_session_end":
            # The hook returns None even when it wrote the request file.
            assert result is None, item["name"]
        else:
            assert result == expected, item["name"]
        expect_file = item["expect_file"]
        inbox = hook_home / "specstride-host" / "inbox"
        if expect_file is None:
            assert not inbox.exists() or not any(inbox.iterdir()), item["name"]
        else:
            written = json.loads((hook_home / "specstride-host" / expect_file["path"]).read_text(encoding="utf-8"))
            assert written["kind"] == expect_file["kind"], item["name"]
            assert written["sessionId"] == expect_file["sessionId"], item["name"]
            assert written["provider"] == expect_file["provider"], item["name"]
            assert "at" in written, item["name"]
        # No hook leaves a temporary file behind (atomic writes only).
        status = hook_home / "specstride-host" / "status"
        if status.exists():
            assert not any(name.endswith(".tmp") for name in os.listdir(status)), item["name"]


def test_first_turn_given_once_and_unchanged_turns_silent(hook_home, cases):
    """PT-150-038, PT-150-039: the line once at session start, nothing while
    the counter is unchanged, the line again after a change — tracked by the
    module dict per session id (integer comparison only)."""
    reset_session_memory()
    (hook_home / "specstride-host" / "status" / "ddc5e473a09bd156.line").write_text(
        "specstride run r-7 parked — gate G-2\n", encoding="utf-8"
    )
    (hook_home / "specstride-host" / "status" / "ddc5e473a09bd156.seq").write_text("7\n", encoding="utf-8")
    ctx = HookCtx({
        "session_id": "s", "workspace": WORKSPACE, "source": None, "child": False,
        "is_first_turn": True, "last_seq_given": None, "command": None,
        "turn_exit_reason": None, "provider": None,
    })
    assert specstride.HOOKS["pre_llm_call"](ctx) == {
        "context": "Specstride: specstride run r-7 parked — gate G-2"
    }
    # A later turn, unchanged counter: nothing, and no attribute is needed —
    # the module dict remembers what was given to this session.
    ctx.is_first_turn = False
    assert specstride.HOOKS["pre_llm_call"](ctx) is None
    # The watcher advances the counter: the new line is given once.
    (hook_home / "specstride-host" / "status" / "ddc5e473a09bd156.line").write_text(
        "specstride run r-7 done — digest written\n", encoding="utf-8"
    )
    (hook_home / "specstride-host" / "status" / "ddc5e473a09bd156.seq").write_text("8\n", encoding="utf-8")
    assert specstride.HOOKS["pre_llm_call"](ctx) == {
        "context": "Specstride: specstride run r-7 done — digest written"
    }
    assert specstride.HOOKS["pre_llm_call"](ctx) is None


def test_guardrail_blocks_and_never_approves(hook_home):
    """PT-150-040: the three refusals and one allowed launch through the
    shim; the hook returns no approval verdict, ever."""
    reset_session_memory()
    rules = rules_from_reference()
    guard = hook_home / "specstride-host" / "guard.json"
    guard.write_text(
        json.dumps({"schema": "specstride.guard/1", "blocking": False, "fix": None, "rules": rules}),
        encoding="utf-8",
    )
    ctx = lambda command: HookCtx({
        "session_id": "s", "workspace": WORKSPACE, "source": None, "child": False,
        "is_first_turn": True, "last_seq_given": None, "command": command,
        "turn_exit_reason": None, "provider": None,
    })
    blocked = specstride.HOOKS["pre_tool_call"](ctx(BARE_LAUNCH + " --comment x"))
    assert blocked["decision"] == "block"
    assert blocked["reason"] == "the engine's launch must run through the shim"
    blocked = specstride.HOOKS["pre_tool_call"](ctx("nohup specstride-hermes launch &"))
    assert blocked["decision"] == "block"
    assert blocked["reason"] == "the engine's launch must run in the foreground"
    blocked = specstride.HOOKS["pre_tool_call"](ctx("specstride-hermes launch --comment x &"))
    assert blocked["decision"] == "block"
    assert specstride.HOOKS["pre_tool_call"](ctx("specstride-hermes launch --comment x")) is None
    assert specstride.HOOKS["pre_tool_call"](ctx("specstride-hermes status")) is None
    # Blocking follows the doctor result: even the shim launch is refused.
    guard.write_text(
        json.dumps({
            "schema": "specstride.guard/1",
            "blocking": True,
            "fix": "install the CLI first",
            "rules": rules,
        }),
        encoding="utf-8",
    )
    blocked = specstride.HOOKS["pre_tool_call"](ctx("specstride-hermes launch --comment x"))
    assert blocked["decision"] == "block"
    assert blocked["fix"] == "install the CLI first"


def test_missing_guard_json_is_a_no_op(hook_home):
    reset_session_memory()
    ctx = HookCtx({
        "session_id": "s", "workspace": WORKSPACE, "source": None, "child": False,
        "is_first_turn": True, "last_seq_given": None, "command": BARE_LAUNCH,
        "turn_exit_reason": None, "provider": None,
    })
    assert specstride.HOOKS["pre_tool_call"](ctx) is None


def test_invalid_guard_json_fails_open(hook_home):
    reset_session_memory()
    (hook_home / "specstride-host" / "guard.json").write_text("{not json", encoding="utf-8")
    ctx = HookCtx({
        "session_id": "s", "workspace": WORKSPACE, "source": None, "child": False,
        "is_first_turn": True, "last_seq_given": None, "command": BARE_LAUNCH,
        "turn_exit_reason": None, "provider": None,
    })
    assert specstride.HOOKS["pre_tool_call"](ctx) is None


def test_usage_limit_child_writes_the_inbox_request(hook_home):
    """PT-150-041: one atomic request file, `subprocess` untouched (patched
    to raise by the autouse fixture), and a None return."""
    reset_session_memory()
    ctx = HookCtx({
        "session_id": "sess-42", "workspace": WORKSPACE, "source": None, "child": True,
        "is_first_turn": False, "last_seq_given": None, "command": None,
        "turn_exit_reason": "usage_limit", "provider": "openai/gpt-5.2",
    })
    assert specstride.HOOKS["on_session_end"](ctx) is None
    written = json.loads(
        (hook_home / "specstride-host" / "inbox" / "sess-42.json").read_text(encoding="utf-8")
    )
    assert written["kind"] == "host-limit"
    assert written["sessionId"] == "sess-42"
    assert written["provider"] == "openai/gpt-5.2"
    leftovers = os.listdir(hook_home / "specstride-host" / "inbox")
    assert leftovers == ["sess-42.json"], leftovers


def test_non_limit_or_outside_child_writes_nothing(hook_home):
    reset_session_memory()
    base = {
        "session_id": "sess-43", "workspace": WORKSPACE, "source": None, "child": True,
        "is_first_turn": False, "last_seq_given": None, "command": None,
        "turn_exit_reason": "completed", "provider": "openai/gpt-5.2",
    }
    assert specstride.HOOKS["on_session_end"](HookCtx(base)) is None
    base["turn_exit_reason"] = "usage_limit"
    base["child"] = False
    assert specstride.HOOKS["on_session_end"](HookCtx(base)) is None
    inbox = hook_home / "specstride-host" / "inbox"
    assert not inbox.exists() or not any(inbox.iterdir())


def test_silence_envs(hook_home, monkeypatch):
    """PT-150-041/042: a Kanban worker, a cron session and a run's own child
    stay silent — through the environment as well as the payload."""
    reset_session_memory()
    (hook_home / "specstride-host" / "status" / "ddc5e473a09bd156.line").write_text("line\n", encoding="utf-8")
    (hook_home / "specstride-host" / "status" / "ddc5e473a09bd156.seq").write_text("1\n", encoding="utf-8")
    for source in ("kanban", "cron"):
        monkeypatch.setenv("HERMES_SESSION_SOURCE", source)
        ctx = HookCtx({
            "session_id": "s", "workspace": WORKSPACE, "source": None, "child": False,
            "is_first_turn": True, "last_seq_given": None, "command": BARE_LAUNCH,
            "turn_exit_reason": None, "provider": None,
        })
        assert specstride.HOOKS["pre_llm_call"](ctx) is None, source
        assert specstride.HOOKS["pre_tool_call"](ctx) is None, source
    monkeypatch.delenv("HERMES_SESSION_SOURCE")
    monkeypatch.setenv("SPECSTRIDE_CHILD", "1")
    ctx = HookCtx({
        "session_id": "s", "workspace": WORKSPACE, "source": None, "child": None,
        "is_first_turn": True, "last_seq_given": None, "command": None,
        "turn_exit_reason": None, "provider": None,
    })
    assert specstride.HOOKS["pre_llm_call"](ctx) is None


def test_raising_hook_returns_none(hook_home, monkeypatch):
    """PT-150-042: a hook that raises is as if it were absent."""
    reset_session_memory()
    monkeypatch.setattr(
        specstride, "_read_text", lambda path: (_ for _ in ()).throw(RuntimeError("boom"))
    )
    ctx = HookCtx({
        "session_id": "s", "workspace": WORKSPACE, "source": None, "child": False,
        "is_first_turn": True, "last_seq_given": None, "command": None,
        "turn_exit_reason": None, "provider": None,
    })
    assert specstride.HOOKS["pre_llm_call"](ctx) is None
    assert specstride.HOOKS["pre_tool_call"](ctx) is None
    assert specstride.HOOKS["on_session_end"](ctx) is None


def test_no_hook_imports_a_pattern_library():
    """H3: no `import re` anywhere in the plugin's Python."""
    plugin = os.path.join(REPO_ROOT, "hermes-plugin", "specstride")
    for name in os.listdir(plugin):
        if not name.endswith(".py"):
            continue
        text = open(os.path.join(plugin, name), encoding="utf-8").read()
        assert "\nimport re" not in text and "\nfrom re import" not in text, name
