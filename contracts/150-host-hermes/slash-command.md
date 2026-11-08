# Contract: `/specstride` (150)

F150-FR-028 to F150-FR-030; research R8. Same verbs as `hermes specstride …`. Works in the TUI,
the CLI chat and Telegram (plugin commands appear in the bot menu, C:185).

| Typed | Action | Model call | Reply |
|---|---|---|---|
| `/specstride status` | `specstride-hermes status` in the session's cwd | no | the CLI's status line(s) and attention items, verbatim |
| `/specstride doctor` | `specstride-host-hermes doctor` | no | the doctor lines |
| `/specstride stop` | `specstride-hermes stop` | no | CLI output verbatim |
| `/specstride stop --now` | `specstride-hermes stop --now` | no | CLI output verbatim |
| `/specstride resume` | `specstride-hermes resume` | no | CLI output verbatim |
| `/specstride run` | none | no | `type /specstride-run to start (invoking it is the consent)` |
| `/specstride dry-run` | none | no | `type /specstride-run dry-run` |
| anything else | none | no | `refused — verbs: run, dry-run, status, stop, stop --now, resume, doctor` |

Typing `stop`, `stop --now` or `resume` is the consent (H1, Principle XV). The model never issues them by tool; a model-proposed stop needs the user's next message to be the typed command.

Command output is data: replies are relayed as text, never re-entered as a prompt. Exit codes of the shim map to a one-line prefix: 127 → `CLI not found — run /specstride doctor`; 4 → the refusal line verbatim.
