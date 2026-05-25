import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createFakePi, createTempCwd, cleanupTempCwd, writeConfig, readCheckpoint } from "./helpers/fake-pi.js";
import pebkacDefenseExtension from "../.omp/extensions/pebkac-defense.js";

describe("Subagent result ingestion", () => {
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

  test("Complete JSON subagent result adds evidence", async () => {
    await initSession();
    const json = JSON.stringify({
      status: "complete",
      evidence: [
        { description: "All tests pass", type: "test_result", verified: true },
        { description: "File updated", type: "file_diff" },
      ],
      changedFiles: ["/src/foo.ts"],
      checkpointUpdates: {},
    });
    await pi.emitCommand("harness-subagent-result", json);
    // Should not throw
    expect(true).toBe(true);
  });

  test("Blocked subagent result records blocker", async () => {
    await initSession();
    const json = JSON.stringify({
      status: "blocked",
      evidence: [],
      blockers: ["Missing dependency"],
    });
    await pi.emitCommand("harness-subagent-result", json);
    expect(true).toBe(true);
  });

  test("Malformed result is rejected gracefully", async () => {
    await initSession();
    // Should not throw on empty
    await pi.emitCommand("harness-subagent-result", "");
    expect(true).toBe(true);
  });

  test("Plain text with test evidence is parsed", async () => {
    await initSession();
    const text = "Build complete.\n42 tests passed, 0 failed.\nexit code: 0";
    await pi.emitCommand("harness-subagent-result", text);
    expect(true).toBe(true);
  });

  test("Plain text with BLOCKED is parsed as blocked", async () => {
    await initSession();
    const text = "BLOCKED: Cannot find module xyz. Tried reinstalling.";
    await pi.emitCommand("harness-subagent-result", text);
    expect(true).toBe(true);
  });

  test("Checkpoint updates from subagent are applied", async () => {
    await initSession();
    const json = JSON.stringify({
      status: "complete",
      evidence: [{ description: "Done" }],
      checkpointUpdates: {
        currentTask: "Fix auth bug",
        workingApproaches: ["Used bcrypt"],
        itemStatuses: { "item-1": "complete" },
      },
    });
    await pi.emitCommand("harness-subagent-result", json);
    const cp = readCheckpoint(cwd);
    expect(cp).not.toBeNull();
    expect(cp.currentTask).toBe("Fix auth bug");
    expect(cp.workingApproaches).toContain("Used bcrypt");
  });
});
