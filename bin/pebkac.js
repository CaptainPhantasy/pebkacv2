#!/usr/bin/env bun
import { existsSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, unlinkSync, statSync, readdirSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

// ANSI color helpers — zero dependencies
const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
};
const NO_COLOR = !!process.env.NO_COLOR;
function c(color, text) { return NO_COLOR ? text : `${C[color]}${text}${C.reset}`; }
function icon(status) {
  if (NO_COLOR) return status === "pass" ? "[PASS]" : status === "fail" ? "[FAIL]" : status === "warn" ? "[WARN]" : status === "info" ? "[INFO]" : "[??]";
  const map = { pass: `${C.green}✔${C.reset}`, fail: `${C.red}✘${C.reset}`, warn: `${C.yellow}⚠${C.reset}`, info: `${C.blue}ℹ${C.reset}` };
  return map[status] ?? "?";
}
function header(text) { return c("bold", c("cyan", text)); }
function label(text) { return c("bold", text); }
function dim(text) { return c("dim", text); }
function green(t) { return c("green", t); }
function red(t) { return c("red", t); }
function yellow(t) { return c("yellow", t); }

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);

function hasFlag(name) {
  return args.includes(name);
}

function optionValue(name, fallback = undefined) {
  const index = args.indexOf(name);
  if (index >= 0 && index + 1 < args.length) return args[index + 1];
  return fallback;
}

function usage() {
  return `PEBKAC Harness

Usage:
  pebkac init --non-interactive --yes [--cwd <path>]
  pebkac status [--cwd <path>]
  pebkac off [--cwd <path>]
  pebkac on [--cwd <path>]
  pebkac launch [--dry-run] [--cwd <path>]
  pebkac doctor [--cwd <path>]
  pebkac version

Init options:
  --verbosity <full|normal|quiet>
  --telemetry / --no-telemetry
  --notifications / --no-notifications
  --health-checks / --no-health-checks

Status:
  Shows extension, config, state, checkpoints, audit log, and runtime info.
  Exit code 0 if healthy, 1 if issues found.
`;
}

function boolFromFlags(enable, disable, fallback) {
  if (hasFlag(disable)) return false;
  if (hasFlag(enable)) return true;
  return fallback;
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function ensureProject(targetCwd) {
  mkdirSync(join(targetCwd, ".omp", "extensions"), { recursive: true });
  mkdirSync(join(targetCwd, ".harness", "state"), { recursive: true });
  mkdirSync(join(targetCwd, ".harness", "checkpoints"), { recursive: true });
  mkdirSync(join(targetCwd, ".harness", "vault"), { recursive: true });
}

function init() {
  const targetCwd = resolve(optionValue("--cwd", process.cwd()));
  const nonInteractive = hasFlag("--non-interactive") || hasFlag("--yes");

  if (!nonInteractive && (!process.stdin.isTTY || !process.stdout.isTTY)) {
    console.error("Interactive onboarding requires a TTY. Re-run with --non-interactive --yes to use explicit defaults.");
    process.exit(2);
  }

  ensureProject(targetCwd);
  copyFileSync(join(repoRoot, ".omp", "extensions", "pebkac-defense.js"), join(targetCwd, ".omp", "extensions", "pebkac-defense.js"));

  // Backward compat: --theme minimal maps to verbosity quiet
  const themeFlag = optionValue("--theme", null);
  let verbosity = optionValue("--verbosity", null);
  if (themeFlag === "minimal" && !verbosity) verbosity = "quiet";
  if (themeFlag === "standard" && !verbosity) verbosity = "full";
  if (!verbosity) verbosity = "full";
  if (!["full", "normal", "quiet"].includes(verbosity)) {
    console.error(`Invalid verbosity: ${verbosity}. Must be full, normal, or quiet.`);
    process.exit(1);
  }
  const theme = verbosity === "quiet" ? "minimal" : "standard";
  const prefs = {
    theme,
    verbosity,
    telemetry: boolFromFlags("--telemetry", "--no-telemetry", true),
    notifications: boolFromFlags("--notifications", "--no-notifications", true),
    healthChecks: boolFromFlags("--health-checks", "--no-health-checks", true),
    capturedAt: new Date().toISOString(),
  };

  writeFileSync(join(targetCwd, ".harness", "config.yaml"), `# PEBKAC Harness Configuration
version: "1.0"

defaults:
  evidence_required: true
  deterministic_prompting: true
  secrets_isolation: true
  git_guard: true
  checkpoint_interval: 10
  verbosity: "${verbosity}"
  enabled: true

# Agent runtime configuration
# Set to "omp", "claude", or "none" for standalone mode
agent_runtime: "omp"

# Install defense extension to all platforms (omp, claude)
platforms: all
`);
  writeJson(join(targetCwd, ".harness", "state", "onboarding-preferences.json"), prefs);
  writeJson(join(targetCwd, ".harness", "state", "telemetry-consent.json"), { enabled: prefs.telemetry });
  writeFileSync(join(targetCwd, ".harness", ".unboxed"), "true\n");

  console.log(header("PEBKAC init complete"));
  console.log(`  ${label("Path")}         ${dim(targetCwd)}`);
  console.log(`  ${label("Verbosity")}    ${verbosity}`);
  console.log(`  ${label("Telemetry")}    ${prefs.telemetry ? green("on") : red("off")}`);
  console.log(`  ${label("Notifications")} ${prefs.notifications ? green("on") : red("off")}`);
  console.log(`  ${label("Health checks")} ${prefs.healthChecks ? green("on") : red("off")}`);
  console.log("");
  console.log(dim("Next steps:"));
  console.log(dim(`  1. Review config: ${join(targetCwd, ".harness", "config.yaml")}`));
  console.log(dim(`  2. Launch session: pebkac launch --cwd ${targetCwd}`));
  console.log(dim(`  3. Check health:   pebkac doctor --cwd ${targetCwd}`));
}

function off() {
  const targetCwd = resolve(optionValue("--cwd", process.cwd()));
  const sentinelPath = join(targetCwd, ".harness", "state", "disabled");
  mkdirSync(join(targetCwd, ".harness", "state"), { recursive: true });
  writeFileSync(sentinelPath, `${new Date().toISOString()}\n`);
  console.log(`${yellow(label("DISABLED"))}  ${dim(targetCwd)}`);
  console.log(`  ${label("Sentinel")}   ${dim(sentinelPath)}`);
  console.log(`  ${label("Re-enable")}  pebkac on --cwd ${targetCwd}`);
  console.log(`  ${label("Per-session")} PEBKAC_OFF=1 <harness-command>`);
}

function on() {
  const targetCwd = resolve(optionValue("--cwd", process.cwd()));
  const sentinelPath = join(targetCwd, ".harness", "state", "disabled");
  if (existsSync(sentinelPath)) {
    unlinkSync(sentinelPath);
    console.log(`${green(label("RE-ENABLED"))}  ${dim(targetCwd)}`);
  } else {
    console.log(`${icon("info")} PEBKAC already enabled for ${dim(targetCwd)}`);
  }
}

function readFileSize(filePath) {
  try {
    const stat = statSync(filePath);
    if (stat.size < 1024) return `${stat.size}B`;
    if (stat.size < 1024 * 1024) return `${(stat.size / 1024).toFixed(1)}KB`;
    return `${(stat.size / (1024 * 1024)).toFixed(1)}MB`;
  } catch {
    return "missing";
  }
}

function countLines(filePath) {
  try {
    const content = readFileSync(filePath, "utf8");
    return content.split("\n").filter(Boolean).length;
  } catch {
    return 0;
  }
}


function statusCommand() {
  const targetCwd = resolve(optionValue("--cwd", process.cwd()));
  const jsonMode = hasFlag("--json");
  const extensionPath = join(targetCwd, ".omp", "extensions", "pebkac-defense.js");
  const configPath = join(targetCwd, ".harness", "config.yaml");
  const sentinelPath = join(targetCwd, ".harness", "state", "disabled");
  const prefsPath = join(targetCwd, ".harness", "state", "onboarding-preferences.json");
  const auditPath = join(targetCwd, ".harness", "audit.log");
  let issues = 0;

  // Extension
  const extensionPresent = existsSync(extensionPath);
  const extensionSize = extensionPresent ? readFileSize(extensionPath) : "missing";
  if (!extensionPresent) issues++;

  // Config
  const configPresent = existsSync(configPath);
  if (!configPresent) issues++;
  let configRuntime = "unset", configVerbosity = "full", configEnabled = "true";
  if (configPresent) {
    try {
      const configText = readFileSync(configPath, "utf8");
      configRuntime = configText.match(/agent_runtime:\s*"?(\w+)"?/)?.[1] ?? "unset";
      configVerbosity = configText.match(/verbosity:\s*"?(\w+)"?/)?.[1] ?? "full";
      configEnabled = configText.match(/enabled:\s*(\w+)/)?.[1] ?? "true";
    } catch {}
  }

  // Disabled state
  const isDisabled = existsSync(sentinelPath);

  // Checkpoints
  const cpDir = join(targetCwd, ".harness", "checkpoints");
  const checkpoints = existsSync(cpDir) ? readdirSync(cpDir).filter(f => f.endsWith(".json")).length : 0;

  // Audit log
  const auditSize = existsSync(auditPath) ? readFileSize(auditPath) : "empty";
  const auditEntries = existsSync(auditPath) ? countLines(auditPath) : 0;

  // Preferences
  let prefs = null;
  if (existsSync(prefsPath)) {
    try { prefs = JSON.parse(readFileSync(prefsPath, "utf8")); } catch {}
  }

  // Runtime
  const runtime = detectRuntime();
  if (!runtime.found) issues++;

  // Session reports
  const reportsDir = join(targetCwd, ".harness", "state");
  const reports = existsSync(reportsDir) ? readdirSync(reportsDir).filter(f => f.startsWith("session-report")).length : 0;

  // Health check
  let healthTime = null;
  const healthPath = join(targetCwd, ".harness", "state", "session-health.json");
  if (existsSync(healthPath)) {
    try { healthTime = JSON.parse(readFileSync(healthPath, "utf8")).startTime ?? null; } catch {}
  }

  if (jsonMode) {
    const output = {
      cwd: targetCwd,
      healthy: issues === 0,
      issues,
      extension: { present: extensionPresent, size: extensionSize },
      config: { present: configPresent, runtime: configRuntime, verbosity: configVerbosity, enabled: configEnabled },
      disabled: isDisabled,
      checkpoints,
      auditLog: { size: auditSize, entries: auditEntries },
      preferences: prefs ? { verbosity: prefs.verbosity ?? prefs.theme ?? "full", notifications: !!prefs.notifications, telemetry: !!prefs.telemetry } : null,
      runtime: { name: runtime.name, found: runtime.found, path: runtime.path },
      sessionReports: reports,
      lastHealthCheck: healthTime,
    };
    console.log(JSON.stringify(output, null, 2));
    if (issues > 0) process.exit(1);
    return;
  }

  // Colorized human output
  console.log(header("PEBKAC Harness Status"));
  console.log(dim("─".repeat(30)));
  console.log(`  ${extensionPresent ? icon("pass") : icon("fail")} ${label("Extension")}  ${extensionPresent ? green(extensionSize) : red("MISSING")}`);
  console.log(`  ${configPresent ? icon("pass") : icon("fail")} ${label("Config")}     ${configPresent ? green("present") : red("MISSING")}`);
  if (configPresent) {
    console.log(`  ${icon("info")} ${label("Runtime")}   ${configRuntime}`);
    console.log(`  ${icon("info")} ${label("Verbosity")} ${configVerbosity}`);
    console.log(`  ${icon("info")} ${label("Enabled")}   ${configEnabled}`);
  }
  console.log(`  ${isDisabled ? icon("warn") : icon("pass")} ${label("Disabled")}  ${isDisabled ? yellow("YES — sentinel file present") : green("no")}`);
  console.log(`  ${icon("info")} ${label("Checkpoints")} ${checkpoints} file${checkpoints !== 1 ? "s" : ""}`);
  console.log(`  ${icon("info")} ${label("Audit log")}  ${auditSize} (${auditEntries} entries)`);
  if (prefs) console.log(`  ${icon("info")} ${label("Prefs")}     verbosity=${prefs.verbosity ?? prefs.theme ?? "full"}, notifications=${prefs.notifications ? green("on") : red("off")}, telemetry=${prefs.telemetry ? green("on") : red("off")}`);
  console.log(`  ${runtime.found ? icon("pass") : icon("fail")} ${label("Runtime")}   ${runtime.found ? green(`${runtime.name} — ${runtime.path}`) : red(`${runtime.name} — NOT FOUND`)}`);
  if (reports > 0) console.log(`  ${icon("info")} ${label("Reports")}   ${reports} session report${reports !== 1 ? "s" : ""}`);
  if (healthTime) console.log(`  ${icon("info")} ${label("Health")}    ${healthTime}`);
  console.log("");
  if (issues > 0) {
    console.log(`${icon("fail")} ${red(`${issues} issue${issues !== 1 ? "s" : ""} found`)}`);
    process.exit(1);
  } else {
    console.log(`${icon("pass")} ${green("All checks passed")}`);
  }
}

function detectRuntime() {
  const runtimes = [
    { name: "omp", cmd: "omp" },
    { name: "claude", cmd: "claude" },
  ];
  for (const rt of runtimes) {
    const result = spawnSync("which", [rt.cmd], { encoding: "utf8" });
    if (result.status === 0 && result.stdout.trim()) {
      return { name: rt.name, found: true, path: result.stdout.trim() };
    }
  }
  // Check first runtime as default
  return { name: runtimes[0].name, found: false, path: null };
}

function readAgentRuntime(cwd) {
  const configPath = join(cwd, ".harness", "config.yaml");
  try {
    const configText = readFileSync(configPath, "utf8");
    const match = configText.match(/agent_runtime:\s*"?(\w+)"?/);
    return match?.[1] ?? "omp";
  } catch {
    return "omp";
  }
}

function launchCommand() {
  const targetCwd = resolve(optionValue("--cwd", process.cwd()));
  const dryRun = hasFlag("--dry-run");
  const runtime = readAgentRuntime(targetCwd);

  if (runtime === "none") {
    console.log(`${icon("info")} Standalone mode ${dim("(agent_runtime: none)")}. No harness to launch.`);
    return;
  }

  const runtimeInfo = detectRuntime();
  const cmd = runtime === "claude" ? "claude" : "omp";

  if (dryRun) {
    console.log(header("Dry run"));
    console.log(`  ${label("Command")}  ${cmd} --cwd ${targetCwd}`);
    console.log(`  ${label("Runtime")}  ${runtimeInfo.found ? green(runtimeInfo.path) : red("NOT FOUND")}`);
    console.log(dim("  Remove --dry-run to execute."));
    return;
  }

  if (!runtimeInfo.found) {
    console.error(`${icon("fail")} ${red(`Runtime "${cmd}" not found on PATH`)}`);
    console.error(dim(`  Run "pebkac doctor" for diagnostics.`));
    process.exit(1);
  }

  console.log(`${icon("info")} Launching ${green(cmd)} in ${dim(targetCwd)}...`);
  const result = spawnSync(cmd, ["--cwd", targetCwd], { stdio: "inherit", cwd: targetCwd });
  process.exit(result.status ?? 1);
}

function doctorCommand() {
  const targetCwd = resolve(optionValue("--cwd", process.cwd()));
  const jsonMode = hasFlag("--json");
  const checks = {};
  let issues = 0;

  // Check 1: Extension file
  const extensionPath = join(targetCwd, ".omp", "extensions", "pebkac-defense.js");
  checks.extension = { present: existsSync(extensionPath), size: existsSync(extensionPath) ? readFileSize(extensionPath) : null };
  if (!checks.extension.present) issues++;

  // Check 2: Config file
  const configPath = join(targetCwd, ".harness", "config.yaml");
  checks.config = { present: existsSync(configPath), valid: false };
  if (existsSync(configPath)) {
    try {
      const text = readFileSync(configPath, "utf8");
      checks.config.valid = text.includes("version:") && text.includes("defaults:");
      if (!checks.config.valid) issues++;
    } catch { issues++; }
  } else { issues++; }

  // Check 3: State directory
  const stateDir = join(targetCwd, ".harness", "state");
  checks.stateDir = { present: existsSync(stateDir) };
  if (!checks.stateDir.present) issues++;

  // Check 4: Sentinel file
  const sentinelPath = join(targetCwd, ".harness", "state", "disabled");
  checks.disabled = { active: existsSync(sentinelPath), since: null };
  if (existsSync(sentinelPath)) {
    try { checks.disabled.since = readFileSync(sentinelPath, "utf8").trim(); } catch {}
    issues++;
  }

  // Check 5: Runtime binary
  const runtime = readAgentRuntime(targetCwd);
  checks.runtime = { name: runtime, found: false, path: null };
  if (runtime === "none") {
    checks.runtime.found = true;
  } else {
    const runtimeInfo = detectRuntime();
    checks.runtime = { name: runtimeInfo.name, found: runtimeInfo.found, path: runtimeInfo.path };
    if (!runtimeInfo.found) issues++;
  }

  // Check 6: Checkpoints directory
  const cpDir = join(targetCwd, ".harness", "checkpoints");
  checks.checkpoints = { present: existsSync(cpDir) };
  if (!checks.checkpoints.present) issues++;

  // Check 7: Vault directory
  const vaultDir = join(targetCwd, ".harness", "vault");
  checks.vault = { present: existsSync(vaultDir) };
  if (!checks.vault.present) issues++;

  if (jsonMode) {
    console.log(JSON.stringify({ cwd: targetCwd, healthy: issues === 0, issues, checks }, null, 2));
    if (issues > 0) process.exit(1);
    return;
  }

  // Colorized human output
  console.log(header("PEBKAC Doctor"));
  console.log(dim("═".repeat(30)));
  console.log(checks.extension.present ? `  ${icon("pass")} ${label("Extension")}  present ${dim(`(${checks.extension.size})`)}` : `  ${icon("fail")} ${red(label("Extension"))}  ${red("MISSING")}`);
  if (!checks.extension.present) console.log(`  ${dim(`Fix: pebkac init --non-interactive --yes --cwd ${targetCwd}`)}`);
  if (checks.config.present && checks.config.valid) {
    console.log(`  ${icon("pass")} ${label("Config")}     present and valid`);
  } else if (checks.config.present) {
    console.log(`  ${icon("fail")} ${red(label("Config"))}     missing required sections`);
  } else {
    console.log(`  ${icon("fail")} ${red(label("Config"))}     ${red("MISSING")}`);
    console.log(`  ${dim(`Fix: pebkac init --non-interactive --yes --cwd ${targetCwd}`)}`);
  }
  console.log(checks.stateDir.present ? `  ${icon("pass")} ${label("State")}      directory exists` : `  ${icon("fail")} ${red(label("State"))}      ${red("MISSING")}`);
  if (!checks.stateDir.present) console.log(`  ${dim(`Fix: pebkac init --non-interactive --yes --cwd ${targetCwd}`)}`);
  if (checks.disabled.active) {
    console.log(`  ${icon("warn")} ${yellow(label("Disabled"))}  ${yellow(`YES — since ${checks.disabled.since}`)}`);
    console.log(`  ${dim(`Fix: pebkac on --cwd ${targetCwd}`)}`);
  } else {
    console.log(`  ${icon("pass")} ${label("Disabled")}  not disabled`);
  }
  if (checks.runtime.found) {
    console.log(`  ${icon("pass")} ${label("Runtime")}   ${green(checks.runtime.name)} ${checks.runtime.path ? dim(checks.runtime.path) : ""}`);
  } else {
    console.log(`  ${icon("fail")} ${red(label("Runtime"))}   ${red(`"${checks.runtime.name}" NOT FOUND on PATH`)}`);
    console.log(`  ${dim(`Fix: Install ${checks.runtime.name} and ensure it's on PATH`)}`);
  }
  console.log(checks.checkpoints.present ? `  ${icon("pass")} ${label("Checkpoints")} directory exists` : `  ${icon("fail")} ${red(label("Checkpoints"))} ${red("MISSING")}`);
  console.log(checks.vault.present ? `  ${icon("pass")} ${label("Vault")}     directory exists` : `  ${icon("fail")} ${red(label("Vault"))}     ${red("MISSING")}`);
  console.log("");
  if (issues === 0) {
    console.log(`${icon("pass")} ${green("All checks passed. PEBKAC is healthy.")}`);
  } else {
    console.log(`${icon("fail")} ${red(`${issues} issue${issues !== 1 ? "s" : ""} found.`)} ${dim("Fix the items above.")}`);
    process.exit(1);
  }
}

function versionCommand() {
  try {
    const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
    console.log(`${header("PEBKAC")} ${green(pkg.version ?? "unknown")} ${dim(`(${pkg.name})`)}`);
  } catch {
    console.log(`${header("PEBKAC")} ${dim("version unknown")}`);
  }
}

const command = args.find((arg) => !arg.startsWith("-")) ?? "help";
if (command === "init") init();
else if (command === "status") statusCommand();
else if (command === "off") off();
else if (command === "on") on();
else if (command === "launch") launchCommand();
else if (command === "doctor") doctorCommand();
else if (command === "version" || hasFlag("--version") || hasFlag("-v")) versionCommand();
else {
  console.log(usage());
  process.exit(command === "help" || hasFlag("--help") ? 0 : 1);
}
