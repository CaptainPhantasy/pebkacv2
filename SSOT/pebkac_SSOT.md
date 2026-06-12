# pebkac SSOT (Single Source of Truth)
**Created:** 2026-05-12T14:58:53-0400
**Last Updated:** 2026-05-24T16:30:00Z
**Governance:** .supercache/ v1.7.0

> **Compliance Notice:** This file must match the structure at
> `.supercache/templates/ssot-template.md`. This is the authoritative
> document for architecture and programmatic change facts of **pebkac**.

---

## Authority

This document is the **single source of truth** for architecture and programmatic change facts of pebkac. All other documents must be treated as **potentially flawed** unless their facts are confirmed here.

When a fact in any other document contradicts this SSOT, the SSOT wins. If the SSOT itself is wrong, it is corrected via the **Verification Sweep Protocol** below, not by editing other documents to match.

---

## Verification Sweep Protocol (required on every read)

When an agent reads this SSOT to perform a task:

1. Perform a **line-by-line verification review** of the sections relevant to the current task.
2. For each verified fact, append a verification entry to the **Verification Log** at the bottom of this file with:
   - Timestamp (`YYYY-MM-DD HH:MM TZ`)
   - Section/line reference
   - Evidence source (code path + line, command + output, build log, runtime behavior, etc.)
   - Confidence = 100%
3. If any fact cannot be verified to 100% confidence:
   - Mark it **UNVERIFIED** inline in the section where it appears
   - Add an entry to `Issues/pebkac_ISSUES.md` to track the discrepancy
   - Do NOT proceed on the assumption that the fact is true

### Positive Reinforcement (required)

For each fact verified at 100% confidence during a sweep, emit the acknowledgement:

```
Verified as fact (100%): <fact summary>
```

This pattern is deliberate — it reinforces evidence-first thinking and makes the verification record auditable after the fact.

---

## Current State

**Phase:** Active development
**Status:** Active
**Last Agent Session:** 2026-05-24T16:30:00Z

---

## Architecture Facts

### Stack

- **Primary language**: JavaScript (Bun native ESM)
- **Framework**: None — defense extension for OMP harness
- **Runtime**: Bun 1.3+ (bundled @bun)
- **Module system**: ESM

### Key architectural choices

1. **Single bundled extension**: `.omp/extensions/pebkac-defense.js` contains all modules (DefenseLayers, ConversationInterceptor, SafetyBoundary, etc.)
2. **Module-level state**: toolCallsThisTurn, consecutiveBlocks, recentToolCalls, breaker — reset at turn_start for isolation
3. **CheckpointManager**: persists session state to `.harness/checkpoints/latest.json` via Bun.write(); tick() drives interval-based saves
4. **Circuit breaker pattern**: breaker tracks degradation score at turn_end; evidence via tool_result closes circuit
5. **Secret redaction**: redactSecrets() called at tool_result (line 1313); containsSecrets() detected but never called the redact function — fixed

---

## Key Decisions

| Date | Decision | Rationale | Decided By |
|---|---|---|---|
| 2026-05-24T16:30:00Z | Added config.yaml parsing for checkpoint_interval, turn_budget, escalation_threshold, git_guard | Config-driven behavior enables runtime tuning without code changes | 0-Main agent |

---

## Dependencies

| Dependency | Version | Purpose | Criticality |
|---|---|---|---|
| @bun/bundler | 1.3+ | Module bundling for single-file extension | critical |

---

## Deployment

| Environment | URL / Location | Status | Last Deploy |
|---|---|---|---|
| production | github.com/CaptainPhantasy/pebkacv2 | Active | N/A |

---

## Known Patterns & Lessons

| Pattern | Trigger | Fix | Confidence |
|---|---|---|---|
| Edit tool corrupts lines | Multiple anchor ops on adjacent lines | Use python3 to rewrite entire file section | 1.0 |
| Config parsing with heredoc | writeConfig() produced JSON not YAML | Use writeYamlConfig() with template literal | 1.0 |
| Checkpoint not created | Budget exhaustion saves don't trigger turn_end tick() | Added explicit checkpoint.save() in before_agent_start | 1.0 |

---

## Verification Log (append-only)

| Timestamp | Section / Line | Fact Verified | Evidence Source | Confidence |
|---|---|---|---|---|
| 2026-05-12T14:58:53-0400 | Authority | Document initialized as SSOT | bootstrap.sh --init created from template | 100% |
| 2026-05-24T16:30:00Z | Stack | Extension uses ESM, Bun runtime | .omp/extensions/pebkac-defense.js:1-45 | 100% |
| 2026-05-24T16:30:00Z | Key arch choices | Single bundled extension | find . -name "*.js" .omp/ | 100% |
| 2026-05-24T16:30:00Z | Key arch choices | CheckpointManager with tick() | .omp/extensions/pebkac-defense.js:114-128 | 100% |
| 2026-05-24T16:30:00Z | Key arch choices | Circuit breaker pattern | .omp/extensions/pebkac-defense.js:1051-1080 | 100% |
| 2026-05-24T16:30:00Z | Key arch choices | Secret redaction at tool_result | .omp/extensions/pebkac-defense.js:1313 | 100% |
| 2026-05-24T16:30:00Z | Key arch choices | Config YAML parsing | .omp/extensions/pebkac-defense.js:1174-1196 | 100% |
| 2026-05-24T16:30:00Z | Tests | 35 tests passing across 7 test files | bun test output | 100% |

---

## Change Log (append-only)

- 2026-05-12T14:58:53-0400 — Initialized SSOT.
- 2026-05-24T16:30:00Z — E2E refactoring complete. Added: secret redaction fix, config loading from YAML, subagent parsing, breaker/escalation, pipeline persistence, turn budget. heartbeat.sh fixed for project-local path resolution. 35 tests passing.

---

## Mandatory execution contract

For EACH requested item:
1) Show exact action taken
2) Show direct evidence (file/line/command/output)
3) Show verification result
4) Mark status only after proof

## Forbidden behaviors

- Declaring "done" without evidence
- Collapsing multiple requested items into one vague summary
- Skipping failed steps without explicit blocker report

## Required output structure

A) Requested items checklist
B) Per-item evidence ledger
C) Verification receipts
D) Completeness matrix (item -> done/blocked -> evidence)

## Hard gate

If any requested item has no evidence row, final status MUST be INCOMPLETE.