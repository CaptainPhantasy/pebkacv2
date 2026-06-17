import { describe, test, expect } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { validateKey, buildTestRequest } from "../lib/api-keys.js";

function tempRoot(prefix = "pebkac-api-") { return mkdtempSync(join(tmpdir(), prefix)); }
function cleanup(dir) { if (dir?.startsWith(tmpdir())) rmSync(dir, { recursive: true, force: true }); }
function run(args, env = {}) {
  const result = Bun.spawnSync({ cmd: ["bun", "./bin/pebkac.js", ...args], cwd: process.cwd(), stdout: "pipe", stderr: "pipe", env: { ...process.env, ...env } });
  return { code: result.exitCode, stdout: new TextDecoder().decode(result.stdout), stderr: new TextDecoder().decode(result.stderr) };
}

describe("api-keys unified command", () => {
  test("provider validation prevents obvious key mixups", () => {
    expect(validateKey("anthropic", "sk-ant-test-aaaaaaaaaaaaaaaaaaaaaaaaa")).toBeNull();
    expect(validateKey("anthropic", "sk-openai-aaaaaaaaaaaaaaaaaaaaaaaa")).toContain("sk-ant");
    expect(validateKey("openai", "sk-ant-test-aaaaaaaaaaaaaaaaaaaaaaaaa")).toContain("anthropic");
    expect(validateKey("openai", "sk-openai-bbbbbbbbbbbbbbbbbbbbbbbbb")).toBeNull();
  });

  test("test request construction does not require network", () => {
    expect(buildTestRequest("anthropic", "sk-ant-x")?.headers["anthropic-version"]).toBe("2023-06-01");
    expect(buildTestRequest("openai", "sk-openai-x")?.headers.Authorization).toBe("Bearer sk-openai-x");
    expect(buildTestRequest("ollama", "")?.url).toContain("localhost:11434");
    expect(buildTestRequest("unknown", "x")).toBeNull();
  });

  test("file backend CRUD never writes raw key to audit", () => {
    const cwd = tempRoot();
    const keyFile = join(cwd, "keys.json");
    try {
      const env = { PEBKAC_KEYCHAIN_FILE: keyFile, TEST_ANTHROPIC_KEY: "sk-ant-test-aaaaaaaaaaaaaaaaaaaaaaaaa", TEST_ANTHROPIC_KEY_2: "sk-ant-test-bbbbbbbbbbbbbbbbbbbbbbbbb" };
      expect(run(["init", "--non-interactive", "--yes", "--cwd", cwd], env).code).toBe(0);
      expect(run(["api-keys", "add", "anthropic", "--key-from-env", "TEST_ANTHROPIC_KEY", "--cwd", cwd], env).code).toBe(0);
      expect(run(["api-keys", "add", "anthropic", "--key-from-env", "TEST_ANTHROPIC_KEY", "--cwd", cwd], env).code).toBe(1);
      expect(run(["api-keys", "rotate", "anthropic", "--key-from-env", "TEST_ANTHROPIC_KEY_2", "--cwd", cwd], env).code).toBe(0);
      const list = run(["api-keys", "list", "--cwd", cwd], env);
      expect(list.code).toBe(0);
      expect(list.stdout).toContain("anthropic");
      expect(list.stdout).not.toContain("sk-ant-test");
      const audit = readFileSync(join(cwd, ".harness", "audit.log"), "utf8");
      expect(audit).not.toContain("sk-ant-test-aaaaaaaaaaaaaaaaaaaaaaaaa");
      expect(audit).not.toContain("sk-ant-test-bbbbbbbbbbbbbbbbbbbbbbbbb");
      expect(run(["api-keys", "remove", "anthropic", "--cwd", cwd], env).code).toBe(0);
      expect(run(["api-keys", "list", "--cwd", cwd], env).stdout).toContain("No API keys");
    } finally { cleanup(cwd); }
  });

  test("non-interactive add requires explicit env source", () => {
    const cwd = tempRoot();
    try {
      const env = { PEBKAC_KEYCHAIN_FILE: join(cwd, "keys.json") };
      expect(run(["init", "--non-interactive", "--yes", "--cwd", cwd], env).code).toBe(0);
      const r = run(["api-keys", "add", "anthropic", "--cwd", cwd], env);
      expect(r.code).toBe(2);
      expect(r.stderr).toContain("--key-from-env");
    } finally { cleanup(cwd); }
  });
});
