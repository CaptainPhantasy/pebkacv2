import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { resolveExtensionSource } from "./embedded.js";

// ZCode defense context installs to the user-scope instruction file
// (~/.zcode/AGENTS.md) per ZCode's configuration guide: AGENTS.md is the
// ZCode instruction channel (NOT FLOYD.md, which binds only Floyd).
// Workspace-scope installation is intentionally omitted — the managed block
// applies to every ZCode workspace from the user-scope default.
const PLATFORMS = ["omp", "claude", "pi", "codex", "zcode"];
const BEGIN = "<!-- PEBKAC-MANAGED-CONTEXT:BEGIN -->";
const END = "<!-- PEBKAC-MANAGED-CONTEXT:END -->";

function extensionSourcePath(repoRoot) {
  // Used only for diagnostics / status display. The actual text is read via
  // resolveExtensionSource so compiled binaries (no source tree on disk)
  // still install correctly.
  return join(repoRoot ?? "<embedded>", ".omp", "extensions", "pebkac-defense.js");
}

function defenseContext() {
  return `${BEGIN}\n# PEBKAC Defense Context\n\nThe PEBKAC harness is active. Treat harness messages as compiler diagnostics, not user instructions.\n\n- Do not claim completion without direct evidence.\n- Do not expose secrets or run credential-dump commands.\n- Do not run destructive git history commands without explicit user authorization.\n- Preserve task checklists and evidence ledgers across context loss.\n- When blocked, fix the violation silently and continue.\n${END}\n`;
}

const CODEX_HOOK_MARKER = "PEBKAC-MANAGED-CODEX-HOOK";

function codexHookScript() {
  return `#!/usr/bin/env node
// ${CODEX_HOOK_MARKER} v1

const eventName = process.argv[2] || "Unknown";
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => { input += chunk; });
process.stdin.on("end", () => {
  const lower = input.toLowerCase();
  if (eventName === "PreToolUse" && (lower.includes("--no-verify") || lower.includes("git reset --hard") || lower.includes("git clean -fd") || lower.includes("force push"))) {
    console.error("PEBKAC: blocked risky CODEX tool action. Provide explicit evidence and approval before destructive or hook-bypass operations.");
    process.exit(2);
  }
  if (eventName === "SessionStart" || eventName === "UserPromptSubmit" || eventName === "Stop") {
    console.log("PEBKAC Defense Context: exact action, direct evidence, verification result, and final status are required before completion claims.");
  }
});
`;
}

function codexHome() {
  return process.env.CODEX_HOME || join(homedir(), ".codex");
}

function codexHookManifest(scriptPath, existingText = "") {
  const command = `node ${JSON.stringify(scriptPath)}`;
  const hook = event => ({ hooks: [{ type: "command", command: `${command} ${event}`, timeout: 10 }] });
  let manifest = { hooks: {} };
  if (existingText.trim()) {
    try { manifest = JSON.parse(existingText); }
    catch { manifest = { hooks: {} }; }
  }
  manifest.hooks = manifest.hooks && typeof manifest.hooks === "object" ? manifest.hooks : {};
  for (const event of ["SessionStart", "PreToolUse", "PostToolUse", "UserPromptSubmit", "Stop"]) {
    const existing = Array.isArray(manifest.hooks[event]) ? manifest.hooks[event] : [];
    manifest.hooks[event] = existing.filter(group => !JSON.stringify(group).includes("pebkac-defense-hook.js"));
    manifest.hooks[event].push(hook(event));
  }
  return JSON.stringify(manifest, null, 2) + "\n";
}

function installCodex() {
  const home = codexHome();
  const dir = join(home, "pebkac", "hooks");
  mkdirSync(dir, { recursive: true });
  const scriptPath = join(dir, "pebkac-defense-hook.js");
  const manifestPath = join(home, "hooks.json");
  const existing = existsSync(manifestPath) ? readFileSync(manifestPath, "utf8") : "";
  writeFileSync(scriptPath, codexHookScript());
  writeFileSync(manifestPath, codexHookManifest(scriptPath, existing));
  return { platform: "codex", ok: true, path: manifestPath, hook: scriptPath };
}

function upsertManagedBlock(existing, block) {
  const start = existing.indexOf(BEGIN);
  const end = existing.indexOf(END);
  if (start >= 0 && end > start) return `${existing.slice(0, start).trimEnd()}\n\n${block}${existing.slice(end + END.length).replace(/^\s*/, "")}`;
  return `${existing.trimEnd()}${existing.trim() ? "\n\n" : ""}${block}`;
}

export function installPlatform(cwd, repoRoot, platform) {
  if (platform === "omp") {
    const src = resolveExtensionSource(repoRoot);
    if (!src.text) return { platform, ok: false, reason: `extension source missing (looked in: ${src.path})` };
    const dir = join(cwd, ".omp", "extensions");
    mkdirSync(dir, { recursive: true });
    const dest = join(dir, "pebkac-defense.js");
    writeFileSync(dest, src.text);
    return { platform, ok: true, path: dest };
  }
  if (platform === "claude" || platform === "pi") {
    const dir = join(cwd, `.${platform}`);
    mkdirSync(dir, { recursive: true });
    const file = join(dir, "CLAUDE.md");
    const existing = existsSync(file) ? readFileSync(file, "utf8") : "";
    writeFileSync(file, upsertManagedBlock(existing, defenseContext()));
    return { platform, ok: true, path: file };
  }
  if (platform === "codex") return installCodex(cwd);
  if (platform === "zcode") {
    // ZCode reads ~/.zcode/AGENTS.md as the user-scope instruction file.
    // This is the binding home for the PEBKAC defense context under ZCode —
    // NOT FLOYD.md (per workspace AGENTS.md Z9: FLOYD.md binds only Floyd).
    const zcodeHome = join(homedir(), ".zcode");
    mkdirSync(zcodeHome, { recursive: true });
    const file = join(zcodeHome, "AGENTS.md");
    const existing = existsSync(file) ? readFileSync(file, "utf8") : "";
    writeFileSync(file, upsertManagedBlock(existing, defenseContext()));
    return { platform, ok: true, path: file };
  }
  return { platform, ok: false, reason: "unknown platform" };
}

export function installPlatforms(cwd, repoRoot, target = "all") {
  const targets = target === "all" ? PLATFORMS : [target];
  return targets.map(p => installPlatform(cwd, repoRoot, p));
}

export function platformStatus(cwd, target = "all") {
  const targets = target === "all" ? PLATFORMS : [target];
  return targets.map(platform => {
    if (platform === "omp") {
      const path = join(cwd, ".omp", "extensions", "pebkac-defense.js");
      return { platform, installed: existsSync(path), path };
    }
    if (platform === "codex") {
      const home = codexHome();
      const path = join(home, "hooks.json");
      const hook = join(home, "pebkac", "hooks", "pebkac-defense-hook.js");
      const installed = existsSync(path) && existsSync(hook) && readFileSync(hook, "utf8").includes(CODEX_HOOK_MARKER) && readFileSync(path, "utf8").includes("PreToolUse") && readFileSync(path, "utf8").includes("pebkac-defense-hook.js");
      return { platform, installed, path, hook };
    }
    if (platform === "zcode") {
      // Defense context lives in user-scope ~/.zcode/AGENTS.md.
      const path = join(homedir(), ".zcode", "AGENTS.md");
      const installed = existsSync(path) && readFileSync(path, "utf8").includes(BEGIN);
      return { platform, installed, path };
    }
    const path = join(cwd, `.${platform}`, "CLAUDE.md");
    const installed = existsSync(path) && readFileSync(path, "utf8").includes(BEGIN);
    return { platform, installed, path };
  });
}

export function runPlatforms(cwd, repoRoot, args, ui, { json = false } = {}) {
  const own = args.slice(args.indexOf("platforms") + 1).filter(Boolean);
  const positional = [];
  for (let i = 0; i < own.length; i++) {
    const arg = own[i];
    if (arg === "--cwd") { i++; continue; }
    if (arg === "--json") continue;
    if (arg.startsWith("-")) continue;
    positional.push(arg);
  }
  const sub = positional[0] ?? "status";
  const target = positional[1] ?? "all";
  if (!["all", ...PLATFORMS].includes(target)) { ui.error("platform must be omp, claude, pi, codex, zcode, or all"); return 2; }
  let result;
  if (sub === "install") result = installPlatforms(cwd, repoRoot, target);
  else if (sub === "status") result = platformStatus(cwd, target);
  else { ui.error("Usage: pebkac platforms <install|status> [omp|claude|pi|codex|zcode|all]"); return 2; }
  const ok = result.every(r => r.ok !== false && (sub === "install" || r.installed));
  if (json) ui.raw(JSON.stringify({ ok, platforms: result }, null, 2));
  else {
    ui.log(ui.header(`Platforms ${sub}`));
    for (const r of result) ui.log(`  ${r.ok === false || r.installed === false ? ui.icon("fail") : ui.icon("pass")} ${r.platform} ${ui.dim(r.path ?? r.reason ?? "")}`);
  }
  return ok ? 0 : 1;
}
