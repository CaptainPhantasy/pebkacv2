# PEBKAC Harness Behavior

This project uses the PEBKAC harness. Here's what it enforces:

## What the harness does automatically
- Transforms every task into a structured execution contract
- Requires evidence (test output, diffs, command results) before "done"
- Blocks destructive git commands (reset --hard, force push, clean -fd)
- Redacts credentials from tool output
- Checkpoints state before context compaction

## What the model cannot do
- Declare "done" without evidence
- Run destructive git commands without user confirmation
- Access real API keys (it uses proxy credentials)
- Skip items without reporting BLOCKED

## How evidence works
Every action must produce an evidence record:
- File modified: path + line range
- Command run: command + output
- Test result: pass/fail + output
- Verification: method + result

## Status definitions
- COMPLETE = All items done + all evidence provided
- INCOMPLETE = Some items missing evidence
- BLOCKED = Cannot proceed — explicit blocker stated
