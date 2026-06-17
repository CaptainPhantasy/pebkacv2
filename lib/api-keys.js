import { appendJsonl, harnessPaths } from "./common.js";
import { getKeychain, maskKey } from "./keychain.js";

export function validateKey(provider, key) {
  if (!key) return "key is empty";
  const p = provider.toLowerCase();
  if (p === "anthropic") {
    if (!key.startsWith("sk-ant-")) return "anthropic keys must start with sk-ant-";
    if (key.length < 30) return "anthropic keys must be at least 30 characters";
    return null;
  }
  if (p === "openai") {
    if (key.startsWith("sk-ant-")) return "openai keys must not use the anthropic sk-ant- prefix";
    if (!key.startsWith("sk-")) return "openai keys must start with sk-";
    if (key.length < 30) return "openai keys must be at least 30 characters";
    return null;
  }
  if (p === "opencode-zen" && key.length < 20) return "opencode-zen keys must be at least 20 characters";
  if (p !== "ollama" && key.length < 20) return `${provider} keys must be at least 20 characters`;
  return null;
}

export function parseApiKeyArgs(args) {
  const own = args.slice(args.indexOf("api-keys") + 1).filter(Boolean);
  const positional = [];
  let keyFromEnv = null;
  let yes = args.includes("--yes") || args.includes("--non-interactive");
  for (let i = 0; i < own.length; i++) {
    const arg = own[i];
    if (arg === "--key-from-env") { keyFromEnv = own[++i] ?? null; continue; }
    if (arg.startsWith("--key-from-env=")) { keyFromEnv = arg.slice("--key-from-env=".length); continue; }
    if (arg === "--cwd") { i++; continue; }
    if (arg.startsWith("-")) continue;
    positional.push(arg);
  }
  return { subcommand: positional[0] ?? null, provider: positional[1] ?? null, keyFromEnv, yes };
}

export function buildTestRequest(provider, key) {
  const p = provider.toLowerCase();
  if (p === "anthropic") return { url: "https://api.anthropic.com/v1/models", headers: { "x-api-key": key, "anthropic-version": "2023-06-01" } };
  if (p === "openai") return { url: "https://api.openai.com/v1/models", headers: { Authorization: `Bearer ${key}` } };
  if (p === "ollama") return { url: "http://localhost:11434/api/tags", headers: {} };
  return null;
}

function audit(cwd, event, details) {
  appendJsonl(harnessPaths(cwd).audit, { timestamp: new Date().toISOString(), event, details });
}

export async function runApiKeys(cwd, args, ui, { json = false } = {}) {
  const parsed = parseApiKeyArgs(args);
  const keychain = getKeychain();
  const sub = parsed.subcommand ?? "help";
  if (sub === "help") {
    ui.raw(`pebkac api-keys <list|add|rotate|remove|test> [provider]\n  add/rotate require --key-from-env VAR in non-interactive use.`);
    return 0;
  }
  if (sub === "list") {
    const providers = keychain.listSecrets();
    const rows = providers.map(provider => {
      const key = keychain.getSecret(provider);
      return { provider, masked: key ? maskKey(key) : "missing", length: key ? key.length : 0 };
    });
    audit(cwd, "api_key_listed", { count: rows.length, success: true });
    if (json) ui.raw(JSON.stringify({ providers: rows }, null, 2));
    else if (rows.length === 0) ui.log("No API keys configured. Use `pebkac api-keys add <provider> --key-from-env VAR`.");
    else rows.forEach(r => ui.log(`${r.provider}: ${r.masked} (${r.length} chars)`));
    return 0;
  }
  if (["add", "rotate"].includes(sub)) {
    if (!parsed.provider) { ui.error("provider is required"); return 2; }
    const existing = keychain.getSecret(parsed.provider);
    if (sub === "add" && existing) { ui.error(`a key for ${parsed.provider} already exists; use rotate`); return 1; }
    const envName = parsed.keyFromEnv;
    if (!envName) { ui.error("--key-from-env VAR is required; raw keys are never accepted as CLI args"); return 2; }
    let key = process.env[envName] ?? "";
    if (!key) { ui.error(`environment variable ${envName} is not set or empty`); return 1; }
    const error = validateKey(parsed.provider, key);
    const length = key.length;
    if (error) { audit(cwd, sub === "rotate" ? "api_key_rotated" : "api_key_added", { provider: parsed.provider, length, success: false, reason: error }); key = ""; ui.error(`invalid key for ${parsed.provider}: ${error}`); return 1; }
    try { keychain.setSecret(parsed.provider, key); }
    catch (err) { audit(cwd, sub === "rotate" ? "api_key_rotated" : "api_key_added", { provider: parsed.provider, length, success: false, reason: "keychain_failed" }); key = ""; ui.error(err.message); return 1; }
    key = "";
    audit(cwd, sub === "rotate" ? "api_key_rotated" : "api_key_added", { provider: parsed.provider, length, previousLength: existing?.length ?? 0, success: true });
    ui.log(`${ui.icon("pass")} ${sub === "rotate" ? "rotated" : "added"} ${parsed.provider} key (${length} chars)`);
    return 0;
  }
  if (["remove", "rm", "delete"].includes(sub)) {
    if (!parsed.provider) { ui.error("provider is required"); return 2; }
    try { keychain.deleteSecret(parsed.provider); }
    catch (err) { audit(cwd, "api_key_removed", { provider: parsed.provider, success: false, reason: "keychain_failed" }); ui.error(err.message); return 1; }
    audit(cwd, "api_key_removed", { provider: parsed.provider, success: true });
    ui.log(`${ui.icon("pass")} removed ${parsed.provider} key`);
    return 0;
  }
  if (sub === "test") {
    if (!parsed.provider) { ui.error("provider is required"); return 2; }
    let key = keychain.getSecret(parsed.provider);
    if (!key && parsed.provider.toLowerCase() !== "ollama") { ui.error(`No key configured for ${parsed.provider}`); return 1; }
    key ??= "";
    const request = buildTestRequest(parsed.provider, key);
    if (!request) { ui.log(`No automatic test for ${parsed.provider}.`); return 0; }
    let status = 0, success = false, reason = null;
    try {
      const res = await fetch(request.url, { method: "GET", headers: request.headers, signal: AbortSignal.timeout(5000) });
      status = res.status;
      try { await res.text(); } catch {}
      success = status === 200;
      reason = success ? null : `http_${status}`;
    } catch (err) { reason = /abort|timeout/i.test(err.message) ? "timeout" : "network"; }
    key = "";
    audit(cwd, "api_key_tested", { provider: parsed.provider, status, success, ...(reason ? { reason } : {}) });
    if (success) { ui.log(`${ui.icon("pass")} ${parsed.provider} key authenticated`); return 0; }
    ui.error(`${parsed.provider} test failed: ${reason}`);
    return 1;
  }
  ui.error(`unknown api-keys subcommand: ${sub}`);
  return 2;
}
