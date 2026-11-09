# Python 3.14 — no `re`, no logic (H3, F150-FR-042)
import json


def register(ctx):
    """Register the commands, tools and hooks of the Specstride plugin."""
    from . import _forward

    ctx.register_command("specstride", _forward.command_handler)
    ctx.register_cli_command("specstride", _forward.command_handler)
    ctx.register_tool("specstride_status", toolset="specstride", default_off=True)(
        _forward.status_tool
    )
    ctx.register_tool("specstride_doctor", toolset="specstride")(_forward.doctor_tool)
    # The hook handlers of contracts/plugin-manifest.md are bound in a later
    # phase (T030+); this phase ships the manifest, the forwarder and the
    # registration surface only.


def _read_table(name, default):
    """A lookup in a Node-written table, or its default."""
    try:
        with open(name, "r", encoding="utf-8") as handle:
            return json.load(handle)
    except Exception:
        return default
