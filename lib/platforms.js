import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { resolveExtensionSource } from "./embedded.js";

const PLATFORMS = ["omp", "claude", "pi"];
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
  if (!["all", ...PLATFORMS].includes(target)) { ui.error("platform must be omp, claude, pi, or all"); return 2; }
  let result;
  if (sub === "install") result = installPlatforms(cwd, repoRoot, target);
  else if (sub === "status") result = platformStatus(cwd, target);
  else { ui.error("Usage: pebkac platforms <install|status> [omp|claude|pi|all]"); return 2; }
  const ok = result.every(r => r.ok !== false && (sub === "install" || r.installed));
  if (json) ui.raw(JSON.stringify({ ok, platforms: result }, null, 2));
  else {
    ui.log(ui.header(`Platforms ${sub}`));
    for (const r of result) ui.log(`  ${r.ok === false || r.installed === false ? ui.icon("fail") : ui.icon("pass")} ${r.platform} ${ui.dim(r.path ?? r.reason ?? "")}`);
  }
  return ok ? 0 : 1;
}
