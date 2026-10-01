import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "fs";
import { join } from "path"; import { tmpdir } from "os";
import { installPlatforms } from "../lib/platforms.js";
test("malformed existing Codex manifest stays intact", () => {
 const sandbox=mkdtempSync(join(tmpdir(), "pebkac-manifest-"));
 const prior=process.env.PEBKAC_CODEX_HOME; process.env.PEBKAC_CODEX_HOME=sandbox;
 const file=join(sandbox, "hooks.json"); writeFileSync(file,"{broken");
 try { expect(() => installPlatforms(sandbox, process.cwd(), "codex")).toThrow("refusing to replace"); expect(readFileSync(file,"utf8")).toBe("{broken"); }
 finally { process.env.PEBKAC_CODEX_HOME=prior; rmSync(sandbox,{recursive:true,force:true}); }
});
test("init installs only project integration surfaces", () => {
 const cwd=mkdtempSync(join(tmpdir(), "pebkac-init-"));
 try { const r=Bun.spawnSync({cmd:["bun","bin/pebkac.js","init","--non-interactive","--yes","--cwd",cwd],env:{...process.env,PEBKAC_CODEX_HOME:join(cwd,"must-not-exist")}}); expect(r.exitCode).toBe(0); expect(readFileSync(join(cwd,".harness/config.yaml"),"utf8")).toContain("platforms: project"); }
 finally { rmSync(cwd,{recursive:true,force:true}); }
});
