#!/usr/bin/env bun
import { existsSync, mkdirSync, copyFileSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);

function hasFlag(name) {
  return args.includes(name);
}

function optionValue(name, fallback = undefined) {
  const index = args.indexOf(name);
  if (index >= 0 && index + 1 < args.length) return args[index + 1];
  return fallback;
}

function usage() {
  return `PEBKAC Harness

Usage:
  pebkac init --non-interactive --yes [--cwd <path>]
  pebkac status [--cwd <path>]

Options:
  --theme <standard|minimal>
  --telemetry / --no-telemetry
  --notifications / --no-notifications
  --health-checks / --no-health-checks
`;
}

function boolFromFlags(enable, disable, fallback) {
  if (hasFlag(disable)) return false;
  if (hasFlag(enable)) return true;
  return fallback;
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function ensureProject(targetCwd) {
  mkdirSync(join(targetCwd, ".omp", "extensions"), { recursive: true });
  mkdirSync(join(targetCwd, ".harness", "state"), { recursive: true });
  mkdirSync(join(targetCwd, ".harness", "checkpoints"), { recursive: true });
  mkdirSync(join(targetCwd, ".harness", "vault"), { recursive: true });
}

function init() {
  const targetCwd = resolve(optionValue("--cwd", process.cwd()));
  const nonInteractive = hasFlag("--non-interactive") || hasFlag("--yes");

  if (!nonInteractive && (!process.stdin.isTTY || !process.stdout.isTTY)) {
    console.error("Interactive onboarding requires a TTY. Re-run with --non-interactive --yes to use explicit defaults.");
    process.exit(2);
  }

  ensureProject(targetCwd);
  copyFileSync(join(repoRoot, ".omp", "extensions", "pebkac-defense.js"), join(targetCwd, ".omp", "extensions", "pebkac-defense.js"));

  const prefs = {
    theme: optionValue("--theme", "standard"),
    telemetry: boolFromFlags("--telemetry", "--no-telemetry", true),
    notifications: boolFromFlags("--notifications", "--no-notifications", true),
    healthChecks: boolFromFlags("--health-checks", "--no-health-checks", true),
    capturedAt: new Date(0).toISOString(),
  };

  writeFileSync(join(targetCwd, ".harness", "config.yaml"), `# PEBKAC Harness Configuration\nversion: "1.0"\n\ndefaults:\n  evidence_required: true\n  deterministic_prompting: true\n  secrets_isolation: true\n  git_guard: true\n  checkpoint_interval: 10\n\nagent_runtime: "omp"\nplatforms: all\n`);
  writeJson(join(targetCwd, ".harness", "state", "onboarding-preferences.json"), prefs);
  writeJson(join(targetCwd, ".harness", "state", "telemetry-consent.json"), { enabled: prefs.telemetry });
  writeFileSync(join(targetCwd, ".harness", ".unboxed"), "true\n");

  console.log(`PEBKAC init complete: ${targetCwd}`);
}

function status() {
  const targetCwd = resolve(optionValue("--cwd", process.cwd()));
  const extensionPath = join(targetCwd, ".omp", "extensions", "pebkac-defense.js");
  const configPath = join(targetCwd, ".harness", "config.yaml");
  console.log(`extension=${existsSync(extensionPath) ? "present" : "missing"}`);
  console.log(`config=${existsSync(configPath) ? "present" : "missing"}`);
}

const command = args.find((arg) => !arg.startsWith("-")) ?? "help";
if (command === "init") init();
else if (command === "status") status();
else {
  console.log(usage());
  process.exit(command === "help" || hasFlag("--help") ? 0 : 1);
}
