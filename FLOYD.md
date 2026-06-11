# pebkac — FLOYD.md
**Version:** 1.7.0
**Initialized:** 2026-05-12T14:58:53-0400
**Governance:** .supercache/ v1.7.0
**Port:** {{PORT}} (claimed in port-registry.json)
**Drive:** {{DRIVE}}
**Path:** /Volumes/SanDisk1Tb/pebkac

---

## Agent Contract

You are working on **pebkac**, a Legacy AI project.

**This file (`FLOYD.md`) is the canonical project spec.** It is authoritative for project identity, stack, ports, build commands, environment variables, and project-specific rules. All agents — Floyd, Claude, or any model routed through the OhMyFloyd harness — read this file first.

### Before You Start
1. Read this file completely.
2. Read `SSOT/pebkac_SSOT.md` for current project state.
3. Read `Issues/pebkac_ISSUES.md` for open issues and blockers.
4. Read `.supercache/manifests/port-allocation-policy.yaml` — NEVER use forbidden ports.

### Governance Location
```
.supercache/ → /Volumes/SanDisk1Tb/.supercache
```
This directory is **READ-ONLY**.

### Where You Write

| Location             | Purpose                                          |
|----------------------|--------------------------------------------------|
| `SSOT/`              | Project status, decisions, findings, verification |
| `Issues/`            | Bugs, blockers, tasks, help-desk ledger          |
| `.floyd/`            | Agent working state, session logs, runtime cache |
| `.omp/`              | Extension source code                            |
| Project source files | Your actual work                                 |

### Where You Do NOT Write

| Location          | Reason                                       |
|-------------------|----------------------------------------------|
| `.supercache/`    | Global governance — READ-ONLY for all agents |

---

## Project Identity

| Field                | Value                                                                   |
|----------------------|-------------------------------------------------------------------------|
| **Name**             | pebkac                                                        |
| **Purpose**          | Defense harness for OMP agent — blocks destructive commands, enforces evidence standards, redacts secrets, manages turn budget |
| **Primary Language** | JavaScript (Bun native ESM)                                         |
| **Runtime**          | Bun 1.3+                                                         |
| **Module System**    | ESM                                                               |
| **Framework**        | None — defense extension for OMP harness                             |
| **Port**             | **{{PORT}}** — claimed in `/Volumes/SanDisk1Tb/SSOT/port-registry.json` |
| **Repository**        | github.com/CaptainPhantasy/pebkacv2                                |
| **Current Phase**    | Active development                                                 |

---

## Project Structure

```
pebkac/
├── .omp/extensions/           # Extension source
│   └── pebkac-defense.js    # Main defense extension (1798 lines)
├── .harness/                  # Harness config and state
│   ├── automation/             # Automation scripts
│   │   └── heartbeat.sh       # Heartbeat monitor (FIXED)
│   ├── config.yaml            # Config defaults
│   ├── checkpoints/            # Session checkpoint files
│   └── state/                  # Runtime state
├── test/                       # Test suite (35 tests passing)
│   ├── smoke.test.js           # Extension registration tests
│   ├── redaction.test.js       # Secret redaction tests
│   ├── config.test.js          # Config loading tests
│   ├── subagent.test.js        # Subagent parsing tests
│   ├── breaker-escalation.test.js  # Breaker/escalation tests
│   ├── pipeline.test.js          # Pipeline persistence tests
│   └── turn-budget.test.js      # Turn budget tests
├── SSOT/                       # Project status and decisions
├── Issues/                      # Bug and task tracking
└── FLOYD.md                    # This file
```

---

## Build & Verify Commands

| Action         | Command                                | Expected Result             |
|----------------|----------------------------------------|-----------------------------|
| **Test**       | `bun test`                            | Exit 0, all tests pass      |
| **Lint**       | `bun run lint` (if configured)         | N/A — no lint configured    |
| **Dev**        | `bun run dev` (if configured)           | N/A — extension runs in harness |

### Verification sequence after any change
```bash
bun test
```

---

## Known Patterns & Lessons

| Pattern                     | Trigger                                  | Fix                                                   | Confidence       |
|-----------------------------|------------------------------------------|-------------------------------------------------------|------------------|
| Edit tool corrupts lines | Multiple anchor ops on adjacent lines | Use python3 to rewrite entire file section | 1.0 |
| Config parsing with heredoc | writeConfig() produced JSON not YAML | Use writeYamlConfig() with template literal | 1.0 |
| Checkpoint not created | Budget exhaustion saves don't trigger turn_end tick() | Add explicit checkpoint.save() in before_agent_start | 1.0 |

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
