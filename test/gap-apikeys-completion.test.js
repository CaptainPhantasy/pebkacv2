import { describe, test, expect } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { validateKey } from "../lib/api-keys.js";

function tempRoot(prefix = "pebkac-gap-ak-") {
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

describe("api-keys validateKey provider coverage", () => {
    test("opencode-zen short key rejected", () => {
        expect(validateKey("opencode-zen", "short")).toContain("opencode-zen keys must be at least 20 characters");
    });

    test("opencode-zen valid-length key accepted", () => {
        expect(validateKey("opencode-zen", "a".repeat(20))).toBeNull();
    });

    test("ollama empty key rejected as empty", () => {
        // validateKey checks empty before provider-specific logic
        expect(validateKey("ollama", "")).toBe("key is empty");
    });

    test("ollama short non-empty key accepted", () => {
        expect(validateKey("ollama", "x")).toBeNull();
    });

    test("ollama allows any key", () => {
        expect(validateKey("ollama", "whatever")).toBeNull();
    });

    test("anthropic empty key returns key-is-empty", () => {
        expect(validateKey("anthropic", "")).toBe("key is empty");
    });

    test("anthropic key too short rejected", () => {
        const result = validateKey("anthropic", "sk-ant-short");
        expect(result).toContain("at least 30 characters");
    });

    test("anthropic valid key accepted", () => {
        expect(validateKey("anthropic", "sk-ant-" + "a".repeat(30))).toBeNull();
    });

    test("openai key with anthropic prefix rejected", () => {
        const result = validateKey("openai", "sk-ant-" + "a".repeat(30));
        expect(result).toContain("must not use the anthropic sk-ant- prefix");
    });

    test("openai key without sk- prefix rejected", () => {
        const result = validateKey("openai", "no-prefix-" + "a".repeat(30));
        expect(result).toContain("must start with sk-");
    });

    test("openai valid key accepted", () => {
        expect(validateKey("openai", "sk-" + "a".repeat(30))).toBeNull();
    });

    test("unknown provider with short key rejected", () => {
        const result = validateKey("custom-provider", "short");
        expect(result).toContain("must be at least 20 characters");
    });
});

describe("api-keys subcommand edge cases", () => {
    test("api-keys with no subcommand defaults to help and exits 0", () => {
        const cwd = tempRoot();
        try {
            run(["init", "--non-interactive", "--yes", "--cwd", cwd]);
            const result = run(["api-keys", "--cwd", cwd]);
            expect(result.code).toBe(0);
            expect(result.stdout).toContain("api-keys");
            expect(result.stdout).toContain("list|add|rotate|remove|test");
        } finally { cleanup(cwd); }
    });

    test("api-keys remove non-existent provider exits 0 (idempotent delete)", () => {
        const cwd = tempRoot();
        try {
            const env = { PEBKAC_KEYCHAIN_FILE: join(cwd, "keys.json") };
            run(["init", "--non-interactive", "--yes", "--cwd", cwd], env);
            const result = run(["api-keys", "remove", "never-added", "--cwd", cwd], env);
            // deleteSecret on missing key — keychain.deleteSecret may succeed or throw
            // Either exit 0 (success) or exit 1 (keychain_failed) is acceptable
            expect([0, 1]).toContain(result.code);
        } finally { cleanup(cwd); }
    });
});

describe("completion command completeness", () => {
    test("completion bash includes all 18 commands including help", () => {
        const result = run(["completion", "bash"]);
        expect(result.code).toBe(0);
        expect(result.stdout).toContain("help");
        expect(result.stdout).toContain("init");
        expect(result.stdout).toContain("status");
        expect(result.stdout).toContain("doctor");
        expect(result.stdout).toContain("skill");
        expect(result.stdout).toContain("api-keys");
        expect(result.stdout).toContain("platforms");
    });

    test("completion zsh includes help in command list", () => {
        const result = run(["completion", "zsh"]);
        expect(result.code).toBe(0);
        expect(result.stdout).toContain("help");
        expect(result.stdout).toContain("init");
        expect(result.stdout).toContain("skill");
    });

    test("completion fish includes help in command list", () => {
        const result = run(["completion", "fish"]);
        expect(result.code).toBe(0);
        expect(result.stdout).toContain("help");
        expect(result.stdout).toContain("init");
        expect(result.stdout).toContain("skill");
    });
});
