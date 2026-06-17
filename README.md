# PEBKAC

PEBKAC is a release-focused defense harness for AI coding sessions.

It wraps the active runtime, installs platform-specific defense surfaces, manages provider keys safely, protects git history, persists session state, and exposes an operational CLI for setup, diagnostics, flags, plugins, audit review, and mode switching.

## Unified CLI Surface

```text
Lifecycle:   init, launch, status, doctor, off, on, mode
Security:    api-keys, hooks, platforms
Operations:  config, flags, plugins, audit, completion, skill, version
```

## Core Guarantees

- Evidence-first completion enforcement
- Git guardrails and managed hooks
- Secrets isolation with OS keychain storage
- OMP extension plus Claude/Pi defense context installation
- Project-local harness state under `.harness/`
- First-run splash only; no repeat animation spam on routine commands
- Machine-readable JSON output for status/doctor and command-specific JSON surfaces

## Quick Start

```bash
pebkac init --non-interactive --yes
pebkac status
pebkac doctor
pebkac help api-keys
```

## Commands

### Lifecycle

- `pebkac init` — initialize `.harness`, install OMP/Claude/Pi surfaces, write defaults, install hooks when inside a git repo
- `pebkac launch` — launch the configured runtime (`omp`, `claude`, `pi`, `none`)
- `pebkac status` — concise health snapshot with runtime, platforms, hooks, plugins, checkpoints, audit size
- `pebkac doctor` — deep diagnostic report with remediation
- `pebkac off` / `pebkac on` — project disable sentinel management
- `pebkac mode` — show or change runtime / verbosity / enabled state

### Security

- `pebkac api-keys` — list/add/rotate/remove/test provider keys via OS keychain or explicit file backend for tests
- `pebkac hooks` — install/status-check managed pre-commit, pre-push, pre-rebase, commit-msg hooks
- `pebkac platforms` — install/status-check OMP extension and Claude/Pi managed `CLAUDE.md` context

### Operations

- `pebkac config` — get/set/list `.harness/config.yaml`
- `pebkac flags` — persistent feature flag store in `.harness/state/feature-flags.json`
- `pebkac plugins` — scan local plugin manifests and recommend missing high-value plugins
- `pebkac audit` — summarize/tail redacted JSONL audit events
- `pebkac completion` — emit bash/zsh/fish completion scripts
- `pebkac skill` — expose the CLI-X 2026 UI/UX contract used by this CLI
- `pebkac version` — print product and package version

## Harness State

```text
.harness/
  config.yaml
  audit.log
  checkpoints/
  state/
    onboarding-preferences.json
    telemetry-consent.json
    feature-flags.json
    splash-seen
  vault/
    config.yaml
.omp/extensions/pebkac-defense.js
.claude/CLAUDE.md
.pi/CLAUDE.md
```

## Verification

- `bun test`
- `pebkac help`
- `pebkac status --json --cwd <path>`
- `pebkac doctor --json --cwd <path>`
