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

const quietMode = hasFlag("--quiet") || hasFlag("-q");
const verboseMode = hasFlag("--verbose") || hasFlag("-V");
function quietLog(...items) { if (!quietMode) console.log(...items); }
function verboseLog(...items) { if (verboseMode && !quietMode) console.log(dim(`  ${items.join(" ")}`)); }
function suggest(msg) { console.error(dim(`  Suggestion: ${msg}`)); }
function tableRow(statusIcon, labelText, valueText, width = 13) {
  return `  ${statusIcon} ${labelText.padEnd(width)} ${valueText}`;
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
  pebkac status [--json] [--quiet] [-q] [--cwd <path>]
  pebkac off [--cwd <path>]
  pebkac on [--cwd <path>]
  pebkac launch [--dry-run] [--quiet] [-q] [--cwd <path>]
  pebkac doctor [--json] [--quiet] [-q] [--cwd <path>]
  pebkac version [-q]
  pebkac config get <key>
  pebkac config set <key> <value>
  pebkac completion <bash|zsh|fish>

Init options:
  --verbosity <full|normal|quiet>
  --telemetry / --no-telemetry
  --notifications / --no-notifications
  --health-checks / --no-health-checks

Global flags:
  --json              Machine-readable JSON output (status, doctor)
  --quiet, -q         Suppress all output; exit code only
  --cwd <path>        Target project directory

Exit codes: 0 = success/healthy, 1 = issues found, 2 = usage error
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
    suggest("pebkac init --non-interactive --yes --cwd .");
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

  quietLog(header("PEBKAC init complete"));
  quietLog(`  ${label("Path")}         ${dim(targetCwd)}`);
  quietLog(`  ${label("Verbosity")}    ${verbosity}`);
  quietLog(`  ${label("Telemetry")}    ${prefs.telemetry ? green("on") : red("off")}`);
  quietLog(`  ${label("Notifications")} ${prefs.notifications ? green("on") : red("off")}`);
  quietLog(`  ${label("Health checks")} ${prefs.healthChecks ? green("on") : red("off")}`);
  quietLog("");
  quietLog(dim("Next steps:"));
  quietLog(dim(`  1. Review config: ${join(targetCwd, ".harness", "config.yaml")}`));
  quietLog(dim(`  2. Launch session: pebkac launch --cwd ${targetCwd}`));
  quietLog(dim(`  3. Check health:   pebkac doctor --cwd ${targetCwd}`));
}

function off() {
  const targetCwd = resolve(optionValue("--cwd", process.cwd()));
  const sentinelPath = join(targetCwd, ".harness", "state", "disabled");
  mkdirSync(join(targetCwd, ".harness", "state"), { recursive: true });
  writeFileSync(sentinelPath, `${new Date().toISOString()}\n`);
  quietLog(`${yellow(label("DISABLED"))}  ${dim(targetCwd)}`);
  quietLog(`  ${label("Sentinel")}   ${dim(sentinelPath)}`);
  quietLog(`  ${label("Re-enable")}  pebkac on --cwd ${targetCwd}`);
  quietLog(`  ${label("Per-session")} PEBKAC_OFF=1 <harness-command>`);
}

function on() {
  const targetCwd = resolve(optionValue("--cwd", process.cwd()));
  const sentinelPath = join(targetCwd, ".harness", "state", "disabled");
  if (existsSync(sentinelPath)) {
    unlinkSync(sentinelPath);
    quietLog(`${green(label("RE-ENABLED"))}  ${dim(targetCwd)}`);
  } else {
    quietLog(`${icon("info")} PEBKAC already enabled for ${dim(targetCwd)}`);
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
    quietLog(JSON.stringify(output, null, 2));
    if (issues > 0) process.exit(1);
    return;
  }
  // Table-formatted output
  quietLog(header("PEBKAC Harness Status"));
  quietLog(dim("─".repeat(40)));
  quietLog(tableRow(extensionPresent ? icon("pass") : icon("fail"), label("Extension"), extensionPresent ? green(extensionSize) : red("MISSING")));
  quietLog(tableRow(configPresent ? icon("pass") : icon("fail"), label("Config"), configPresent ? green("present") : red("MISSING")));
  if (configPresent) {
    quietLog(tableRow(icon("info"), label("Runtime"), configRuntime));
    quietLog(tableRow(icon("info"), label("Verbosity"), configVerbosity));
    quietLog(tableRow(icon("info"), label("Enabled"), configEnabled));
  }
  quietLog(tableRow(isDisabled ? icon("warn") : icon("pass"), label("Disabled"), isDisabled ? yellow("YES — sentinel file present") : green("no")));
  quietLog(tableRow(icon("info"), label("Checkpoints"), `${checkpoints} file${checkpoints !== 1 ? "s" : ""}`));
  quietLog(tableRow(icon("info"), label("Audit log"), `${auditSize} (${auditEntries} entries)`));
  if (prefs) quietLog(tableRow(icon("info"), label("Prefs"), `verbosity=${prefs.verbosity ?? prefs.theme ?? "full"}, notifications=${prefs.notifications ? green("on") : red("off")}, telemetry=${prefs.telemetry ? green("on") : red("off")}`));
  quietLog(tableRow(runtime.found ? icon("pass") : icon("fail"), label("Runtime"), runtime.found ? green(`${runtime.name} — ${runtime.path}`) : red(`${runtime.name} — NOT FOUND`)));
  if (reports > 0) quietLog(tableRow(icon("info"), label("Reports"), `${reports} session report${reports !== 1 ? "s" : ""}`));
  if (healthTime) quietLog(tableRow(icon("info"), label("Health"), healthTime));
  // Verbose diagnostics
  if (verboseMode) {
    quietLog("");
    quietLog(dim("── Verbose ──"));
    verboseLog(`extension: ${extensionPath}`);
    verboseLog(`config: ${configPath}`);
    verboseLog(`sentinel: ${sentinelPath} ${isDisabled ? "(present)" : "(absent)"}`);
    verboseLog(`preferences: ${prefsPath}`);
    verboseLog(`audit: ${auditPath}`);
    verboseLog(`checkpoints: ${cpDir}`);
    verboseLog(`health: ${healthPath}`);
    verboseLog(`cwd: ${targetCwd}`);
    if (prefs) verboseLog(`raw prefs: ${JSON.stringify(prefs)}`);
  }
  quietLog("");
  if (issues > 0) {
    quietLog(`${icon("fail")} ${red(`${issues} issue${issues !== 1 ? "s" : ""} found`)}`);
    quietLog(dim(`  Run "pebkac doctor" for detailed diagnostics.`));
    process.exit(1);
  } else {
    quietLog(`${icon("pass")} ${green("All checks passed")}`);
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
    quietLog(`${icon("info")} Standalone mode ${dim("(agent_runtime: none)")}. No harness to launch.`);
    return;
  }

  const runtimeInfo = detectRuntime();
  const cmd = runtime === "claude" ? "claude" : "omp";

  if (dryRun) {
    quietLog(header("Dry run"));
    quietLog(`  ${label("Command")}  ${cmd} --cwd ${targetCwd}`);
    quietLog(`  ${label("Runtime")}  ${runtimeInfo.found ? green(runtimeInfo.path) : red("NOT FOUND")}`);
    quietLog(dim("  Remove --dry-run to execute."));
    return;
  }

  if (!runtimeInfo.found) {
    console.error(`${icon("fail")} ${red(`Runtime "${cmd}" not found on PATH`)}`);
    console.error(dim(`  Run "pebkac doctor" for diagnostics.`));
    process.exit(1);
  }

  quietLog(`${icon("info")} Launching ${green(cmd)} in ${dim(targetCwd)}...`);
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
    quietLog(JSON.stringify({ cwd: targetCwd, healthy: issues === 0, issues, checks }, null, 2));
    if (issues > 0) process.exit(1);
    return;
  }

  // Table-formatted output
  quietLog(header("PEBKAC Doctor"));
  quietLog(dim("═".repeat(40)));
  quietLog(tableRow(checks.extension.present ? icon("pass") : icon("fail"), label("Extension"), checks.extension.present ? green(`present ${dim(`(${checks.extension.size})`)}`) : red("MISSING")));
  if (!checks.extension.present) quietLog(`  ${dim(`Fix: pebkac init --non-interactive --yes --cwd ${targetCwd}`)}`);
  if (checks.config.present && checks.config.valid) {
    quietLog(tableRow(icon("pass"), label("Config"), green("present and valid")));
  } else if (checks.config.present) {
    quietLog(tableRow(icon("fail"), label("Config"), red("missing required sections")));
  } else {
    quietLog(tableRow(icon("fail"), label("Config"), red("MISSING")));
    quietLog(`  ${dim(`Fix: pebkac init --non-interactive --yes --cwd ${targetCwd}`)}`);
  }
  quietLog(tableRow(checks.stateDir.present ? icon("pass") : icon("fail"), label("State"), checks.stateDir.present ? green("directory exists") : red("MISSING")));
  if (!checks.stateDir.present) quietLog(`  ${dim(`Fix: pebkac init --non-interactive --yes --cwd ${targetCwd}`)}`);
  if (checks.disabled.active) {
    quietLog(tableRow(icon("warn"), label("Disabled"), yellow(`YES — since ${checks.disabled.since}`)));
    quietLog(`  ${dim(`Fix: pebkac on --cwd ${targetCwd}`)}`);
  } else {
    quietLog(tableRow(icon("pass"), label("Disabled"), green("not disabled")));
  }
  if (checks.runtime.found) {
    quietLog(tableRow(icon("pass"), label("Runtime"), `${green(checks.runtime.name)} ${checks.runtime.path ? dim(checks.runtime.path) : ""}`));
  } else {
    quietLog(tableRow(icon("fail"), label("Runtime"), red(`"${checks.runtime.name}" NOT FOUND on PATH`)));
    quietLog(`  ${dim(`Fix: Install ${checks.runtime.name} and ensure it's on PATH`)}`);
  }
  quietLog(tableRow(checks.checkpoints.present ? icon("pass") : icon("fail"), label("Checkpoints"), checks.checkpoints.present ? green("directory exists") : red("MISSING")));
  quietLog(tableRow(checks.vault.present ? icon("pass") : icon("fail"), label("Vault"), checks.vault.present ? green("directory exists") : red("MISSING")));
  // Verbose diagnostics
  if (verboseMode) {
    quietLog("");
    quietLog(dim("── Verbose ──"));
    verboseLog(`extension: ${join(targetCwd, ".omp", "extensions", "pebkac-defense.js")}`);
    verboseLog(`config: ${join(targetCwd, ".harness", "config.yaml")}`);
    verboseLog(`state: ${join(targetCwd, ".harness", "state")}`);
    verboseLog(`checkpoints: ${join(targetCwd, ".harness", "checkpoints")}`);
    verboseLog(`vault: ${join(targetCwd, ".harness", "vault")}`);
    verboseLog(`cwd: ${targetCwd}`);
    verboseLog(`checks: ${JSON.stringify(checks)}`);
  }
  quietLog("");
  if (issues === 0) {
    quietLog(`${icon("pass")} ${green("All checks passed. PEBKAC is healthy.")}`);
  } else {
    quietLog(`${icon("fail")} ${red(`${issues} issue${issues !== 1 ? "s" : ""} found.`)} ${dim("Fix the items above.")}`);
    process.exit(1);
  }
}

function versionCommand() {
  try {
    const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
    quietLog(`${header("PEBKAC")} ${green(pkg.version ?? "unknown")} ${dim(`(${pkg.name})`)}`);
  } catch {
    quietLog(`${header("PEBKAC")} ${dim("version unknown")}`);
  }
}

function configCommand() {
  const sub = args[args.indexOf("config") + 1];
  const targetCwd = resolve(optionValue("--cwd", process.cwd()));
  const configPath = join(targetCwd, ".harness", "config.yaml");

  if (!existsSync(configPath)) {
    console.error(`${red("No config found.")} Run ${dim("pebkac init")} first.`);
    process.exit(1);
  }

  const configText = readFileSync(configPath, "utf8");

  // Simple YAML value reader — handles key: value and quoted strings
  function getYamlValue(text, key) {
    // Support dot-notation: "defaults.evidence_required" → section=defaults, leaf=evidence_required
    const parts = key.split(".");
    if (parts.length === 2) {
      const sectionRe = new RegExp(`^${parts[0]}:\\s*$`, "m");
      const sectionMatch = sectionRe.exec(text);
      if (!sectionMatch) return undefined;
      const afterSection = text.slice(sectionMatch.index);
      const nextSection = afterSection.indexOf("\n\n");
      const block = nextSection > 0 ? afterSection.slice(0, nextSection) : afterSection;
      const leafRe = new RegExp(`^\\s+${parts[1]}:\\s*(.+)$`, "m");
      const m = leafRe.exec(block);
      return m ? m[1].replace(/^["']|["']$/g, "").trim() : undefined;
    }
    const re = new RegExp(`^${parts[0]}:\\s*(.+)$`, "m");
    const m = re.exec(text);
    return m ? m[1].replace(/^["']|["']$/g, "").trim() : undefined;
  }

  function setYamlValue(text, key, value) {
    const parts = key.split(".");
    if (parts.length === 2) {
      const re = new RegExp(`^(\\s+${parts[1]}:\\s*).+$`, "m");
      if (re.test(text)) return text.replace(re, `$1${value}`);
      // Key doesn't exist yet — append under section
      const sectionRe = new RegExp(`^(${parts[0]}:\\s*\\n)`, "m");
      return text.replace(sectionRe, `$1  ${parts[1]}: ${value}\n`);
    }
    const re = new RegExp(`^(${parts[0]}:\\s*).+$`, "m");
    if (re.test(text)) return text.replace(re, `$1${value}`);
    // Append at end
    return text.trimEnd() + `\n${parts[0]}: ${value}\n`;
  }

  if (sub === "get") {
    const key = args[args.indexOf("get") + 1];
    if (!key) {
      console.error(red("Usage: pebkac config get <key>"));
      console.error(dim("  Keys: agent_runtime, verbosity, enabled, defaults.evidence_required, defaults.git_guard, defaults.secrets_isolation"));
      process.exit(2);
    }
    const val = getYamlValue(configText, key);
    if (val === undefined) {
      console.error(red(`Key "${key}" not found in config`));
      suggest("pebkac config list --cwd . to see all available keys");
      process.exit(1);
    }
    quietLog(val);
  } else if (sub === "set") {
    const key = args[args.indexOf("set") + 1];
    const value = args[args.indexOf("set") + 2];
    if (!key || !value) {
      console.error(red("Usage: pebkac config set <key> <value>"));
      process.exit(2);
    }
    const quoted = value.match(/[^a-zA-Z0-9_.\-]/) ? `"${value}"` : value;
    const updated = setYamlValue(configText, key, quoted);
    writeFileSync(configPath, updated);
    quietLog(`${icon("pass")} ${green(key)} set to ${green(quoted)}`);
  } else if (sub === "list") {
    quietLog(configText.trimEnd());
  } else {
    console.error(red(`Unknown config subcommand: ${sub ?? "(none)"}`));
    console.error(dim("  Usage: pebkac config <get|set|list> [key] [value]"));
    process.exit(2);
  }
}

const command = args.find((arg) => !arg.startsWith("-")) ?? "help";
function completionCommand() {
  const shell = args[args.indexOf("completion") + 1];
  const commands = ["init", "status", "off", "on", "launch", "doctor", "version", "config"];
  const configSubs = ["get", "set", "list"];
  const globalFlags = ["--json", "--quiet", "-q", "--cwd", "--dry-run", "--non-interactive", "--yes", "--help"];

  if (!shell || !["bash", "zsh", "fish"].includes(shell)) {
    console.error(red("Usage: pebkac completion <bash|zsh|fish>"));
    console.error(dim("  Add to your shell: eval \"$(pebkac completion bash)\""));
    process.exit(2);
  }

  if (shell === "bash") {
    quietLog(`# pebkac bash completion
_pebkac_completions() {
  local cur="\${COMP_WORDS[COMP_CWORD]}"
  local prev="\${COMP_WORDS[COMP_CWORD-1]}"
  local commands="${commands.join(" ")}"
  local flags="${globalFlags.join(" ")}"

  if [ "\$COMP_CWORD" -eq 1 ]; then
    COMPREPLY=($(compgen -W "\$commands" -- "\$cur"))
  elif [ "\$prev" = "config" ]; then
    COMPREPLY=($(compgen -W "get set list" -- "\$cur"))
  elif [ "\$prev" = "get" ] || [ "\$prev" = "set" ]; then
    COMPREPLY=($(compgen -W "agent_runtime verbosity enabled defaults.evidence_required defaults.git_guard defaults.secrets_isolation defaults.checkpoint_interval defaults.deterministic_prompting defaults.verbosity" -- "\$cur"))
  elif [ "\$prev" = "--cwd" ]; then
    COMPREPLY=($(compgen -d -- "\$cur"))
  else
    COMPREPLY=($(compgen -W "\$flags" -- "\$cur"))
  fi
}
complete -F _pebkac_completions pebkac`);
  } else if (shell === "zsh") {
    quietLog(`#compdef pebkac
# pebkac zsh completion
_pebkac() {
  local -a commands config_subs flags
  commands=(${commands.map(c => `"${c}:PEBKAC ${c} command"`).join("\n    ")})
  config_subs=("get:Get a config value" "set:Set a config value" "list:Show full config")
  flags=(${globalFlags.map(f => `"${f}"`).join(" ")})

  _arguments -C \\
    "1:command:->command" \\
    "2:subcommand:->subcommand" \\
    "*::arg:->arg"

  case \$state in
    command) _describe "command" commands ;;
    subcommand)
      case \$words[1] in
        config) _describe "subcommand" config_subs ;;
      esac ;;
    arg)
      case \$words[2] in
        set|get) _describe "key" "agent_runtime verbosity enabled defaults.evidence_required defaults.git_guard defaults.secrets_isolation defaults.checkpoint_interval" ;;
      esac ;;
  esac
}
_pebkac "\$@"`);
  } else if (shell === "fish") {
    quietLog(`# pebkac fish completion
set -l commands ${commands.join(" ")}
set -l config_subs get set list
set -l config_keys agent_runtime verbosity enabled defaults.evidence_required defaults.git_guard defaults.secrets_isolation defaults.checkpoint_interval

complete -c pebkac -n "__fish_use_subcommand" -a "$commands"
complete -c pebkac -n "__fish_seen_subcommand_from config" -a "$config_subs"
complete -c pebkac -n "__fish_seen_subcommand_from config; and __fish_seen_subcommand_from get set" -a "$config_keys"
complete -c pebkac -s q -l quiet -d "Suppress all output"
complete -c pebkac -l json -d "Machine-readable JSON output"
complete -c pebkac -l cwd -x -a "(__fish_complete_directories)" -d "Target directory"
complete -c pebkac -l dry-run -d "Show command without executing"
complete -c pebkac -l non-interactive -d "Skip interactive prompts"
complete -c pebkac -l yes -d "Use defaults"`);
  }
}

if (command === "init") init();
else if (command === "status") statusCommand();
else if (command === "off") off();
else if (command === "on") on();
else if (command === "launch") launchCommand();
else if (command === "doctor") doctorCommand();
else if (command === "version" || hasFlag("--version") || hasFlag("-v")) versionCommand();
else if (command === "config") configCommand();
else if (command === "completion") completionCommand();
else {
  quietLog(usage());
  process.exit(command === "help" || hasFlag("--help") ? 0 : 1);
}
