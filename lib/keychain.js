import { existsSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { homedir } from "os";
import { spawnSync } from "child_process";
import { ensureDir, readJson, writeJson } from "./common.js";

export const KEYCHAIN_PREFIX = "keychain:pebkac/";
const SERVICE = "pebkac";

function registryPath() {
  if (process.env.PEBKAC_KEYCHAIN_FILE) return `${process.env.PEBKAC_KEYCHAIN_FILE}.registry.json`;
  if (process.platform === "darwin") return join(homedir(), "Library", "Application Support", "pebkac", "keychain-registry.json");
  if (process.platform === "win32") return join(process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "pebkac", "keychain-registry.json");
  return join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), "pebkac", "keychain-registry.json");
}

function register(provider) {
  const path = registryPath();
  const registry = readJson(path, { entries: [] }) ?? { entries: [] };
  if (!registry.entries.some(e => e.provider === provider)) {
    registry.entries.push({ provider, addedAt: new Date().toISOString() });
    writeJson(path, registry);
  }
}

function unregister(provider) {
  const path = registryPath();
  const registry = readJson(path, { entries: [] }) ?? { entries: [] };
  const next = registry.entries.filter(e => e.provider !== provider);
  if (next.length !== registry.entries.length) writeJson(path, { entries: next });
}

function listRegistered() {
  const registry = readJson(registryPath(), { entries: [] }) ?? { entries: [] };
  return registry.entries.map(e => e.provider).sort();
}

function run(cmd, opts = {}) {
  return spawnSync(cmd[0], cmd.slice(1), { input: opts.input, encoding: "utf8", stdio: [opts.input === undefined ? "ignore" : "pipe", "pipe", "pipe"] });
}

class FileKeychainBackend {
  constructor(file) { this.file = file; }
  #read() { return readJson(this.file, {}) ?? {}; }
  #write(data) { ensureDir(dirname(this.file)); writeFileSync(this.file, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 }); }
  setSecret(provider, key) { const data = this.#read(); data[provider] = key; this.#write(data); register(provider); }
  getSecret(provider) { const data = this.#read(); return typeof data[provider] === "string" ? data[provider] : null; }
  deleteSecret(provider) { const data = this.#read(); delete data[provider]; this.#write(data); unregister(provider); }
  listSecrets() { return Object.keys(this.#read()).sort(); }
}

class MacKeychainBackend {
  setSecret(provider, key) {
    const r = run(["/usr/bin/security", "add-generic-password", "-s", SERVICE, "-a", provider, "-w", key, "-U"]);
    if (r.status !== 0) throw new Error(`macOS keychain set failed for ${provider}: ${r.stderr.trim() || r.status}`);
    register(provider);
  }
  getSecret(provider) {
    const r = run(["/usr/bin/security", "find-generic-password", "-s", SERVICE, "-a", provider, "-w"]);
    if (r.status !== 0) return null;
    return r.stdout.replace(/\n$/, "") || null;
  }
  deleteSecret(provider) {
    const r = run(["/usr/bin/security", "delete-generic-password", "-s", SERVICE, "-a", provider]);
    if (r.status !== 0 && r.status !== 44 && !/could not be found/i.test(r.stderr)) throw new Error(`macOS keychain delete failed for ${provider}: ${r.stderr.trim() || r.status}`);
    unregister(provider);
  }
  listSecrets() { return listRegistered(); }
}

class LinuxKeychainBackend {
  #ensure() {
    const r = run(["sh", "-c", "command -v secret-tool"]);
    if (r.status !== 0 || !r.stdout.trim()) throw new Error("Linux keychain backend requires secret-tool from libsecret-tools.");
  }
  setSecret(provider, key) {
    this.#ensure();
    const r = run(["secret-tool", "store", "--label", `PEBKAC ${provider}`, "service", SERVICE, "account", provider], { input: key });
    if (r.status !== 0) throw new Error(`secret-tool store failed for ${provider}: ${r.stderr.trim() || r.status}`);
    register(provider);
  }
  getSecret(provider) {
    try { this.#ensure(); } catch { return null; }
    const r = run(["secret-tool", "lookup", "service", SERVICE, "account", provider]);
    return r.status === 0 ? r.stdout.replace(/\n$/, "") || null : null;
  }
  deleteSecret(provider) {
    try { this.#ensure(); run(["secret-tool", "clear", "service", SERVICE, "account", provider]); } finally { unregister(provider); }
  }
  listSecrets() { return listRegistered(); }
}

class UnsupportedKeychainBackend {
  setSecret() { throw new Error(`No safe keychain backend is implemented for ${process.platform}. Set PEBKAC_KEYCHAIN_FILE for test/dev file backend.`); }
  getSecret() { return null; }
  deleteSecret() {}
  listSecrets() { return listRegistered(); }
}

export function getKeychain() {
  if (process.env.PEBKAC_KEYCHAIN_FILE) return new FileKeychainBackend(process.env.PEBKAC_KEYCHAIN_FILE);
  if (process.platform === "darwin" && existsSync("/usr/bin/security")) return new MacKeychainBackend();
  if (process.platform === "linux") return new LinuxKeychainBackend();
  return new UnsupportedKeychainBackend();
}

export function maskKey(key) {
  const tail = key.length >= 4 ? key.slice(-4) : key;
  return tail.padStart(8, "•");
}
