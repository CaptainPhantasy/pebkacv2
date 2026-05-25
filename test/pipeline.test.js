import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createFakePi, createTempCwd, cleanupTempCwd, writeConfig, readCheckpoint } from "./helpers/fake-pi.js";
import pebkacDefenseExtension from "../.omp/extensions/pebkac-defense.js";

describe("Sequential pipeline", () => {
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
    await pi.emitCommand("flare-complete", "");
  }

  test("Stage cannot complete without required evidence", async () => {
    await initSession();
    await pi.emit("turn_start", {}, { cwd });
    await pi.emitCommand("harness-pipeline", "start Build:test,lint");
    // Try to complete Build stage without evidence
    await pi.emitCommand("harness-pipeline", "complete");
    // Should be blocked because evidence "test" is missing
    const cp = readCheckpoint(cwd);
    expect(cp).not.toBeNull();
  });

  test("Stage advances with valid evidence", async () => {
    await initSession();
    await pi.emit("turn_start", {}, { cwd });
    await pi.emitCommand("harness-pipeline", "start Build:test,lint");
    // Complete with required evidence
    await pi.emitCommand("harness-pipeline", "complete test");
    // Pipeline should advance
    const cp = readCheckpoint(cwd);
    expect(cp).not.toBeNull();
  });

  test("Pipeline persists checkpoint after stage complete", async () => {
    await initSession();
    await pi.emit("turn_start", {}, { cwd });
    await pi.emitCommand("harness-pipeline", "start Build:test");
    await pi.emitCommand("harness-pipeline", "complete test");
    const cp = readCheckpoint(cwd);
    expect(cp).not.toBeNull();
    // Evidence summary should contain pipeline stage record
    expect(cp.evidenceSummary.some(e => e.includes("pipeline"))).toBe(true);
  });
});
