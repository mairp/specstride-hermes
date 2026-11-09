# Language Ledger — 150-host-hermes (plan.md, Principle H3)

Python appears only under `hermes-plugin/`; it forwards, reads files, checks equality and
looks up Node-written tables. It holds no logic of the product and no regular expressions
(a gate fails the build on `import re`).

| Component | Language | Gain over TS | Cost | Interface |
|---|---|---|---|---|
| `hermes-plugin/specstride/__init__.py` | Python 3.14 | Hermes loads only Python plugins | none at install (`python_runtime: external`, no deps) | `register(ctx)`; forwards to `bin/specstride-hermes` / control CLI by argv |
| `hermes-plugin/specstride/_forward.py` | Python 3.14 | the one subprocess helper | — | `subprocess.run(argv, shell=False, timeout)`; golden fixtures |
| `hermes-plugin/specstride/plugin.yaml` | YAML | manifest | — | Hermes manifest v2 |
