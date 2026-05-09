#!/usr/bin/env node
/**
 * Benchmark runner — runs the kibitz analysis pipeline over all PGN files
 * in one or more bucket directories and saves structured JSON results.
 *
 * Usage:
 *   node benchmark/runner.js [--buckets A,B,C,D] [--model <id>] [--tone <tone>]
 *                            [--depth <n>] [--prompt-version <v>]
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseArgs } from 'util';
import { DEFAULT_MODEL } from '../src/analyzeGame.js';
import { analyzeGameForBenchmark, PROMPT_VERSION } from './analyze.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GAMES_DIR = path.join(__dirname, 'games');
const RESULTS_DIR = path.join(__dirname, 'results');
const ALL_BUCKETS = ['A_canonical', 'B_titled', 'C_amateur', 'D_synthetic'];

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

async function runBucket(bucketDir, bucketName, outDir, opts) {
  const pgnFiles = readdirSync(bucketDir)
    .filter(f => f.endsWith('.pgn'))
    .sort();

  console.log(`\n[${bucketName}] ${pgnFiles.length} games`);

  const summaries = [];
  for (const fname of pgnFiles) {
    const gameId = fname.replace(/\.pgn$/, '');
    const pgnPath = path.join(bucketDir, fname);
    const outPath = path.join(outDir, bucketName, `${gameId}.analysis.json`);

    mkdirSync(path.dirname(outPath), { recursive: true });

    console.log(`  → ${gameId}`);
    const pgn = readFileSync(pgnPath, 'utf8');
    const t0 = Date.now();
    try {
      const result = await analyzeGameForBenchmark(pgn, {
        tone: opts.tone,
        model: opts.model,
        depth: opts.depth,
        source: `benchmark/${bucketName}`,
        onProgress: (cur, total) => process.stderr.write(`\r     Stockfish: ${cur}/${total}`),
      });
      process.stderr.write('\n');
      writeFileSync(outPath, JSON.stringify(result, null, 2));
      summaries.push({ game_id: gameId, bucket: bucketName, status: 'ok', elapsed_ms: Date.now() - t0, cost_usd: result.metadata.cost_usd });
      console.log(`     done (${((Date.now() - t0) / 1000).toFixed(1)}s, $${result.metadata.cost_usd.toFixed(4)})`);
    } catch (e) {
      process.stderr.write('\n');
      console.error(`     FAILED: ${e.message}`);
      summaries.push({ game_id: gameId, bucket: bucketName, status: 'error', error: e.message, elapsed_ms: Date.now() - t0 });
    }
  }
  return summaries;
}

async function main() {
  const { values } = parseArgs({
    options: {
      buckets:          { type: 'string', default: '' },
      model:            { type: 'string', default: DEFAULT_MODEL },
      tone:             { type: 'string', default: 'intermediate' },
      depth:            { type: 'string', default: '15' },
      'prompt-version': { type: 'string', default: PROMPT_VERSION },
    },
  });

  const requestedBuckets = values.buckets
    ? values.buckets.split(',').map(b => {
        const match = ALL_BUCKETS.find(x => x.startsWith(b.trim()));
        if (!match) { console.error(`Unknown bucket: ${b}`); process.exit(1); }
        return match;
      })
    : ALL_BUCKETS;

  const opts = {
    model: values.model,
    tone: values.tone,
    depth: parseInt(values.depth),
  };

  const ts = timestamp();
  const modelSlug = values.model.replace(/[^a-z0-9-]/gi, '-');
  const runDir = path.join(RESULTS_DIR, `${ts}_${modelSlug}_${values['prompt-version']}`);
  mkdirSync(runDir, { recursive: true });

  console.log(`Run: ${runDir}`);
  console.log(`Model: ${opts.model} | Tone: ${opts.tone} | Depth: ${opts.depth}`);

  const allSummaries = [];
  for (const bucket of requestedBuckets) {
    const bucketDir = path.join(GAMES_DIR, bucket);
    if (!existsSync(bucketDir)) {
      console.log(`Skipping ${bucket} — no directory found`);
      continue;
    }
    const summaries = await runBucket(bucketDir, bucket, runDir, opts);
    allSummaries.push(...summaries);
  }

  const manifestPath = path.join(runDir, 'manifest.json');
  writeFileSync(manifestPath, JSON.stringify({ run_dir: runDir, model: opts.model, tone: opts.tone, depth: opts.depth, prompt_version: values['prompt-version'], games: allSummaries }, null, 2));
  console.log(`\nManifest: ${manifestPath}`);

  const totalCost = allSummaries.reduce((s, g) => s + (g.cost_usd ?? 0), 0);
  const failed = allSummaries.filter(g => g.status === 'error').length;
  console.log(`\nDone: ${allSummaries.length - failed}/${allSummaries.length} games succeeded, total cost: $${totalCost.toFixed(4)}`);
  if (failed > 0) console.warn(`${failed} game(s) failed — see manifest for details`);
}

main().catch(e => { console.error(e); process.exit(1); });
