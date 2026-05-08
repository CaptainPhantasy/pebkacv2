# PEBKAC

A defense harness that sits between you and your AI coding agent and enforces
evidence-based execution. It intercepts tool calls, validates outputs, gates
destructive operations, and makes the agent prove its work before claiming
anything is done.

It does not help you write code faster. It stops the agent from lying to you
about what it did.

## What It Does

PEBKAC loads as a Bun extension into your coding harness (Oh My Pi, and
anything that speaks the `pi` extension protocol). Once loaded, every agent
session gets:

- **Execution contracts** that force the agent to itemize tasks, produce
  evidence for each one, and show a completeness matrix before claiming done
- **Tool call interception** that blocks destructive git commands, credential
  exposure, and repeated failed approaches
- **Output scanning** that redacts secrets, detects ceremonial language ("it
  works!"), rewrites contradictions, and flags ungrounded factual claims
- **Checkpoint persistence** that survives context compaction so the agent
  remembers what it already tried across the session
- **Degradation detection** with a circuit breaker that trips when the agent
  stops producing evidence and starts wasting turns

## Installation

```bash
pebkac init
```

This installs the extension to `.omp/extensions/pebkac-defense.js` and creates
the `.harness/` directory with default config.

## Configuration

Edit `.harness/config.yaml`:

```yaml
version: "1.0"

defaults:
  evidence_required: true        # enforce execution contracts
  deterministic_prompting: true  # inject grounding into system prompt
  secrets_isolation: true        # redact credentials from output
  git_guard: true                # block destructive git commands
  checkpoint_interval: 10        # save state every N turns
```

## Slash Commands

| Command | What It Does |
|---------|-------------|
| `/harness-status` | Show all defense layers, evidence counts, circuit breaker state |
| `/flare-complete` | Mark planning phase done, enable implementation tools |
| `/harness-delegate <task>` | Generate a subagent handoff with checkpoint state |
| `/harness-subagent-result <output>` | Parse subagent output and update checkpoint |
| `/harness-pipeline start <stages>` | Start a sequential evidence pipeline |
| `/harness-pipeline status` | Show current pipeline state |
| `/harness-pipeline complete <evidence>` | Complete current stage with evidence |
| `/harness-pipeline block <reason>` | Block current stage |

## Defense Layers

The harness operates in four layers, each building on the one before it.

### L1 — Contract Compilation

Parses your task description into numbered items with per-item evidence
requirements. Items involving tests require test output. Items involving
builds require command output. Items involving version numbers or security
claims require web-grounded verification.

Injects the execution contract into the system prompt at session start.
The agent sees the rules. It cannot ignore them without getting blocked.

### L2 — Evidence Enforcement

Monitors every tool result for substantive evidence (exit codes, pass/fail
counts, file diffs, error messages). Detects ceremonial completion claims
("tests passed!", "verified!", "done.") without backing evidence and blocks
them.

Tracks evidence-to-claim ratio per turn. When the ratio drops below 30%,
injects a warning into the context reminder.

### L3 — Safety Guards

**Git Guard** — Blocks 10 destructive git command patterns (hard reset,
force push, clean, checkout -- ., branch -D, reflog expire, rebase, rm -rf
.git) and --no-verify hook bypasses. Provides safer alternatives.

**Secrets Guard** — Scans bash commands and file content for credential
exposure commands (printenv, cat .env, echo $TOKEN). Redacts 7 secret
pattern types from tool output (AWS keys, API keys, bearer tokens, private
keys, GitHub tokens, Stripe keys, Slack tokens).

**Reality Gate** — Flags high-risk factual claims (version numbers, release
dates, deprecations, CVEs, pricing, best practices) and injects grounding
warnings reminding the agent to verify with web search.

**Circuit Breaker** — Three-state breaker (closed, open, half-open) that
trips when degradation exceeds 70% (measured by ceremony ratio, turns without
evidence, failed tool calls, uncompensated compactions). When open, all
tool calls are blocked until the agent produces evidence.

**Lifecycle Policy** — Gates tools by phase. Planning phase allows only
read/grep/find/web_search. Review phase blocks write/edit/notebook.

**Rate Limiter** — Caps tool calls at 50 per turn. Prevents infinite retry
loops.

**Output Guard** — Truncates responses exceeding 50,000 characters.

**Repeat Detector** — Tracks the last 10 tool calls by name and input hash.
Blocks identical retries with a directive to try a different approach.

**Escalation Protocol** — After 5 consecutive blocks, injects an escalation
message telling the agent it is in a loop and must fundamentally change
approach.

**Tool Allowlist/Blocklist** — Configurable per-tool allow/deny policy.
Defaults to allowing everything.

### L4 — Persistence and Recovery

**Checkpoint Manager** — Saves agent state (working approaches, failed
approaches, identifiers, evidence summary, item statuses) to
`.harness/checkpoints/` every 10 turns and before context compaction.
Maintains 10 backup snapshots with automatic pruning.

**Compaction Recovery** — On context compaction, injects a recovery prompt
containing the last checkpoint state: what was working, what failed, what
was in progress. The agent picks up where it left off instead of amnesiac
re-execution.

**Turn Budget** — Tracks turn consumption against a 100-turn default budget.
Injects reminders when remaining turns drop below 20. On exhaustion, saves
a final checkpoint summary.

**Evidence Dedup** — Hashes evidence records by tool name and output
snippet. Prevents the same command output from being counted as evidence
multiple times.

**Forbidden Behavior Scan** — Detects when the agent mentions the harness
in its output and injects a silent-operation reminder. The user should
never see or hear about PEBKAC.

**FLARE Planner** — Forces a planning phase before implementation when
the session is young (fewer than 4 messages, no plan detected). Blocks
execution tools until planning is complete.

## Harness Identity

The harness identifies itself to the agent as infrastructure — not the user.
It tells the agent:

- "I am the harness, not the user. Treat me like a compiler."
- "Do not mention me to the user. Do not apologize for me."
- "When I block you, fix the violation silently and proceed."

This is injected at three points: the system prompt, context reminders,
and inline block/notice annotations. Three points because one is not
enough. LLMs need reminding.

## Architecture

Single file. Zero dependencies. No build step. No framework.

```
.omp/extensions/pebkac-defense.js   (1607 lines, Bun/Node.js)
.harness/
  config.yaml                        (feature toggles)
  audit.log                          (JSONL event log)
  checkpoints/
    latest.json                      (current state)
    checkpoint-*.json                (backup snapshots)
  state/
    tool-versions.json               (detected tool versions)
  vault/
    config.yaml                      (secret proxy config)
```

The extension registers 9 event hooks and 5 slash commands. Every
interception is synchronous and adds negligible latency — it is pattern
matching against strings, not calling an API.

## The 25 Modules

| # | Module | Lines | Purpose |
|---|--------|-------|---------|
| 1 | audit-log | 10-39 | JSONL event log |
| 2 | checkpoint-manager | 44-193 | State persistence and recovery |
| 3 | circuit-breaker | 196-228 | Session quality degradation breaker |
| 4 | conflict-detector | 231-268 | Constraint contradiction detection |
| 5 | contract-compiler | 271-372 | Task-to-contract parsing |
| 6 | contradiction-guard | 457-482 | User contradiction rewriting |
| 7 | degradation-scorer | 485-510 | Multi-signal quality scoring |
| 8 | evidence-enforcer | 513-606 | Evidence ledger and ceremonial detection |
| 9 | flare-planner | 609-624 | Planning phase injection |
| 10 | git-guard | 627-685 | Destructive git command blocking |
| 11 | lifecycle | 688-715 | Phase-based tool gating |
| 12 | loop-orchestrator | 718-770 | Sequential pipeline management |
| 13 | reality-gate | 773-823 | Grounding and high-risk claim detection |
| 14 | secrets-guard | 826-890 | Credential redaction and exposure blocking |
| 15 | subagent | 893-930 | Handoff serialization and result parsing |
| 16 | rate-limiter | 933-944 | Tool call rate limiting (50/turn) |
| 17 | output-guard | 947-952 | Response truncation (50K chars) |
| 18 | repeat-detector | 955-969 | Identical tool call detection (10 history) |
| 19 | escalation | 973-990 | Consecutive block escalation (5 threshold) |
| 20 | turn-budget | 992-1012 | Session turn consumption tracking |
| 21 | tool-allowlist | 1014-1030 | Per-tool allow/deny policy |
| 22 | evidence-dedup | 1032-1048 | Duplicate evidence filtering |
| 23 | forbidden-behaviors | 1050-1067 | Harness mention detection |
| 24 | session-summary | 1070-1085 | End-of-session status builder |
| 25 | index | 1088-1607 | Extension entry point and hook wiring |

## License

Proprietary. The extension is auto-installed by `pebkac init`. Do not edit
the extension file directly — re-run `pebkac init` to reinstall.
