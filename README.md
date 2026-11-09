# specstride-hermes — prompt kit

Run in order from this folder (after `cd /root/specstride-hermes`):

| # | File | Paste after |
|---|------|-------------|
| 00 | `prompts/00-grounding-research.md` | (already run 2026-11-08 → `research/A–D`) |
| 01 | `prompts/01-constitution.md` | `/speckit-constitution` |
| 02 | `prompts/02-specify.md` | `/speckit-specify` (runs twice: 150, 151) |
| 03 | `prompts/03-plan.md` | `/speckit-plan` (150, then 151) |
| 04 | `prompts/04-campaign-150.md` | the `specstride-run` skill (dry run first, launch on your explicit "run it") |
| 05 | `prompts/05-relaunch-150.md` | a dsh session at this folder, to relaunch 150 after `launch-mw87nv4l` failed (proposer roles fixed) |

Each prompt may spin up to 4 read-only Sonnet/Haiku research agents.
