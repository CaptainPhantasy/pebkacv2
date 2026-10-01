import { spawnSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";

function execute(binary, args, cwd) {
  const result = spawnSync(binary, args, { cwd, encoding: "utf8", env: process.env });
  return { code: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function healthy(result) {
  try { return result.code === 0 && JSON.parse(result.stdout).healthy === true; }
  catch { return false; }
}

export async function run({ cwd, paths }) {
  const binary = process.env.PEBKAC_EXECUTABLE || "/opt/homebrew/bin/pebkac";
  const before = execute(binary, ["doctor", "--json", "--cwd", cwd], cwd);
  if (healthy(before)) return { ok: true, summary: "Doctor already reports a healthy project; no changes were needed.", data: { changed: false, verified: true } };

  const actions = [];
  const configPresent = existsSync(paths.config);
  const configText = configPresent ? readFileSync(paths.config, "utf8") : "";
  if (!configPresent || !configText.includes("version:") || !configText.includes("defaults:")) {
    if (configPresent) {
      const backup = join(paths.state, "doctor-autofix-backups", `${Date.now()}-config.yaml`);
      mkdirSync(dirname(backup), { recursive: true });
      writeFileSync(backup, configText, { mode: 0o600 });
      actions.push(`backed up invalid config to ${backup}`);
    }
    const initialized = execute(binary, ["init", "--non-interactive", "--yes", "--cwd", cwd], cwd);
    if (initialized.code !== 0) return { ok: false, summary: "Bootstrap remediation failed.", data: { actions, stderr: initialized.stderr.trim() } };
    actions.push("initialized missing harness surfaces");
  } else {
    for (const directory of [paths.state, paths.checkpoints, paths.vault]) {
      if (!existsSync(directory)) { mkdirSync(directory, { recursive: true }); actions.push(`created ${directory}`); }
    }
    if (!existsSync(paths.flags)) {
      writeFileSync(paths.flags, `${JSON.stringify({ evidence_contracts: true, git_guard: true, secrets_isolation: true, reality_gate: true, checkpoints: true, circuit_breaker: true, rate_limiter: true, repeat_detector: true, first_run_splash: true }, null, 2)}\n`, { mode: 0o600 });
      actions.push("restored feature flags");
    }
    const platforms = execute(binary, ["platforms", "install", "all", "--cwd", cwd], cwd);
    if (platforms.code !== 0) return { ok: false, summary: "Platform surface remediation failed.", data: { actions, stderr: platforms.stderr.trim() } };
    actions.push("reinstalled platform defense surfaces");
    const hooks = execute(binary, ["hooks", "install", "--cwd", cwd], cwd);
    if (hooks.code === 0) actions.push("reconciled git safety hooks");
  }

  const after = execute(binary, ["doctor", "--json", "--cwd", cwd], cwd);
  const verified = healthy(after);
  let doctor = null;
  try { doctor = JSON.parse(after.stdout); } catch {}
  return {
    ok: verified,
    summary: verified ? "Safe remediations applied; doctor verification now passes." : "Safe remediations were applied, but doctor still reports an issue.",
    data: { changed: actions.length > 0, actions, verified, doctor, stderr: after.stderr.trim() },
  };
}
