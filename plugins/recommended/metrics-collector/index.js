import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";

function percent(numerator, denominator) {
  return denominator ? Number(((numerator / denominator) * 100).toFixed(2)) : 0;
}

export async function run({ paths }) {
  const lines = existsSync(paths.audit) ? readFileSync(paths.audit, "utf8").split("\n").filter(Boolean) : [];
  const entries = lines.flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
  const turns = entries.filter(entry => entry.event === "turn_end" && entry.details?.metrics);
  const blockedTurns = turns.filter(entry => Number(entry.details.metrics.failedToolCalls ?? 0) > 0).length;
  const evidenceTurns = turns.filter(entry => Number(entry.details.metrics.evidenceCount ?? 0) > 0).length;
  const commands = entries.filter(entry => entry.event === "cli_command" && Number.isFinite(Number(entry.details?.durationMs)));
  const latencies = commands.map(entry => Number(entry.details.durationMs));
  const metrics = {
    collectedAt: new Date().toISOString(),
    source: paths.audit,
    auditEntries: entries.length,
    turns: turns.length,
    blockedTurns,
    blockRatePercent: percent(blockedTurns, turns.length),
    evidenceTurns,
    evidenceRatioPercent: percent(evidenceTurns, turns.length),
    commandLatencyMs: {
      samples: latencies.length,
      average: latencies.length ? Number((latencies.reduce((a, b) => a + b, 0) / latencies.length).toFixed(2)) : null,
      maximum: latencies.length ? Math.max(...latencies) : null,
      minimum: latencies.length ? Math.min(...latencies) : null,
    },
  };
  const output = join(paths.state, "pebkac-metrics.json");
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(metrics, null, 2)}\n`, { mode: 0o600 });
  return { ok: true, summary: `Collected ${entries.length} audit entries across ${turns.length} turns.`, data: { ...metrics, output } };
}
