#!/usr/bin/env node
/**
 * Aggregates benchmark judge results into a CSV and summary JSON.
 * Also runs the judge pass on any analysis files that don't yet have judge results.
 *
 * Usage:
 *   node benchmark/aggregate.js --run <results/run-dir>
 *                               [--skip-judge]
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseArgs } from 'util';
import { judgeAnalysis } from './judge.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REFERENCES_DIR = path.join(__dirname, 'references');
const GAMES_DIR = path.join(__dirname, 'games');

const PASS_THRESHOLDS = {
  tactical_accuracy_mean: 4.5,
  move_selection_mean_B:  4.0,
  max_hallucinations:     0,
};

function mean(arr) {
  if (!arr.length) return null;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}

async function loadOrRunJudge(analysisPath, bucketName, skipJudge, apiKey) {
  const judgePath = analysisPath.replace('.analysis.json', '.judge.json');
  if (existsSync(judgePath)) return JSON.parse(readFileSync(judgePath, 'utf8'));
  if (skipJudge) return null;

  const gameId = path.basename(analysisPath, '.analysis.json');
  const referencePath = path.join(REFERENCES_DIR, bucketName, `${gameId}.pgn`);
  const assertionsPath = path.join(GAMES_DIR, bucketName, `${gameId}.assertions.json`);

  console.log(`  Judging ${gameId}…`);
  const result = await judgeAnalysis(analysisPath, {
    referencePath: existsSync(referencePath) ? referencePath : null,
    assertionsPath: existsSync(assertionsPath) ? assertionsPath : null,
    apiKey,
  });
  writeFileSync(judgePath, JSON.stringify(result, null, 2));
  return result;
}

function toCsvRow(row) {
  return Object.values(row).map(v => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(',');
}

async function main() {
  const { values } = parseArgs({
    options: {
      run:          { type: 'string' },
      'skip-judge': { type: 'boolean', default: false },
    },
  });

  if (!values.run) {
    console.error('Usage: node benchmark/aggregate.js --run <results/run-dir> [--skip-judge]');
    process.exit(1);
  }

  const runDir = values.run;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const skipJudge = values['skip-judge'];

  const rows = [];
  const bucketDirs = readdirSync(runDir).filter(f => {
    try { return readdirSync(path.join(runDir, f)).some(x => x.endsWith('.analysis.json')); }
    catch { return false; }
  });

  for (const bucketName of bucketDirs.sort()) {
    const bucketDir = path.join(runDir, bucketName);
    const analysisFiles = readdirSync(bucketDir).filter(f => f.endsWith('.analysis.json')).sort();
    console.log(`\n[${bucketName}] ${analysisFiles.length} games`);

    for (const fname of analysisFiles) {
      const analysisPath = path.join(bucketDir, fname);
      const gameId = fname.replace('.analysis.json', '');
      const analysis = JSON.parse(readFileSync(analysisPath, 'utf8'));
      const judge = await loadOrRunJudge(analysisPath, bucketName, skipJudge, apiKey);

      const row = {
        game_id: gameId,
        bucket: bucketName,
        model: analysis.metadata.model,
        prompt_version: analysis.metadata.prompt_version,
        analysis_level: analysis.metadata.analysis_level,
        move_selection: judge?.scores?.move_selection ?? null,
        tactical_accuracy: judge?.scores?.tactical_accuracy ?? null,
        causal_explanation: judge?.scores?.causal_explanation ?? null,
        pedagogical_value: judge?.scores?.pedagogical_value ?? null,
        voice: judge?.scores?.voice ?? null,
        hallucination_count: judge?.hallucinations?.length ?? null,
        missed_count: judge?.missed?.length ?? null,
        false_flag_count: judge?.false_flags?.length ?? null,
        assertions_passed: judge?.assertion_results
          ? [
              ...(judge.assertion_results.must_flag_moves ?? []),
              ...(judge.assertion_results.must_not_flag_moves ?? []),
              ...(judge.assertion_results.required_concepts ?? []),
            ].filter(r => r.passed || r.found).length
          : null,
        assertions_total: judge?.assertion_results
          ? [
              ...(judge.assertion_results.must_flag_moves ?? []),
              ...(judge.assertion_results.must_not_flag_moves ?? []),
              ...(judge.assertion_results.required_concepts ?? []),
            ].length
          : null,
        should_flag_passed: judge?.assertion_results?.should_flag_moves
          ? judge.assertion_results.should_flag_moves.filter(r => r.passed).length
          : null,
        should_flag_total: judge?.assertion_results?.should_flag_moves?.length ?? null,
        cost_usd: analysis.metadata.cost_usd,
        latency_ms: analysis.metadata.latency_ms,
        moves_count: analysis.game_metadata.moves_count,
      };
      rows.push(row);
      console.log(`  ${gameId}: tactical=${row.tactical_accuracy ?? '?'} move_sel=${row.move_selection ?? '?'} halluc=${row.hallucination_count ?? '?'}`);
    }
  }

  // Build summary
  const scored = rows.filter(r => r.tactical_accuracy !== null);
  const bucketB = scored.filter(r => r.bucket.startsWith('B_'));
  const bucketD = scored.filter(r => r.bucket.startsWith('D_'));

  const summary = {
    run_dir: runDir,
    total_games: rows.length,
    scored_games: scored.length,
    per_dimension: {
      move_selection:     { mean: mean(scored.map(r => r.move_selection)), median: median(scored.map(r => r.move_selection)) },
      tactical_accuracy:  { mean: mean(scored.map(r => r.tactical_accuracy)), median: median(scored.map(r => r.tactical_accuracy)) },
      causal_explanation: { mean: mean(scored.map(r => r.causal_explanation)), median: median(scored.map(r => r.causal_explanation)) },
      pedagogical_value:  { mean: mean(scored.map(r => r.pedagogical_value)), median: median(scored.map(r => r.pedagogical_value)) },
      voice:              { mean: mean(scored.map(r => r.voice)), median: median(scored.map(r => r.voice)) },
    },
    total_hallucinations: scored.reduce((s, r) => s + (r.hallucination_count ?? 0), 0),
    total_missed: scored.reduce((s, r) => s + (r.missed_count ?? 0), 0),
    total_false_flags: scored.reduce((s, r) => s + (r.false_flag_count ?? 0), 0),
    total_cost_usd: rows.reduce((s, r) => s + (r.cost_usd ?? 0), 0),
    pass_fail: {
      tactical_accuracy_mean: {
        threshold: PASS_THRESHOLDS.tactical_accuracy_mean,
        actual: mean(scored.map(r => r.tactical_accuracy)),
        passed: (mean(scored.map(r => r.tactical_accuracy)) ?? 0) >= PASS_THRESHOLDS.tactical_accuracy_mean,
      },
      move_selection_mean_B: {
        threshold: PASS_THRESHOLDS.move_selection_mean_B,
        actual: mean(bucketB.map(r => r.move_selection)),
        passed: (mean(bucketB.map(r => r.move_selection)) ?? 0) >= PASS_THRESHOLDS.move_selection_mean_B,
      },
      zero_hallucinations_D: {
        threshold: 0,
        actual: bucketD.reduce((s, r) => s + (r.hallucination_count ?? 0), 0),
        passed: bucketD.reduce((s, r) => s + (r.hallucination_count ?? 0), 0) === 0,
      },
    },
  };

  // Write CSV
  const csvPath = path.join(runDir, 'results.csv');
  const headers = Object.keys(rows[0] ?? {});
  const csv = [headers.join(','), ...rows.map(toCsvRow)].join('\n');
  writeFileSync(csvPath, csv);

  // Write summary JSON
  const summaryPath = path.join(runDir, 'summary.json');
  writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

  // Print pass/fail
  console.log('\n─── Pass/Fail ───────────────────────────────');
  for (const [key, pf] of Object.entries(summary.pass_fail)) {
    const icon = pf.passed ? '✓' : '✗';
    console.log(`  ${icon} ${key}: ${pf.actual?.toFixed(2) ?? 'N/A'} (threshold: ${pf.threshold})`);
  }
  const allPassed = Object.values(summary.pass_fail).every(pf => pf.passed);
  console.log(`\n${allPassed ? 'PASS' : 'FAIL'} — see ${summaryPath}`);
  console.log(`CSV: ${csvPath}`);
}

main().catch(e => { console.error(e); process.exit(1); });
