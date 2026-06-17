import { describe, test, expect } from "bun:test";
import { mkdtempSync, rmSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

function tempRoot(prefix = "pebkac-gap-ops-") {
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

describe("flags command edge cases", () => {
    test("flags get unknown flag exits 2 with known-flags list", () => {
        const cwd = tempRoot();
        try {
            run(["init", "--non-interactive", "--yes", "--cwd", cwd]);
            const result = run(["flags", "get", "nonexistent_flag", "--cwd", cwd]);
            expect(result.code).toBe(2);
            expect(result.stderr).toContain("known flags");
            expect(result.stderr).toContain("evidence_contracts");
        } finally { cleanup(cwd); }
    });

    test("flags set with invalid bool exits 2", () => {
        const cwd = tempRoot();
        try {
            run(["init", "--non-interactive", "--yes", "--cwd", cwd]);
            const result = run(["flags", "set", "git_guard", "maybe", "--cwd", cwd]);
            expect(result.code).toBe(2);
            expect(result.stderr).toContain("flag value must be true/false/on/off/1/0");
        } finally { cleanup(cwd); }
    });

    test("flags set true persists and round-trips via get", () => {
        const cwd = tempRoot();
        try {
            run(["init", "--non-interactive", "--yes", "--cwd", cwd]);
            const setRes = run(["flags", "set", "rate_limiter", "true", "--cwd", cwd]);
            expect(setRes.code).toBe(0);
            const getRes = run(["flags", "get", "rate_limiter", "--cwd", cwd]);
            expect(getRes.code).toBe(0);
            expect(getRes.stdout).toContain("true");
        } finally { cleanup(cwd); }
    });

    test("flags set off parses as false", () => {
        const cwd = tempRoot();
        try {
            run(["init", "--non-interactive", "--yes", "--cwd", cwd]);
            const setRes = run(["flags", "set", "checkpoints", "off", "--cwd", cwd]);
            expect(setRes.code).toBe(0);
            const getRes = run(["flags", "get", "checkpoints", "--json", "--cwd", cwd]);
            expect(getRes.code).toBe(0);
            const parsed = JSON.parse(getRes.stdout);
            expect(parsed.value).toBe(false);
        } finally { cleanup(cwd); }
    });

    test("flags with no subcommand defaults to list", () => {
        const cwd = tempRoot();
        try {
            run(["init", "--non-interactive", "--yes", "--cwd", cwd]);
            const result = run(["flags", "--cwd", cwd], { env: { NO_COLOR: "1" } });
            expect(result.code).toBe(0);
            expect(result.stdout).toContain("Flags");
            expect(result.stdout).toContain("evidence_contracts");
        } finally { cleanup(cwd); }
    });

    test("flags get --json outputs valid JSON with key/value/path", () => {
        const cwd = tempRoot();
        try {
            run(["init", "--non-interactive", "--yes", "--cwd", cwd]);
            const result = run(["flags", "get", "git_guard", "--json", "--cwd", cwd]);
            expect(result.code).toBe(0);
            const parsed = JSON.parse(result.stdout);
            expect(parsed.key).toBe("git_guard");
            expect(parsed).toHaveProperty("value");
            expect(parsed).toHaveProperty("path");
        } finally { cleanup(cwd); }
    });
});

describe("mode command edge cases", () => {
    test("mode set runtime invalid exits 2", () => {
        const cwd = tempRoot();
        try {
            run(["init", "--non-interactive", "--yes", "--cwd", cwd]);
            const result = run(["mode", "set", "runtime", "invalid-runtime", "--cwd", cwd]);
            expect(result.code).toBe(2);
            expect(result.stderr).toContain("runtime must be omp, claude, pi, or none");
        } finally { cleanup(cwd); }
    });

    test("mode set verbosity invalid exits 2", () => {
        const cwd = tempRoot();
        try {
            run(["init", "--non-interactive", "--yes", "--cwd", cwd]);
            const result = run(["mode", "set", "verbosity", "loud", "--cwd", cwd]);
            expect(result.code).toBe(2);
            expect(result.stderr).toContain("verbosity must be full, normal, or quiet");
        } finally { cleanup(cwd); }
    });

    test("mode set enabled invalid exits 2", () => {
        const cwd = tempRoot();
        try {
            run(["init", "--non-interactive", "--yes", "--cwd", cwd]);
            const result = run(["mode", "set", "enabled", "perhaps", "--cwd", cwd]);
            expect(result.code).toBe(2);
            expect(result.stderr).toContain("enabled must be true or false");
        } finally { cleanup(cwd); }
    });

    test("mode set unknown key exits 2", () => {
        const cwd = tempRoot();
        try {
            run(["init", "--non-interactive", "--yes", "--cwd", cwd]);
            const result = run(["mode", "set", "unknown_key", "value", "--cwd", cwd]);
            expect(result.code).toBe(2);
            expect(result.stderr).toContain("mode key must be runtime, verbosity, or enabled");
        } finally { cleanup(cwd); }
    });

    test("mode set runtime claude persists to config", () => {
        const cwd = tempRoot();
        try {
            run(["init", "--non-interactive", "--yes", "--cwd", cwd]);
            const result = run(["mode", "set", "runtime", "claude", "--cwd", cwd]);
            expect(result.code).toBe(0);
            const config = readFileSync(join(cwd, ".harness", "config.yaml"), "utf8");
            expect(config).toMatch(/agent_runtime:\s*claude/);
        } finally { cleanup(cwd); }
    });

    test("mode with no subcommand defaults to show", () => {
        const cwd = tempRoot();
        try {
            run(["init", "--non-interactive", "--yes", "--cwd", cwd]);
            const result = run(["mode", "--cwd", cwd]);
            expect(result.code).toBe(0);
            expect(result.stdout).toContain("runtime:");
            expect(result.stdout).toContain("verbosity:");
        } finally { cleanup(cwd); }
    });

    test("mode show --json outputs valid JSON with expected keys", () => {
        const cwd = tempRoot();
        try {
            run(["init", "--non-interactive", "--yes", "--cwd", cwd]);
            const result = run(["mode", "show", "--json", "--cwd", cwd]);
            expect(result.code).toBe(0);
            const parsed = JSON.parse(result.stdout);
            expect(parsed).toHaveProperty("runtime");
            expect(parsed).toHaveProperty("verbosity");
            expect(parsed).toHaveProperty("enabled");
            expect(parsed).toHaveProperty("disabledSentinel");
        } finally { cleanup(cwd); }
    });
});

describe("audit command edge cases", () => {
    test("audit summary on project with no audit log exits 0 and shows empty", () => {
        const cwd = tempRoot();
        try {
            run(["init", "--non-interactive", "--yes", "--cwd", cwd]);
            // Remove audit log to simulate empty
            const auditPath = join(cwd, ".harness", "audit.log");
            try { rmSync(auditPath); } catch {}
            const result = run(["audit", "summary", "--cwd", cwd], { env: { NO_COLOR: "1" } });
            expect(result.code).toBe(0);
            expect(result.stdout).toContain("empty");
        } finally { cleanup(cwd); }
    });

    test("audit tail --limit 2 exits 0 and respects limit", () => {
        const cwd = tempRoot();
        try {
            run(["init", "--non-interactive", "--yes", "--cwd", cwd]);
            // Generate audit events
            run(["status", "--cwd", cwd]);
            run(["status", "--cwd", cwd]);
            run(["status", "--cwd", cwd]);
            run(["status", "--cwd", cwd]);
            run(["status", "--cwd", cwd]);
            const result = run(["audit", "tail", "--limit", "2", "--cwd", cwd]);
            expect(result.code).toBe(0);
            // Non-json tail prints each entry on its own line
            const lines = result.stdout.trim().split("\n").filter(l => l.trim());
            expect(lines.length).toBeLessThanOrEqual(2);
        } finally { cleanup(cwd); }
    });

    test("audit tail --json outputs valid JSON with path and entries", () => {
        const cwd = tempRoot();
        try {
            run(["init", "--non-interactive", "--yes", "--cwd", cwd]);
            run(["status", "--cwd", cwd]);
            const result = run(["audit", "tail", "--json", "--cwd", cwd]);
            expect(result.code).toBe(0);
            const parsed = JSON.parse(result.stdout);
            expect(parsed).toHaveProperty("path");
            expect(parsed).toHaveProperty("entries");
            expect(Array.isArray(parsed.entries)).toBe(true);
        } finally { cleanup(cwd); }
    });

    test("audit with no subcommand defaults to summary", () => {
        const cwd = tempRoot();
        try {
            run(["init", "--non-interactive", "--yes", "--cwd", cwd]);
            const result = run(["audit", "--cwd", cwd], { env: { NO_COLOR: "1" } });
            expect(result.code).toBe(0);
            expect(result.stdout).toContain("Audit summary");
        } finally { cleanup(cwd); }
    });
});
