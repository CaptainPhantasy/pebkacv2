# pebkac — Code Review
**Date:** 2026-06-17
**Reviewer:** 0-Main agent
**Scope:** Full source tree (lib/, bin/, .omp/extensions/)
**Method:** Line-level read of all source + test execution

---

## Scope and Method

Read every source file in `lib/` (7 files, 909 lines), `bin/pebkac.js` (375 lines), and the bundled `.omp/extensions/pebkac-defense.js` (1812 lines). Ran the full test suite. Findings below are evidence-cited with file:line.

## Metrics

| Metric | Value | Source |
|---|---|---|
| Source files | 9 (lib/ + bin/) | `wc -l lib/*.js bin/*.js` |
| Source lines | 1284 (lib+bin) + 1812 (extension) = 3096 | `wc -l` |
| Test files | 16 | `find test -name "*.test.js"` |
| Test lines | 3274 | `wc -l test/*.test.js` |
| Tests passing | 200 / 0 fail | `bun test` 2026-06-17 |
| expect() calls | 609 | `bun test` output |
| TODO/FIXME/HACK | 0 | `grep` in lib/ bin/ |
| Test:source ratio | 1.06:1 (3274:3096) | derived |

## Findings

### F1 — Duplicate `CONTENT_BEARING_TOOLS` declaration (low)
**Location:** `.omp/extensions/pebkac-defense.js:1105` and `:1195`
**Issue:** `CONTENT_BEARING_TOOLS` is declared with `var` twice. The second declaration (line 1195, inside the `index.ts` bundling boundary) shadows the first (line 1105, evidence-dedup module). Both are identical `new Set(["write", "edit", "notebook"])`, so behavior is unaffected, but the duplicate is sloppy and indicates the bundler concatenation didn't deduplicate a shared constant.
**Severity:** Low — benign, no runtime impact.
**Recommendation:** Remove the declaration at line 1195; the module-scope one at 1105 is sufficient.

### F2 — Regex-based YAML parsing (medium)
**Location:** `.omp/extensions/pebkac-defense.js:1222-1232` (`parseConfigYaml`)
**Issue:** Config YAML is parsed via two regexes (`defaults:` block extraction + per-line `kv` match). This handles the simple flat `defaults:` structure in `.harness/config.yaml` but will silently misparse nested keys, quoted values with colons, multiline values, or comments. The regex `/(?:\n\S|\n*$)/` for block termination is fragile.
**Severity:** Medium — config drift could cause silent misconfiguration. Current config is flat enough that it works.
**Recommendation:** Acceptable for now given the flat config shape; document the constraint in FLOYD.md. If config grows nested keys, switch to a real parser.

### F3 — Silent empty catch blocks (medium)
**Location:** `.omp/extensions/pebkac-defense.js:1296, 1317, 1339, 1364, 1366` and others
**Issue:** Multiple `catch {}` blocks swallow errors with no logging. Examples: `writeSessionReport` (1296), sentinel check (1317), health write (1339), config watcher (1364-1365). These are explicitly best-effort paths, but silent swallowing means a real failure (disk full, permissions) is invisible.
**Severity:** Medium — masks operational failures in exactly the paths that matter for resilience.
**Recommendation:** At minimum, append failures to the audit log (`auditLog.append`) even when not surfacing to the user. The infrastructure exists.

### F4 — `new CircuitBreaker` without parentheses (low, style)
**Location:** `.omp/extensions/pebkac-defense.js:1107`
**Issue:** `const breaker = new CircuitBreaker;` omits the invocation parens. Valid JS, but unconventional and inconsistent with `new EvidenceEnforcer` (1304), `new CheckpointManager(ctx.cwd)` (1305), `new AuditLog(ctx.cwd)` (1306) which all use parens elsewhere in the same function.
**Severity:** Low — style inconsistency only.
**Recommendation:** Add parens for consistency: `new CircuitBreaker()`.

### F5 — No CI workflow (medium)
**Location:** Absent — `.github/workflows/` not found in repo tree
**Issue:** Tests pass locally (`bun test`: 200/0) but there's no automated CI gate. The 200-test suite runs only when a human remembers. Given this project's own thesis is enforcement of execution contracts, the absence of CI on itself is a gap.
**Severity:** Medium — regression risk on any contribution.
**Recommendation:** Add `.github/workflows/test.yml` running `bun test` on push/PR. Minimal: install Bun, run test.

### F6 — Bundled single-file extension is hard to edit safely (low, structural)
**Location:** `.omp/extensions/pebkac-defense.js` (1812 lines, 20+ modules concatenated)
**Issue:** The extension is a Bun-bundled artifact with `// @bun` marker and `// packages/pebkac-harness/src/core/*.ts` source-path comments. Edits to the bundled file are edits to generated output — the real source is the `packages/pebkac-harness/src/core/` TypeScript tree, which is not present in this repo. A maintainer editing the bundle directly risks losing changes on the next bundle.
**Severity:** Low for runtime correctness (the bundle works), but a trap for future maintainers.
**Recommendation:** Add a note to FLOYD.md: the bundled extension is generated; the source-of-truth is the `packages/pebkac-harness` tree (external). Do not hand-edit the bundle except for emergencies.

## What Works Well

- **Real enforcement, not theatre:** The verbosity levels (full/normal/quiet) genuinely gate `notify()`, context reminders, and grounding warnings — verified in the hook bodies (1281-1286, 1581-1587). ISSUE-0008 through ISSUE-0014 confirm prior theatre was fixed.
- **Defense in depth is coherent:** L1 (contract) → L2 (evidence) → L3 (guards) → L4 (checkpoint/budget) layers compose cleanly in the `tool_call`/`tool_result` hooks (1459-1567). Each guard returns a block reason; each is independently configurable.
- **Secrets redaction is single-pass and correct:** `tool_result` calls `redactSecrets(text)` once and checks the return value (1515) — the old `containsSecrets()`-without-`redactSecrets()` bug (ISSUE-0001) is fixed.
- **Test coverage is strong for the surface:** 200 tests across 16 files covering smoke, redaction, config, subagent, breaker-escalation, pipeline, turn-budget, CLI, onboarding, API keys, ops commands.
- **Disable paths are comprehensive:** `PEBKAC_OFF` env, sentinel file, config `enabled:false`, CLI `off`/`on`, mid-session `/harness-off` `/harness-on` — five independent disable vectors (ISSUE-0007).

## Summary

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 3 (F2, F3, F5) |
| Low | 3 (F1, F4, F6) |

**Verdict:** Production-acceptable for an internal tool. No blocking issues. The three medium findings (regex YAML, silent catches, no CI) are worth addressing but none prevent reliable operation today. The codebase does what it claims and the test suite proves it.
