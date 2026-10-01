import { describe, test, expect } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { gunzipSync } from "zlib";

function tempRoot(prefix = "pebkac-unified-") {
  return mkdtempSync(join(tmpdir(), prefix));
}
function cleanup(dir) {
  if (dir?.startsWith(tmpdir())) rmSync(dir, { recursive: true, force: true });
}
const TEST_EMPTY_GLOBAL_ROOT = join(tmpdir(), `pebkac-empty-global-${process.pid}-${Date.now()}`);
function run(args, opts = {}) {
  const result = Bun.spawnSync({ cmd: ["bun", "./bin/pebkac.js", ...args], cwd: process.cwd(), stdout: "pipe", stderr: "pipe", env: { ...process.env, PEBKAC_GLOBAL_PLUGIN_ROOT: TEST_EMPTY_GLOBAL_ROOT, ...opts.env } });
  return { code: result.exitCode, stdout: new TextDecoder().decode(result.stdout), stderr: new TextDecoder().decode(result.stderr) };
}

describe("unified CLI command surface", () => {
  test("help advertises merged command groups and quick start footer", () => {
    const r = run(["help"]);
    expect(r.code).toBe(0);
    for (const cmd of ["api-keys", "hooks", "platforms", "plugins", "flags", "audit", "mode", "skill"]) {
      expect(r.stdout).toContain(cmd);
    }
    expect(r.stdout).toContain("Command Dashboard");
    expect(r.stdout).toContain("Quick start:");
    expect(r.stdout).toContain("pebkac init --non-interactive --yes --cwd .");
  });

  test("completion output includes install guidance comments", () => {
    const bash = run(["completion", "bash"]);
    expect(bash.code).toBe(0);
    expect(bash.stdout).toContain("# Install: eval");
    const fish = run(["completion", "fish"]);
    expect(fish.code).toBe(0);
    expect(fish.stdout).toContain("# Install: pebkac completion fish | source");
  });

  test("command-specific help exists for every advertised command", () => {
    for (const cmd of ["init", "status", "doctor", "off", "on", "launch", "version", "config", "completion", "api-keys", "hooks", "platforms", "plugins", "flags", "audit", "mode", "skill"]) {
      const r = run(["help", cmd]);
      expect(r.code, `${cmd}: ${r.stderr}`).toBe(0);
      expect(r.stdout).toContain(`pebkac ${cmd}`);
    }
  });

  test("unknown command exits with usage code", () => {
    const r = run(["bogus-command"]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("Unknown command");
  });
});

describe("init, status, doctor, modes, flags", () => {
  test("init creates all promised release surfaces", () => {
    const cwd = tempRoot();
    try {
      const r = run(["init", "--non-interactive", "--yes", "--cwd", cwd, "--verbosity", "quiet", "--no-telemetry", "--no-notifications"]);
      expect(r.code, r.stderr).toBe(0);
      expect(existsSync(join(cwd, ".omp", "extensions", "pebkac-defense.js"))).toBe(true);
      expect(existsSync(join(cwd, ".claude", "CLAUDE.md"))).toBe(true);
      expect(existsSync(join(cwd, ".pi", "CLAUDE.md"))).toBe(true);
      expect(existsSync(join(cwd, ".harness", "config.yaml"))).toBe(true);
      expect(existsSync(join(cwd, ".harness", "vault", "config.yaml"))).toBe(true);
      expect(existsSync(join(cwd, ".harness", "state", "feature-flags.json"))).toBe(true);
      expect(existsSync(join(cwd, ".harness", "state", "splash-seen"))).toBe(true);
      expect(readFileSync(join(cwd, ".harness", "config.yaml"), "utf8")).toContain('verbosity: "quiet"');
    } finally { cleanup(cwd); }
  });

  test("init shows verdict summary and next steps", () => {
    const cwd = tempRoot();
    try {
      const r = run(["init", "--non-interactive", "--yes", "--cwd", cwd]);
      expect(r.code, r.stderr).toBe(0);
      expect(r.stdout).toContain("Verdict:");
      expect(r.stdout).toContain("READY");
      expect(r.stdout).toContain("Next steps:");
      expect(r.stdout).toContain("Launch session");
      expect(r.stdout).toContain("Run diagnostics");
    } finally { cleanup(cwd); }
  });

  test("status json reflects configured runtime instead of any runtime", () => {
    const cwd = tempRoot();
    try {
      expect(run(["init", "--non-interactive", "--yes", "--cwd", cwd]).code).toBe(0);
      expect(run(["mode", "set", "runtime", "none", "--cwd", cwd]).code).toBe(0);
      const r = run(["status", "--json", "--cwd", cwd]);
      expect(r.code, r.stderr).toBe(0);
      const data = JSON.parse(r.stdout);
      expect(data.config.runtime).toBe("none");
      expect(data.runtime.name).toBe("none");
      expect(data.runtime.found).toBe(true);
    } finally { cleanup(cwd); }
  });

  test("status text includes verdict summary", () => {
    const cwd = tempRoot();
    try {
      expect(run(["init", "--non-interactive", "--yes", "--cwd", cwd]).code).toBe(0);
      const r = run(["status", "--cwd", cwd], { env: { NO_COLOR: "1" } });
      expect(r.code, r.stderr).toBe(0);
      expect(r.stdout).toContain("Verdict:");
      expect(r.stdout).toContain("READY");
      expect(r.stdout).toContain("required surfaces are present");
    } finally { cleanup(cwd); }
  });

  test("flags persist and mode updates config", () => {
    const cwd = tempRoot();
    try {
      expect(run(["init", "--non-interactive", "--yes", "--cwd", cwd]).code).toBe(0);
      expect(run(["flags", "set", "reality_gate", "off", "--cwd", cwd]).code).toBe(0);
      const flag = run(["flags", "get", "reality_gate", "--json", "--cwd", cwd]);
      expect(JSON.parse(flag.stdout).value).toBe(false);
      expect(run(["mode", "set", "verbosity", "normal", "--cwd", cwd]).code).toBe(0);
      expect(run(["config", "get", "defaults.verbosity", "--json", "--cwd", cwd]).stdout.includes("\"normal\"")).toBe(true);
    } finally { cleanup(cwd); }
  });

  test("config list/get/set use dashboard text and JSON contracts", () => {
    const cwd = tempRoot();
    try {
      expect(run(["init", "--non-interactive", "--yes", "--cwd", cwd]).code).toBe(0);
      const list = run(["config", "list", "--cwd", cwd], { env: { NO_COLOR: "1" } });
      expect(list.code).toBe(0);
      expect(list.stdout).toContain("Config");
      expect(list.stdout).toContain("Verdict:");
      expect(list.stdout).toContain("agent_runtime");
      const get = run(["config", "get", "agent_runtime", "--cwd", cwd], { env: { NO_COLOR: "1" } });
      expect(get.code).toBe(0);
      expect(get.stdout).toContain("Config value");
      expect(get.stdout).toContain("omp");
      const set = run(["config", "set", "agent_runtime", "none", "--cwd", cwd], { env: { NO_COLOR: "1" } });
      expect(set.code).toBe(0);
      expect(set.stdout).toContain("Config updated");
      const getJson = run(["config", "get", "agent_runtime", "--json", "--cwd", cwd]);
      expect(JSON.parse(getJson.stdout).value).toBe("none");
    } finally { cleanup(cwd); }
  });

  test("flags list/get/set use dashboard text and JSON contracts", () => {
    const cwd = tempRoot();
    try {
      expect(run(["init", "--non-interactive", "--yes", "--cwd", cwd]).code).toBe(0);
      const list = run(["flags", "list", "--cwd", cwd], { env: { NO_COLOR: "1" } });
      expect(list.code).toBe(0);
      expect(list.stdout).toContain("Flags");
      expect(list.stdout).toContain("Verdict:");
      const get = run(["flags", "get", "reality_gate", "--cwd", cwd], { env: { NO_COLOR: "1" } });
      expect(get.code).toBe(0);
      expect(get.stdout).toContain("Flag value");
      const set = run(["flags", "set", "reality_gate", "off", "--cwd", cwd], { env: { NO_COLOR: "1" } });
      expect(set.code).toBe(0);
      expect(set.stdout).toContain("Flag updated");
      const getJson = run(["flags", "get", "reality_gate", "--json", "--cwd", cwd]);
      expect(JSON.parse(getJson.stdout).value).toBe(false);
    } finally { cleanup(cwd); }
  });

  test("plugins, audit, skill commands are real", () => {
    const cwd = tempRoot();
    try {
      mkdirSync(join(cwd, ".omp", "plugins", "demo"), { recursive: true });
      writeFileSync(join(cwd, ".omp", "plugins", "demo", "plugin.json"), JSON.stringify({ name: "demo", version: "1.2.3", description: "demo plugin" }));
      mkdirSync(join(cwd, ".harness"), { recursive: true });
      writeFileSync(join(cwd, ".harness", "audit.log"), JSON.stringify({ event: "api_key_added", details: { key: "sk-ant-secretsecretsecretsecret" } }) + "\n");
      const plugins = run(["plugins", "list", "--cwd", cwd]);
      expect(plugins.code).toBe(0);
      expect(plugins.stdout).toContain("demo");
      expect(plugins.stdout).toContain("1.2.3");
      const audit = run(["audit", "tail", "--cwd", cwd]);
      expect(audit.code).toBe(0);
      expect(audit.stdout).toContain("[REDACTED_ANTHROPIC_KEY]");
      const skill = run(["skill", "--cwd", cwd]);
      expect(skill.code).toBe(0);
      expect(skill.stdout).toContain("cli-x-2026");
    } finally { cleanup(cwd); }
  });

  test("plugins list uses dashboard summary and empty-state next actions", () => {
    const cwd = tempRoot();
    try {
      const r = run(["plugins", "list", "--cwd", cwd], { env: { NO_COLOR: "1" } });
      expect(r.code).toBe(0);
      expect(r.stdout).toContain("Plugins");
      expect(r.stdout).toContain("Verdict:");
      expect(r.stdout).toContain("NO PLUGINS");
      expect(r.stdout).toContain("Next actions:");
      expect(r.stdout).toContain("pebkac plugins recommend");
    } finally { cleanup(cwd); }
  });

  test("plugins recommend uses dashboard summary", () => {
    const cwd = tempRoot();
    try {
      const r = run(["plugins", "recommend", "--cwd", cwd], { env: { NO_COLOR: "1" } });
      expect(r.code).toBe(0);
      expect(r.stdout).toContain("Plugin recommendations");
      expect(r.stdout).toContain("Verdict:");
      expect(r.stdout).toContain("UPSIDE AVAILABLE");
      expect(r.stdout).toContain("audit-archiver");
    } finally { cleanup(cwd); }
  });

  test("plugins recommend json includes priority rationale and category", () => {
    const cwd = tempRoot();
    try {
      const r = run(["plugins", "recommend", "--json", "--cwd", cwd]);
      expect(r.code).toBe(0);
      const data = JSON.parse(r.stdout);
      expect(Array.isArray(data.recommendations)).toBe(true);
      expect(data.recommendations[0]).toHaveProperty("priority");
      expect(data.recommendations[0]).toHaveProperty("rationale");
      expect(data.recommendations[0]).toHaveProperty("category");
    } finally { cleanup(cwd); }
  });

  test("recommended plugins install globally, disappear from recommendations, and execute", () => {
    const cwd = tempRoot();
    const globalRoot = tempRoot("pebkac-global-plugins-");
    const archiveRoot = tempRoot("pebkac-audit-archive-");
    const env = { PEBKAC_GLOBAL_PLUGIN_ROOT: globalRoot };
    try {
      mkdirSync(join(cwd, ".harness", "state"), { recursive: true });
      const audit = [
        { timestamp: Date.now(), event: "turn_end", details: { metrics: { failedToolCalls: 1, evidenceCount: 0 } } },
        { timestamp: Date.now(), event: "turn_end", details: { metrics: { failedToolCalls: 0, evidenceCount: 2 } } },
        { timestamp: Date.now(), event: "cli_command", details: { command: "status", exitCode: 0, durationMs: 25, token: "sk-ant-secretsecretsecretsecret" } },
      ];
      writeFileSync(join(cwd, ".harness", "audit.log"), `${audit.map(item => JSON.stringify(item)).join("\n")}\n`);

      const install = run(["plugins", "install-recommended", "--archive-dir", archiveRoot, "--json", "--cwd", cwd], { env });
      expect(install.code, install.stderr).toBe(0);
      expect(JSON.parse(install.stdout).verified).toHaveLength(3);

      const recommend = run(["plugins", "recommend", "--json", "--cwd", cwd], { env });
      expect(recommend.code, recommend.stderr).toBe(0);
      expect(JSON.parse(recommend.stdout).recommendations).toHaveLength(0);

      const metrics = run(["plugins", "run", "metrics-collector", "--json", "--cwd", cwd], { env });
      expect(metrics.code, metrics.stderr).toBe(0);
      const metricData = JSON.parse(metrics.stdout).data;
      expect(metricData.blockRatePercent).toBe(50);
      expect(metricData.evidenceRatioPercent).toBe(50);
      expect(metricData.commandLatencyMs.samples).toBeGreaterThanOrEqual(1);
      expect(existsSync(join(cwd, ".harness", "state", "pebkac-metrics.json"))).toBe(true);

      const archive = run(["plugins", "run", "audit-archiver", "--json", "--cwd", cwd], { env });
      expect(archive.code, archive.stderr).toBe(0);
      const archiveData = JSON.parse(archive.stdout).data;
      expect(archiveData.verified).toBe(true);
      expect(existsSync(archiveData.archive)).toBe(true);
      expect(existsSync(`${archiveData.archive}.json`)).toBe(true);
      const archivedText = gunzipSync(readFileSync(archiveData.archive)).toString("utf8");
      expect(archivedText).toContain("[REDACTED_ANTHROPIC_KEY]");
      expect(archivedText).not.toContain("sk-ant-secretsecretsecretsecret");
    } finally {
      cleanup(cwd);
      cleanup(globalRoot);
      cleanup(archiveRoot);
    }
  });

  test("doctor text includes verdict summary", () => {
    const cwd = tempRoot();
    try {
      expect(run(["init", "--non-interactive", "--yes", "--cwd", cwd]).code).toBe(0);
      const r = run(["doctor", "--cwd", cwd], { env: { NO_COLOR: "1" } });
      expect(r.code, r.stderr).toBe(0);
      expect(r.stdout).toContain("Verdict:");
      expect(r.stdout).toContain("all required checks passed");
    } finally { cleanup(cwd); }
  });

  test("doctor unhealthy output includes remediation next actions", () => {
    const cwd = tempRoot();
    try {
      const r = run(["doctor", "--cwd", cwd], { env: { NO_COLOR: "1" } });
      expect(r.code, r.stderr).toBe(1);
      expect(r.stdout).toContain("REMEDIATION REQUIRED");
      expect(r.stdout).toContain("Next actions:");
      expect(r.stdout).toContain("Re-run bootstrap");
    } finally { cleanup(cwd); }
  });

  test("splash does not replay on routine commands", () => {
    const cwd = tempRoot();
    try {
      const init = run(["init", "--non-interactive", "--yes", "--cwd", cwd], { env: { NO_COLOR: "1" } });
      expect(init.code, init.stderr).toBe(0);
      expect(init.stdout).toContain("PEBKAC defense harness online");
      const status = run(["status", "--cwd", cwd], { env: { NO_COLOR: "1" } });
      expect(status.code, status.stderr).toBe(0);
      expect(status.stdout).not.toContain("PEBKAC defense harness online");
    } finally { cleanup(cwd); }
  });
});
