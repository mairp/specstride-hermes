#!/usr/bin/env node
/**
 * The control CLI of the Hermes host (T031, contracts/150-host-hermes/
 * installer-cli.md): `specstride-host-hermes
 * install|uninstall|doctor|watch|eval`. The dispatcher forwards the rest of
 * the argv to the module that owns the command — the installer
 * (`src/installer.ts`), the doctor (`src/doctor.ts`), the watcher (T057) and
 * the eval driver (T068) — and exits with that module's exit code. A usage
 * error exits 3.
 *
 * Source of record: `scripts/specstride-host-hermes.mjs`; `npm run build`
 * copies it to `bin/specstride-host-hermes.mjs` with mode 755 (the build
 * wipes `bin/` and rewrites the shim beside it).
 */
import { run as installerRun } from "../src/installer.ts";
import { run as doctorRun } from "../src/doctor.ts";
import { run as curateRun } from "../src/curate/reconcile.ts";

const argv = process.argv.slice(2);
// The seam `--project <dir>` BEFORE the command fixes the project root; it is
// consumed here so the dispatcher still sees a command as argv[0].
const command = argv[0] === "--project" &&
      ["install", "uninstall", "curate"].includes(argv[2] ?? "")
  ? argv[2]
  : argv[0] ?? "";

/** Print a result and leave its exit code in the process status. */
function finish(result) {
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exit(result.exit);
}

switch (command) {
  case "install":
  case "uninstall":
    finish(installerRun(argv));
    break;
  case "doctor":
    finish(doctorRun(process.argv.slice(2)));
    break;
  case "curate":
    finish(curateRun(argv));
    break;
  case "watch":
  case "eval":
    process.stderr.write(
      `specstride-host-hermes: ${command} is wired by a later task of this feature (watch: T057, eval: T068)\n`,
    );
    process.exit(3);
    break;
  default:
    process.stderr.write(
      "usage: specstride-host-hermes install [--profile <p> | --user | --project]\n" +
        "                                      [--with-kanban]\n" +
        "       specstride-host-hermes uninstall [--profile <p> | --user | --project]\n" +
        "       specstride-host-hermes doctor [--json]\n" +
        "       specstride-host-hermes curate reconcile [--dry-run] [--feature <prefix>]\n" +
        "       specstride-host-hermes watch [--once] [--print-unit]\n" +
        "       specstride-host-hermes eval <suite> [--lane paid|local]\n",
    );
    process.exit(3);
}
