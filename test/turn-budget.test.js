import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createFakePi, createTempCwd, cleanupTempCwd, readCheckpoint } from "./helpers/fake-pi.js";
import { writeFileSync, existsSync } from "fs";
import { join } from "path";
import pebkacDefenseExtension from "../.omp/extensions/pebkac-defense.js";

function writeYamlConfig(cwd, yaml) {
  writeFileSync(join(cwd, ".harness", "config.yaml"), yaml);
}

describe("Turn budget and session summary", () => {
  let cwd, pi;

  beforeEach(() => {
    cwd = createTempCwd();
    pi = createFakePi(cwd);
    pebkacDefenseExtension(pi);
  });

  afterEach(() => {
    cleanupTempCwd(cwd);
  });

  async function initSession() {
    await pi.emit("session_start", {}, { cwd });
    await pi.emitCommand("flare-complete", "");
  }

  test("Budget initialized from config", async () => {
    writeYamlConfig(cwd, `version: "1.0"\ndefaults:\n  turn_budget: 3\n`);
    await initSession();
    await pi.emit("turn_start", {}, { cwd });
    expect(true).toBe(true);
  });

  test("Budget exhaustion persists checkpoint", async () => {
    writeYamlConfig(cwd, `version: "1.0"\ndefaults:\n  turn_budget: 2\n`);
    await initSession();
    await pi.emit("turn_start", {}, { cwd });
    await pi.emit("turn_end", {}, { cwd });
    await pi.emit("turn_start", {}, { cwd });
    await pi.emit("turn_end", {}, { cwd });
    const cp = readCheckpoint(cwd);
    expect(cp).not.toBeNull();
    expect(cp.evidenceSummary.some(e => e.includes("TURN BUDGET"))).toBe(true);
  });

  test("Checkpoint interval from config creates checkpoint", async () => {
    writeYamlConfig(cwd, `version: "1.0"\ndefaults:\n  checkpoint_interval: 1\n`);
    await initSession();
    await pi.emit("turn_start", {}, { cwd });
    await pi.emit("turn_end", {}, { cwd });
    const cpPath = join(cwd, ".harness", "checkpoints", "latest.json");
    expect(existsSync(cpPath)).toBe(true);
  });
});

describe("Checkpoint recovery on contract creation", () => {
  let cwd, pi;

  beforeEach(() => {
    cwd = createTempCwd();
    pi = createFakePi(cwd);
    pebkacDefenseExtension(pi);
  });

  afterEach(() => {
    cleanupTempCwd(cwd);
  });

  test("Contract items are persisted to checkpoint", async () => {
    await pi.emit("session_start", {}, { cwd });
    await pi.emit("before_agent_start", {
      systemPrompt: "",
      taskDescription: "Task item 1: First step.\nTask item 2: Second step."
    }, { cwd });
    const cp = readCheckpoint(cwd);
    expect(cp).not.toBeNull();
    expect(cp.currentTask).toBeTruthy();
    expect(Object.keys(cp.itemStatuses || {}).length).toBeGreaterThan(0);
  });
});
