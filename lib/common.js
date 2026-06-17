import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from "fs";
import { dirname, join, resolve } from "path";
import { spawnSync } from "child_process";

export const EXIT = Object.freeze({ OK: 0, ISSUE: 1, USAGE: 2 });

export function resolveCwd(args, fallback = process.cwd()) {
  const idx = args.indexOf("--cwd");
  if (idx >= 0) {
    const next = args[idx + 1];
    if (!next || next.startsWith("--")) throw new Error("--cwd requires a value");
    return resolve(next);
  }
  const inline = args.find(a => a.startsWith("--cwd="));
  if (inline) return resolve(inline.slice("--cwd=".length));
  return resolve(fallback);
}

export function optionValue(args, name, fallback = undefined) {
  const idx = args.indexOf(name);
  if (idx >= 0) {
    const next = args[idx + 1];
    if (!next || next.startsWith("--")) throw new Error(`${name} requires a value`);
    return next;
  }
  const inline = args.find(a => a.startsWith(`${name}=`));
  return inline ? inline.slice(name.length + 1) : fallback;
}

export function unknownFlags(args, knownFlags) {
  return args.filter(arg => arg.startsWith("-") && !knownFlags.has(arg));
}

export function hasFlag(args, ...names) {
  return names.some(name => args.includes(name));
}

export function boolFromFlags(args, enable, disable, fallback) {
  if (args.includes(enable)) return true;
  if (args.includes(disable)) return false;
  return fallback;
}

export function ensureDir(path) {
  mkdirSync(path, { recursive: true });
}

export function writeJson(path, value) {
  ensureDir(dirname(path));
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function readJson(path, fallback = null) {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return fallback; }
}

export function appendJsonl(path, value) {
  ensureDir(dirname(path));
  writeFileSync(path, `${JSON.stringify(value)}\n`, { flag: "a" });
}

export function harnessPaths(cwd) {
  return {
    root: join(cwd, ".harness"),
    state: join(cwd, ".harness", "state"),
    checkpoints: join(cwd, ".harness", "checkpoints"),
    vault: join(cwd, ".harness", "vault"),
    config: join(cwd, ".harness", "config.yaml"),
    prefs: join(cwd, ".harness", "state", "onboarding-preferences.json"),
    telemetry: join(cwd, ".harness", "state", "telemetry-consent.json"),
    disabled: join(cwd, ".harness", "state", "disabled"),
    audit: join(cwd, ".harness", "audit.log"),
    splashSeen: join(cwd, ".harness", "state", "splash-seen"),
    flags: join(cwd, ".harness", "state", "feature-flags.json"),
  };
}

export function ensureProject(cwd) {
  const p = harnessPaths(cwd);
  ensureDir(join(cwd, ".omp", "extensions"));
  ensureDir(join(cwd, ".claude"));
  ensureDir(join(cwd, ".pi"));
  ensureDir(p.state);
  ensureDir(p.checkpoints);
  ensureDir(p.vault);
}

export function fileSize(path) {
  try {
    const size = statSync(path).size;
    if (size < 1024) return `${size}B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)}KB`;
    return `${(size / (1024 * 1024)).toFixed(1)}MB`;
  } catch { return "missing"; }
}

export function lineCount(path) {
  try { return readFileSync(path, "utf8").split("\n").filter(Boolean).length; } catch { return 0; }
}

export function listJsonFiles(path) {
  try { return readdirSync(path).filter(f => f.endsWith(".json")); } catch { return []; }
}

export function readConfigText(cwd) {
  try { return readFileSync(harnessPaths(cwd).config, "utf8"); } catch { return ""; }
}

export function yamlGet(text, key) {
  const parts = key.split(".");
  if (parts.length === 2) {
    const section = new RegExp(`^${escapeRegex(parts[0])}:\\s*$`, "m").exec(text);
    if (!section) return undefined;
    const after = text.slice(section.index + section[0].length);
    const next = /\n\S[^\n]*:\s*(?:\n|$)/.exec(after);
    const block = next ? after.slice(0, next.index) : after;
    const line = new RegExp(`^\\s+${escapeRegex(parts[1])}:\\s*(.+)$`, "m").exec(block.split("\n").filter(l => !l.trim().startsWith("#")).join("\n"));
    return line ? cleanYamlValue(line[1]) : undefined;
  }
  const line = new RegExp(`^${escapeRegex(key)}:\\s*(.+)$`, "m").exec(text);
  return line ? cleanYamlValue(line[1]) : undefined;
}

export function yamlSet(text, key, value) {
  const rendered = renderYamlValue(value);
  const parts = key.split(".");
  if (parts.length === 2) {
    const leafRe = new RegExp(`^(\\s+${escapeRegex(parts[1])}:\\s*).+$`, "m");
    if (leafRe.test(text)) return text.replace(leafRe, `$1${rendered}`);
    const sectionRe = new RegExp(`^(${escapeRegex(parts[0])}:\\s*\\n)`, "m");
    if (sectionRe.test(text)) return text.replace(sectionRe, `$1  ${parts[1]}: ${rendered}\n`);
    return `${text.trimEnd()}\n${parts[0]}:\n  ${parts[1]}: ${rendered}\n`;
  }
  const re = new RegExp(`^(${escapeRegex(key)}:\\s*).+$`, "m");
  if (re.test(text)) return text.replace(re, `$1${rendered}`);
  return `${text.trimEnd()}\n${key}: ${rendered}\n`;
}

export function writeConfigValue(cwd, key, value) {
  const p = harnessPaths(cwd);
  let text = readConfigText(cwd);
  if (!text) text = `version: "1.0"\ndefaults:\n`;
  writeFileSync(p.config, yamlSet(text, key, value));
}

export function readAgentRuntime(cwd) {
  return yamlGet(readConfigText(cwd), "agent_runtime") ?? "omp";
}

export function detectRuntime(name) {
  if (name === "none") return { name, configured: name, found: true, path: null };
  const binary = name === "claude" ? "claude" : name === "pi" ? "pi" : "omp";
  const result = spawnSync("which", [binary], { encoding: "utf8" });
  return { name: binary, configured: name, found: result.status === 0 && !!result.stdout.trim(), path: result.stdout.trim() || null };
}

export function cleanYamlValue(value) {
  return String(value).trim().replace(/^['"]|['"]$/g, "");
}

function renderYamlValue(value) {
  const s = String(value);
  if (/^(true|false|null|\d+)$/.test(s)) return s;
  return /^[a-zA-Z0-9_.\/-]+$/.test(s) ? s : JSON.stringify(s);
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function redactSecrets(text) {
  return String(text)
    .replace(/(?:AKIA|ASIA)[A-Z0-9]{16}/g, "[REDACTED_AWS_KEY]")
    .replace(/sk-ant-[A-Za-z0-9_-]{16,}/g, "[REDACTED_ANTHROPIC_KEY]")
    .replace(/sk-[A-Za-z0-9_-]{20,}/g, "[REDACTED_API_KEY]")
    .replace(/Bearer\s+[A-Za-z0-9_\-./+=]{20,}/g, "Bearer [REDACTED_TOKEN]")
    .replace(/(?<=(?:API_KEY|SECRET|TOKEN|PASSWORD|PRIVATE_KEY)\s*[=:]\s*["']?)[A-Za-z0-9_\-./+=]{12,}/gi, "[REDACTED_SECRET]");
}
