/**
 * The CI resolver hook of the per-change gate (F150-FR-043, F150-SC-004,
 * research R12): run the gate with
 *
 *     NODE_OPTIONS="--import=./tests/helpers/no-model-dns.mjs" npm run gate
 *
 * and any DNS lookup of a hostname from `tests/helpers/provider-hosts.json`
 * fails the run. The gate must make 0 model calls; a lookup of a provider
 * hostname is the only observable a model call leaves behind in a network-
 * blocked job.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import dns from "node:dns";

const HERE = dirname(fileURLToPath(import.meta.url));
const { hosts } = JSON.parse(readFileSync(join(HERE, "provider-hosts.json"), "utf8"));
const blocked = new Set(hosts);

function fail(host) {
  // A throw inside a resolver callback fails the lookup, not the process, so
  // the refusal is recorded and every such lookup is counted for the report.
  const message = `no-model-dns: blocked provider lookup of ${host} (the gate must make 0 model calls)`;
  process.stderr.write(message + "\n");
  process.exitCode = 1;
}

const lookup = dns.lookup;
dns.lookup = function patchedLookup(host, ...rest) {
  if (typeof host === "string" && blocked.has(host)) fail(host);
  return lookup.call(dns, host, ...rest);
};

const Resolver = dns.Resolver;
const originalResolve = Resolver.prototype.resolve;
Resolver.prototype.resolve = function patchedResolve(name, ...rest) {
  if (blocked.has(name)) fail(name);
  return originalResolve.call(this, name, ...rest);
};

const originalResolve4 = Resolver.prototype.resolve4;
Resolver.prototype.resolve4 = function patchedResolve4(name, ...rest) {
  if (blocked.has(name)) fail(name);
  return originalResolve4.call(this, name, ...rest);
};

const originalResolve6 = Resolver.prototype.resolve6;
Resolver.prototype.resolve6 = function patchedResolve6(name, ...rest) {
  if (blocked.has(name)) fail(name);
  return originalResolve6.call(this, name, ...rest);
};
