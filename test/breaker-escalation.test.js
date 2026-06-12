import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createFakePi, createTempCwd, cleanupTempCwd, writeConfig } from "./helpers/fake-pi.js";
import pebkacDefenseExtension from "../.omp/extensions/pebkac-defense.js";

describe("Breaker recovery and escalation", () => {
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

  async function initSession() {
    await pi.emit("session_start", {}, { cwd });
  }

  test("Git guard blocks count toward escalation", async () => {
    await initSession();
    // Exit planning mode so bash is allowed
    await pi.emitCommand("flare-complete");
    await pi.emit("turn_start", {}, { cwd });
    // 5 git guard blocks
    for (let i = 0; i < 5; i++) {
      await pi.emit("tool_call", {
        toolName: "bash",
        input: { command: "git reset --hard HEAD" },
      }, { cwd });
    }
    // 6th call should be escalated
    const result = await pi.emit("tool_call", {
      toolName: "bash",
      input: { command: "git status" },
    }, { cwd });
    expect(result.block || result.reason).toBeDefined();
  });

  test("Secrets exposure blocks count toward escalation", async () => {
    await initSession();
    await pi.emitCommand("flare-complete");
    await pi.emit("turn_start", {}, { cwd });
    for (let i = 0; i < 5; i++) {
      await pi.emit("tool_call", {
        toolName: "bash",
        input: { command: "printenv" },
      }, { cwd });
    }
    const result = await pi.emit("tool_call", {
      toolName: "bash",
      input: { command: "echo hello" },
    }, { cwd });
    expect(result.block || result.reason).toBeDefined();
  });

  test("Breaker recovers via harness-status then evidence", async () => {
    await initSession();
    await pi.emitCommand("flare-complete");
    await pi.emit("turn_start", {}, { cwd });
    for (let i = 0; i < 5; i++) {
      await pi.emit("tool_call", {
        toolName: "bash",
        input: { command: "git reset --hard" },
      }, { cwd });
    }
    // harness-status transitions breaker from open to half-open (or no-op if not open)
    await pi.emitCommand("harness-status", "");
    // Produce evidence to close the breaker
    await pi.emit("tool_result", {
      toolName: "bash",
      toolCallId: "call-recovery-001",
      content: [{ type: "text", text: "2 tests passed, 0 failed\nexit code: 0" }],
      isError: false,
    }, { cwd });
    // After evidence, the breaker is closed and escalation is reset — simple bash should work
    const result = await pi.emit("tool_call", {
      toolName: "bash",
      input: { command: "echo ok" },
    }, { cwd });
    if (result.block) {
      console.log("Still blocked. Reason:", result.reason);
    }
    expect(result.block).toBeFalsy();
  });
});
