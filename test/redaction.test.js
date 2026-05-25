import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createFakePi, createTempCwd, cleanupTempCwd, writeConfig, writeToolVersions } from "./helpers/fake-pi.js";
import pebkacDefenseExtension from "../.omp/extensions/pebkac-defense.js";

describe("Secret redaction in tool results", () => {
  let cwd, pi;

  beforeEach(() => {
    cwd = createTempCwd();
    writeConfig(cwd);
    pi = createFakePi(cwd);
    pebkacDefenseExtension(pi);
  });

  afterEach(() => {
    cleanupTempCwd(cwd);
  });

  async function emitToolResult(toolName, text) {
    const event = {
      toolName,
      toolCallId: "call-test-001",
      content: [{ type: "text", text }],
      isError: false,
    };
    return await pi.emit("tool_result", event);
  }

  const AWS_KEY = "AKIAIOSFODNN7EXAMPLE";
  const BEARER = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
  const GH_TOKEN = "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij";
  const STRIPE_KEY = "sk_live_" + "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijkl";
  const SLACK_TOKEN = "xoxb-" + "1234567890-1234567890123-AbCdEfGhIjKlMnOpQrStUvWx";
  const PRIV_KEY_HEADER = "-----BEGIN RSA PRIVATE KEY-----";
  const PRIV_KEY_BODY = "MIIEpAIBAAKCAQEA0Z3VS5JJcds3xfn/ygWyF8PbnGy0AHB7mSrORbsXxHNHYtML";
  const PRIV_KEY_FOOTER = "-----END RSA PRIVATE KEY-----";

  test("Redacts AWS access key from tool output", async () => {
    const raw = "export AWS_ACCESS_KEY_ID=" + AWS_KEY;
    const result = await emitToolResult("bash", raw);
    const text = result.content?.[0]?.text ?? raw;
    expect(text).not.toContain(AWS_KEY);
    expect(text).toContain("[REDACTED]");
  });

  test("Redacts Bearer token from tool output", async () => {
    const raw = "Authorization: Bearer " + BEARER;
    const result = await emitToolResult("bash", raw);
    const text = result.content?.[0]?.text ?? raw;
    expect(text).not.toContain(BEARER.slice(0, 30));
    expect(text).toContain("[REDACTED]");
  });

  test("Redacts GitHub token from tool output", async () => {
    const raw = "token: " + GH_TOKEN;
    const result = await emitToolResult("bash", raw);
    const text = result.content?.[0]?.text ?? raw;
    expect(text).not.toContain(GH_TOKEN);
    expect(text).toContain("[REDACTED]");
  });

  test("Redacts Stripe live key from tool output", async () => {
    const raw = "const key = " + STRIPE_KEY;
    const result = await emitToolResult("bash", raw);
    const text = result.content?.[0]?.text ?? raw;
    expect(text).not.toContain(STRIPE_KEY);
    expect(text).toContain("[REDACTED]");
  });

  test("Redacts Slack token from tool output", async () => {
    const raw = "SLACK_TOKEN=" + SLACK_TOKEN;
    const result = await emitToolResult("bash", raw);
    const text = result.content?.[0]?.text ?? raw;
    expect(text).not.toContain(SLACK_TOKEN);
    expect(text).toContain("[REDACTED]");
  });

  test("Redacts private key from tool output", async () => {
    const raw = PRIV_KEY_HEADER + "\n" + PRIV_KEY_BODY + "\n" + PRIV_KEY_FOOTER;
    const result = await emitToolResult("bash", raw);
    const text = result.content?.[0]?.text ?? raw;
    expect(text).not.toContain(PRIV_KEY_BODY);
    expect(text).toContain("[REDACTED]");
  });

  test("Redacts URL-embedded password from tool output", async () => {
    const raw = "DATABASE_URL=postgres://admin:s3cretP@ss@db.example.com:5432/mydb";
    const result = await emitToolResult("bash", raw);
    const text = result.content?.[0]?.text ?? raw;
    expect(text).not.toContain("s3cretP@ss@");
    expect(text).toContain("[REDACTED]");
  });

  test("Redacts API key assignment from tool output", async () => {
    const apiKey = "sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    const raw = 'API_KEY="' + apiKey + '"';
    const result = await emitToolResult("bash", raw);
    const text = result.content?.[0]?.text ?? raw;
    expect(text).not.toContain(apiKey);
    expect(text).toContain("[REDACTED]");
  });

  test("Non-secret output passes through unchanged", async () => {
    const safe = "Build successful. 42 tests passed, 0 failed.";
    const result = await emitToolResult("bash", safe);
    const text = result.content?.[0]?.text ?? safe;
    expect(text).toContain("Build successful. 42 tests passed, 0 failed.");
    expect(text).not.toContain("[REDACTED]");
  });

  test("Multiple secrets in single output are all redacted", async () => {
    const multi = "key1=" + AWS_KEY + " and token=" + GH_TOKEN;
    const result = await emitToolResult("bash", multi);
    const text = result.content?.[0]?.text ?? multi;
    expect(text).not.toContain(AWS_KEY);
    expect(text).not.toContain(GH_TOKEN);
    const redactedCount = (text.match(/\[REDACTED\]/g) || []).length;
    expect(redactedCount).toBeGreaterThanOrEqual(2);
  });

  test("Raw secret string is never present in returned content", async () => {
    const output = "The key is " + AWS_KEY + " and it should be hidden";
    const result = await emitToolResult("bash", output);
    const text = result.content?.[0]?.text ?? output;
    expect(text).not.toContain(AWS_KEY);
  });
});
