import { existsSync, writeFileSync } from "fs";
import { dirname } from "path";
import { ensureDir, harnessPaths } from "./common.js";

export const C = Object.freeze({
  reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m", red: "\x1b[31m", green: "\x1b[32m",
  yellow: "\x1b[33m", blue: "\x1b[34m", magenta: "\x1b[35m", cyan: "\x1b[36m",
});

export function color(name, text, noColor = !!process.env.NO_COLOR) {
  return noColor ? String(text) : `${C[name] ?? ""}${text}${C.reset}`;
}

export function icon(status) {
  const labels = {
    pass: "[PASS]",
    fail: "[FAIL]",
    warn: "[WARN]",
    info: "[INFO]",
    busy: "[BUSY]",
  };
  const colors = { pass: "green", fail: "red", warn: "yellow", info: "cyan", busy: "blue" };
  const label = labels[status] ?? "[INFO]";
  return color(colors[status] ?? "cyan", label);
}

export function makeUi({ quiet = false, json = false } = {}) {
  return {
    quiet,
    json,
    log: (...items) => { if (!quiet && !json) console.log(...items); },
    error: (...items) => { console.error(...items); },
    raw: (...items) => { console.log(...items); },
    header: text => color("bold", color("cyan", text)),
    label: text => color("bold", text),
    dim: text => color("dim", text),
    green: text => color("green", text),
    red: text => color("red", text),
    yellow: text => color("yellow", text),
    icon,
    suggest: text => { console.error(`Suggestion: ${text}`); },
  };
}

export function row(status, name, value, width = 18) {
  return `  ${icon(status)} ${color("bold", name.padEnd(width))} ${value}`;
}

export function groupedHelp(version = "1.0.0") {
  return `PEBKAC ${version}
Defense harness for evidence-first AI coding sessions.

Usage:
  pebkac <command> [options]
  pebkac help [command]

Command Dashboard
  Lifecycle
    init                 Initialize .harness state and install defense surfaces
    launch               Launch configured runtime with PEBKAC loaded
    status               Show concise project health
    doctor               Run deep diagnostics with remediation
    off | on             Disable/re-enable project harness
    mode                 Show or set runtime/verbosity/enablement mode

  Security
    api-keys             Manage provider keys in OS keychain
    hooks                Install/status managed git safety hooks
    platforms            Install/status OMP, Claude, and Pi defense surfaces

  Operations
    config               Get/set/list .harness/config.yaml values
    flags                List/get/set feature flags
    plugins              List and recommend local plugins
    audit                Summarize or tail redacted audit events
    completion           Generate shell completions
    skill                Show the CLI-X 2026 skill applied to this CLI
    version              Print version

Global flags:
  --json               Machine-readable output where supported
  --quiet, -q          Suppress output; exit code only
  --cwd <path>         Target project directory
  --verbose, -V        Include diagnostic details
  --dry-run            Preview launch/install where supported

Quick start:
  1. pebkac init --non-interactive --yes --cwd .
  2. pebkac status --cwd .
  3. pebkac doctor --cwd .

Exit codes: 0 success, 1 health/operation issue, 2 usage error
`;
}

export function commandHelp(command) {
  const help = {
    init: `pebkac init [--non-interactive] [--yes] [--cwd <path>] [--verbosity full|normal|quiet]\n\nCreates .harness state, installs OMP extension, Claude/Pi context, vault config, flags, and optional first-run splash state.`,
    launch: `pebkac launch [--dry-run] [--cwd <path>]\n\nLaunches the configured agent_runtime: omp, claude, pi, or none. Dry-run prints the exact command and preserves --dry-run output for verification.`,
    status: `pebkac status [--json] [--quiet] [--verbose] [--cwd <path>]\n\nShows extension, platform, config, flags, plugin, audit, runtime, checkpoint, and disabled state.`,
    doctor: `pebkac doctor [--json] [--quiet] [--verbose] [--cwd <path>]\n\nRuns deep diagnostics and returns non-zero when required setup is missing or drifted.`,
    config: `pebkac config <get|set|list> [key] [value] [--cwd <path>]\n\nSupports dot notation, e.g. defaults.verbosity, defaults.git_guard, agent_runtime.`,
    "api-keys": `pebkac api-keys <list|add|rotate|remove|test> [provider]\n\nProvider keys are stored in OS keychain. Use --key-from-env VAR for non-interactive secret input. Raw keys are never printed or written to audit logs.`,
    hooks: `pebkac hooks <install|status> [--json] [--cwd <path>]\n\nInstalls/status-checks pre-commit, pre-push, pre-rebase, and commit-msg hooks. Existing hooks are preserved as .local and chained.`,
    platforms: `pebkac platforms <install|status> [omp|claude|pi|all] [--json] [--cwd <path>]\n\nOMP gets .omp/extensions/pebkac-defense.js. Claude and Pi get managed CLAUDE.md defense context.`,
    flags: `pebkac flags <list|get|set> [name] [value] [--json] [--cwd <path>]\n\nPersists known feature flags under .harness/state/feature-flags.json.`,
    plugins: `pebkac plugins <list|recommend> [--json] [--cwd <path>]\n\nScans .harness/plugins and .omp/plugins for package.json/plugin.json manifests.`,
    audit: `pebkac audit <summary|tail> [--limit N] [--json] [--cwd <path>]\n\nReads .harness/audit.log and redacts secret-like values before display.`,
    mode: `pebkac mode <show|set> [key] [value] [--cwd <path>]\n\nKeys: runtime, verbosity, enabled. Runtime values: omp, claude, pi, none.`,
    completion: `pebkac completion <bash|zsh|fish>\n\nPrints shell completion script for all commands and main subcommands. Add it to your shell with eval or source.`,
    skill: `pebkac skill [--cwd <path>]\n\nShows the CLI-X 2026 skill contract used for this CLI UX pass.`,
    version: `pebkac version [--quiet]\n\nPrints product name and version.`,
    off: `pebkac off [--cwd <path>]\n\nCreates .harness/state/disabled. Extension hooks pass through while disabled.`,
    on: `pebkac on [--cwd <path>]\n\nRemoves .harness/state/disabled or reports already enabled.`,
  };
  return help[command] ?? null;
}

export function maybeSplash(cwd, { force = false, quiet = false } = {}) {
  if (quiet) return "";
  const p = harnessPaths(cwd).splashSeen;
  if (!force && existsSync(p)) return "";
  ensureDir(dirname(p));
  writeFileSync(p, new Date().toISOString() + "\n");
  return [
    color("cyan", "╔════════════════════════════════════╗"),
    color("cyan", "║") + color("bold", "  PEBKAC defense harness online  ") + color("cyan", "║"),
    color("cyan", "╚════════════════════════════════════╝"),
  ].join("\n");
}
