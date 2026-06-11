# PEBKAC Construction Plan: Realize Claimed Features + Disable Toggle + Next Layer

**Created:** 2026-06-10
**Objective:** Make every PEBKAC claim real — disable toggle, working verbosity, real onboarding, actual harness launch — plus the next layer of capabilities the app should have.
**Estimated steps:** 9
**Parallelism:** Steps 1-3 are independent; Steps 4-7 depend on 1-3; Steps 8-9 depend on 4-7.

---

## Step 1: CLI `off`/`on` Toggle + `PEBKAC_OFF` Env Var

**Why first:** The user's original ask. Unblocks per-session disable without code changes.

**Files changed:**
- `bin/pebkac.js` — add `off`, `on` subcommands
- `.omp/extensions/pebkac-defense.js` — add `PEBKAC_OFF` env var early-exit guard

**Context brief for fresh agent:**
PEBKAC loads as a Bun extension via `.omp/extensions/pebkac-defense.js`. The extension's `pebkacDefenseExtension(pi)` function registers hooks and commands on the `pi` protocol object. There is no disable mechanism today. The CLI (`bin/pebkac.js`) only supports `init` and `status`.

**Implementation:**

1. **`bin/pebkac.js`** — Add two new commands:
   - `pebkac off [--cwd <path>]` — creates `.harness/state/disabled` sentinel file (contains timestamp). Prints confirmation with restore instructions.
   - `pebkac on [--cwd <path>]` — removes `.harness/state/disabled` sentinel file. Prints confirmation.
   - Both commands use existing `optionValue("--cwd", process.cwd())` pattern.

2. **`.omp/extensions/pebkac-defense.js`** — At the very top of `pebkacDefenseExtension(pi)`, before any hook registration:
   ```js
   // Disable check: env var or sentinel file
   if (process.env.PEBKAC_OFF === "1" || process.env.PEBKAC_OFF === "true") {
     pi.setLabel("PEBKAC Harness [DISABLED]");
     return; // no hooks, no commands — completely inert
   }
   ```
   Then in `session_start` handler, add async check for sentinel file:
   ```js
   try {
     const disabledSentinel = path.join(ctx.cwd, ".harness", "state", "disabled");
     const exists = await Bun.file(disabledSentinel).exists();
     if (exists) {
       // Don't register anything else — session is defenseless
       return;
     }
   } catch {}
   ```
   The env-var check is synchronous and runs before hook registration (zero-cost). The sentinel check runs in `session_start` for per-project disable.

**Tests:**
- New `test/disable-toggle.test.js`:
  - `PEBKAC_OFF=1` → extension registers label with `[DISABLED]`, no hooks registered
  - Sentinel file present → `session_start` completes without error, `harness-status` command not registered
  - `pebkac off` → sentinel file created
  - `pebkac on` → sentinel file removed
  - `pebkac on` when already on → no error

**Verification:**
```bash
bun test test/disable-toggle.test.js
PEBKAC_OFF=1 bun test test/smoke.test.js  # should show DISABLED label
```

**Exit criteria:** `pebkac off` / `pebkac on` round-trip works; `PEBKAC_OFF=1` makes extension inert; all existing tests still pass.

**Rollback:** Delete sentinel file or unset env var. No migration needed.

---

## Step 2: Real Verbosity System

**Why:** The app claims `standard`/`minimal` themes but they produce zero visible difference. The `theme` preference is stored and displayed in status but never used to change behavior.

**Files changed:**
- `.omp/extensions/pebkac-defense.js` — `notify()` function, `buildContractSystemPromptLayer()`, `buildFlarePlanningInjection()`, context reminder injection, `harness-status` output

**Context brief for fresh agent:**
The extension has an `onboardingPreferences.theme` field (loaded from `.harness/state/onboarding-preferences.json`) with values `"standard"` or `"minimal"`. Today it's only shown in the `/harness-status` output. The `notify(ctx, prefs, message, level)` function gates on `prefs.notifications` but never on `prefs.theme`. Context reminders are always the full paragraph.

**Implementation:**

Define three verbosity levels (replacing the current two-theme system with a real `verbosity` field):

| Level | `config.yaml` value | Behavior |
|-------|---------------------|----------|
| Full | `verbosity: full` | Current behavior — all blocks, notices, grounding warnings, context reminders, audit logging. System prompt includes full contract layer. |
| Normal | `verbosity: normal` | Blocks and grounding warnings remain. Suppress context reminders unless breaker is open or budget is low. System prompt includes contract but not FLARE planning unless explicitly requested. Audit log still writes. |
| Quiet | `verbosity: quiet` | Only hard blocks (git guard, secrets, circuit breaker open). No grounding warnings, no context reminders, no ceremonial detection notices, no contradiction rewrites. Audit log still writes. `/harness-status` still works. |

1. **Config loading** in `session_start` — parse `defaults.verbosity` from config.yaml. Map to `"full"` | `"normal"` | `"quiet"`. Default `"full"` for backward compatibility. Back-compat: if old `theme: "minimal"` exists, treat as `"normal"`.

2. **`notify()` function** — gate by verbosity:
   - `full`: all messages pass
   - `normal`: suppress `info` level messages, keep `warning`/`error`
   - `quiet`: only `error` level

3. **Context reminder injection** (`context` handler):
   - `full`: current behavior (full reminder paragraph every 10 messages)
   - `normal`: only inject when breaker is open, budget low, or ceremony ratio > 50%
   - `quiet`: never inject

4. **`buildContractSystemPromptLayer()`** — pass verbosity:
   - `full`: full contract text
   - `normal`: abbreviated contract (forbidden behaviors + evidence requirement only)
   - `quiet`: minimal — just "Evidence required for completion claims. Destructive git commands blocked."

5. **`buildGroundingInjection()`**:
   - `full`: full grounding profile
   - `normal`: one-line date reminder only
   - `quiet`: skip entirely

6. **`harness-status` output** — show current verbosity level

**Tests:**
- Extend `test/onboarding-preferences.test.js`:
  - `verbosity: "quiet"` → context handler returns unmodified messages
  - `verbosity: "normal"` → grounding warning suppressed in tool_result
  - `verbosity: "full"` → current behavior unchanged
  - Back-compat: `theme: "minimal"` → treated as `verbosity: "normal"`

**Verification:**
```bash
bun test test/onboarding-preferences.test.js
```

**Exit criteria:** Changing verbosity in config produces measurable behavioral difference in what the extension injects/blocks.

**Rollback:** Remove verbosity config key → defaults to `"full"` (current behavior).

---

## Step 3: Real Onboarding — Make Preferences Functional

**Why:** Onboarding asks for theme/notifications/telemetry/health-checks preferences, but only `notifications` and `telemetry` actually gate behavior. `healthChecks` and `theme` are theatre.

**Files changed:**
- `bin/pebkac.js` — expand onboarding to ask real questions with real effects
- `.omp/extensions/pebkac-defense.js` — wire `healthChecks` to actual behavior
- `.harness/config.yaml` template — add `verbosity` and `enabled` keys

**Context brief for fresh agent:**
CLI `init` writes preferences to `.harness/state/onboarding-preferences.json` with keys `{theme, telemetry, notifications, healthChecks, capturedAt}`. The extension reads these at session start. Today: `telemetry:false` prevents audit log writes (real). `notifications:false` suppresses non-critical UI notifications (real). `healthChecks` does nothing. `theme` does nothing (fixed in Step 2).

**Implementation:**

1. **Make `healthChecks` real** — when `healthChecks: true`:
   - `session_start` writes a `.harness/state/last-health-check.json` with `{ timestamp, configValid, extensionPresent, drivesMounted }` summary
   - `/harness-status` includes a "Health" section showing these checks
   - When `healthChecks: false`: skip health write, suppress health section from status output

2. **Add `verbosity` to onboarding** — CLI `init` now asks (or accepts `--verbosity full|normal|quiet`). Stored in both preferences JSON and written into `config.yaml`.

3. **Add `enabled` to config.yaml template** — `pebkac init` writes `enabled: true` in config.yaml defaults. Extension reads it at session start and honors `enabled: false` as a per-project disable (complements Step 1's sentinel/env-var).

4. **Expand non-interactive init** — accept `--verbosity`, `--enabled`/`--no-enabled` flags. All preferences now have CLI flag counterparts.

5. **Make `capturedAt` real** — set to `new Date().toISOString()` instead of `new Date(0).toISOString()` on init. Use it to detect stale preferences (> 30 days → nudge in status output).

**Tests:**
- Extend `test/cli-onboarding.test.js`:
  - `--verbosity quiet` → config.yaml contains `verbosity: "quiet"`
  - `--no-enabled` → config.yaml contains `enabled: false`
  - Preferences JSON includes real timestamp
- Extend `test/onboarding-preferences.test.js`:
  - `healthChecks: true` → status output includes "Health" section
  - `healthChecks: false` → no health section

**Verification:**
```bash
bun test test/cli-onboarding.test.js test/onboarding-preferences.test.js
```

**Exit criteria:** Every preference key gates real, testable behavior. No preference is theatre.

**Rollback:** New keys default to current behavior. Old config.yaml files without new keys work unchanged.

---

## Step 4: Real Harness Launch (session lifecycle)

**Why:** The extension's `session_start` handler runs file I/O (checkpoint init, audit init, config loading) but never actually attempts to launch or verify a harness runtime. The config says `agent_runtime: "omp"` but the extension doesn't verify OMP is running or attempt to start it.

**Files changed:**
- `.omp/extensions/pebkac-defense.js` — `session_start` handler
- `bin/pebkac.js` — add `launch` subcommand

**Context brief for fresh agent:**
The extension registers hooks on a `pi` protocol object provided by the harness runtime (OMP, Claude Code, etc.). The extension has no way to start a harness — it's loaded BY one. The claim of "launching a harness" is about the CLI providing a way to start an OMP/Claude session with PEBKAC pre-loaded, and the extension verifying its runtime is healthy.

**Implementation:**

1. **Extension: runtime health check** — In `session_start`, after loading config:
   - Verify `ctx.cwd` exists and contains `.omp/extensions/pebkac-defense.js`
   - Verify `.harness/` directory structure is complete
   - Write a `.harness/state/session-health.json` with `{ runtime: "omp"|"claude"|"unknown", startTime, extensionLoaded: true, configValid: boolean }`
   - If health checks fail, log warning to audit log

2. **CLI: `pebkac launch` command** — Starts the configured harness runtime:
   - Read `agent_runtime` from config.yaml
   - If `"omp"`: run `omp --cwd <path>` (or `omp` with appropriate args)
   - If `"claude"`: run `claude --cwd <path>`
   - If `"none"`: print "Standalone mode. No harness to launch."
   - Print clear error if the runtime binary is not found
   - Add `pebkac launch --dry-run` to print what would be launched without executing

3. **CLI: `pebkac doctor` command** — Diagnose setup issues:
   - Check extension file exists
   - Check config.yaml is valid
   - Check harness state directory exists
   - Check for sentinel files (disabled, etc.)
   - Check runtime binary is available (`which omp`, `which claude`)
   - Print pass/fail for each check with fix instructions

**Tests:**
- New `test/launch.test.js`:
  - `launch --dry-run` with `agent_runtime: "omp"` → prints omp command
  - `launch --dry-run` with `agent_runtime: "none"` → prints standalone message
  - `doctor` → reports extension present, config valid
  - `doctor` with missing extension → reports failure with fix

**Verification:**
```bash
bun test test/launch.test.js
```

**Exit criteria:** `pebkac launch --dry-run` prints the correct command. `pebkac doctor` identifies real setup issues.

**Rollback:** New commands don't affect existing behavior.

---

## Step 5: Slash Command to Toggle Mid-Session

**Why:** Steps 1-3 handle pre-session and per-project disable. A power user wants to toggle PEBKAC mid-session without restarting.

**Depends on:** Step 1

**Files changed:**
- `.omp/extensions/pebkac-defense.js` — add `/harness-off` and `/harness-on` commands

**Implementation:**

1. **`/harness-off` command** — Sets module-level `disabled = true`. All subsequent hook handlers short-circuit: `tool_call` returns `{}` (no block), `tool_result` passes through unmodified, `context` returns unmodified messages. `/harness-status` still works and shows "DISABLED (mid-session)". Writes to audit log.

2. **`/harness-on` command** — Sets `disabled = false`. All hooks resume. Writes to audit log.

3. **Guard pattern** — Every hook handler checks `if (disabled) return;` as first line (except `session_start` which is already done, and `harness-status`/`harness-off`/`harness-on` commands which must always work).

**Tests:**
- New `test/mid-session-toggle.test.js`:
  - `/harness-off` then `tool_call` with destructive git → passes through
  - `/harness-on` then `tool_call` with destructive git → blocked
  - `/harness-status` works in both states

**Verification:**
```bash
bun test test/mid-session-toggle.test.js
```

**Exit criteria:** Toggle works mid-session. All guards pass. Audit log records toggle events.

**Rollback:** State is in-memory only. Next session starts clean.

---

## Step 6: Config Hot-Reload

**Why:** Currently config is loaded once at `session_start` and never re-read. Changing config.yaml requires a new session. This is the "next layer up" — once verbosity and disable are config-driven, hot-reload makes them instantly useful.

**Depends on:** Steps 2, 3

**Files changed:**
- `.omp/extensions/pebkac-defense.js` — add config file watcher in `session_start`

**Implementation:**

1. **Watch `.harness/config.yaml`** — Use `fs.watch` on the config file. On change:
   - Re-read and parse config.yaml
   - Apply updated values to module-level state (verbosity, enabled, checkpoint_interval, tool_call_limit, etc.)
   - Log config reload to audit log
   - Do NOT re-register hooks or commands (that would duplicate them)

2. **New `/harness-reload` command** — Manual reload trigger for environments where `fs.watch` doesn't work (some network mounts). Reads config, applies, confirms.

**Tests:**
- New `test/config-hot-reload.test.js`:
  - Change config.yaml verbosity mid-session → next tool_result behavior changes
  - `/harness-reload` → confirms reload
  - Invalid config.yaml → graceful fallback to current values

**Verification:**
```bash
bun test test/config-hot-reload.test.js
```

**Exit criteria:** Config changes take effect without session restart.

**Rollback:** Stop watching. Config stays at last loaded values.

---

## Step 7: Session Summary + Exit Report

**Why:** PEBKAC tracks evidence, ceremony ratio, breaker state, turn budget — but only exposes it via `/harness-status` during the session. When the session ends, all that data evaporates. The "next layer up" is persisting a session report that the next session (or the user) can review.

**Depends on:** Steps 1-4

**Files changed:**
- `.omp/extensions/pebkac-defense.js` — `turn_end` handler (budget exceeded path), add `session_end` concept

**Implementation:**

1. **Write session report on budget exhaustion** — already partially done (checkpoint save). Extend to write a human-readable `.harness/state/session-report.md` with:
   - Task description
   - Evidence count and ceremony ratio
   - Working and failed approaches
   - Breaker trip count
   - Turn budget usage
   - Unresolved items

2. **`/harness-report` command** — Generate the report on demand.

3. **Session report in `session_start`** — If a previous session report exists, inject a summary into the recovery prompt so the new session knows what happened last time.

**Tests:**
- New `test/session-report.test.js`:
  - Budget exhaustion → session-report.md written
  - `/harness-report` → markdown output generated
  - New session with existing report → recovery prompt includes summary

**Verification:**
```bash
bun test test/session-report.test.js
```

**Exit criteria:** Session data survives session end. Next session gets a meaningful handoff.

**Rollback:** Reports are append-only files. No behavioral change.

---

## Step 8: CLI `status` Enhancement — Real Diagnostics

**Depends on:** Steps 3, 4

**Why:** `pebkac status` currently only checks if the extension file and config exist. It should give a real diagnostic picture.

**Files changed:**
- `bin/pebkac.js` — expand `status` command

**Implementation:**

1. **Rich status output:**
   ```
   PEBKAC Harness Status
   =====================
   Extension: present (66.5KB)
   Config: present, agent_runtime=omp, verbosity=full
   State: initialized (2026-06-10)
   Disabled: no
   Checkpoints: 3 files
   Audit log: 1.2MB (1,247 entries)
   Preferences: theme=standard, notifications=on, telemetry=on
   Runtime: omp — found at /usr/local/bin/omp
   Session reports: 2 (latest: 2026-06-09)
   ```

2. **Exit code** — 0 if everything healthy, 1 if issues found (missing extension, invalid config, disabled).

**Tests:**
- Extend `test/cli-onboarding.test.js` or new `test/status-command.test.js`

**Verification:**
```bash
bun test test/status-command.test.js
pebkac status
```

**Exit criteria:** `pebkac status` gives a complete diagnostic picture with actionable information.

**Rollback:** Status is read-only. No risk.

---

## Step 9: Update README + SSOT + CHANGELOG

**Depends on:** Steps 1-8

**Why:** Every feature must be documented accurately. The README claims features that don't exist — this step makes every claim true.

**Files changed:**
- `README.md` — update feature list, add disable/verbosity/launch sections
- `SSOT/pebkac_SSOT.md` — update architecture facts, decisions, verification log
- `Issues/pebkac_ISSUES.md` — record new issues resolved
- `CHANGELOG.md` — add entry
- `FLOYD.md` — update version, build commands if needed
- `bin/pebkac.js` usage string — update with new commands

**Implementation:**
Standard documentation updates. Each feature gets accurate description with usage examples. Remove or qualify any claims that are aspirational rather than implemented.

**Verification:**
```bash
# Verify README examples are accurate (manual review against implementation)
bun test  # full suite passes
```

**Exit criteria:** Every feature claimed in README has corresponding passing tests. No aspirational claims.

**Rollback:** Documentation-only. No risk.

---

## Dependency Graph

```
Step 1 (disable toggle) ─────────────────────┐
Step 2 (verbosity) ───────────────────────────┤
Step 3 (real onboarding) ─────────────────────┤
                                              ├→ Step 5 (mid-session toggle) [depends 1]
                                              ├→ Step 6 (config hot-reload) [depends 2,3]
                                              ├→ Step 7 (session report) [depends 1-4]
Step 4 (harness launch) ──────────────────────┤
                                              ├→ Step 8 (CLI status) [depends 3,4]
                                              └→ Step 9 (docs) [depends 1-8]
```

**Parallel execution:** Steps 1, 2, 3, 4 can all run in parallel. Steps 5-8 can run in parallel after their dependencies. Step 9 is last.

## Model Tier Recommendations

| Step | Model | Reason |
|------|-------|--------|
| 1-3 | default | Mechanical additions to existing patterns |
| 4 | strongest | Requires understanding OMP/Claude runtime protocols |
| 5-7 | default | Follows patterns established in 1-3 |
| 8 | default | CLI output formatting |
| 9 | default | Documentation |

## Rollback Strategy

---

## Adversarial Review Findings (2026-06-10)

Applied during review phase. All critical; must be addressed during implementation.

### R1: Sentinel check placement (Step 1)
The env-var guard at the top of `pebkacDefenseExtension()` blocks ALL hook registration — including `session_start` — so the sentinel file check can't live there. **Fix:** env-var check is synchronous at top (returns early, zero hooks registered). Sentinel file check goes in `session_start` as first action, setting a module-level `disabled` flag that all subsequent hooks short-circuit on. The `session_start` sentinel check must happen before `checkpoint.init()` and `auditLog.init()`.

### R2: `pebkac launch` is CLI-only, not extension (Step 4)
The extension is loaded BY a harness runtime — it cannot and should not launch one. The `launch` CLI command is a standalone convenience only. The extension's `session_start` health check should verify runtime state (extension file present, config valid, directories exist) but never attempt to spawn a process. Keep these concerns strictly separate.

### R3: `fs.watch` is unreliable on external drives (Step 6)
This project lives on `/Volumes/SanDisk1Tb` (USB-mounted). `fs.watch` may return `ENOSYS` or silently fail. **Fix:** `fs.watch` is best-effort wrapped in try/catch. The `/harness-reload` command is the primary mechanism. If watch setup fails, log once to audit and skip.

### R4: Disable priority must be explicit (Steps 1 + 3)
Three disable paths can overlap: env var `PEBKAC_OFF`, sentinel file, config `enabled: false`. **Priority:** `PEBKAC_OFF` env var > sentinel file > config `enabled: false`. Document in README and code comments.

### R5: Existing `loadedConfig` flags are theatre (Step 2 prerequisite)
Lines 1235-1240 set `loadedConfig.evidenceRequired`, `.secretsIsolation`, `.gitGuard`, `.deterministicPrompting` — but NO hook handler checks these flags. The git guard always runs, secrets guard always runs, etc. Before adding verbosity, wire the existing flags to actually gate their guards:
- `loadedConfig.gitGuard === false` → skip `evaluateGitCommand()` in `tool_call`
- `loadedConfig.secretsIsolation === false` → skip `checkSecretExposure()` and `redactSecrets()` in `tool_call`/`tool_result`
- `loadedConfig.evidenceRequired === false` → skip ceremonial detection in `tool_result`
This makes config.yaml's existing keys real before adding new ones.

All changes are additive. No breaking changes to the extension protocol. Old config.yaml files without new keys get sensible defaults. Sentinel files and env vars are removable. Mid-session toggle is in-memory only.
