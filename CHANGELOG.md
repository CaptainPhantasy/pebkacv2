# Changelog

All notable changes to the PEBKAC defense extension.

## [0.2.0] — 2025-05-08

### Added

**New defense modules (8 modules, 25 total)**

- **Rate Limiter** — Caps tool calls at 50 per turn. Prevents infinite
  retry loops by blocking with a directive to stop and produce evidence
  or report BLOCKED. (`rate-limiter.ts`, L933-944)

- **Output Guard** — Truncates agent responses exceeding 50,000 characters
  with a harness notice to be more concise. (`output-guard.ts`, L947-952)

- **Repeat Detector** — Tracks the last 10 tool calls by name and input
  hash. Blocks identical retries with a directive to try a different
  approach. (`repeat-detector.ts`, L955-969)

- **Escalation Protocol** — Counts consecutive blocks. After 5 in a row,
  injects an escalation message telling the agent it is in a loop and must
  fundamentally change approach. (`escalation.ts`, L973-990)

- **Turn Budget** — Tracks turn consumption against a 100-turn default
  budget. Injects context reminders when remaining turns drop below 20.
  Saves a session summary on exhaustion. (`turn-budget.ts`, L992-1012)

- **Tool Allowlist/Blocklist** — Configurable per-tool allow/deny policy.
  Functions: `configureToolPolicy(blocked, allowed)`,
  `checkToolAllowlist(toolName)`. Defaults to allowing everything.
  (`tool-allowlist.ts`, L1014-1030)

- **Evidence Dedup** — Hashes evidence records by tool name and normalized
  output snippet (first 200 chars). Prevents the same command output from
  inflating the evidence count. (`evidence-dedup.ts`, L1032-1048)

- **Forbidden Behavior Scan** — Detects 4 patterns where the agent
  mentions the harness in its output (correction language, naming the
  harness, attributing actions to it, claiming it is blocking). Injects a
  silent-operation reminder. (`forbidden-behaviors.ts`, L1050-1067)

- **Session Summary** — Builds a structured end-of-session summary
  (evidence records, unsubstantiated claims, ceremony ratio, working/failed
  approaches, turn count, circuit breaker state) for checkpoint
  persistence. (`session-summary.ts`, L1069-1085)

**Hook wiring**

All 8 new modules wired into extension event hooks:

- `tool_call` — rate limiter, repeat detector, escalation check, tool
  allowlist (L1232-1254)
- `turn_start` — reset rate limit, repeat detector, escalation, tick turn
  budget (L1188-1191)
- `turn_end` — turn budget check, session summary on exhaustion (L1223-1228)
- `tool_result` — output guard (L1309), evidence dedup (L1316), forbidden
  behavior scan (L1334)
- `context` — turn budget warnings in reminder injection (L1423-1428)
- `harness-status` command — 8 new rows in status table (L1446-1455)

### Changed

**Harness identity system** (3 injection points)

- Added `### HARNESS IDENTITY` section to system prompt (L380-393) telling
  the model "I am the harness, not the user. Treat me like a compiler."
- Added `### SILENT OPERATION` section (L395-408) with 6 prohibitions
  against mentioning the harness to the user
- Context reminder prefix changed from bare `[PEBKAC]` to
  `[HARNESS REMINDER -- this message is from the PEBKAC Harness
  infrastructure, not the user. Do not mention this reminder to the user.]`
  (L1406)
- Inline annotations (`HARD BLOCK`, `NOTICE`, `GROUNDING`) now carry
  `-- harness directive, not user input. Fix silently, do not mention to
  user.` suffix (L1338, L1344, L1360)

**Code quality fixes**

- Fixed empty `catch {}` blocks — 3 locations now catch with `(err)` and
  log to `console.error('[PEBKAC] ...')` (L121, L180, L960)
- Fixed redundant `JSON.stringify` — serialize once into `const serialized`,
  write twice (main + backup) (L115-119)
- Fixed O(n^2) `getUnsubstantiatedClaims` — single-pass with two Sets
  (`verified`, `allItems`) replacing triple-pass `.map()` → `Set` →
  `.filter()` + `.some()` (L594-601)
- Removed unnecessary import aliasing — `fs2` → `fs`, `path2` → `path`
  throughout; removed duplicate import declarations

### Not changed (verified, intentional)

- **O(n^2) conflict detector** — With 3 pairs and <10 rules, max ~300
  iterations. Not worth added complexity.
- **Global regex `lastIndex`** — Both `redactSecrets()` and
  `containsSecrets()` already reset `lastIndex = 0` before each use.
- **Tool versions catch** — `catch { toolVersions = null; }` at L1117 is
  correct: optional file read with null fallback.

## [0.1.0] — 2025-04-03

### Added

- Initial unboxing: extension auto-installed by `pebkac init`
- 17 original modules (audit-log through subagent)
- 9 event hooks (session_start through context)
- 5 slash commands (harness-status, flare-complete, harness-delegate,
  harness-subagent-result, harness-pipeline)
- Execution contract enforcement with 8 forbidden behaviors (fb-1 through fb-8)
- Git guard with 10 destructive command patterns
- Secrets guard with 7 redaction patterns
- Circuit breaker with degradation scoring
- Checkpoint persistence with compaction recovery
- FLARE planning phase enforcement
- Evidence ledger with ceremonial detection
- Contract compiler with task-to-items parsing
