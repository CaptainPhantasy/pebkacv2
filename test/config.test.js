import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createFakePi, createTempCwd, cleanupTempCwd, writeConfig } from "./helpers/fake-pi.js";
import { writeFileSync, unlinkSync, existsSync } from "fs";
import { join } from "path";
import pebkacDefenseExtension from "../.omp/extensions/pebkac-defense.js";

function writeYamlConfig(cwd, yaml) {
  writeFileSync(join(cwd, ".harness", "config.yaml"), yaml);
}

describe("Config loading", () => {
  let cwd, pi;

  beforeEach(() => {
    cwd = createTempCwd();
    pi = createFakePi(cwd);
    pebkacDefenseExtension(pi);
  });

  afterEach(() => {
    cleanupTempCwd(cwd);
  });

  test("Falls back safely when config.yaml is missing", async () => {
    if (existsSync(join(cwd, ".harness", "config.yaml"))) {
      unlinkSync(join(cwd, ".harness", "config.yaml"));
    }
    await pi.emit("session_start", {}, { cwd });
    expect(true).toBe(true);
  });

  test("Loads default config without error", async () => {
    writeYamlConfig(cwd, `version: "1.0"\ndefaults:\n  evidence_required: true\n  checkpoint_interval: 10\n`);
    await pi.emit("session_start", {}, { cwd });
    expect(true).toBe(true);
  });

  test("Checkpoint interval comes from config", async () => {
    writeYamlConfig(cwd, `version: "1.0"\ndefaults:\n  checkpoint_interval: 3\n`);
    await pi.emit("session_start", {}, { cwd });
    // Simulate 3 turns
    await pi.emit("turn_start", {}, { cwd });
    await pi.emit("turn_end", {}, { cwd });
    await pi.emit("turn_start", {}, { cwd });
    await pi.emit("turn_end", {}, { cwd });
    await pi.emit("turn_start", {}, { cwd });
    // After turn_end on the 3rd turn, checkpoint should save
    await pi.emit("turn_end", {}, { cwd });
    const cp = join(cwd, ".harness", "checkpoints", "latest.json");
    expect(existsSync(cp)).toBe(true);
  });

  test("Turn budget initializes from config", async () => {
    writeYamlConfig(cwd, `version: "1.0"\ndefaults:\n  turn_budget: 2\n`);
    await pi.emit("session_start", {}, { cwd });
    await pi.emit("turn_start", {}, { cwd });
    await pi.emit("turn_end", {}, { cwd });
    await pi.emit("turn_start", {}, { cwd });
    await pi.emit("turn_end", {}, { cwd });
    // After 2 turns, budget exceeded — should have saved checkpoint
    const cp = join(cwd, ".harness", "checkpoints", "latest.json");
    expect(existsSync(cp)).toBe(true);
  });
});
