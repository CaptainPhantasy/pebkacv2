#!/usr/bin/env bun
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";
import { EXIT, boolFromFlags, detectRuntime, ensureProject, fileSize, harnessPaths, hasFlag, lineCount, listJsonFiles, optionValue, readAgentRuntime, readConfigText, readJson, resolveCwd, unknownFlags, writeConfigValue, writeJson, yamlGet, yamlSet } from "../lib/common.js";
import { makeUi, groupedHelp, commandHelp, row, maybeSplash } from "../lib/ui.js";
import { runApiKeys } from "../lib/api-keys.js";
import { runHooks, getHooksStatus, installHooks } from "../lib/git-hooks.js";
import { runPlatforms, installPlatforms, platformStatus } from "../lib/platforms.js";
import { DEFAULT_FLAGS, auditEvent, runAudit, runFlags, runMode, runPlugins, runSkill, scanPlugins } from "../lib/ops.js";
import { PACKAGE, VERSION, NAME, resolveExtensionSource } from "../lib/embedded.js";

// repoRoot is retained for source-tree fallback resolution and parity with
// prior behavior; commands that need the defense extension source prefer
// the embedded copy (see lib/embedded.js) so compiled binaries work too.
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const KNOWN = new Set(["help", "init", "status", "doctor", "off", "on", "launch", "version", "config", "completion", "api-keys", "hooks", "platforms", "plugins", "flags", "audit", "mode", "skill"]);
const KNOWN_FLAGS = new Set(["--help", "-h", "--version", "-v", "--quiet", "-q", "--json", "--cwd", "--verbose", "-V", "--dry-run", "--non-interactive", "--yes", "--theme", "--verbosity", "--enabled", "--no-enabled", "--telemetry", "--no-telemetry", "--notifications", "--no-notifications", "--health-checks", "--no-health-checks", "--key-from-env", "--limit", "--archive-dir"]);
const quiet = hasFlag(args, "--quiet", "-q");
const json = hasFlag(args, "--json");
const verbose = hasFlag(args, "--verbose", "-V");
const ui = makeUi({ quiet, json });

function packageInfo() {
  // PACKAGE is imported with { type: "json" } — available both at source
  // (read from disk) and in compiled binaries (inlined by bun --compile).
  if (PACKAGE && PACKAGE.version) return PACKAGE;
  try { return JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")); }
  catch { return { name: NAME, version: VERSION }; }
}

function failUsage(message, suggestion) {
  if (message) ui.error(message);
  if (suggestion) ui.suggest(suggestion);
  return EXIT.USAGE;
}

function handleUnknownFlags() {
  const flags = unknownFlags(args, KNOWN_FLAGS);
  if (flags.length > 0) ui.error(`Unknown flag${flags.length > 1 ? "s" : ""}: ${flags.join(", ")}`);
}

function command() {
  return args.find(a => !a.startsWith("-")) ?? (hasFlag(args, "--version", "-v") ? "version" : "help");
}

function helpCommand() {
  const target = args.find((a, i) => i > 0 && !a.startsWith("-") && a !== "help");
  if (target) {
    const text = commandHelp(target);
    if (!text) { ui.error(`Unknown command: ${target}`); return EXIT.ISSUE; }
    ui.raw(text);
    return EXIT.OK;
  }
  ui.raw(groupedHelp(packageInfo().version));
  return EXIT.OK;
}

function initCommand() {
  let cwd;
  try { cwd = resolveCwd(args); } catch (err) { return failUsage(err.message, "pebkac init --non-interactive --yes --cwd ."); }
  const nonInteractive = hasFlag(args, "--non-interactive", "--yes");
  if (!nonInteractive && (!process.stdin.isTTY || !process.stdout.isTTY)) {
    ui.error("Interactive onboarding requires a TTY. Re-run with --non-interactive --yes.");
    ui.suggest("pebkac init --non-interactive --yes --cwd .");
    return EXIT.USAGE;
  }
  const src = resolveExtensionSource(repoRoot);
  if (!src.text) {
    ui.error(`Extension source not found (looked in: ${src.path})`);
    ui.suggest("Re-clone the repository or restore .omp/extensions/pebkac-defense.js.");
    return EXIT.ISSUE;
  }
  ensureProject(cwd);
  let verbosity;
  try { verbosity = optionValue(args, "--verbosity", optionValue(args, "--theme", null) === "minimal" ? "quiet" : "full"); }
  catch (err) { return failUsage(err.message, "pebkac init --verbosity full --cwd ."); }
  if (!["full", "normal", "quiet"].includes(verbosity)) return failUsage("--verbosity must be full, normal, or quiet", "pebkac init --verbosity full --cwd .");
  const enabled = boolFromFlags(args, "--enabled", "--no-enabled", true);
  const telemetry = boolFromFlags(args, "--telemetry", "--no-telemetry", true);
  const notifications = boolFromFlags(args, "--notifications", "--no-notifications", true);
  const healthChecks = boolFromFlags(args, "--health-checks", "--no-health-checks", true);
  const config = `# PEBKAC Harness Configuration\nversion: "1.0"\n\ndefaults:\n  evidence_required: true\n  deterministic_prompting: true\n  secrets_isolation: true\n  git_guard: true\n  checkpoint_interval: 10\n  turn_budget: 100\n  escalation_threshold: 5\n  verbosity: "${verbosity}"\n  enabled: ${enabled}\n\nagent_runtime: "omp"\nplatforms: project\n`;
  writeFileSync(harnessPaths(cwd).config, config);
  writeFileSync(join(harnessPaths(cwd).vault, "config.yaml"), `# PEBKAC Vault Configuration\nsecrets: {}\n`);
  writeJson(harnessPaths(cwd).prefs, { theme: verbosity === "quiet" ? "minimal" : "standard", verbosity, telemetry, notifications, healthChecks, capturedAt: new Date().toISOString() });
  writeJson(harnessPaths(cwd).telemetry, { enabled: telemetry });
  writeJson(harnessPaths(cwd).flags, DEFAULT_FLAGS);
  writeFileSync(join(harnessPaths(cwd).root, ".unboxed"), "true\n");
  const platformResults = installPlatforms(cwd, repoRoot, "project");
  const hookResult = installHooks(cwd);
  const splash = maybeSplash(cwd, { force: true, quiet });
  if (splash) ui.log(splash);
  ui.log(ui.header("PEBKAC init complete"));
  ui.log(`Verdict: ${ui.green("READY")} — project defenses are installed and the command surface is live.`);
  ui.log(row("pass", "Path", ui.dim(cwd)));
  ui.log(row("pass", "Verbosity", verbosity));
  ui.log(row("pass", "Platforms", platformResults.map(r => `${r.platform}:${r.ok ? "ok" : "fail"}`).join(", ")));
  ui.log(row(hookResult.ok ? "pass" : "warn", "Git hooks", hookResult.ok ? hookResult.installed.join(", ") : hookResult.reason));
  ui.log("");
  ui.log("Next steps:");
  ui.log(`  1. Review config   ${join(cwd, ".harness", "config.yaml")}`);
  ui.log(`  2. Launch session  pebkac launch --cwd ${cwd}`);
  ui.log(`  3. Run diagnostics pebkac doctor --cwd ${cwd}`);
  return platformResults.every(r => r.ok) ? EXIT.OK : EXIT.ISSUE;
}

function offCommand() {
  let cwd;
  try { cwd = resolveCwd(args); } catch (err) { return failUsage(err.message, "pebkac off --cwd ."); }
  ensureProject(cwd);
  writeFileSync(harnessPaths(cwd).disabled, new Date().toISOString() + "\n");
  ui.log(`${ui.icon("warn")} DISABLED ${ui.dim(cwd)}`);
  ui.log(`  Re-enable: pebkac on --cwd ${cwd}`);
  ui.log(`  Per-session: PEBKAC_OFF=1 <harness-command>`);
  return EXIT.OK;
}

function onCommand() {
  let cwd;
  try { cwd = resolveCwd(args); } catch (err) { return failUsage(err.message, "pebkac on --cwd ."); }
  const sentinel = harnessPaths(cwd).disabled;
  if (existsSync(sentinel)) {
    unlinkSync(sentinel);
    ui.log(`${ui.icon("pass")} RE-ENABLED ${ui.dim(cwd)}`);
  } else {
    ui.log(`${ui.icon("info")} PEBKAC already enabled for ${ui.dim(cwd)}`);
  }
  return EXIT.OK;
}

function statusData(cwd) {
  const p = harnessPaths(cwd);
  const configText = readConfigText(cwd);
  const configuredRuntime = readAgentRuntime(cwd);
  const runtime = detectRuntime(configuredRuntime);
  const platforms = platformStatus(cwd, yamlGet(readConfigText(cwd), "platforms") ?? "project");
  const hooks = getHooksStatus(cwd);
  const plugins = scanPlugins(cwd);
  const extensionPath = join(cwd, ".omp", "extensions", "pebkac-defense.js");
  const issues = [
    !existsSync(extensionPath),
    !existsSync(p.config),
    !existsSync(p.state),
    !existsSync(p.checkpoints),
    !existsSync(p.vault),
    !runtime.found,
    platforms.some(x => !x.installed),
  ].filter(Boolean).length;
  return {
    cwd,
    healthy: issues === 0,
    issues,
    extension: { present: existsSync(extensionPath), size: fileSize(extensionPath), path: extensionPath },
    config: { present: existsSync(p.config), valid: !!configText.includes("version:") && !!configText.includes("defaults:"), runtime: configuredRuntime, verbosity: yamlGet(configText, "defaults.verbosity") ?? "full", enabled: yamlGet(configText, "defaults.enabled") ?? "true" },
    disabled: { active: existsSync(p.disabled) },
    runtime,
    platforms,
    hooks,
    plugins: { count: plugins.length, plugins },
    checkpoints: { present: existsSync(p.checkpoints), count: listJsonFiles(p.checkpoints).length },
    auditLog: { size: fileSize(p.audit), entries: lineCount(p.audit) },
    flags: readJson(p.flags, DEFAULT_FLAGS) ?? DEFAULT_FLAGS,
    checks: {
      extension: { present: existsSync(extensionPath) },
      config: { present: existsSync(p.config), valid: !!configText.includes("version:") && !!configText.includes("defaults:") },
      stateDir: { present: existsSync(p.state) },
      disabled: { active: existsSync(p.disabled) },
      runtime: runtime,
      checkpoints: { present: existsSync(p.checkpoints) },
      vault: { present: existsSync(p.vault) },
    },
  };
}

function statusCommand() {
  let data;
  try { data = statusData(resolveCwd(args)); } catch (err) { return failUsage(err.message, "pebkac status --cwd ."); }
  if (json) {
    ui.raw(JSON.stringify(data, null, 2));
    return data.healthy ? EXIT.OK : EXIT.ISSUE;
  }
  ui.log(ui.header("PEBKAC Status"));
  ui.log(`Verdict: ${data.healthy ? ui.green("READY") : ui.yellow("ATTENTION NEEDED")} — ${data.issues === 0 ? "all required surfaces are present" : `${data.issues} setup issue${data.issues === 1 ? "" : "s"} detected`}.`);
  ui.log(row(data.extension.present ? "pass" : "fail", "Extension", data.extension.present ? `present ${data.extension.size}` : "missing"));
  ui.log(row(data.config.present ? "pass" : "fail", "Config", data.config.present ? `present runtime=${data.config.runtime}, verbosity=${data.config.verbosity}, enabled=${data.config.enabled}` : "missing"));
  ui.log(row(data.disabled.active ? "warn" : "pass", "Disabled", data.disabled.active ? "YES — sentinel file present" : "no"));
  ui.log(row(data.runtime.found ? "pass" : "fail", "Runtime", data.runtime.found ? `${data.runtime.name} ${ui.dim(data.runtime.path ?? "")}` : `${data.runtime.name} NOT FOUND`));
  ui.log(row(data.platforms.every(p => p.installed) ? "pass" : "fail", "Platforms", data.platforms.map(p => `${p.platform}:${p.installed ? "ok" : "missing"}`).join(", ")));
  ui.log(row(data.hooks.ok || data.hooks.reason === "not a git repository" ? "pass" : "warn", "Git hooks", data.hooks.reason ?? data.hooks.hooks.map(h => `${h.name}:${h.installed && !h.drifted ? "ok" : "issue"}`).join(", ")));
  ui.log(row("info", "Plugins", String(data.plugins.count)));
  ui.log(row("info", "Checkpoints", String(data.checkpoints.count)));
  ui.log(row("info", "Audit", `${data.auditLog.size} (${data.auditLog.entries} entries)`));
  if (verbose) {
    ui.log("");
    ui.log("Verbose:");
    ui.log(`  extension: ${data.extension.path}`);
    ui.log(`  config: ${harnessPaths(data.cwd).config}`);
    ui.log(`  cwd: ${data.cwd}`);
    ui.log(`  hooks: ${JSON.stringify(data.hooks)}`);
    ui.log(JSON.stringify(data, null, 2));
  }
  return data.healthy ? EXIT.OK : EXIT.ISSUE;
}

function doctorCommand() {
  let data;
  try { data = statusData(resolveCwd(args)); } catch (err) { return failUsage(err.message, "pebkac doctor --cwd ."); }
  const checks = {
    extension: data.checks.extension,
    config: data.checks.config,
    stateDir: data.checks.stateDir,
    disabled: data.checks.disabled,
    runtime: data.runtime,
    checkpoints: data.checks.checkpoints,
    vault: data.checks.vault,
    hooks: { ok: data.hooks.ok || data.hooks.reason === "not a git repository", reason: data.hooks.reason },
    flags: { present: existsSync(harnessPaths(data.cwd).flags) },
    platforms: { ok: data.platforms.every(p => p.installed) },
  };
  const fixes = {
    extension: "pebkac init --non-interactive --yes",
    config: "pebkac init --non-interactive --yes",
    stateDir: "pebkac init --non-interactive --yes",
    disabled: "pebkac on --cwd .",
    runtime: `install ${data.runtime.name} or set agent_runtime: none`,
    checkpoints: "pebkac init --non-interactive --yes",
    vault: "pebkac init --non-interactive --yes",
    hooks: "pebkac hooks install",
    flags: "pebkac flags list",
    platforms: "pebkac platforms install all",
  };
  const healthy = checks.extension.present && checks.config.present && checks.config.valid && checks.stateDir.present && !checks.disabled.active && checks.runtime.found && checks.checkpoints.present && checks.vault.present && checks.flags.present && checks.platforms.ok && checks.hooks.ok;
  const result = { healthy, issues: healthy ? 0 : 1, checks };
  if (json) {
    ui.raw(JSON.stringify(result, null, 2));
    return healthy ? EXIT.OK : EXIT.ISSUE;
  }
  ui.log(ui.header("PEBKAC Doctor"));
  ui.log(`Verdict: ${healthy ? ui.green("READY") : ui.yellow("REMEDIATION REQUIRED")} — ${healthy ? "all required checks passed" : "one or more required defenses are missing or drifted"}.`);
  ui.log(row(checks.extension.present ? "pass" : "fail", "extension", checks.extension.present ? "ok" : fixes.extension));
  ui.log(row(checks.config.present && checks.config.valid ? "pass" : "fail", "config", checks.config.present && checks.config.valid ? "ok" : fixes.config));
  ui.log(row(checks.runtime.found ? "pass" : "fail", "runtime", checks.runtime.found ? `ok (${checks.runtime.configured})` : fixes.runtime));
  ui.log(row(checks.platforms.ok ? "pass" : "fail", "platforms", checks.platforms.ok ? "ok" : fixes.platforms));
  ui.log(row(checks.hooks.ok ? "pass" : "fail", "git-hooks", checks.hooks.ok ? "ok" : fixes.hooks));
  ui.log(row(checks.vault.present ? "pass" : "fail", "vault", checks.vault.present ? "ok" : fixes.vault));
  ui.log(row(checks.flags.present ? "pass" : "fail", "flags", checks.flags.present ? "ok" : fixes.flags));
  if (!healthy) {
    ui.log("");
    ui.log("Next actions:");
    if (!checks.extension.present || !checks.config.present || !checks.config.valid || !checks.stateDir.present || !checks.checkpoints.present || !checks.vault.present || !checks.flags.present) ui.log("  1. Re-run bootstrap: pebkac init --non-interactive --yes --cwd .");
    if (checks.disabled.active) ui.log("  2. Re-enable project: pebkac on --cwd .");
    if (!checks.platforms.ok) ui.log("  3. Reinstall surfaces: pebkac platforms install all --cwd .");
    if (!checks.hooks.ok && checks.hooks.reason !== "not a git repository") ui.log("  4. Repair git hooks: pebkac hooks install --cwd .");
    if (!checks.runtime.found) ui.log(`  5. Fix runtime: ${fixes.runtime}`);
  }
  if (verbose) {
    ui.log("");
    ui.log("Verbose:");
    ui.log(`  checks: ${JSON.stringify(checks)}`);
    ui.log(`  cwd: ${data.cwd}`);
  }
  return healthy ? EXIT.OK : EXIT.ISSUE;
}

function launchCommand() {
  let cwd;
  try { cwd = resolveCwd(args); } catch (err) { return failUsage(err.message, "pebkac launch [runtime] --cwd ."); }
  // Positional runtime override: `pebkac launch zcode` overrides the
  // configured agent_runtime for this invocation only (config is not
  // mutated). Strips flags and --cwd's value, leaving the first bare token.
  const KNOWN_RUNTIMES = ["omp", "claude", "pi", "codex", "zcode", "none"];
  const positional = args.slice(args.indexOf("launch") + 1).filter((a, i, arr) => {
    if (a === "--cwd") return false;          // drop the flag
    if (i > 0 && arr[i - 1] === "--cwd") return false;  // drop its value
    if (a.startsWith("--")) return false;     // drop other flags (--dry-run)
    return true;
  });
  const override = positional[0];
  let runtimeName;
  if (override && KNOWN_RUNTIMES.includes(override)) {
    runtimeName = override;
  } else if (override) {
    ui.error(`Unknown runtime '${override}'. Must be one of: ${KNOWN_RUNTIMES.join(", ")}`);
    return EXIT.USAGE;
  } else {
    runtimeName = readAgentRuntime(cwd);
  }
  if (runtimeName === "none") { ui.log(`${ui.icon("info")} Standalone mode (agent_runtime: none). No harness to launch.`); return EXIT.OK; }
  const runtime = detectRuntime(runtimeName);
  // ZCode is a macOS Electron GUI app, not a CLI TTY binary. Launch via
  // `open -a ZCode.app` (returns immediately; ZCode restores its last
  // workspace via its built-in session-restore plugin). This diverges from
  // the omp/claude/pi path which spawnSync a CLI binary with stdio inherit.
  if (runtimeName === "zcode") {
    // ZCode is a macOS Electron GUI app. Workspace opening goes through its
    // registered `zcode://` deep-link scheme (the same path the Finder
    // "Open in ZCode" extension uses): the handler in app.asar parses the
    // URL, extracts the `path` query param, and dispatches to
    // handleOpenWorkspacePath. `open -a ZCode.app` alone only raises the
    // window without loading a workspace.
    if (hasFlag(args, "--dry-run")) {
      const url = `zcode://workspace/open?path=${encodeURIComponent(cwd)}`;
      ui.log(`Command: open "${url}"`);
      ui.log(`Runtime: ${runtime.found ? runtime.path : "NOT FOUND"}`);
      ui.log("Remove --dry-run to execute.");
      return EXIT.OK;
    }
    if (!runtime.found) { ui.error("ZCode.app not found at /Applications/ZCode.app"); ui.suggest("Install from https://zcode.z.ai/en/docs/install or run `pebkac doctor`."); return EXIT.ISSUE; }
    const deepLink = `zcode://workspace/open?path=${encodeURIComponent(cwd)}`;
    const r = spawnSync("open", [deepLink], { stdio: "inherit" });
    return r.status ?? EXIT.OK;
  }
  const cmd = runtime.name;
  if (hasFlag(args, "--dry-run")) {
    ui.log(`Command: ${cmd} --cwd ${cwd} --dry-run`);
    ui.log(`Runtime: ${runtime.found ? runtime.path : "NOT FOUND"}`);
    ui.log("Remove --dry-run to execute.");
    return EXIT.OK;
  }
  if (!runtime.found) { ui.error(`Runtime ${cmd} not found on PATH`); ui.suggest("Run `pebkac doctor` for diagnostics."); return EXIT.ISSUE; }
  const r = spawnSync(cmd, ["--cwd", cwd], { stdio: "inherit", cwd });
  return r.status ?? EXIT.ISSUE;
}

function configCommand() {
  let cwd;
  try { cwd = resolveCwd(args); } catch (err) { return failUsage(err.message, "pebkac config get agent_runtime --cwd ."); }
  const configIdx = args.indexOf("config");
  const FLAG_VALS = new Set(["--cwd", "--limit", "--verbosity", "--theme", "--key-from-env"]);
  const positionals = [];
  for (let i = configIdx + 1; i < args.length; i++) {
    if (args[i].startsWith("--")) { if (FLAG_VALS.has(args[i])) i++; continue; }
    positionals.push(args[i]);
  }
  const sub = positionals[0] ?? "list";
  const key = positionals[1];
  const value = positionals[2];
  const text = readConfigText(cwd);
  if (!text) { ui.error("No config found. Run pebkac init first."); ui.suggest("pebkac init --non-interactive --yes --cwd ."); return EXIT.ISSUE; }
  if (sub === "list") {
    if (json) { ui.raw(JSON.stringify({ path: harnessPaths(cwd).config, keys: { "agent_runtime": yamlGet(text, "agent_runtime") ?? "omp", "defaults.verbosity": yamlGet(text, "defaults.verbosity") ?? "full", "defaults.enabled": yamlGet(text, "defaults.enabled") ?? "true" }, raw: text.trimEnd() }, null, 2)); return EXIT.OK; }
    ui.log(ui.header("Config"));
    ui.log(`Verdict: ${ui.green("READY")} — configuration file is present and readable.`);
    ui.log(row("pass", "Path", ui.dim(harnessPaths(cwd).config)));
    ui.log(row("info", "agent_runtime", yamlGet(text, "agent_runtime") ?? "omp"));
    ui.log(row("info", "verbosity", yamlGet(text, "defaults.verbosity") ?? "full"));
    ui.log(row("info", "enabled", yamlGet(text, "defaults.enabled") ?? "true"));
    return EXIT.OK;
  }
  if (sub === "get") {
    if (!key) return failUsage("Usage: pebkac config get <key>", "pebkac config list --cwd .");
    const v = yamlGet(text, key);
    if (v === undefined) { ui.error(`Key not found: ${key}`); ui.suggest("pebkac config list --cwd ."); return EXIT.ISSUE; }
    if (json) { ui.raw(JSON.stringify({ key, value: v, path: harnessPaths(cwd).config }, null, 2)); return EXIT.OK; }
    ui.log(ui.header("Config value"));
    ui.log(`Verdict: ${ui.green("READY")} — requested key resolved.`);
    ui.log(row("pass", "Key", key));
    ui.log(row("info", "Value", String(v)));
    return EXIT.OK;
  }
  if (sub === "set") {
    if (!key || value === undefined) return failUsage("Usage: pebkac config set <key> <value>", "pebkac config set agent_runtime claude --cwd .");
    writeFileSync(harnessPaths(cwd).config, yamlSet(text, key, value));
    ui.log(ui.header("Config updated"));
    ui.log(`Verdict: ${ui.green("READY")} — configuration value written successfully.`);
    ui.log(row("pass", "Key", key));
    ui.log(row("info", "Value", String(value)));
    return EXIT.OK;
  }
  return failUsage(`Unknown config subcommand: ${sub}`, "pebkac config <get|set|list> [key] [value]");
}

function completionCommand() {
  const shell = args[args.indexOf("completion") + 1];
  const commands = "help init status off on launch doctor version config completion api-keys hooks platforms plugins flags audit mode skill";
  if (shell === "bash") {
    ui.raw(`# PEBKAC bash completion\n# Install: eval \"$(pebkac completion bash)\"\n_pebkac_completions(){\n  local cur=\"\${COMP_WORDS[COMP_CWORD]}\"\n  local commands=\"${commands}\"\n  local config_subs=\"get set list\"\n  COMPREPLY=($(compgen -W \"\\$commands\" -- \"\\$cur\"))\n}\ncomplete -F _pebkac_completions pebkac`);
    return EXIT.OK;
  }
  if (shell === "zsh") {
    ui.raw(`#compdef pebkac\n# Install: eval \"$(pebkac completion zsh)\"\n_pebkac(){\n  local -a commands\n  commands=(${commands.split(" ").map(c => `"${c}:${c}"`).join(" ")})\n  _describe "command" commands\n}\n_pebkac "$@"`);
    return EXIT.OK;
  }
  if (shell === "fish") {
    ui.raw(`# PEBKAC fish completion\n# Install: pebkac completion fish | source\nset -l commands ${commands}\nset -l config_subs get set list\ncomplete -c pebkac -n "__fish_use_subcommand" -a "$commands"\ncomplete -c pebkac -n "__fish_seen_subcommand_from config" -a "$config_subs"`);
    return EXIT.OK;
  }
  ui.error("Usage: pebkac completion <bash|zsh|fish>");
  ui.suggest('eval "$(pebkac completion bash)"');
  return EXIT.USAGE;
}

async function main() {
  handleUnknownFlags();
  const cmd = command();
  if (hasFlag(args, "--help", "-h") && cmd !== "help") { ui.raw(commandHelp(cmd) ?? groupedHelp(packageInfo().version)); return EXIT.OK; }
  if (!KNOWN.has(cmd)) { ui.error(`Unknown command: ${cmd}`); ui.suggest("pebkac help"); return EXIT.USAGE; }
  if (cmd === "help") return helpCommand();
  if (cmd === "init") return initCommand();
  if (cmd === "status") return statusCommand();
  if (cmd === "doctor") return doctorCommand();
  if (cmd === "off") return offCommand();
  if (cmd === "on") return onCommand();
  if (cmd === "launch") return launchCommand();
  if (cmd === "version") { const p = packageInfo(); if (!quiet) ui.raw(`PEBKAC ${p.version} (${p.name})`); return EXIT.OK; }
  if (cmd === "config") return configCommand();
  if (cmd === "completion") return completionCommand();
  let cwd;
  try { cwd = resolveCwd(args); } catch (err) { return failUsage(err.message, `pebkac ${cmd} --cwd .`); }
  if (cmd === "api-keys") return await runApiKeys(cwd, args, ui, { json });
  if (cmd === "hooks") return runHooks(cwd, args, ui, { json });
  if (cmd === "platforms") return runPlatforms(cwd, repoRoot, args, ui, { json });
  if (cmd === "plugins") return runPlugins(cwd, args, ui, { json });
  if (cmd === "flags") return runFlags(cwd, args, ui, { json });
  if (cmd === "audit") return runAudit(cwd, args, ui, { json });
  if (cmd === "mode") return runMode(cwd, args, ui, { json });
  if (cmd === "skill") return runSkill(cwd, args, ui, { json });
  return EXIT.USAGE;
}

const commandStartedAt = Date.now();
main().then(code => {
  try {
    const auditCwd = resolveCwd(args);
    if (existsSync(harnessPaths(auditCwd).root)) auditEvent(auditCwd, "cli_command", { command: command(), exitCode: code, durationMs: Date.now() - commandStartedAt });
  } catch {}
  process.exit(code);
}).catch(err => { console.error(`Error: ${err.message}`); process.exit(err.message.includes("requires a value") ? EXIT.USAGE : EXIT.ISSUE); });
