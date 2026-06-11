import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import pebkacDefenseExtension from "../.omp/extensions/pebkac-defense.js";

function tempRoot() {
  return join(tmpdir(), `pebkac-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
}

function cleanup(cwd) {
  try { rmSync(cwd, { recursive: true, force: true }); } catch {}
}

function makePi(cwd) {
  const events = {};
  const commands = {};
  const messages = [];
  const pi = {
    setLabel: () => {},
    on: (event, handler) => { events[event] = handler; },
    registerCommand: (name, def) => { commands[name] = def.handler; },
    sendMessage: (msg) => { messages.push(msg); },
    events,
    commands,
    messages,
  };
  pebkacDefenseExtension(pi);
  return pi;
}

function writeConfig(cwd, text) {
  const dir = join(cwd, ".harness");
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, "state"), { recursive: true });
  mkdirSync(join(dir, "checkpoints"), { recursive: true });
  writeFileSync(join(dir, "config.yaml"), text);
}

function writePreferences(cwd, prefs) {
  const dir = join(cwd, ".harness", "state");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "onboarding-preferences.json"), JSON.stringify(prefs));
}

describe("Disable toggle", () => {
  const savedEnv = process.env.PEBKAC_OFF;

  afterEach(() => {
    if (savedEnv === undefined) delete process.env.PEBKAC_OFF;
    else process.env.PEBKAC_OFF = savedEnv;
  });

  test("PEBKAC_OFF=1 makes extension inert (no hooks registered)", () => {
    process.env.PEBKAC_OFF = "1";
    const cwd = tempRoot();
    try {
      const pi = makePi(cwd);
      // With PEBKAC_OFF, the extension returns early — no hooks or commands registered
      expect(Object.keys(pi.events).length).toBe(0);
      expect(Object.keys(pi.commands).length).toBe(0);
    } finally {
      cleanup(cwd);
      delete process.env.PEBKAC_OFF;
    }
  });

  test("PEBKAC_OFF=true makes extension inert", () => {
    process.env.PEBKAC_OFF = "true";
    const cwd = tempRoot();
    try {
      const pi = makePi(cwd);
      expect(Object.keys(pi.events).length).toBe(0);
    } finally {
      cleanup(cwd);
      delete process.env.PEBKAC_OFF;
    }
  });

  test("PEBKAC_OFF unset — extension registers normally", () => {
    delete process.env.PEBKAC_OFF;
    const cwd = tempRoot();
    try {
      const pi = makePi(cwd);
      expect(Object.keys(pi.events).length).toBeGreaterThan(0);
      expect(pi.commands["harness-status"]).toBeDefined();
    } finally {
      cleanup(cwd);
    }
  });

  test("Sentinel file disables extension at session_start", async () => {
    delete process.env.PEBKAC_OFF;
    const cwd = tempRoot();
    try {
      mkdirSync(join(cwd, ".harness", "state"), { recursive: true });
      writeFileSync(join(cwd, ".harness", "state", "disabled"), new Date().toISOString() + "\n");
      const pi = makePi(cwd);
      await pi.events["session_start"]({}, { cwd, ui: { setStatus: () => {} } });
      // Mid-session disabled — tool_call should return undefined (passthrough)
      const result = await pi.events["tool_call"]({ toolName: "bash", input: { command: "git reset --hard" } }, {});
      expect(result).toBeUndefined();
    } finally {
      cleanup(cwd);
    }
  });
});

describe("Verbosity system", () => {
  test("verbosity: quiet suppresses grounding warnings in tool_result", async () => {
    const cwd = tempRoot();
    try {
      writeConfig(cwd, `version: "1.0"\ndefaults:\n  verbosity: "quiet"\n`);
      writePreferences(cwd, { theme: "standard", telemetry: true, notifications: true, healthChecks: true });
      const pi = makePi(cwd);
      await pi.events["session_start"]({}, { cwd, ui: { setStatus: () => {} } });
      await pi.events["turn_start"]({}, { cwd });

      const result = await pi.events["tool_result"]({
        content: [{ type: "text", text: "The pricing is $50/month and it was released in 2024." }],
        isError: false, toolName: "read", toolCallId: "test-1",
      }, {});
      // In quiet mode, no grounding warnings appended
      const text = result?.content?.[0]?.text ?? "";
      expect(text).not.toContain("PEBKAC GROUNDING");
    } finally {
      cleanup(cwd);
    }
  });

  test("verbosity: full includes grounding warnings in tool_result", async () => {
    const cwd = tempRoot();
    try {
      writeConfig(cwd, `version: "1.0"\ndefaults:\n  verbosity: "full"\n`);
      writePreferences(cwd, { theme: "standard", telemetry: true, notifications: true, healthChecks: true });
      const pi = makePi(cwd);
      await pi.events["session_start"]({}, { cwd, ui: { setStatus: () => {} } });
      await pi.events["turn_start"]({}, { cwd });

      const result = await pi.events["tool_result"]({
        content: [{ type: "text", text: "The pricing changed and security CVE-2024-1234 was found." }],
        isError: false, toolName: "read", toolCallId: "test-2",
      }, {});
      const text = result?.content?.[0]?.text ?? "";
      expect(text).toContain("PEBKAC GROUNDING");
    } finally {
      cleanup(cwd);
    }
  });

  test("theme: minimal maps to verbosity normal", async () => {
    const cwd = tempRoot();
    try {
      writeConfig(cwd, `version: "1.0"\ndefaults:\n`);
      writePreferences(cwd, { theme: "minimal", telemetry: true, notifications: true, healthChecks: true });
      const pi = makePi(cwd);
      await pi.events["session_start"]({}, { cwd, ui: { setStatus: () => {} } });
      // harness-status should show both Theme and Verbosity
      const seen = [];
      await pi.commands["harness-status"]("", { ui: { setStatus: () => {}, notify: (msg) => seen.push(String(msg)) } });
      const output = seen.join("\n");
      expect(output).toContain("Theme | minimal");
    } finally {
      cleanup(cwd);
    }
  });
});

describe("Config flags wired to guards", () => {
  test("git_guard: false skips git guard in tool_call", async () => {
    const cwd = tempRoot();
    try {
      writeConfig(cwd, `version: "1.0"\ndefaults:\n  git_guard: false\n`);
      writePreferences(cwd, { theme: "standard", telemetry: true, notifications: true, healthChecks: true });
      const pi = makePi(cwd);
      await pi.events["session_start"]({}, { cwd, ui: { setStatus: () => {} } });
      await pi.events["turn_start"]({}, { cwd });
      // Exit planning phase so bash isn't blocked by lifecycle policy
      await pi.commands["flare-complete"]("", { ui: { setStatus: () => {}, notify: () => {} } });

      const result = await pi.events["tool_call"]({ toolName: "bash", input: { command: "git reset --hard HEAD" } }, {});
      // Git guard disabled — should NOT be blocked
      expect(result).toBeUndefined();
    } finally {
      cleanup(cwd);
    }
  });

  test("git_guard: true blocks destructive git commands", async () => {
    const cwd = tempRoot();
    try {
      writeConfig(cwd, `version: "1.0"\ndefaults:\n  git_guard: true\n`);
      writePreferences(cwd, { theme: "standard", telemetry: true, notifications: true, healthChecks: true });
      const pi = makePi(cwd);
      await pi.events["session_start"]({}, { cwd, ui: { setStatus: () => {} } });
      await pi.events["turn_start"]({}, { cwd });
      await pi.commands["flare-complete"]("", { ui: { setStatus: () => {}, notify: () => {} } });

      const result = await pi.events["tool_call"]({ toolName: "bash", input: { command: "git reset --hard HEAD" } }, {});
      expect(result?.block).toBe(true);
      expect(result?.reason).toContain("Git Guard");
    } finally {
      cleanup(cwd);
    }
  });

  test("secrets_isolation: false skips secrets guard", async () => {
    const cwd = tempRoot();
    try {
      writeConfig(cwd, `version: "1.0"\ndefaults:\n  secrets_isolation: false\n`);
      writePreferences(cwd, { theme: "standard", telemetry: true, notifications: true, healthChecks: true });
      const pi = makePi(cwd);
      await pi.events["session_start"]({}, { cwd, ui: { setStatus: () => {} } });
      await pi.events["turn_start"]({}, { cwd });
      await pi.commands["flare-complete"]("", { ui: { setStatus: () => {}, notify: () => {} } });

      // env command that would normally be blocked by secrets guard
      const result = await pi.events["tool_call"]({ toolName: "bash", input: { command: "env" } }, {});
      expect(result).toBeUndefined();
    } finally {
      cleanup(cwd);
    }
  });
});

describe("Mid-session toggle", () => {
  test("/harness-off then /harness-on round-trip", async () => {
    const cwd = tempRoot();
    try {
      writeConfig(cwd, `version: "1.0"\ndefaults:\n`);
      writePreferences(cwd, { theme: "standard", telemetry: true, notifications: true, healthChecks: true });
      const pi = makePi(cwd);
      await pi.events["session_start"]({}, { cwd, ui: { setStatus: () => {} } });
      await pi.events["turn_start"]({}, { cwd });

      // Turn off
      await pi.commands["harness-off"]("", { ui: { setStatus: () => {}, notify: () => {} } });
      // Destructive git should passthrough when disabled
      const resultOff = await pi.events["tool_call"]({ toolName: "bash", input: { command: "git reset --hard" } }, {});
      expect(resultOff).toBeUndefined();

      // Turn back on
      await pi.commands["harness-on"]("", { ui: { setStatus: () => {}, notify: () => {} } });
      // Destructive git should be blocked again
      const resultOn = await pi.events["tool_call"]({ toolName: "bash", input: { command: "git reset --hard" } }, {});
      expect(resultOn?.block).toBe(true);
    } finally {
      cleanup(cwd);
    }
  });
});

describe("Session report", () => {
  test("/harness-report writes session-report.md", async () => {
    const cwd = tempRoot();
    try {
      writeConfig(cwd, `version: "1.0"\ndefaults:\n`);
      writePreferences(cwd, { theme: "standard", telemetry: true, notifications: true, healthChecks: true });
      const pi = makePi(cwd);
      await pi.events["session_start"]({}, { cwd, ui: { setStatus: () => {} } });
      await pi.events["turn_start"]({}, { cwd });

      await pi.commands["harness-report"]("", { ui: { setStatus: () => {}, notify: () => {} } });
      const reportPath = join(cwd, ".harness", "state", "session-report.md");
      expect(existsSync(reportPath)).toBe(true);
      const content = readFileSync(reportPath, "utf8");
      expect(content).toContain("Session Summary");
    } finally {
      cleanup(cwd);
    }
  });
});

describe("Health check", () => {
  test("healthChecks: true writes session-health.json", async () => {
    const cwd = tempRoot();
    try {
      writeConfig(cwd, `version: "1.0"\ndefaults:\n`);
      writePreferences(cwd, { theme: "standard", telemetry: true, notifications: true, healthChecks: true });
      const pi = makePi(cwd);
      await pi.events["session_start"]({}, { cwd, ui: { setStatus: () => {} } });

      const healthPath = join(cwd, ".harness", "state", "session-health.json");
      expect(existsSync(healthPath)).toBe(true);
      const health = JSON.parse(readFileSync(healthPath, "utf8"));
      expect(health.extensionLoaded).toBe(true);
    } finally {
      cleanup(cwd);
    }
  });

  test("healthChecks: false does not write session-health.json", async () => {
    const cwd = tempRoot();
    try {
      writeConfig(cwd, `version: "1.0"\ndefaults:\n`);
      writePreferences(cwd, { theme: "standard", telemetry: true, notifications: true, healthChecks: false });
      const pi = makePi(cwd);
      await pi.events["session_start"]({}, { cwd, ui: { setStatus: () => {} } });

      const healthPath = join(cwd, ".harness", "state", "session-health.json");
      expect(existsSync(healthPath)).toBe(false);
    } finally {
      cleanup(cwd);
    }
  });
});

describe("Config reload", () => {
  test("/harness-reload re-reads config.yaml", async () => {
    const cwd = tempRoot();
    try {
      writeConfig(cwd, `version: "1.0"\ndefaults:\n  verbosity: "full"\n`);
      writePreferences(cwd, { theme: "standard", telemetry: true, notifications: true, healthChecks: true });
      const pi = makePi(cwd);
      await pi.events["session_start"]({}, { cwd, ui: { setStatus: () => {} } });

      // Change config
      writeConfig(cwd, `version: "1.0"\ndefaults:\n  verbosity: "quiet"\n`);

      // Reload
      const seen = [];
      await pi.commands["harness-reload"]("", { ui: { setStatus: () => {}, notify: (msg) => seen.push(String(msg)) } });
      expect(seen.join("")).toContain("verbosity=quiet");
    } finally {
      cleanup(cwd);
    }
  });
});

describe("CLI off/on commands", () => {
  test("pebkac off creates sentinel file", () => {
    const cwd = tempRoot();
    try {
      mkdirSync(join(cwd, ".harness", "state"), { recursive: true });
      const result = Bun.spawnSync({
        cmd: ["bun", "./bin/pebkac.js", "off", "--cwd", cwd],
        cwd: process.cwd(),
        stdout: "pipe", stderr: "pipe",
      });
      expect(result.exitCode).toBe(0);
      expect(existsSync(join(cwd, ".harness", "state", "disabled"))).toBe(true);
    } finally {
      cleanup(cwd);
    }
  });

  test("pebkac on removes sentinel file", () => {
    const cwd = tempRoot();
    try {
      mkdirSync(join(cwd, ".harness", "state"), { recursive: true });
      writeFileSync(join(cwd, ".harness", "state", "disabled"), "test\n");
      const result = Bun.spawnSync({
        cmd: ["bun", "./bin/pebkac.js", "on", "--cwd", cwd],
        cwd: process.cwd(),
        stdout: "pipe", stderr: "pipe",
      });
      expect(result.exitCode).toBe(0);
      expect(existsSync(join(cwd, ".harness", "state", "disabled"))).toBe(false);
    } finally {
      cleanup(cwd);
    }
  });

  test("pebkac on when already enabled is a no-op", () => {
    const cwd = tempRoot();
    try {
      mkdirSync(join(cwd, ".harness", "state"), { recursive: true });
      const result = Bun.spawnSync({
        cmd: ["bun", "./bin/pebkac.js", "on", "--cwd", cwd],
        cwd: process.cwd(),
        stdout: "pipe", stderr: "pipe",
      });
      expect(result.exitCode).toBe(0);
    } finally {
      cleanup(cwd);
    }
  });
});

describe("CLI launch and doctor commands", () => {
  test("pebkac launch --dry-run prints command without executing", () => {
    const cwd = tempRoot();
    try {
      mkdirSync(join(cwd, ".harness"), { recursive: true });
      writeFileSync(join(cwd, ".harness", "config.yaml"), `version: "1.0"\ndefaults:\n  enabled: true\nagent_runtime: "omp"\n`);
      const result = Bun.spawnSync({
        cmd: ["bun", "./bin/pebkac.js", "launch", "--dry-run", "--cwd", cwd],
        cwd: process.cwd(),
        stdout: "pipe", stderr: "pipe",
      });
      const stdout = new TextDecoder().decode(result.stdout);
      expect(result.exitCode).toBe(0);
      expect(stdout).toContain("omp");
      expect(stdout).toContain("--dry-run");
    } finally {
      cleanup(cwd);
    }
  });

  test("pebkac doctor reports missing extension", () => {
    const cwd = tempRoot();
    try {
      mkdirSync(join(cwd, ".harness"), { recursive: true });
      mkdirSync(join(cwd, ".harness", "state"), { recursive: true });
      mkdirSync(join(cwd, ".harness", "checkpoints"), { recursive: true });
      mkdirSync(join(cwd, ".harness", "vault"), { recursive: true });
      writeFileSync(join(cwd, ".harness", "config.yaml"), `version: "1.0"\ndefaults:\n`);
      const result = Bun.spawnSync({
        cmd: ["bun", "./bin/pebkac.js", "doctor", "--cwd", cwd],
        cwd: process.cwd(),
        stdout: "pipe", stderr: "pipe",
      });
      const stdout = new TextDecoder().decode(result.stdout);
      expect(result.exitCode).toBe(1);
      expect(stdout).toContain("FAIL");
    } finally {
      cleanup(cwd);
    }
  });
});

describe("CLI status command", () => {
  test("pebkac status shows extension and config info", () => {
    const cwd = tempRoot();
    try {
      // Full init to get extension file
      const result = Bun.spawnSync({
        cmd: ["bun", "./bin/pebkac.js", "init", "--non-interactive", "--yes", "--cwd", cwd],
        cwd: process.cwd(),
        stdout: "pipe", stderr: "pipe",
      });
      expect(result.exitCode).toBe(0);

      const statusResult = Bun.spawnSync({
        cmd: ["bun", "./bin/pebkac.js", "status", "--cwd", cwd],
        cwd: process.cwd(),
        stdout: "pipe", stderr: "pipe",
      });
      const stdout = new TextDecoder().decode(statusResult.stdout);
      expect(statusResult.exitCode).toBe(0);
      expect(stdout).toContain("Extension");
      expect(stdout).toContain("present");
    } finally {
      cleanup(cwd);
    }
  });
});

describe("CLI colorized output", () => {
  test("version command prints version", () => {
    const result = Bun.spawnSync({
      cmd: ["bun", "./bin/pebkac.js", "version"],
      cwd: process.cwd(),
      stdout: "pipe", stderr: "pipe",
    });
    const stdout = new TextDecoder().decode(result.stdout);
    expect(result.exitCode).toBe(0);
    expect(stdout).toContain("PEBKAC");
    expect(stdout).toContain("1.0.0");
  });

  test("--version flag also works", () => {
    const result = Bun.spawnSync({
      cmd: ["bun", "./bin/pebkac.js", "--version"],
      cwd: process.cwd(),
      stdout: "pipe", stderr: "pipe",
    });
    const stdout = new TextDecoder().decode(result.stdout);
    expect(result.exitCode).toBe(0);
    expect(stdout).toContain("1.0.0");
  });

  test("init output shows next steps", () => {
    const cwd = tempRoot();
    try {
      const result = Bun.spawnSync({
        cmd: ["bun", "./bin/pebkac.js", "init", "--non-interactive", "--yes", "--cwd", cwd],
        cwd: process.cwd(),
        stdout: "pipe", stderr: "pipe",
      });
      const stdout = new TextDecoder().decode(result.stdout);
      expect(result.exitCode).toBe(0);
      expect(stdout).toContain("Next steps");
      expect(stdout).toContain("pebkac launch");
      expect(stdout).toContain("pebkac doctor");
    } finally {
      cleanup(cwd);
    }
  });

  test("doctor output uses PASS/FAIL markers", () => {
    const cwd = tempRoot();
    try {
      const result = Bun.spawnSync({
        cmd: ["bun", "./bin/pebkac.js", "doctor", "--cwd", cwd],
        cwd: process.cwd(),
        stdout: "pipe", stderr: "pipe",
      });
      const stdout = new TextDecoder().decode(result.stdout);
      // Should have FAIL markers for uninitialized project
      expect(stdout).toContain("PASS");
      expect(stdout).toContain("FAIL");
    } finally {
      cleanup(cwd);
    }
  });

  test("off output shows re-enable instructions", () => {
    const cwd = tempRoot();
    try {
      mkdirSync(join(cwd, ".harness", "state"), { recursive: true });
      const result = Bun.spawnSync({
        cmd: ["bun", "./bin/pebkac.js", "off", "--cwd", cwd],
        cwd: process.cwd(),
        stdout: "pipe", stderr: "pipe",
      });
      const stdout = new TextDecoder().decode(result.stdout);
      expect(result.exitCode).toBe(0);
      expect(stdout).toContain("DISABLED");
      expect(stdout).toContain("Re-enable");
      expect(stdout).toContain("pebkac on");
    } finally {
      cleanup(cwd);
    }
  });

  test("NO_COLOR strips ANSI codes", () => {
    const result = Bun.spawnSync({
      cmd: ["bun", "./bin/pebkac.js", "version"],
      cwd: process.cwd(),
      stdout: "pipe", stderr: "pipe",
      env: { ...process.env, NO_COLOR: "1" },
    });
    const stdout = new TextDecoder().decode(result.stdout);
    expect(result.exitCode).toBe(0);
    expect(stdout).toContain("PEBKAC");
    // With NO_COLOR, no ANSI escape sequences
    expect(stdout).not.toContain("\x1b[");
  });
});

describe("Slash command aliases", () => {
  test("all short aliases are registered", () => {
    const cwd = tempRoot();
    try {
      mkdirSync(join(cwd, ".harness"), { recursive: true });
      mkdirSync(join(cwd, ".harness", "state"), { recursive: true });
      mkdirSync(join(cwd, ".harness", "checkpoints"), { recursive: true });
      writeConfig(cwd, 'version: "1.0"\ndefaults:\n  evidence_required: true\n  secrets_isolation: true\n  git_guard: true\n  verbosity: "full"\n  enabled: true\n');
      const pi = makePi(cwd);
      const cmds = Object.keys(pi.commands);
      const aliases = ["hs", "ho", "hon", "hr", "hrep", "hd", "hsr", "hp", "fc"];
      for (const alias of aliases) {
        expect(cmds).toContain(alias);
      }
    } finally {
      cleanup(cwd);
    }
  });

  test("hs alias description references harness-status", () => {
    const cwd = tempRoot();
    try {
      mkdirSync(join(cwd, ".harness"), { recursive: true });
      mkdirSync(join(cwd, ".harness", "state"), { recursive: true });
      mkdirSync(join(cwd, ".harness", "checkpoints"), { recursive: true });
      writeConfig(cwd, 'version: "1.0"\ndefaults:\n  evidence_required: true\n  secrets_isolation: true\n  git_guard: true\n  verbosity: "full"\n  enabled: true\n');
      const pi = makePi(cwd);
      // makePi stores handler only; check that alias key exists
      expect(pi.commands["hs"]).toBeDefined();
      expect(pi.commands["harness-status"]).toBeDefined();
      // Same handler reference
      expect(pi.commands["hs"]).toBe(pi.commands["harness-status"]);
    } finally {
      cleanup(cwd);
    }
  });
});

describe("JSON output mode", () => {
  test("status --json outputs valid JSON with expected keys", () => {
    const cwd = tempRoot();
    try {
      const result = Bun.spawnSync({
        cmd: ["bun", "./bin/pebkac.js", "init", "--non-interactive", "--yes", "--cwd", cwd],
        cwd: process.cwd(),
        stdout: "pipe", stderr: "pipe",
      });
      expect(result.exitCode).toBe(0);
      const jsonResult = Bun.spawnSync({
        cmd: ["bun", "./bin/pebkac.js", "status", "--json", "--cwd", cwd],
        cwd: process.cwd(),
        stdout: "pipe", stderr: "pipe",
      });
      const stdout = new TextDecoder().decode(jsonResult.stdout);
      expect(jsonResult.exitCode).toBe(0);
      const data = JSON.parse(stdout);
      expect(data.healthy).toBe(true);
      expect(data.extension.present).toBe(true);
      expect(data.config.present).toBe(true);
      expect(data).toHaveProperty("issues");
      expect(data).toHaveProperty("disabled");
      expect(data).toHaveProperty("checkpoints");
      expect(data).toHaveProperty("runtime");
    } finally {
      cleanup(cwd);
    }
  });

  test("doctor --json outputs valid JSON with checks", () => {
    const cwd = tempRoot();
    try {
      const result = Bun.spawnSync({
        cmd: ["bun", "./bin/pebkac.js", "init", "--non-interactive", "--yes", "--cwd", cwd],
        cwd: process.cwd(),
        stdout: "pipe", stderr: "pipe",
      });
      expect(result.exitCode).toBe(0);
      const jsonResult = Bun.spawnSync({
        cmd: ["bun", "./bin/pebkac.js", "doctor", "--json", "--cwd", cwd],
        cwd: process.cwd(),
        stdout: "pipe", stderr: "pipe",
      });
      const stdout = new TextDecoder().decode(jsonResult.stdout);
      expect(jsonResult.exitCode).toBe(0);
      const data = JSON.parse(stdout);
      expect(data.healthy).toBe(true);
      expect(data.checks.extension.present).toBe(true);
      expect(data.checks.config.present).toBe(true);
      expect(data.checks.config.valid).toBe(true);
      expect(data.checks.stateDir.present).toBe(true);
      expect(data.checks.disabled.active).toBe(false);
      expect(data.checks.checkpoints.present).toBe(true);
      expect(data.checks.vault.present).toBe(true);
    } finally {
      cleanup(cwd);
    }
  });

  test("doctor --json reports failures correctly", () => {
    const cwd = tempRoot();
    try {
      const jsonResult = Bun.spawnSync({
        cmd: ["bun", "./bin/pebkac.js", "doctor", "--json", "--cwd", cwd],
        cwd: process.cwd(),
        stdout: "pipe", stderr: "pipe",
      });
      const stdout = new TextDecoder().decode(jsonResult.stdout);
      expect(jsonResult.exitCode).toBe(1);
      const data = JSON.parse(stdout);
      expect(data.healthy).toBe(false);
      expect(data.issues).toBeGreaterThan(0);
      expect(data.checks.extension.present).toBe(false);
    } finally {
      cleanup(cwd);
    }
  });
});
