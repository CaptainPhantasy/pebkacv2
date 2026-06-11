#!/usr/bin/env bun
import { existsSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, unlinkSync, statSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

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

  console.log(`PEBKAC init complete: ${targetCwd}`);
  console.log(`  verbosity: ${verbosity}`);
  console.log(`  telemetry: ${prefs.telemetry}`);
  console.log(`  notifications: ${prefs.notifications}`);
  console.log(`  health checks: ${prefs.healthChecks}`);
}

function off() {
  const targetCwd = resolve(optionValue("--cwd", process.cwd()));
  const sentinelPath = join(targetCwd, ".harness", "state", "disabled");
  mkdirSync(join(targetCwd, ".harness", "state"), { recursive: true });
  writeFileSync(sentinelPath, `${new Date().toISOString()}\n`);
  console.log(`PEBKAC disabled for: ${targetCwd}`);
  console.log(`  Sentinel: ${sentinelPath}`);
  console.log(`  To re-enable: pebkac on --cwd ${targetCwd}`);
  console.log(`  Or per-session: PEBKAC_OFF=1 <harness-command>`);
}

function on() {
  const targetCwd = resolve(optionValue("--cwd", process.cwd()));
  const sentinelPath = join(targetCwd, ".harness", "state", "disabled");
  if (existsSync(sentinelPath)) {
    unlinkSync(sentinelPath);
    console.log(`PEBKAC re-enabled for: ${targetCwd}`);
  } else {
    console.log(`PEBKAC already enabled for: ${targetCwd}`);
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

function findFiles(dir, pattern) {
  const results = [];
  try {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (entry.match(pattern)) results.push(full);
    }
  } catch {}
  return results;
}

import { readdirSync } from "fs";

function statusCommand() {
  const targetCwd = resolve(optionValue("--cwd", process.cwd()));
  const extensionPath = join(targetCwd, ".omp", "extensions", "pebkac-defense.js");
  const configPath = join(targetCwd, ".harness", "config.yaml");
  const sentinelPath = join(targetCwd, ".harness", "state", "disabled");
  const prefsPath = join(targetCwd, ".harness", "state", "onboarding-preferences.json");
  const auditPath = join(targetCwd, ".harness", "audit.log");
  let issues = 0;

  console.log("PEBKAC Harness Status");
  console.log("=====================");

  // Extension
  const extensionPresent = existsSync(extensionPath);
  const extensionSize = extensionPresent ? readFileSize(extensionPath) : "missing";
  console.log(`Extension: ${extensionPresent ? `present (${extensionSize})` : "MISSING"}`);
  if (!extensionPresent) issues++;

  // Config
  const configPresent = existsSync(configPath);
  console.log(`Config: ${configPresent ? "present" : "MISSING"}`);
  if (!configPresent) issues++;

  // Parse config for details
  if (configPresent) {
    try {
      const configText = readFileSync(configPath, "utf8");
      const runtimeMatch = configText.match(/agent_runtime:\s*"?(\w+)"?/);
      const verbosityMatch = configText.match(/verbosity:\s*"?(\w+)"?/);
      const enabledMatch = configText.match(/enabled:\s*(\w+)/);
      console.log(`  agent_runtime: ${runtimeMatch?.[1] ?? "unset"}`);
      console.log(`  verbosity: ${verbosityMatch?.[1] ?? "full"}`);
      console.log(`  enabled: ${enabledMatch?.[1] ?? "true"}`);
    } catch {}
  }

  // Disabled state
  const isDisabled = existsSync(sentinelPath);
  console.log(`Disabled: ${isDisabled ? "YES (sentinel file present)" : "no"}`);

  // Checkpoints
  const cpDir = join(targetCwd, ".harness", "checkpoints");
  const checkpoints = existsSync(cpDir) ? readdirSync(cpDir).filter(f => f.endsWith(".json")).length : 0;
  console.log(`Checkpoints: ${checkpoints} file${checkpoints !== 1 ? "s" : ""}`);

  // Audit log
  const auditSize = existsSync(auditPath) ? readFileSize(auditPath) : "empty";
  const auditEntries = existsSync(auditPath) ? countLines(auditPath) : 0;
  console.log(`Audit log: ${auditSize} (${auditEntries} entries)`);

  // Preferences
  if (existsSync(prefsPath)) {
    try {
      const prefs = JSON.parse(readFileSync(prefsPath, "utf8"));
      console.log(`Preferences: verbosity=${prefs.verbosity ?? prefs.theme ?? "full"}, notifications=${prefs.notifications ?? "unset"}, telemetry=${prefs.telemetry ?? "unset"}`);
    } catch {}
  }

  // Runtime
  const runtime = detectRuntime();
  console.log(`Runtime: ${runtime.found ? `${runtime.name} — found at ${runtime.path}` : `${runtime.name} — NOT FOUND`}`);
  if (!runtime.found) issues++;

  // Session reports
  const reportsDir = join(targetCwd, ".harness", "state");
  const reports = existsSync(reportsDir) ? readdirSync(reportsDir).filter(f => f.startsWith("session-report")).length : 0;
  if (reports > 0) console.log(`Session reports: ${reports}`);

  // Health check
  const healthPath = join(targetCwd, ".harness", "state", "session-health.json");
  if (existsSync(healthPath)) {
    try {
      const health = JSON.parse(readFileSync(healthPath, "utf8"));
      console.log(`Last health check: ${health.startTime ?? "unknown"}`);
    } catch {}
  }

  console.log("");
  if (issues > 0) {
    console.log(`Issues found: ${issues}`);
    process.exit(1);
  } else {
    console.log("All checks passed.");
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
    console.log("Standalone mode (agent_runtime: none). No harness to launch.");
    return;
  }

  const runtimeInfo = detectRuntime();
  const cmd = runtime === "claude" ? "claude" : "omp";

  if (dryRun) {
    console.log(`Would launch: ${cmd} --cwd ${targetCwd}`);
    console.log(`  Runtime detected: ${runtimeInfo.found ? runtimeInfo.path : "NOT FOUND"}`);
    console.log(`  Remove --dry-run to execute.`);
    return;
  }

  if (!runtimeInfo.found) {
    console.error(`Runtime "${cmd}" not found on PATH. Install it first.`);
    console.error(`  Run "pebkac doctor" for diagnostics.`);
    process.exit(1);
  }

  console.log(`Launching ${cmd} in ${targetCwd}...`);
  const result = spawnSync(cmd, ["--cwd", targetCwd], {
    stdio: "inherit",
    cwd: targetCwd,
  });
  process.exit(result.status ?? 1);
}

function doctorCommand() {
  const targetCwd = resolve(optionValue("--cwd", process.cwd()));
  let issues = 0;

  console.log("PEBKAC Doctor");
  console.log("=============");

  // Check 1: Extension file
  const extensionPath = join(targetCwd, ".omp", "extensions", "pebkac-defense.js");
  if (existsSync(extensionPath)) {
    console.log(`[PASS] Extension present (${readFileSize(extensionPath)})`);
  } else {
    console.log(`[FAIL] Extension missing: ${extensionPath}`);
    console.log(`       Fix: pebkac init --non-interactive --yes --cwd ${targetCwd}`);
    issues++;
  }

  // Check 2: Config file
  const configPath = join(targetCwd, ".harness", "config.yaml");
  if (existsSync(configPath)) {
    // Validate it's parseable
    try {
      const text = readFileSync(configPath, "utf8");
      if (text.includes("version:") && text.includes("defaults:")) {
        console.log("[PASS] Config present and valid");
      } else {
        console.log("[FAIL] Config present but missing required sections (version, defaults)");
        issues++;
      }
    } catch {
      console.log("[FAIL] Config present but unreadable");
      issues++;
    }
  } else {
    console.log(`[FAIL] Config missing: ${configPath}`);
    console.log(`       Fix: pebkac init --non-interactive --yes --cwd ${targetCwd}`);
    issues++;
  }

  // Check 3: State directory
  const stateDir = join(targetCwd, ".harness", "state");
  if (existsSync(stateDir)) {
    console.log("[PASS] State directory exists");
  } else {
    console.log(`[FAIL] State directory missing: ${stateDir}`);
    console.log(`       Fix: pebkac init --non-interactive --yes --cwd ${targetCwd}`);
    issues++;
  }

  // Check 4: Sentinel file
  const sentinelPath = join(targetCwd, ".harness", "state", "disabled");
  if (existsSync(sentinelPath)) {
    const ts = readFileSync(sentinelPath, "utf8").trim();
    console.log(`[WARN] PEBKAC is DISABLED (since ${ts})`);
    console.log(`       Fix: pebkac on --cwd ${targetCwd}`);
    issues++;
  } else {
    console.log("[PASS] Not disabled");
  }

  // Check 5: Runtime binary
  const runtime = readAgentRuntime(targetCwd);
  if (runtime === "none") {
    console.log("[PASS] Standalone mode (no runtime needed)");
  } else {
    const runtimeInfo = detectRuntime();
    if (runtimeInfo.found) {
      console.log(`[PASS] Runtime "${runtimeInfo.name}" found at ${runtimeInfo.path}`);
    } else {
      console.log(`[FAIL] Runtime "${runtime}" not found on PATH`);
      console.log(`       Fix: Install ${runtime} and ensure it's on PATH`);
      issues++;
    }
  }

  // Check 6: Checkpoints directory
  const cpDir = join(targetCwd, ".harness", "checkpoints");
  if (existsSync(cpDir)) {
    console.log("[PASS] Checkpoints directory exists");
  } else {
    console.log(`[FAIL] Checkpoints directory missing`);
    issues++;
  }

  // Check 7: Vault directory
  const vaultDir = join(targetCwd, ".harness", "vault");
  if (existsSync(vaultDir)) {
    console.log("[PASS] Vault directory exists");
  } else {
    console.log(`[FAIL] Vault directory missing`);
    issues++;
  }

  console.log("");
  if (issues === 0) {
    console.log("All checks passed. PEBKAC is healthy.");
  } else {
    console.log(`${issues} issue${issues !== 1 ? "s" : ""} found. Fix the items above.`);
    process.exit(1);
  }
}

const command = args.find((arg) => !arg.startsWith("-")) ?? "help";
if (command === "init") init();
else if (command === "status") statusCommand();
else if (command === "off") off();
else if (command === "on") on();
else if (command === "launch") launchCommand();
else if (command === "doctor") doctorCommand();
else {
  console.log(usage());
  process.exit(command === "help" || hasFlag("--help") ? 0 : 1);
}
