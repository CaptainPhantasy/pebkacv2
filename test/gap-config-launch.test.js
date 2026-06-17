import { describe, test, expect } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

function tempRoot(prefix = "pebkac-gap-cl-") {
    return mkdtempSync(join(tmpdir(), prefix));
}
function cleanup(dir) {
    if (dir?.startsWith(tmpdir())) rmSync(dir, { recursive: true, force: true });
}
function run(args, opts = {}) {
    const result = Bun.spawnSync({
        cmd: ["bun", "./bin/pebkac.js", ...args],
        cwd: process.cwd(),
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, ...opts.env },
    });
    return {
        code: result.exitCode,
        stdout: new TextDecoder().decode(result.stdout),
        stderr: new TextDecoder().decode(result.stderr),
    };
}

describe("config command edge cases", () => {
    test("config set without value exits 2 with usage error", () => {
        const cwd = tempRoot();
        try {
            run(["init", "--non-interactive", "--yes", "--cwd", cwd]);
            const result = run(["config", "set", "agent_runtime", "--cwd", cwd]);
            expect(result.code).toBe(2);
            expect(result.stderr).toContain("Usage: pebkac config set <key> <value>");
        } finally { cleanup(cwd); }
    });

    test("config unknown subcommand exits 2", () => {
        const cwd = tempRoot();
        try {
            run(["init", "--non-interactive", "--yes", "--cwd", cwd]);
            const result = run(["config", "bogus", "--cwd", cwd]);
            expect(result.code).toBe(2);
            expect(result.stderr).toContain("Unknown config subcommand");
        } finally { cleanup(cwd); }
    });

    test("config get nested key --json outputs valid JSON", () => {
        const cwd = tempRoot();
        try {
            run(["init", "--non-interactive", "--yes", "--cwd", cwd]);
            const result = run(["config", "get", "defaults.verbosity", "--json", "--cwd", cwd]);
            expect(result.code).toBe(0);
            const parsed = JSON.parse(result.stdout);
            expect(parsed.key).toBe("defaults.verbosity");
            expect(parsed).toHaveProperty("value");
            expect(parsed).toHaveProperty("path");
        } finally { cleanup(cwd); }
    });

    test("config list --json outputs valid JSON with path/keys/raw", () => {
        const cwd = tempRoot();
        try {
            run(["init", "--non-interactive", "--yes", "--cwd", cwd]);
            const result = run(["config", "list", "--json", "--cwd", cwd]);
            expect(result.code).toBe(0);
            const parsed = JSON.parse(result.stdout);
            expect(parsed).toHaveProperty("path");
            expect(parsed).toHaveProperty("keys");
            expect(parsed).toHaveProperty("raw");
            expect(parsed.keys).toHaveProperty("agent_runtime");
        } finally { cleanup(cwd); }
    });

    test("config set nested key round-trips via get", () => {
        const cwd = tempRoot();
        try {
            run(["init", "--non-interactive", "--yes", "--cwd", cwd]);
            const setRes = run(["config", "set", "defaults.turn_budget", "50", "--cwd", cwd]);
            expect(setRes.code).toBe(0);
            const getRes = run(["config", "get", "defaults.turn_budget", "--json", "--cwd", cwd]);
            expect(getRes.code).toBe(0);
            const parsed = JSON.parse(getRes.stdout);
            expect(String(parsed.value)).toBe("50");
        } finally { cleanup(cwd); }
    });

    test("config get with no key exits 2 with usage error", () => {
        const cwd = tempRoot();
        try {
            run(["init", "--non-interactive", "--yes", "--cwd", cwd]);
            const result = run(["config", "get", "--cwd", cwd]);
            expect(result.code).toBe(2);
            expect(result.stderr).toContain("Usage: pebkac config get <key>");
        } finally { cleanup(cwd); }
    });
});

describe("launch command edge cases", () => {
    test("launch with agent_runtime none prints Standalone mode and exits 0", () => {
        const cwd = tempRoot();
        try {
            run(["init", "--non-interactive", "--yes", "--cwd", cwd]);
            writeFileSync(join(cwd, ".harness", "config.yaml"), 'version: "1.0"\ndefaults:\n  enabled: true\nagent_runtime: "none"\n');
            const result = run(["launch", "--cwd", cwd]);
            expect(result.code).toBe(0);
            expect(result.stdout).toContain("Standalone mode");
        } finally { cleanup(cwd); }
    });

    test("launch --dry-run with unconfigured runtime prints command and runtime path", () => {
        const cwd = tempRoot();
        try {
            run(["init", "--non-interactive", "--yes", "--cwd", cwd]);
            // detectRuntime maps unknown names to the omp binary; verify dry-run shows command
            writeFileSync(join(cwd, ".harness", "config.yaml"), 'version: "1.0"\ndefaults:\n  enabled: true\nagent_runtime: "omp"\n');
            const result = run(["launch", "--dry-run", "--cwd", cwd]);
            expect(result.code).toBe(0);
            expect(result.stdout).toContain("omp");
            expect(result.stdout).toContain("--dry-run");
        } finally { cleanup(cwd); }
    });

});
