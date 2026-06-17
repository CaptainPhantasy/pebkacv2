import { existsSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { join } from "path";
import { appendJsonl, ensureDir, harnessPaths, readConfigText, readJson, redactSecrets, writeConfigValue, writeJson, yamlGet } from "./common.js";

export const DEFAULT_FLAGS = Object.freeze({
  evidence_contracts: true,
  git_guard: true,
  secrets_isolation: true,
  reality_gate: true,
  checkpoints: true,
  circuit_breaker: true,
  rate_limiter: true,
  repeat_detector: true,
  first_run_splash: true,
});

function readFlags(cwd) {
  return { ...DEFAULT_FLAGS, ...(readJson(harnessPaths(cwd).flags, {}) ?? {}) };
}

function parseBool(value) {
  if (["true", "on", "1", "yes"].includes(String(value).toLowerCase())) return true;
  if (["false", "off", "0", "no"].includes(String(value).toLowerCase())) return false;
  return null;
}

const FLAG_VALS = new Set(["--cwd", "--limit", "--verbosity", "--theme", "--key-from-env"]);

function positionalsAfter(args, name) {
  const idx = args.indexOf(name);
  if (idx < 0) return [];
  const pos = [];
  for (let i = idx + 1; i < args.length; i++) {
    if (args[i].startsWith("--")) { if (FLAG_VALS.has(args[i])) i++; continue; }
    pos.push(args[i]);
  }
  return pos;
}

function subAfter(args, name, fallback) {
  const pos = positionalsAfter(args, name);
  return pos.length ? pos[0] : fallback;
}

export function runFlags(cwd, args, ui, { json = false } = {}) {
  const idx = args.indexOf("flags");
  const sub = subAfter(args, "flags", "list");
  const flags = readFlags(cwd);
  if (sub === "list") {
    if (json) ui.raw(JSON.stringify({ path: harnessPaths(cwd).flags, flags }, null, 2));
    else {
      ui.log(ui.header("Flags"));
      ui.log(`Verdict: ${ui.green("READY")} — ${Object.keys(flags).length} feature flags loaded.`);
      Object.entries(flags).forEach(([k, v]) => ui.log(`  ${v ? ui.icon("pass") : ui.icon("warn")} ${k.padEnd(22)} ${String(v)}`));
    }
    return 0;
  }
  const flagsPos = positionalsAfter(args, "flags");
  const key = flagsPos[1];
  if (!key || !(key in DEFAULT_FLAGS)) { ui.error(`known flags: ${Object.keys(DEFAULT_FLAGS).join(", ")}`); return 2; }
  if (sub === "get") {
    if (json) ui.raw(JSON.stringify({ key, value: flags[key], path: harnessPaths(cwd).flags }, null, 2));
    else {
      ui.log(ui.header("Flag value"));
      ui.log(`Verdict: ${ui.green("READY")} — requested flag resolved.`);
      ui.log(`  ${flags[key] ? ui.icon("pass") : ui.icon("warn")} ${key.padEnd(22)} ${String(flags[key])}`);
    }
    return 0;
  }
  if (sub === "set") {
    const value = parseBool(flagsPos[2]);
    if (value === null) { ui.error("flag value must be true/false/on/off/1/0"); return 2; }
    flags[key] = value;
    writeJson(harnessPaths(cwd).flags, flags);
    if (json) ui.raw(JSON.stringify({ key, value, path: harnessPaths(cwd).flags }, null, 2));
    else {
      ui.log(ui.header("Flag updated"));
      ui.log(`Verdict: ${ui.green("READY")} — feature flag persisted.`);
      ui.log(`  ${value ? ui.icon("pass") : ui.icon("warn")} ${key.padEnd(22)} ${String(value)}`);
    }
    return 0;
  }
  ui.error("Usage: pebkac flags <list|get|set> [name] [value]");
  return 2;
}

export function scanPlugins(cwd) {
  const roots = [join(cwd, ".harness", "plugins"), join(cwd, ".omp", "plugins")];
  const plugins = [];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const name of readdirSync(root)) {
      const dir = join(root, name);
      const manifestPath = [join(dir, "plugin.json"), join(dir, "package.json")].find(existsSync);
      const manifest = manifestPath ? readJson(manifestPath, {}) : {};
      plugins.push({ name: manifest.name ?? name, version: manifest.version ?? "unknown", path: dir, enabled: !existsSync(join(dir, ".disabled")), description: manifest.description ?? "" });
    }
  }
  return plugins;
}

export function runPlugins(cwd, args, ui, { json = false } = {}) {
  const sub = subAfter(args, "plugins", "list");
  const plugins = scanPlugins(cwd);
  const recommended = [
    { name: "audit-archiver", priority: "high", rationale: "Ship audit logs off-box for incident review.", category: "observability" },
    { name: "metrics-collector", priority: "medium", rationale: "Track block rate, evidence ratio, and command latency.", category: "analytics" },
    { name: "doctor-autofix", priority: "high", rationale: "Apply safe remediation for missing dirs, contexts, and config keys.", category: "automation" },
  ];
  if (sub === "list") {
    const result = { plugins };
    if (json) ui.raw(JSON.stringify(result, null, 2));
    else {
      ui.log(ui.header("Plugins"));
      ui.log(`Verdict: ${plugins.length ? ui.green("ACTIVE SURFACE FOUND") : ui.yellow("NO LOCAL PLUGINS")} — ${plugins.length ? `${plugins.length} plugin${plugins.length === 1 ? "" : "s"} discovered` : "scan .harness/plugins or .omp/plugins to extend PEBKAC"}.`);
      if (!plugins.length) {
        ui.log("Next actions:");
        ui.log("  1. Drop a plugin manifest into .harness/plugins/<name>/plugin.json");
        ui.log("  2. Or use `pebkac plugins recommend` for missing high-value plugin ideas.");
      } else {
        plugins.forEach(p => ui.log(`  ${p.enabled ? ui.icon("pass") : ui.icon("warn")} ${p.name.padEnd(20)} ${p.version.padEnd(8)} ${ui.dim(p.path)}`));
      }
    }
    return 0;
  }
  if (sub === "recommend") {
    const installed = new Set(plugins.map(p => p.name));
    const missing = recommended.filter(r => !installed.has(r.name));
    if (json) ui.raw(JSON.stringify({ recommendations: missing }, null, 2));
    else {
      ui.log(ui.header("Plugin recommendations"));
      ui.log(`Verdict: ${missing.length ? ui.yellow("UPSIDE AVAILABLE") : ui.green("COVERED")} — ${missing.length ? `${missing.length} recommended plugin${missing.length === 1 ? "" : "s"} not yet installed` : "all built-in recommendations are already present"}.`);
      if (!missing.length) ui.log("  [PASS] No recommended plugin gaps detected.");
      else missing.forEach(r => ui.log(`  ${ui.icon("info")} ${r.name.padEnd(20)} [${r.priority.toUpperCase()}] ${r.rationale}`));
    }
    return 0;
  }
  ui.error("Usage: pebkac plugins <list|recommend>");
  return 2;
}

export function runAudit(cwd, args, ui, { json = false } = {}) {
  const sub = subAfter(args, "audit", "summary");
  const limitIdx = args.indexOf("--limit");
  const limit = limitIdx >= 0 ? Number(args[limitIdx + 1] ?? 20) : 20;
  const path = harnessPaths(cwd).audit;
  const lines = existsSync(path) ? readFileSync(path, "utf8").split("\n").filter(Boolean) : [];
  const entries = lines.map(line => { try { return JSON.parse(redactSecrets(line)); } catch { return { raw: redactSecrets(line) }; } });
  if (sub === "summary") {
    const counts = {};
    for (const e of entries) counts[e.event ?? "unknown"] = (counts[e.event ?? "unknown"] ?? 0) + 1;
    const result = { path, entries: entries.length, counts };
    if (json) ui.raw(JSON.stringify(result, null, 2));
    else { ui.log(ui.header("Audit summary")); Object.entries(counts).forEach(([k, v]) => ui.log(`  ${k}: ${v}`)); if (!entries.length) ui.log("  empty"); }
    return 0;
  }
  if (sub === "tail") {
    const tail = entries.slice(-limit);
    if (json) ui.raw(JSON.stringify({ path, entries: tail }, null, 2));
    else tail.forEach(e => ui.log(JSON.stringify(e)));
    return 0;
  }
  ui.error("Usage: pebkac audit <summary|tail> [--limit N]");
  return 2;
}

export function runMode(cwd, args, ui, { json = false } = {}) {
  const idx = args.indexOf("mode");
  const sub = subAfter(args, "mode", "show");
  const text = readConfigText(cwd);
  const current = {
    runtime: yamlGet(text, "agent_runtime") ?? "omp",
    verbosity: yamlGet(text, "defaults.verbosity") ?? "full",
    enabled: yamlGet(text, "defaults.enabled") ?? "true",
    disabledSentinel: existsSync(harnessPaths(cwd).disabled),
  };
  if (sub === "show") { if (json) ui.raw(JSON.stringify(current, null, 2)); else Object.entries(current).forEach(([k, v]) => ui.log(`${k}: ${v}`)); return 0; }
  if (sub !== "set") { ui.error("Usage: pebkac mode <show|set> [runtime|verbosity|enabled] [value]"); return 2; }
  const modePos = positionalsAfter(args, "mode");
  const key = modePos[1];
  const value = modePos[2];
  if (key === "runtime") {
    if (!["omp", "claude", "pi", "none"].includes(value)) { ui.error("runtime must be omp, claude, pi, or none"); return 2; }
    writeConfigValue(cwd, "agent_runtime", value);
  } else if (key === "verbosity") {
    if (!["full", "normal", "quiet"].includes(value)) { ui.error("verbosity must be full, normal, or quiet"); return 2; }
    writeConfigValue(cwd, "defaults.verbosity", value);
  } else if (key === "enabled") {
    const parsed = parseBool(value);
    if (parsed === null) { ui.error("enabled must be true or false"); return 2; }
    writeConfigValue(cwd, "defaults.enabled", parsed);
  } else { ui.error("mode key must be runtime, verbosity, or enabled"); return 2; }
  ui.log(`${ui.icon("pass")} ${key}=${value}`);
  return 0;
}

export function runSkill(_cwd, _args, ui, { json = false } = {}) {
  const skill = {
    name: "cli-x-2026",
    applied: true,
    contract: ["grouped command surface", "bounded status/doctor tables", "quiet/json modes", "clear exit semantics", "first-run-only splash"],
    source: "skill://cli-x-2026",
  };
  if (json) ui.raw(JSON.stringify(skill, null, 2));
  else {
    ui.log(ui.header("CLI skill applied: cli-x-2026"));
    skill.contract.forEach(item => ui.log(`  ${ui.icon("pass")} ${item}`));
  }
  return 0;
}

export function auditEvent(cwd, event, details = {}) {
  appendJsonl(harnessPaths(cwd).audit, { timestamp: new Date().toISOString(), event, details });
}
