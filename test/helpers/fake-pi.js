/**
 * Fake `pi` extension runtime for testing PEBKAC defense extension.
 * Simulates the OMP extension protocol without requiring a real harness.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { resetAllState } from "../../.omp/extensions/pebkac-defense.js";

export function createTempCwd() {
  const dir = mkdtempSync(join(tmpdir(), "pebkac-test-"));
  mkdirSync(join(dir, ".harness"), { recursive: true });
  mkdirSync(join(dir, ".harness", "checkpoints"), { recursive: true });
  mkdirSync(join(dir, ".harness", "state"), { recursive: true });
  mkdirSync(join(dir, ".harness", "vault"), { recursive: true });
  return dir;
}

export function cleanupTempCwd(dir) {
  if (dir && dir.startsWith(tmpdir())) {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function createFakePi(cwd) {
  resetAllState(); // isolate each test from prior module state
  const hooks = {};
  const commands = {};
  let label = "";
  const sentMessages = [];

  const pi = {
    setLabel(l) { label = l; },
    getLabel() { return label; },

    on(eventName, handler) {
      if (!hooks[eventName]) hooks[eventName] = [];
      hooks[eventName].push(handler);
    },

    registerCommand(name, def) {
      commands[name] = def;
    },

    getCommands() { return commands; },
    getHooks() { return hooks; },

    sendMessage(msg) {
      sentMessages.push(msg);
    },
    getSentMessages() { return sentMessages; },
    clearSentMessages() { sentMessages.length = 0; },

    async emit(eventName, eventPayload, ctxOverrides = {}) {
      const handlers = hooks[eventName] || [];
      let result = {};
      const ctx = { cwd, ui: { setStatus: () => {}, notify: () => {} }, ...ctxOverrides };
      for (const handler of handlers) {
        const r = await handler(eventPayload, ctx);
        if (r) result = { ...result, ...r };
      }
      return result;
    },

    async emitCommand(name, args, ctxOverrides = {}) {
      const cmd = commands[name];
      if (!cmd) throw new Error(`Command "${name}" not registered`);
      const ctx = { cwd, ui: { setStatus: () => {}, notify: () => {} }, ...ctxOverrides };
      await cmd.handler(args, ctx);
    },
  };

  return pi;
}

export function writeConfig(cwd, config) {
  const defaults = {
    version: "1.0",
    defaults: {
      evidence_required: true,
      deterministic_prompting: true,
      secrets_isolation: true,
      git_guard: true,
      checkpoint_interval: 10,
    },
  };
  const content = config !== undefined ? config : defaults;
  writeFileSync(join(cwd, ".harness", "config.yaml"), JSON.stringify(content));
}

export function writeToolVersions(cwd, versions) {
  writeFileSync(
    join(cwd, ".harness", "state", "tool-versions.json"),
    JSON.stringify(versions || { git: "2.50.1", node: "v25.8.2", bun: "1.3.10" })
  );
}

export function readCheckpoint(cwd) {
  const p = join(cwd, ".harness", "checkpoints", "latest.json");
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf8"));
}

export function readAuditLog(cwd) {
  const p = join(cwd, ".harness", "audit.log");
  if (!existsSync(p)) return [];
  return readFileSync(p, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}
