import { describe, test, expect } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { installHooks, getHooksStatus } from "../lib/git-hooks.js";
import { installPlatforms, platformStatus } from "../lib/platforms.js";

function tempRoot(prefix = "pebkac-hooks-") { return mkdtempSync(join(tmpdir(), prefix)); }
function cleanup(dir) { if (dir?.startsWith(tmpdir())) rmSync(dir, { recursive: true, force: true }); }
function git(args, cwd) { return Bun.spawnSync({ cmd: ["git", ...args], cwd, stdout: "pipe", stderr: "pipe" }); }

describe("managed git hooks", () => {
  test("install is idempotent and preserves existing hooks as .local", () => {
    const cwd = tempRoot();
    try {
      expect(git(["init"], cwd).exitCode).toBe(0);
      const hooksDir = join(cwd, ".git", "hooks");
      mkdirSync(hooksDir, { recursive: true });
      writeFileSync(join(hooksDir, "pre-commit"), "#!/bin/sh\necho user hook\n");
      const first = installHooks(cwd);
      expect(first.ok).toBe(true);
      expect(existsSync(join(hooksDir, "pre-commit.local"))).toBe(true);
      expect(readFileSync(join(hooksDir, "pre-commit"), "utf8")).toContain("PEBKAC-MANAGED-HOOK");
      const second = installHooks(cwd);
      expect(second.ok).toBe(true);
      const status = getHooksStatus(cwd);
      expect(status.ok).toBe(true);
      expect(status.hooks.every(h => h.installed && !h.drifted)).toBe(true);
    } finally { cleanup(cwd); }
  });

  test("status detects drift", () => {
    const cwd = tempRoot();
    try {
      expect(git(["init"], cwd).exitCode).toBe(0);
      expect(installHooks(cwd).ok).toBe(true);
      writeFileSync(join(cwd, ".git", "hooks", "commit-msg"), "#!/bin/sh\n# PEBKAC-MANAGED-HOOK v1\necho drift\n");
      const status = getHooksStatus(cwd);
      expect(status.ok).toBe(false);
      expect(status.hooks.find(h => h.name === "commit-msg")?.drifted).toBe(true);
    } finally { cleanup(cwd); }
  });
});

describe("platform installers", () => {
  test("installs omp extension and claude/pi context", () => {
    const cwd = tempRoot();
    try {
      const results = installPlatforms(cwd, process.cwd(), "all");
      expect(results.every(r => r.ok)).toBe(true);
      expect(existsSync(join(cwd, ".omp", "extensions", "pebkac-defense.js"))).toBe(true);
      expect(readFileSync(join(cwd, ".claude", "CLAUDE.md"), "utf8")).toContain("PEBKAC-MANAGED-CONTEXT");
      expect(readFileSync(join(cwd, ".pi", "CLAUDE.md"), "utf8")).toContain("PEBKAC-MANAGED-CONTEXT");
      const status = platformStatus(cwd, "all");
      expect(status.every(s => s.installed)).toBe(true);
    } finally { cleanup(cwd); }
  });

  test("managed context upsert preserves user text", () => {
    const cwd = tempRoot();
    try {
      mkdirSync(join(cwd, ".claude"), { recursive: true });
      writeFileSync(join(cwd, ".claude", "CLAUDE.md"), "# User notes\nKeep this.\n");
      expect(installPlatforms(cwd, process.cwd(), "claude")[0].ok).toBe(true);
      expect(installPlatforms(cwd, process.cwd(), "claude")[0].ok).toBe(true);
      const text = readFileSync(join(cwd, ".claude", "CLAUDE.md"), "utf8");
      expect(text).toContain("Keep this.");
      expect(text.match(/PEBKAC-MANAGED-CONTEXT:BEGIN/g)?.length).toBe(1);
    } finally { cleanup(cwd); }
  });
});
