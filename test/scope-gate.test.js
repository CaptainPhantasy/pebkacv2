/**
 * Tests for the scope-completeness gate (Option 1).
 * Proves the gate rejects premature FINAL STATUS: COMPLETE claims
 * and allows legitimate ones.
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import pebkacDefenseExtension, { resetAllState } from "../.omp/extensions/pebkac-defense.js";

function tempRoot() {
  return join(tmpdir(), `pebkac-scope-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
}

function cleanup(cwd) {
  try { rmSync(cwd, { recursive: true, force: true }); } catch {}
}

function setupHarness(cwd) {
  mkdirSync(join(cwd, ".harness", "checkpoints"), { recursive: true });
  mkdirSync(join(cwd, ".harness", "state"), { recursive: true });
  mkdirSync(join(cwd, ".harness", "vault"), { recursive: true });
}

function makePi(cwd) {
  resetAllState();
  const events = {};
  const pi = {
    setLabel: () => {},
    on: (event, handler) => { events[event] = handler; },
    registerCommand: () => {},
    sendMessage: () => {},
    events,
  };
  pebkacDefenseExtension(pi);
  return pi;
}

const ctx = (cwd) => ({ cwd, ui: { setStatus: () => {} } });

const threeItemTask = "1. Update the API endpoint\n2. Add input validation\n3. Write integration tests";

function buildMatrix(items, opts = {}) {
  const { allComplete = true, allVerified = true } = opts;
  const lines = items.map((desc, i) => {
    const status = allComplete ? "DONE" : (i === 0 ? "DONE" : "PENDING");
    const verified = allVerified ? "YES" : (i === 0 ? "YES" : "NO");
    const evidence = verified === "YES" ? "test_output" : "missing";
    return `| ${i + 1} | ${desc} | ${status} | ${evidence} | ${verified} |`;
  });
  return [
    "| # | Item | Status | Evidence | Verified |",
    "|---|------|--------|----------|----------|",
    ...lines,
    "",
    "FINAL STATUS: COMPLETE",
  ].join("\n");
}

async function startSession(pi, cwd, taskDescription) {
  await pi.events.session_start({}, ctx(cwd));
  await pi.events.before_agent_start({ systemPrompt: "base", taskDescription }, ctx(cwd));
}

async function fireContext(pi, cwd, messages) {
  return await pi.events.context({ messages }, ctx(cwd));
}

describe("Scope-completeness gate (Option 1)", () => {
  let cwd, pi;

  beforeEach(() => {
    cwd = tempRoot();
    setupHarness(cwd);
    pi = makePi(cwd);
  });

  afterEach(() => cleanup(cwd));

  test("blocks premature COMPLETE: matrix covers fewer rows than compiled items", async () => {
    await startSession(pi, cwd, threeItemTask);
    const matrix = buildMatrix(["Update the API endpoint", "Add input validation"]);
    const result = await fireContext(pi, cwd, [{ role: "assistant", content: matrix }]);
    expect(result).toBeDefined();
    const injected = result.messages[result.messages.length - 1].content;
    expect(injected).toContain("PEBKAC SCOPE GATE");
    expect(injected).toContain("2 row(s)");
    expect(injected).toContain("3 item(s)");
  });

  test("blocks premature COMPLETE: matrix row has non-DONE status", async () => {
    await startSession(pi, cwd, threeItemTask);
    const matrix = buildMatrix(
      ["Update the API endpoint", "Add input validation", "Write integration tests"],
      { allComplete: false, allVerified: true }
    );
    const result = await fireContext(pi, cwd, [{ role: "assistant", content: matrix }]);
    expect(result).toBeDefined();
    const injected = result.messages[result.messages.length - 1].content;
    expect(injected).toContain("PEBKAC SCOPE GATE");
    expect(injected).toContain("not marked DONE or COMPLETE");
  });

  test("blocks premature COMPLETE: matrix row lacks verified evidence", async () => {
    await startSession(pi, cwd, threeItemTask);
    const matrix = buildMatrix(
      ["Update the API endpoint", "Add input validation", "Write integration tests"],
      { allComplete: true, allVerified: false }
    );
    const result = await fireContext(pi, cwd, [{ role: "assistant", content: matrix }]);
    expect(result).toBeDefined();
    const injected = result.messages[result.messages.length - 1].content;
    expect(injected).toContain("PEBKAC SCOPE GATE");
    expect(injected).toContain("lack verified evidence");
  });

  test("allows COMPLETE: full coverage, all DONE, all verified", async () => {
    await startSession(pi, cwd, threeItemTask);
    const matrix = buildMatrix([
      "Update the API endpoint",
      "Add input validation",
      "Write integration tests",
    ]);
    const result = await fireContext(pi, cwd, [{ role: "assistant", content: matrix }]);
    if (result) {
      const lastContent = result.messages[result.messages.length - 1].content;
      expect(lastContent).not.toContain("PEBKAC SCOPE GATE");
    }
  });

  test("does not fire when agent claims INCOMPLETE", async () => {
    await startSession(pi, cwd, threeItemTask);
    const matrix = "FINAL STATUS: INCOMPLETE";
    const result = await fireContext(pi, cwd, [{ role: "assistant", content: matrix }]);
    if (result) {
      const lastContent = result.messages[result.messages.length - 1].content;
      expect(lastContent).not.toContain("PEBKAC SCOPE GATE");
    }
  });

  test("does not fire when no completeness matrix present", async () => {
    await startSession(pi, cwd, threeItemTask);
    const result = await fireContext(pi, cwd, [
      { role: "assistant", content: "I'm still working on the task." },
    ]);
    if (result) {
      const lastContent = result.messages[result.messages.length - 1].content;
      expect(lastContent).not.toContain("PEBKAC SCOPE GATE");
    }
  });

  test("does not fire when no task was compiled (compiledItemCount = 0)", async () => {
    const matrix = buildMatrix(["single"], { allComplete: true, allVerified: true });
    const result = await fireContext(pi, cwd, [{ role: "assistant", content: matrix }]);
    if (result) {
      const lastContent = result.messages[result.messages.length - 1].content;
      expect(lastContent).not.toContain("PEBKAC SCOPE GATE");
    }
  });
});
