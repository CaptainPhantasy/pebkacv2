import { createHash } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "path";
import { gzipSync, gunzipSync } from "zlib";

function option(args, name) {
  const index = args.indexOf(name);
  if (index >= 0) return args[index + 1];
  const inline = args.find(arg => arg.startsWith(`${name}=`));
  return inline?.slice(name.length + 1);
}

function redact(text) {
  return String(text)
    .replace(/(?:AKIA|ASIA)[A-Z0-9]{16}/g, "[REDACTED_AWS_KEY]")
    .replace(/sk-ant-[A-Za-z0-9_-]{16,}/g, "[REDACTED_ANTHROPIC_KEY]")
    .replace(/sk-[A-Za-z0-9_-]{20,}/g, "[REDACTED_API_KEY]")
    .replace(/Bearer\s+[A-Za-z0-9_\-./+=]{20,}/g, "Bearer [REDACTED_TOKEN]")
    .replace(/(?<=(?:API_KEY|SECRET|TOKEN|PASSWORD|PRIVATE_KEY)\s*[=:]\s*["']?)[A-Za-z0-9_\-./+=]{12,}/gi, "[REDACTED_SECRET]");
}

function inside(parent, child) {
  const rel = relative(resolve(parent), resolve(child));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export async function run({ cwd, args, paths, manifest }) {
  const source = paths.audit;
  if (!existsSync(source)) return { ok: false, summary: `Audit log not found: ${source}` };
  const destinationValue = option(args, "--destination") || process.env.PEBKAC_AUDIT_ARCHIVE_DIR || manifest.configuration?.destination;
  if (!destinationValue) return { ok: false, summary: "Archive destination is not configured. Reinstall with --archive-dir or pass --destination." };
  const destination = resolve(destinationValue);
  if (inside(cwd, destination)) return { ok: false, summary: "Archive destination must be outside the protected project." };

  const raw = readFileSync(source, "utf8");
  const redacted = redact(raw);
  const compressed = gzipSync(Buffer.from(redacted), { level: 9 });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const project = basename(cwd).replace(/[^A-Za-z0-9._-]+/g, "-") || "project";
  const archive = join(destination, project, `${stamp}-audit.jsonl.gz`);
  mkdirSync(dirname(archive), { recursive: true });
  writeFileSync(archive, compressed, { flag: "wx", mode: 0o600 });
  const restored = gunzipSync(readFileSync(archive)).toString("utf8");
  const sha256 = createHash("sha256").update(restored).digest("hex");
  const verified = restored === redacted;
  const metadata = {
    source,
    archive,
    archivedAt: new Date().toISOString(),
    entries: redacted.split("\n").filter(Boolean).length,
    sourceBytes: Buffer.byteLength(raw),
    archivedBytes: compressed.byteLength,
    sha256,
    redacted: redacted !== raw,
    verified,
  };
  writeFileSync(`${archive}.json`, `${JSON.stringify(metadata, null, 2)}\n`, { mode: 0o600 });
  return { ok: verified, summary: verified ? `Archived and verified ${metadata.entries} audit entries.` : "Archive verification failed.", data: metadata };
}
