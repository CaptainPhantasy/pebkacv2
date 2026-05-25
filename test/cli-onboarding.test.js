import { describe, test, expect } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

function tempRoot() {
  return mkdtempSync(join(tmpdir(), "pebkac-cli-"));
}

function cleanup(dir) {
  if (dir?.startsWith(tmpdir())) rmSync(dir, { recursive: true, force: true });
}

describe("CLI onboarding", () => {
  test("init --non-interactive writes launchable project state", () => {
    const cwd = tempRoot();
    try {
      const result = Bun.spawnSync({
        cmd: [
          "bun",
          "./bin/pebkac.js",
          "init",
          "--non-interactive",
          "--yes",
          "--cwd",
          cwd,
          "--theme",
          "minimal",
          "--no-telemetry",
          "--no-notifications",
          "--no-health-checks",
        ],
        cwd: process.cwd(),
        stdout: "pipe",
        stderr: "pipe",
      });
      const stdout = new TextDecoder().decode(result.stdout);
      const stderr = new TextDecoder().decode(result.stderr);

      expect(result.exitCode, stderr).toBe(0);
      expect(stdout).toContain("PEBKAC init complete");
      expect(existsSync(join(cwd, ".omp", "extensions", "pebkac-defense.js"))).toBe(true);
      expect(existsSync(join(cwd, ".harness", "config.yaml"))).toBe(true);
      expect(existsSync(join(cwd, ".harness", "state", "onboarding-preferences.json"))).toBe(true);
      expect(existsSync(join(cwd, ".harness", "state", "telemetry-consent.json"))).toBe(true);

      const prefs = JSON.parse(readFileSync(join(cwd, ".harness", "state", "onboarding-preferences.json"), "utf8"));
      expect(prefs.theme).toBe("minimal");
      expect(prefs.telemetry).toBe(false);
      expect(prefs.notifications).toBe(false);
      expect(prefs.healthChecks).toBe(false);
    } finally {
      cleanup(cwd);
    }
  });

  test("init without non-interactive mode fails safely when no TTY is available", () => {
    const cwd = tempRoot();
    try {
      const result = Bun.spawnSync({
        cmd: ["bun", "./bin/pebkac.js", "init", "--cwd", cwd],
        cwd: process.cwd(),
        stdout: "pipe",
        stderr: "pipe",
      });
      const output = `${new TextDecoder().decode(result.stdout)}${new TextDecoder().decode(result.stderr)}`;

      expect(result.exitCode).toBe(2);
      expect(output).toContain("--non-interactive");
      expect(output).not.toContain("Select provider");
    } finally {
      cleanup(cwd);
    }
  });
});
