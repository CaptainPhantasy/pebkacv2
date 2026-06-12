import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { createFakePi, createTempCwd, cleanupTempCwd, writeConfig, readAuditLog } from "./helpers/fake-pi.js";
import pebkacDefenseExtension from "../.omp/extensions/pebkac-defense.js";

function writePreferences(cwd, prefs) {
  mkdirSync(join(cwd, ".harness", "state"), { recursive: true });
  writeFileSync(join(cwd, ".harness", "state", "onboarding-preferences.json"), JSON.stringify(prefs, null, 2));
  writeFileSync(join(cwd, ".harness", "state", "telemetry-consent.json"), JSON.stringify({ enabled: prefs.telemetry }, null, 2));
}

describe("Onboarding preference enforcement", () => {
  let cwd, pi, notifications, statuses;

  beforeEach(() => {
    cwd = createTempCwd();
    writeConfig(cwd);
    notifications = [];
    statuses = [];
    pi = createFakePi(cwd);
    pebkacDefenseExtension(pi);
  });

  afterEach(() => cleanupTempCwd(cwd));

  test("notifications:false suppresses non-critical command notifications", async () => {
    writePreferences(cwd, { theme: "standard", telemetry: true, notifications: false, healthChecks: true });
    await pi.emit("session_start", {}, {
      cwd,
      ui: { setStatus: (key, value) => statuses.push([key, value]), notify: (msg, level) => notifications.push([msg, level]) },
    });

    await pi.emitCommand("harness-status", "", {
      ui: { setStatus: (key, value) => statuses.push([key, value]), notify: (msg, level) => notifications.push([msg, level]) },
    });

    expect(notifications.length).toBe(0);
    expect(statuses.length).toBeGreaterThan(0);
  });

  test("telemetry:false prevents audit log writes", async () => {
    writePreferences(cwd, { theme: "standard", telemetry: false, notifications: true, healthChecks: true });
    await pi.emit("session_start", {}, { cwd });
    await pi.emit("turn_start", {}, { cwd });
    await pi.emit("turn_end", {}, { cwd });

    expect(readAuditLog(cwd)).toEqual([]);
  });

  test("healthChecks:false suppresses automation guidance from status", async () => {
    writePreferences(cwd, { theme: "standard", telemetry: true, notifications: true, healthChecks: false });
    await pi.emit("session_start", {}, { cwd });
    const seen = [];

    await pi.emitCommand("harness-status", "", {
      ui: { setStatus: () => {}, notify: (msg) => seen.push(String(msg)) },
    });

    expect(seen.join("\n")).not.toContain("Heartbeat");
    expect(seen.join("\n")).not.toContain("Automation");
  });

  test("theme preference is visible in status output", async () => {
    writePreferences(cwd, { theme: "minimal", telemetry: true, notifications: true, healthChecks: true });
    await pi.emit("session_start", {}, { cwd });
    const seen = [];

    await pi.emitCommand("harness-status", "", {
      ui: { setStatus: () => {}, notify: (msg) => seen.push(String(msg)) },
    });

    expect(seen.join("\n")).toContain("Theme | minimal");
  });

  test("preferences are readable from generated onboarding state", async () => {
    writePreferences(cwd, { theme: "minimal", telemetry: false, notifications: false, healthChecks: false });
    const prefs = JSON.parse(readFileSync(join(cwd, ".harness", "state", "onboarding-preferences.json"), "utf8"));
    expect(prefs).toMatchObject({ theme: "minimal", telemetry: false, notifications: false, healthChecks: false });
  });
});
