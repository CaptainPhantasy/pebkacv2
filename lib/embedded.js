// Build-time embedded resources for compiled-binary mode.
//
// When running from source (`bun bin/pebkac.js`), these import attributes
// resolve at runtime from disk — works fine.
//
// When compiled with `bun build --compile`, Bun bundles the contents into
// the binary at build time — so `package.json` and the defense extension
// are always available regardless of where the binary is invoked from.

import { existsSync, readFileSync } from "fs";
import { join } from "path";
import pkg from "../package.json" with { type: "json" };
import extensionSourceText from "../.omp/extensions/pebkac-defense.js" with { type: "text" };
import auditArchiverManifest from "../plugins/recommended/audit-archiver/plugin.json" with { type: "json" };
import auditArchiverSource from "../plugins/recommended/audit-archiver/index.js" with { type: "text" };
import metricsCollectorManifest from "../plugins/recommended/metrics-collector/plugin.json" with { type: "json" };
import metricsCollectorSource from "../plugins/recommended/metrics-collector/index.js" with { type: "text" };
import doctorAutofixManifest from "../plugins/recommended/doctor-autofix/plugin.json" with { type: "json" };
import doctorAutofixSource from "../plugins/recommended/doctor-autofix/index.js" with { type: "text" };

export const PACKAGE = pkg;
export const VERSION = pkg?.version ?? "unknown";
export const NAME = pkg?.name ?? "PEBKAC";
export const EXTENSION_SOURCE = extensionSourceText;
export const RECOMMENDED_PLUGIN_BUNDLES = Object.freeze([
  { manifest: auditArchiverManifest, source: auditArchiverSource },
  { manifest: metricsCollectorManifest, source: metricsCollectorSource },
  { manifest: doctorAutofixManifest, source: doctorAutofixSource },
]);

/**
 * Returns the raw text of the defense extension. Honors an explicit
 * filesystem override (PEBKAC_SOURCE_ROOT) for development workflows,
 * then falls back to the embedded copy bundled at compile time.
 */
export function resolveExtensionSource(repoRoot) {
  const override = process.env.PEBKAC_SOURCE_ROOT;
  if (override) {
    const candidate = join(override, ".omp", "extensions", "pebkac-defense.js");
    if (existsSync(candidate)) return { text: readFileSync(candidate, "utf8"), path: candidate };
  }
  if (repoRoot) {
    const candidate = join(repoRoot, ".omp", "extensions", "pebkac-defense.js");
    if (existsSync(candidate)) return { text: readFileSync(candidate, "utf8"), path: candidate };
  }
  return { text: EXTENSION_SOURCE, path: "<embedded>" };
}
