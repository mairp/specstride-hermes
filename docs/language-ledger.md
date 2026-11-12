# Language Ledger — 150-host-hermes (plan.md, Principle H3)

Python appears only under `hermes-plugin/`; it forwards, reads files, checks equality and
looks up Node-written tables. It holds no logic of the product and no regular expressions
(a gate fails the build on `import re`).

| Component | Language | Gain over TS | Cost | Interface |
|---|---|---|---|---|
| `hermes-plugin/specstride/__init__.py` | Python 3.14 | Hermes loads only Python plugins | none at install (`python_runtime: external`, no deps) | `register(ctx)`; forwards to `bin/specstride-hermes` / control CLI by argv |
| `hermes-plugin/specstride/_forward.py` | Python 3.14 | the one subprocess helper | — | `subprocess.run(argv, shell=False, timeout)`; golden fixtures |
| `hermes-plugin/specstride/dashboard/plugin_api.py` | Python 3.14 | Hermes routes only Python modules | none at install (`python_runtime: external`, no deps; 151 T008) | `router`; every route forwards argv to `specstride-host-hermes tab <op>` and returns its stdout and status — no parsing, no lane maps, no file writes (contracts/151-hermes-kanban/plugin-api.md) |
| `hermes-plugin/specstride/plugin.yaml` | YAML | manifest | — | Hermes manifest v2 |
| `hermes-plugin/tests/conftest.py` | Python 3.14 (test-only) | pytest imports the glue as a package, no install | none shipped (`hermes-plugin/tests/` is build-only, never packaged) | `sys.path` insert so `import specstride` resolves |
| `hermes-plugin/tests/test_command.py` | Python 3.14 (test-only) | drives the registered handler over the shared golden fixtures with `subprocess.run` patched | none shipped (build-only) | asserts argv, replies and `shell=False` parity with the TypeScript reference |
| `hermes-plugin/tests/test_hooks.py` | Python 3.14 (test-only) | drives the registered hooks over the shared hook golden fixtures; reads the guard rules from the Node reference so the table cannot drift | none shipped (build-only) | asserts returns, silence envs, atomic inbox writes, the no-subprocess and fail-open behaviour, parity with `glue-reference.ts` |
