# The live probe of specs/150-host-hermes (T069, PT-150-049, F150-FR-049)

A person starts this probe; the build never does (H8). It settles **U-150-06**
(HF-GW-SURVIVAL): a detached run launched through `systemd-run --scope` from a
gateway-hosted session survives `systemctl restart hermes-gateway`
(`KillMode=mixed`) and the end of a TUI session. It also measures
**F150-SC-005** (a Telegram notice within 60 s of a state change, once per
change) and **F150-SC-006** (a run started from Telegram is alive after the
gateway restarts).

The probe needs: the package installed in the dedicated `specstride` profile
(`specstride-host-hermes install --profile specstride`), a stub `SPECSTRIDE_BIN`
that records argv and stays alive long enough to be observed, and the
`hermes-gateway` service running. **No model call is made**: the launch goes
through the shim, and the sessions only relay CLI lines.

## Steps

1. **Stub run.** Set `SPECSTRIDE_BIN` to the stub CLI of `tests/stubs/`
   configured to write engine state and emit status changes on a timer, in a
   scratch repository outside this one.

2. **Telegram (gateway-hosted) session.** In a Telegram chat served by the
   gateway, run the `specstride-run` skill's launch step (its `launch`
   command through `specstride-hermes`). Record:
   - the shim's scope line (the `systemd-run --scope` invocation, R6);
   - `systemctl show <scope>` → the runtime root's `CGroup` is NOT under
     `hermes-gateway.service`.

3. **TUI session.** In a local `hermes` TUI session in the same scratch
   repository, launch a second stub run the same way. Record the same two
   facts.

4. **Kill the hosts.** `systemctl restart hermes-gateway`, then end the TUI
   session (Ctrl-C / close the terminal). Do NOT touch the stub processes.

5. **Check survival.** After the gateway is back:
   - `specstride-hermes status` in the scratch repository relays the terse
     line of both runs (they answer);
   - the engine's state root (`$XDG_STATE_HOME/specstride/`) holds both runs'
     state files, with fresh mtimes;
   - `ps` shows both runtime roots alive.

6. **Measure F150-SC-005.** While a run parks on a gate, timestamp the
   engine's state change and the arrival of the Telegram line. The notice is
   one line holding the run, the change and the acting command; the delta is
   ≤ 60 s; a second cycle with NO change produces no second message.

7. **Record.** Write the transcript to
   `evals/probe-results/<date>-live-probe.txt` with date, hermes version
   (`hermes --version`), gateway unit version and the commands used. Then
   **a person** updates the host-facts rows the probe settles:
   - `HF-GW-SURVIVAL` (`src/host-facts.ts` and
     `contracts/150-host-hermes/host-facts.md`): `status: verified`, with
     `verified-on` = the date of the probe — only if every step above passed;
   - otherwise the row stays `unverified` and the transcript names the step
     that failed.

## Results

| Date | Outcome | Transcript |
|---|---|---|
| — | not yet run (the probe is person-started) | — |
