import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "fs";
import { homedir } from "os";
import { isAbsolute, join, relative, resolve } from "path";
import { pathToFileURL } from "url";
import { appendJsonl, ensureDir, harnessPaths, readConfigText, readJson, redactSecrets, writeConfigValue, writeJson, yamlGet } from "./common.js";
import { RECOMMENDED_PLUGIN_BUNDLES } from "./embedded.js";

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

export function globalPluginRoot() {
  return resolve(process.env.PEBKAC_GLOBAL_PLUGIN_ROOT || join(homedir(), ".omp", "plugins"));
}

function within(parent, child) {
  const rel = relative(resolve(parent), resolve(child));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export function scanPlugins(cwd) {
  const globalRoot = globalPluginRoot();
  const roots = [
    { path: globalRoot, scope: "global" },
    { path: join(cwd, ".harness", "plugins"), scope: "local" },
    { path: join(cwd, ".omp", "plugins"), scope: "local" },
  ];
  const plugins = new Map();
  const seenRoots = new Set();
  for (const root of roots) {
    const normalizedRoot = resolve(root.path);
    if (seenRoots.has(normalizedRoot) || !existsSync(normalizedRoot) || !statSync(normalizedRoot).isDirectory()) continue;
    seenRoots.add(normalizedRoot);
    for (const dirent of readdirSync(normalizedRoot, { withFileTypes: true })) {
      if (!dirent.isDirectory()) continue;
      const dir = join(normalizedRoot, dirent.name);
      const manifestPath = [join(dir, "plugin.json"), join(dir, "package.json")].find(existsSync);
      if (!manifestPath) continue;
      const manifest = readJson(manifestPath, null);
      if (!manifest || typeof manifest !== "object") continue;
      const name = typeof manifest.name === "string" && manifest.name ? manifest.name : dirent.name;
      const entryPath = typeof manifest.entry === "string" ? resolve(dir, manifest.entry) : null;
      const entryValid = !!entryPath && within(dir, entryPath) && existsSync(entryPath) && statSync(entryPath).isFile();
      plugins.set(name, {
        name,
        version: typeof manifest.version === "string" ? manifest.version : "unknown",
        path: dir,
        manifestPath,
        entry: entryValid ? entryPath : null,
        executable: entryValid,
        enabled: !existsSync(join(dir, ".disabled")),
        description: typeof manifest.description === "string" ? manifest.description : "",
        scope: root.scope,
        manifest,
      });
    }
  }
  return [...plugins.values()];
}

function installRecommended(args) {
  const root = globalPluginRoot();
  const archiveIndex = args.indexOf("--archive-dir");
  const inlineArchive = args.find(arg => arg.startsWith("--archive-dir="));
  const archiveDir = archiveIndex >= 0 ? args[archiveIndex + 1] : inlineArchive?.slice("--archive-dir=".length);
  if (archiveIndex >= 0 && (!archiveDir || archiveDir.startsWith("--"))) throw new Error("--archive-dir requires a value");
  const installed = [];
  for (const bundle of RECOMMENDED_PLUGIN_BUNDLES) {
    const dir = join(root, bundle.manifest.name);
    const manifest = structuredClone(bundle.manifest);
    if (manifest.name === "audit-archiver" && archiveDir) manifest.configuration = { ...manifest.configuration, destination: resolve(archiveDir) };
    ensureDir(dir);
    writeFileSync(join(dir, "plugin.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
    writeFileSync(join(dir, "index.js"), bundle.source, { mode: 0o600 });
    installed.push({ name: manifest.name, version: manifest.version, path: dir });
  }
  return { root, installed };
}

function pluginArgs(args, pluginName) {
  const separator = args.indexOf("--");
  if (separator >= 0) return args.slice(separator + 1);
  const nameIndex = args.indexOf(pluginName);
  return nameIndex >= 0 ? args.slice(nameIndex + 1).filter((arg, index, tail) => {
    if (arg === "--cwd") return false;
    if (index > 0 && tail[index - 1] === "--cwd") return false;
    return !["--json", "--quiet", "-q"].includes(arg);
  }) : [];
}

async function executePlugin(plugin, cwd, args, json, quiet) {
  if (!plugin.enabled) return { ok: false, summary: `Plugin is disabled: ${plugin.name}` };
  if (!plugin.executable) return { ok: false, summary: `Plugin has no valid executable entry: ${plugin.name}` };
  const moduleUrl = `${pathToFileURL(plugin.entry).href}?mtime=${statSync(plugin.entry).mtimeMs}`;
  const loaded = await import(moduleUrl);
  if (typeof loaded.run !== "function") return { ok: false, summary: `Plugin entry must export run(): ${plugin.entry}` };
  const result = await loaded.run({ cwd, args, json, quiet, paths: harnessPaths(cwd), manifest: plugin.manifest });
  if (!result || typeof result !== "object" || typeof result.ok !== "boolean") return { ok: false, summary: `Plugin returned an invalid result: ${plugin.name}` };
  return result;
}

export async function runPlugins(cwd, args, ui, { json = false } = {}) {
  const sub = subAfter(args, "plugins", "list");
  const recommended = [
    { name: "audit-archiver", priority: "high", rationale: "Ship audit logs off-box for incident review.", category: "observability" },
    { name: "metrics-collector", priority: "medium", rationale: "Track block rate, evidence ratio, and command latency.", category: "analytics" },
    { name: "doctor-autofix", priority: "high", rationale: "Apply safe remediation for missing dirs, contexts, and config keys.", category: "automation" },
  ];
  if (sub === "install-recommended") {
    const result = installRecommended(args);
    const verified = scanPlugins(cwd).filter(plugin => recommended.some(item => item.name === plugin.name) && plugin.scope === "global" && plugin.executable);
    const output = { ...result, verified: verified.map(plugin => ({ name: plugin.name, executable: plugin.executable, path: plugin.path })) };
    if (json) ui.raw(JSON.stringify(output, null, 2));
    else {
      ui.log(ui.header("Recommended plugins installed"));
      ui.log(`Verdict: ${verified.length === recommended.length ? ui.green("READY") : ui.red("INCOMPLETE")} — ${verified.length}/${recommended.length} global plugins are executable.`);
      output.verified.forEach(plugin => ui.log(`  ${ui.icon("pass")} ${plugin.name.padEnd(20)} ${ui.dim(plugin.path)}`));
    }
    return verified.length === recommended.length ? 0 : 1;
  }
  const plugins = scanPlugins(cwd);
  if (sub === "list") {
    const result = { globalRoot: globalPluginRoot(), plugins: plugins.map(({ manifest, ...plugin }) => plugin) };
    if (json) ui.raw(JSON.stringify(result, null, 2));
    else {
      ui.log(ui.header("Plugins"));
      ui.log(`Verdict: ${plugins.length ? ui.green("ACTIVE SURFACE FOUND") : ui.yellow("NO PLUGINS")} — ${plugins.length ? `${plugins.length} plugin${plugins.length === 1 ? "" : "s"} discovered` : "scan global ~/.omp/plugins plus project .harness/plugins and .omp/plugins"}.`);
      if (!plugins.length) {
        ui.log("Next actions:");
        ui.log("  1. Run `pebkac plugins install-recommended`");
        ui.log("  2. Or use `pebkac plugins recommend` for missing high-value plugin ideas.");
      } else {
        plugins.forEach(p => ui.log(`  ${p.enabled && p.executable ? ui.icon("pass") : ui.icon("warn")} ${p.name.padEnd(20)} ${p.version.padEnd(8)} ${p.scope.padEnd(6)} ${ui.dim(p.path)}`));
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
  if (sub === "run") {
    const pos = positionalsAfter(args, "plugins");
    const name = pos[1];
    if (!name) { ui.error("Usage: pebkac plugins run <name> -- [plugin options]"); return 2; }
    const plugin = plugins.find(candidate => candidate.name === name);
    if (!plugin) { ui.error(`Plugin not found: ${name}`); return 1; }
    let result;
    try { result = await executePlugin(plugin, cwd, pluginArgs(args, name), json, ui.quiet); }
    catch (error) { result = { ok: false, summary: error instanceof Error ? error.message : String(error) }; }
    auditEvent(cwd, "plugin_run", { plugin: name, ok: result.ok });
    if (json) ui.raw(JSON.stringify({ plugin: name, ...result }, null, 2));
    else {
      ui.log(ui.header(`Plugin: ${name}`));
      ui.log(`Verdict: ${result.ok ? ui.green("PASS") : ui.red("FAIL")} — ${result.summary}`);
      if (result.data) Object.entries(result.data).forEach(([key, value]) => ui.log(`  ${key}: ${typeof value === "object" ? JSON.stringify(value) : value}`));
    }
    return result.ok ? 0 : 1;
  }
  ui.error("Usage: pebkac plugins <list|recommend|install-recommended|run>");
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
