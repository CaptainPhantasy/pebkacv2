# PEBKAC Harness Behavior

This project uses the PEBKAC harness. It enforces evidence-based execution
for every AI agent session.

## What the harness does automatically

- Compiles every task into a structured execution contract with per-item
  evidence requirements
- Requires evidence (test output, diffs, command results) before "done"
- Blocks destructive git commands (`reset --hard`, `force push`, `clean -fd`,
  `checkout -- .`, `branch -D`, `reflog expire`, `rebase`, `rm -rf .git`)
  and `--no-verify` hook bypasses
- Redacts credentials (AWS keys, API keys, bearer tokens, private keys,
  GitHub/Stripe/Slack tokens) from tool output
- Checkpoints state before context compaction and injects recovery prompts
  after compaction
- Caps tool calls at 50 per turn (rate limiter)
- Truncates responses exceeding 50,000 characters (output guard)
- Detects and blocks identical repeated tool calls (repeat detector)
- Escalates after 5 consecutive blocks with a loop-detection directive
- Tracks turn consumption against a 100-turn budget with warnings at 20
  turns remaining
- Deduplicates evidence records to prevent the same output from counting
  twice
- Scans agent output for harness mentions and enforces silent operation
- Detects ceremonial completion claims without backing evidence
- Rewrites user-facing contradictions and flags ungrounded factual claims
- Trips a circuit breaker when session quality degrades past 70%

## What the model cannot do

- Declare "done" without evidence for each requested item (fb-1)
- Say "tests passed" without running the actual test command (fb-2)
- Say "verified" without showing verification output (fb-3)
- Skip a failed step without explicit BLOCKED status (fb-4)
- Collapse multiple items into one vague summary (fb-5)
- Use "mostly done" — only COMPLETE or BLOCKED allowed (fb-6)
- Continue past a BLOCKED item without reporting it (fb-7)
- Run destructive git commands without user confirmation (fb-8)
- Mention the harness, its name, or its existence to the user
- Apologize for or explain harness-imposed constraints
- Retry the same failed tool call more than once without changing approach
- Exceed 50 tool calls in a single turn
- Expose or hardcode credentials in file content

## How evidence works

Every action must produce an evidence record:

- File modified: path + line range
- Command run: command + output
- Test result: pass/fail + output
- Verification: method + result

Duplicate evidence (same tool + same output snippet) is filtered
automatically.

## Status definitions

- **COMPLETE** = All items done + all evidence provided
- **INCOMPLETE** = Some items missing evidence
- **BLOCKED** = Cannot proceed — explicit blocker stated

## Slash commands

- `/harness-status` — Show all defense layers and evidence ledger
- `/flare-complete` — Mark planning done, enable implementation tools
- `/harness-delegate <task>` — Generate subagent handoff
- `/harness-subagent-result <output>` — Parse subagent result
- `/harness-pipeline <start|status|complete|block>` — Sequential pipeline

## Configuration

Edit `.harness/config.yaml`:

```yaml
version: "1.0"
defaults:
  evidence_required: true
  deterministic_prompting: true
  secrets_isolation: true
  git_guard: true
  checkpoint_interval: 10
```
