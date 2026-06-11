# pebkac Issues Ledger
**Created:** 2026-05-12T14:58:53-0400
**Governance:** .supercache/ v1.7.0

---

## Issues Ledger

| ID | Created | Title | Status | Owner | Evidence / Links | Resolution Proof |
|---|---|---|---|---|---|---|
| ISSUE-0001 | 2026-05-24T16:30:00Z | Secret redaction not applied in tool_result handler | Resolved | 0-Main | containsSecrets() detected but never called redactSecrets() — fixed at line 1313 | 11 regression tests pass |
| ISSUE-0002 | 2026-05-24T16:30:00Z | Config YAML parsing missing | Resolved | 0-Main | Added config.yaml loading at session_start with manual regex extraction | 4 config tests pass |
| ISSUE-0003 | 2026-05-24T16:30:00Z | Subagent parsing not wired to checkpoint | Resolved | 0-Main | JSON + heuristic fallback parsing, checkpoint persistence | 5 subagent tests pass |
| ISSUE-0004 | 2026-05-24T16:30:00Z | Circuit breaker recovery path incomplete | Resolved | 0-Main | harness-status command triggers halfOpen(); resetEscalation on evidence | 3 breaker/escalation tests pass |
| ISSUE-0005 | 2026-05-24T16:30:00Z | Checkpoint not saved on contract creation | Resolved | 0-Main | Added checkpoint.save() in before_agent_start after setCurrentTask/setItemStatus | Test passes |
| ISSUE-0007 | 2026-06-10T12:00:00Z | No disable mechanism for PEBKAC | Resolved | 0-Main | Added PEBKAC_OFF env var, sentinel file, config enabled:false, CLI off/on, mid-session /harness-off / /harness-on | 21 new tests pass |
| ISSUE-0008 | 2026-06-10T12:00:00Z | Verbosity levels are theatre — no behavioral difference | Resolved | 0-Main | Three real levels (full/normal/quiet) that gate notify(), context reminders, grounding warnings, contract prompt, ceremony detection | Verbosity tests pass |
| ISSUE-0009 | 2026-06-10T12:00:00Z | Onboarding preferences healthChecks/theme are theatre | Resolved | 0-Main | healthChecks gates session-health.json write and status section; theme maps to verbosity; capturedAt uses real timestamp | Onboarding pref tests pass |
| ISSUE-0010 | 2026-06-10T12:00:00Z | loadedConfig flags set but never checked | Resolved | 0-Main | gitGuard, secretsIsolation, evidenceRequired now gate their respective guards in tool_call/tool_result | Config flags tests pass |
| ISSUE-0011 | 2026-06-10T12:00:00Z | No harness launch or diagnostic command | Resolved | 0-Main | Added pebkac launch --dry-run and pebkac doctor CLI commands | Launch/doctor tests pass |
| ISSUE-0012 | 2026-06-10T12:00:00Z | No mid-session toggle for PEBKAC | Resolved | 0-Main | /harness-off and /harness-on set module-level flag all hooks check; audit-logged | Mid-session toggle test passes |
| ISSUE-0013 | 2026-06-10T12:00:00Z | Config changes require session restart | Resolved | 0-Main | fs.watch on config.yaml (best-effort) + /harness-reload command for manual reload | Config reload test passes |
| ISSUE-0014 | 2026-06-10T12:00:00Z | Session data lost between sessions | Resolved | 0-Main | Session report writes to .harness/state/session-report.md; next session recovery prompt includes previous report summary | Session report test passes |
| ISSUE-0006 | 2026-05-24T16:30:00Z | heartbeat.sh broken syntax | Resolved | 0-Main | Missing closing parenthesis in path resolution logic | Verified with bash -n; runs correctly |

---

## Change Log (append-only)

- 2026-05-12T14:58:53-0400 — Initialized issues ledger.
- 2026-06-10T12:00:00Z — ISSUE-0007 through ISSUE-0014 resolved. 63 tests passing. All claimed features now real and tested.
- 2026-05-24T16:30:00Z — All E2E refactoring items resolved. 35 tests passing. Extension at 1798 lines. Full test coverage across smoke, redaction, config, subagent, breaker-escalation, pipeline, turn-budget.