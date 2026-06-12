import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createFakePi, createTempCwd, cleanupTempCwd, writeConfig, writeToolVersions } from "./helpers/fake-pi.js";
import pebkacDefenseExtension from "../.omp/extensions/pebkac-defense.js";

describe("Extension registration", () => {
  let cwd, pi;

  beforeEach(() => {
    cwd = createTempCwd();
    writeConfig(cwd);
    pi = createFakePi(cwd);
  });

  afterEach(() => {
    cleanupTempCwd(cwd);
  });

  test("registers expected label", () => {
    pebkacDefenseExtension(pi);
    expect(pi.getLabel()).toContain("PEBKAC");
  });

  test("registers all expected event hooks", () => {
    pebkacDefenseExtension(pi);
    const hooks = pi.getHooks();
    const expectedHooks = [
      "session_start",
      "before_agent_start",
      "session_before_compact",
      "session_compact",
      "turn_start",
      "turn_end",
      "tool_call",
      "tool_result",
      "context",
    ];
    for (const h of expectedHooks) {
      expect(hooks[h], `Missing hook: ${h}`).toBeDefined();
      expect(hooks[h].length, `Hook ${h} should have at least one handler`).toBeGreaterThanOrEqual(1);
    }
  });

  test("registers all expected slash commands", () => {
    pebkacDefenseExtension(pi);
    const cmds = pi.getCommands();
    const expectedCmds = [
      "harness-status",
      "flare-complete",
      "harness-delegate",
      "harness-subagent-result",
      "harness-pipeline",
    ];
    for (const c of expectedCmds) {
      expect(cmds[c], `Missing command: ${c}`).toBeDefined();
      expect(cmds[c].handler, `Command ${c} should have a handler`).toBeFunction();
    }
  });

  test("session_start initializes without error", async () => {
    pebkacDefenseExtension(pi);
    await pi.emit("session_start", {}, { cwd });
    // Should not throw — basic smoke
    expect(true).toBe(true);
  });
});
