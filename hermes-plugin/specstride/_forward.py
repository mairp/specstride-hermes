# Python 3.14 — the one subprocess helper (H3, F150-FR-042)
import json
import os
import subprocess

TIMEOUT_SECONDS = 30
DEFAULT_REPLY = "Specstride not installed - run specstride-host-hermes install"


def bin_directory():
    """The `bin/` next to this package, from the installer's `_paths.json`."""
    here = os.path.dirname(os.path.abspath(__file__))
    try:
        with open(os.path.join(here, "_paths.json"), "r", encoding="utf-8") as handle:
            paths = json.load(handle)
        return paths["bin"]
    except Exception:
        return os.path.join(here, "bin")


def run(argv, timeout=TIMEOUT_SECONDS):
    """`subprocess.run(argv, shell=False, timeout)`; the reply is data."""
    shim = os.path.join(bin_directory(), "specstride-hermes")
    try:
        done = subprocess.run([shim] + list(argv), shell=False, timeout=timeout, capture_output=True)
    except (OSError, subprocess.TimeoutExpired):
        return DEFAULT_REPLY
    text = done.stdout.decode("utf-8", "replace").strip()
    return text if text else DEFAULT_REPLY


def command_handler(ctx):
    """The `specstride` slash/CLI verb: forward the argv verbatim."""
    return run(ctx.argv)


def status_tool(ctx):
    """Forward `status` through the shim; read-only."""
    return run(["status"])


def doctor_tool(ctx):
    """Forward the host doctor; read-only."""
    return run(["doctor"])
