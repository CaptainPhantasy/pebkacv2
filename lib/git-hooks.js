import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, chmodSync } from "fs";
import { join } from "path";
import { spawnSync } from "child_process";
import { writeJson, readJson } from "./common.js";

export const HOOK_MARKER = "PEBKAC-MANAGED-HOOK";
const MANIFEST = ".pebkac-manifest.json";

const HOOKS = {
  "pre-commit": `#!/bin/sh\n# ${HOOK_MARKER} v1\nDIFF=$(git diff --cached --unified=0)\nif printf '%s' "$DIFF" | grep -E '(AKIA|ASIA)[A-Z0-9]{16}|sk-ant-[A-Za-z0-9_-]{16,}|SECRET|TOKEN|PASSWORD' >/dev/null; then\n  printf 'PEBKAC: staged diff appears to contain secrets. Set PEBKAC_ALLOW_SECRETS=1 to override.\\n' >&2\n  [ "$PEBKAC_ALLOW_SECRETS" = "1" ] || exit 1\nfi\nLOCAL=$(git rev-parse --git-path hooks/pre-commit.local)\n[ -x "$LOCAL" ] && exec "$LOCAL" "$@"\nexit 0\n`,
  "pre-push": `#!/bin/sh\n# ${HOOK_MARKER} v1\nZERO=0000000000000000000000000000000000000000\nREJECTED=0\nwhile read local_ref local_sha remote_ref remote_sha; do\n  [ "$local_sha" = "$ZERO" ] && continue\n  case "$remote_ref" in refs/heads/main|refs/heads/master|refs/heads/release/*)\n    if [ "$remote_sha" != "$ZERO" ] && git rev-list "$remote_sha" "^$local_sha" | grep . >/dev/null; then\n      printf 'PEBKAC: force-push to protected branch %s would discard remote commits.\\n' "$remote_ref" >&2\n      [ "$PEBKAC_ALLOW_FORCE" = "1" ] || REJECTED=1\n    fi\n  esac\ndone\n[ "$REJECTED" = "1" ] && exit 1\nLOCAL=$(git rev-parse --git-path hooks/pre-push.local)\n[ -x "$LOCAL" ] && exec "$LOCAL" "$@"\nexit 0\n`,
  "pre-rebase": `#!/bin/sh\n# ${HOOK_MARKER} v1\n[ "$PEBKAC_ALLOW_REWRITE" = "1" ] && exit 0\nUPSTREAM=\"$1\"\n[ -z \"$UPSTREAM\" ] && UPSTREAM='@{upstream}'\nif git rev-parse --verify \"$UPSTREAM\" >/dev/null 2>&1; then\n  if git rev-list \"$UPSTREAM\"..HEAD --remotes | grep . >/dev/null 2>&1; then\n    printf 'PEBKAC: refusing to rebase commits already visible on a remote.\\n' >&2\n    exit 1\n  fi\nfi\nLOCAL=$(git rev-parse --git-path hooks/pre-rebase.local)\n[ -x \"$LOCAL\" ] && exec \"$LOCAL\" \"$@\"\nexit 0\n`,
  "commit-msg": `#!/bin/sh\n# ${HOOK_MARKER} v1\nFIRST=$(sed -n '1p' "$1" | tr -d '\\r')\ncase "$FIRST" in ""|"."|"WIP"|"wip"|"fix"|"update"|"changes")\n  printf 'PEBKAC: commit message is too vague. Use a meaningful conventional commit.\\n' >&2\n  exit 1\n;; esac\nLOCAL=$(git rev-parse --git-path hooks/commit-msg.local)\n[ -x "$LOCAL" ] && exec "$LOCAL" "$@"\nexit 0\n`,
};

export function findGitRoot(cwd) {
  const r = spawnSync("git", ["-C", cwd, "rev-parse", "--show-toplevel"], { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : null;
}

function hookStatus(hooksDir, name) {
  const path = join(hooksDir, name);
  if (!existsSync(path)) return { name, installed: false, drifted: false };
  const text = readFileSync(path, "utf8");
  return { name, installed: text.includes(HOOK_MARKER), drifted: text.includes(HOOK_MARKER) && text !== HOOKS[name] };
}

export function installHooks(cwd) {
  const root = findGitRoot(cwd);
  if (!root) return { ok: false, reason: "not a git repository", installed: [] };
  const hooksDir = join(root, ".git", "hooks");
  mkdirSync(hooksDir, { recursive: true });
  const installed = [];
  for (const [name, content] of Object.entries(HOOKS)) {
    const target = join(hooksDir, name);
    const local = join(hooksDir, `${name}.local`);
    if (existsSync(target)) {
      const current = readFileSync(target, "utf8");
      if (!current.includes(HOOK_MARKER) && !existsSync(local)) renameSync(target, local);
    }
    writeFileSync(target, content);
    chmodSync(target, 0o755);
    installed.push(name);
  }
  writeJson(join(hooksDir, MANIFEST), { marker: HOOK_MARKER, installedAt: new Date().toISOString(), hooks: installed });
  return { ok: true, gitRoot: root, hooksDir, installed };
}

export function getHooksStatus(cwd) {
  const root = findGitRoot(cwd);
  if (!root) return { ok: false, reason: "not a git repository", hooks: [] };
  const hooksDir = join(root, ".git", "hooks");
  const hooks = Object.keys(HOOKS).map(name => hookStatus(hooksDir, name));
  const manifest = readJson(join(hooksDir, MANIFEST), null);
  return { ok: hooks.every(h => h.installed && !h.drifted), gitRoot: root, hooksDir, manifestPresent: !!manifest, hooks };
}

export function runHooks(cwd, args, ui, { json = false } = {}) {
  const sub = args[args.indexOf("hooks") + 1] ?? "status";
  const result = sub === "install" ? installHooks(cwd) : sub === "status" ? getHooksStatus(cwd) : null;
  if (!result) { ui.error("Usage: pebkac hooks <install|status>"); return 2; }
  if (json) ui.raw(JSON.stringify(result, null, 2));
  else if (!result.ok && result.reason) ui.error(`${ui.icon("fail")} ${result.reason}`);
  else {
    ui.log(ui.header(`Git hooks ${sub}`));
    for (const hook of result.hooks ?? result.installed.map(name => ({ name, installed: true, drifted: false }))) {
      ui.log(`  ${hook.installed && !hook.drifted ? ui.icon("pass") : ui.icon("fail")} ${hook.name}${hook.drifted ? " drifted" : ""}`);
    }
  }
  return result.ok ? 0 : 1;
}
