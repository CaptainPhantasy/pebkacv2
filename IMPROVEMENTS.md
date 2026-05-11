# PEBKAC Defense Harness - Improvement Suggestions

After analyzing the 1,607-line `pebkac-defense.js` extension, here are actionable improvements organized by category:

---

## 🔴 Critical Issues

### 1. **Hardcoded Magic Numbers Without Configuration**
**Location:** Multiple modules (lines 933-944, 947-952, 955-969, 992-1012)

**Problem:** Rate limits (50/turn), output truncation (50K chars), repeat history (10 calls), turn budget (100 turns), escalation threshold (5 blocks), checkpoint interval (10 turns) are all hardcoded.

**Impact:** Users cannot tune these for their workflow without editing the extension file directly, which contradicts the "do not edit" directive.

**Fix:**
```javascript
// Add to config.yaml defaults:
defaults:
  rate_limit: 50
  output_max_chars: 50000
  repeat_history_size: 10
  turn_budget: 100
  escalation_threshold: 5
  checkpoint_interval: 10
```

```javascript
// In index.ts, load from config:
const config = await loadConfig(ctx.cwd);
const rateLimit = config.defaults.rate_limit ?? 50;
```

---

### 2. **No Error Handling for File System Operations**
**Location:** CheckpointManager.save() (lines 110-124), AuditLog.append() (lines 20-24)

**Problem:** Silent failures with `console.error()` only. If `.harness/checkpoints/` becomes unwritable (disk full, permissions), the system degrades without alerting.

**Impact:** Checkpoint corruption or loss goes unnoticed until compaction recovery fails.

**Fix:**
```javascript
async save() {
  try {
    // ... existing code
  } catch (err) {
    console.error('[PEBKAC] Checkpoint save failed:', err.message);
    // CRITICAL: Inject warning into next agent turn
    this.#saveFailed = true;
    await this.auditLog.append({
      event: 'checkpoint_failure',
      error: err.message,
      severity: 'critical'
    });
  }
}
```

---

### 3. **Memory Leak in Evidence Dedup**
**Location:** `evidenceHashes` Set (lines 1032-1048)

**Problem:** The `evidenceHashes` Set grows unbounded throughout the session. Only reset via `resetEvidenceDedup()` which is never called.

**Impact:** Long sessions (>100 turns) accumulate thousands of hashes, increasing memory pressure.

**Fix:**
```javascript
// Add LRU cache with max size
const MAX_EVIDENCE_HASHES = 1000;
function checkEvidenceDuplicate(toolName, snippet) {
  const hash = hashEvidence(toolName, snippet);
  if (evidenceHashes.has(hash)) {
    return { isDuplicate: true };
  }
  evidenceHashes.add(hash);
  // Prune oldest entries when exceeding limit
  if (evidenceHashes.size > MAX_EVIDENCE_HASHES) {
    const firstKey = evidenceHashes.values().next().value;
    evidenceHashes.delete(firstKey);
  }
  return { isDuplicate: false };
}
```

---

## 🟠 High Priority

### 4. **Regex Patterns Are Incomplete**
**Location:** CEREMONIAL_PATTERNS (lines 516-523), DESTRUCTIVE_COMMANDS (lines 630-640)

**Problem:** 
- Ceremonial patterns miss common phrases: "successfully completed", "all done", "finished up"
- Git guard misses: `git update-ref`, `git filter-branch`, `git replace`

**Fix:**
```javascript
var CEREMONIAL_PATTERNS = [
  // ... existing patterns
  /successfully\s+complet(ed|es)?/i,
  /all\s+done\.?/i,
  /finish(ed|es)?\s+up/i,
  /wrap(ped)?\s+up/i,
  /nailed\s+it/i
];

var DESTRUCTIVE_COMMANDS = [
  // ... existing patterns
  { pattern: /git\s+update-ref\s+-d/, risk: "Deletes ref without recovery", severity: "critical" },
  { pattern: /git\s+filter-branch/, risk: "Rewrites entire history", severity: "critical" },
  { pattern: /git\s+replace\s+-d/, risk: "Destroys replacement refs", severity: "high" }
];
```

---

### 5. **No Unit Tests**
**Location:** Entire codebase

**Problem:** Zero test coverage for 25 modules. Critical logic like contract compilation, evidence detection, and circuit breaker state transitions are untested.

**Impact:** Regression bugs will go undetected. Pattern changes could break core functionality.

**Fix:** Create `/workspace/.harness/tests/` with:
- `contract-compiler.test.js` - Test task parsing edge cases
- `evidence-enforcer.test.js` - Test ceremonial vs substantive detection
- `git-guard.test.js` - Test command blocking accuracy
- `circuit-breaker.test.js` - Test state transitions

Example:
```javascript
// contract-compiler.test.js
import { describe, it, expect } from 'bun:test';
import { compileContract } from './contract-compiler';

describe('compileContract', () => {
  it('handles empty task description', () => {
    expect(compileContract('')).toBeNull();
  });
  
  it('parses numbered items correctly', () => {
    const result = compileContract('1. Write tests\n2. Run lint');
    expect(result.items).toHaveLength(2);
    expect(result.items[0].evidenceRequired).toContain('test_result');
  });
});
```

---

### 6. **Contradiction Detection Is Too Aggressive**
**Location:** CONTRADICTION_PATTERNS (lines 457-464)

**Problem:** Pattern `/you are (?:wrong|mistaken|incorrect)/i` triggers on legitimate corrections like "You are wrong about that bug being fixed" when the agent is debugging.

**Impact:** False positives rewrite valid diagnostic statements.

**Fix:** Add context awareness:
```javascript
function detectContradiction(output, conversationHistory) {
  // Check if this is self-correction vs user correction
  const isSelfCorrection = /I (?:was |am )?(?:wrong|mistaken)/i.test(output);
  if (isSelfCorrection) {
    return { isContradiction: false, confidence: 0 };
  }
  // ... existing logic
}
```

---

### 7. **No Metrics or Observability**
**Location:** Throughout

**Problem:** No way to measure:
- How often blocks occur
- Which patterns trigger most frequently
- Average ceremony ratio per session
- Time spent in each phase

**Impact:** Cannot optimize the harness itself. Users cannot see ROI.

**Fix:** Add metrics collection:
```javascript
class MetricsCollector {
  #metrics = {
    blocksByReason: {},
    ceremonyRatios: [],
    phaseTransitions: [],
    sessionDurations: []
  };
  
  recordBlock(reason) {
    this.#metrics.blocksByReason[reason] = 
      (this.#metrics.blocksByReason[reason] || 0) + 1;
  }
  
  async export() {
    await fs.writeFile(
      '.harness/metrics.json',
      JSON.stringify(this.#metrics, null, 2)
    );
  }
}
```

---

## 🟡 Medium Priority

### 8. **Secret Patterns Are Incomplete**
**Location:** secrets-guard.ts (lines 826-890)

**Problem:** Missing modern secret formats:
- GitHub Fine-grained PATs (`github_pat_`)
- NPM tokens (`npm_`)
- PyPI API tokens (`pypi-`)
- Database connection strings with passwords

**Fix:** Expand SECRET_PATTERNS:
```javascript
var SECRET_PATTERNS = [
  // ... existing patterns
  { name: 'github_fine_grained', pattern: /github_pat_[A-Za-z0-9_]{22,}/ },
  { name: 'npm_token', pattern: /npm_[A-Za-z0-9]{36}/ },
  { name: 'pypi_token', pattern: /pypi-[A-Za-z0-9_-]{100,}/ },
  { name: 'db_connection', pattern: /(?:mongodb|postgres|mysql):\/\/[^:]+:[^@]+@/ }
];
```

---

### 9. **No Graceful Degradation When Bun Is Unavailable**
**Location:** Uses `Bun.file()`, `Bun.write()` throughout

**Problem:** Extension requires Bun runtime. No fallback for Node.js environments.

**Impact:** Limits adoption to Bun users only.

**Fix:** Add runtime detection and polyfill:
```javascript
const isBun = typeof Bun !== 'undefined';

async function readFile(path) {
  if (isBun) {
    return await Bun.file(path).text();
  } else {
    return await fs.promises.readFile(path, 'utf8');
  }
}
```

---

### 10. **Checkpoint Recovery Injection Is Too Verbose**
**Location:** `buildRecoveryInjection()` (lines 135-173)

**Problem:** Injects 100+ lines of context on every compaction, consuming valuable token budget.

**Impact:** Reduces space for actual conversation history.

**Fix:** Compress the injection:
```javascript
buildRecoveryInjection() {
  const state = this.#state;
  // Use compact format
  return `[PEBKAC CHECKPOINT] Task: ${state.currentTask?.slice(0,50)} | Working: ${state.workingApproaches.length} | Failed: ${state.failedApproaches.length} | Evidence: ${state.evidenceSummary.length}`;
}
```

---

### 11. **Reality Gate Does Not Cache Verification Results**
**Location:** reality-gate.ts (lines 773-823)

**Problem:** Every high-risk claim triggers a grounding reminder, even if already verified earlier in the session.

**Impact:** Repetitive warnings for the same version number or CVE.

**Fix:** Add verification cache:
```javascript
const verifiedClaims = new Map();

function isHighRiskClaim(text) {
  const match = findHighRiskPattern(text);
  if (!match) return { isHighRisk: false };
  
  const claimKey = `${match.category}:${match.fragment}`;
  if (verifiedClaims.has(claimKey)) {
    return { isHighRisk: false, previouslyVerified: true };
  }
  
  return { isHighRisk: true, ...match };
}

function markClaimVerified(category, fragment) {
  verifiedClaims.set(`${category}:${fragment}`, Date.now());
}
```

---

### 12. **Turn Budget Has No Warning Escalation**
**Location:** turn-budget.ts (lines 992-1012)

**Problem:** Only warns at <20 turns remaining. No progressive warnings at 50, 30, 20, 10.

**Impact:** Agent may not prioritize effectively until too late.

**Fix:**
```javascript
function checkTurnBudget() {
  const consumed = getTurnsConsumed();
  const remaining = turnBudget - consumed;
  const warnings = [];
  
  if (remaining === 50) warnings.push('Halfway through turn budget');
  if (remaining === 30) warnings.push('Consider wrapping up non-critical tasks');
  if (remaining === 20) warnings.push('Critical: 20 turns remaining');
  if (remaining === 10) warnings.push('Emergency: 10 turns left, finalize now');
  
  return { exceeded: remaining <= 0, remaining, warnings };
}
```

---

## 🟢 Low Priority (Quality of Life)

### 13. **Add TypeScript Types**
**Location:** Entire codebase uses JSDoc-style comments but no actual types

**Benefit:** Better IDE support, catch type errors before runtime

---

### 14. **Document All Slash Commands in README**
**Location:** README.md mentions 5 commands but code has more

**Benefit:** Users discover all available functionality

---

### 15. **Add `harness-explain-block` Command**
**Location:** New command

**Purpose:** When a tool call is blocked, agent can query why without guessing

```javascript
pi.registerCommand("harness-explain-block", {
  description: "Explain why the last tool call was blocked",
  handler: async (_args, ctx) => {
    const lastBlock = auditLog.getLastBlock();
    ctx.ui.notify(`Blocked because: ${lastBlock.reason}`, "warning");
  }
});
```

---

### 16. **Support Custom Forbidden Behaviors**
**Location:** DEFAULT_FORBIDDEN_BEHAVIORS (lines 271-312)

**Problem:** Users cannot add project-specific forbidden behaviors (e.g., "do not modify package.json")

**Fix:** Load from `.harness/config.yaml`:
```yaml
forbidden_behaviors:
  - id: "custom-1"
    description: "Modify package.json without explicit approval"
    consequence: "Revert changes and request approval"
```

---

### 17. **Add Session Export Command**
**Location:** New feature

**Purpose:** Export full session audit log for post-mortem analysis

```bash
/harness-export-session --format=json --output=session-2024-01-15.json
```

---

### 18. **Improve Error Messages**
**Location:** Throughout

**Problem:** Messages like "BLOCKED by Git Guard" don't link to documentation

**Fix:** Add reference links:
```javascript
return {
  blocked: true,
  reason: `BLOCKED by Git Guard: ${risk}. See https://pebkac.dev/docs/git-guard#${severity}`,
  // ...
};
```

---

## Summary Table

| # | Issue | Priority | Effort | Impact |
|---|-------|----------|--------|--------|
| 1 | Hardcoded magic numbers | 🔴 Critical | Low | High |
| 2 | Silent file system failures | 🔴 Critical | Low | High |
| 3 | Memory leak in evidence dedup | 🔴 Critical | Low | Medium |
| 4 | Incomplete regex patterns | 🟠 High | Low | Medium |
| 5 | No unit tests | 🟠 High | High | High |
| 6 | Over-aggressive contradiction detection | 🟠 High | Medium | Medium |
| 7 | No metrics/observability | 🟠 High | Medium | High |
| 8 | Incomplete secret patterns | 🟡 Medium | Low | High |
| 9 | Bun-only runtime | 🟡 Medium | Medium | Low |
| 10 | Verbose checkpoint recovery | 🟡 Medium | Low | Medium |
| 11 | No verification caching | 🟡 Medium | Low | Low |
| 12 | Turn budget warning escalation | 🟡 Medium | Low | Medium |
| 13-18 | Quality of life improvements | 🟢 Low | Varies | Low |

---

## Recommended Implementation Order

1. **Week 1:** Fix critical issues (#1-3)
2. **Week 2:** Add tests (#5) and expand patterns (#4, #8)
3. **Week 3:** Add metrics (#7) and improve UX (#10, #12, #15)
4. **Week 4:** Address remaining medium/low priority items
