# Python 3.14 — the one subprocess helper of the Specstride plugin (T043,
# H3, F150-FR-042). No `re`, no business logic, no command table: this module
# holds exactly one `subprocess.run` wrapper and nothing else; every caller
# (the glue in `__init__.py` included) goes through `run`, so the pytest
# suite can intercept all subprocess execution by patching
# `_forward.subprocess.run`.
import subprocess


def run(argv, timeout=30, cwd=None):
    """`subprocess.run(argv, shell=False, capture_output=True, text=True,
    timeout)`; returns `(exit, stdout, stderr)`. A timeout is
    `(124, "", "timeout")`; a binary that cannot start is `(127, "", reason)`."""
    try:
        done = subprocess.run(
            list(argv),
            shell=False,
            capture_output=True,
            text=True,
            timeout=timeout,
            cwd=cwd,
        )
    except subprocess.TimeoutExpired:
        return (124, "", "timeout")
    except OSError as error:
        return (127, "", str(error))
    return (done.returncode, done.stdout or "", done.stderr or "")
