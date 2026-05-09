#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import { parseArgs } from 'util';
import { fileURLToPath } from 'url';
import { parseGame, reclassifyWithEvals } from '../src/parseGame.js';
import { selectMoments, DEFAULT_MODEL, analyzeGameWithUsage, toneDesc, ANNOTATION_RULES, isLegalLine, extractMentionedSANs, scrubExplanation, formatMomentEntry } from '../src/analyzeGame.js';
import { mergeAnalysis } from '../src/pipeline.js';
import { StockfishEngine } from './stockfish-node.js';

export const PROMPT_VERSION = 'v1.2';
export const STOCKFISH_PATH = process.env.STOCKFISH_PATH ?? '/opt/homebrew/bin/stockfish';

export function buildBenchmarkPrompt(pgn, moments, summary, evals, tone, perPly = [], positions = [], momentEngineData = {}) {
  const cleanPgn = pgn.replace(/\{[^}]*\}/g, '').replace(/\s+/g, ' ').trim();
  const topMoments = selectMoments(moments, evals);
  const momentsList = topMoments.map(m => formatMomentEntry(m, evals, momentEngineData, perPly)).join('\n');

  return `You are a chess coach explaining specific moments in a game. You are NOT a chess engine. All chess truth comes from the engine output provided below. You translate engine analysis into coaching prose.

Tone: ${toneDesc(tone)}
White: ${summary.white} | Black: ${summary.black} | Result: ${summary.result}
Opening: ${summary.opening ?? 'Unknown'} | Event: ${summary.event}

PGN:
${cleanPgn}

Key moments (eval in pawns, positive = White advantage; each entry names the side that just moved):
${momentsList}

Return ONLY valid JSON, no markdown:
{
  "narrative": "2-3 sentences: how the game unfolded and what decided it",
  "pattern": "1-2 sentences: a recurring theme or lesson",
  "moments": [
    {
      "moveIdx": <number>,
      "explanation": "1-2 sentences with [[square/piece/move]] annotations: what happened and why it matters",
      "claimed_lines": [
        {
          "label": "refutation|winning-plan|defense",
          "moves_san": ["<move1>", "<move2>"],
          "claim": "<one sentence: what this line achieves>"
        }
      ],
      "suggestedQuestion": "<omit unless there is a genuinely interesting tactical or strategic follow-up question>"
    }
  ]
}

Rules:
- NEVER name a move anywhere in your response (explanation, claimed_lines, or anywhere else) unless it appears verbatim in the engine alternatives or refutation lines provided above. If you cannot cite an engine-grounded move, describe the idea in words without naming the move.
- claimed_lines: use ONLY moves that appear verbatim in the engine alternatives or refutation lines above. Empty [] if none apply.
- Do not make claims about tactical motifs (pins, forks, skewers, discovered attacks) unless the geometry is visible in the provided engine lines.
- Output exactly the moveIdx values listed above, no more, no less
- ${ANNOTATION_RULES}`;
}

// Cost per million tokens (input/output)
const MODEL_COSTS = {
  'claude-haiku-4-5-20251001': { in: 0.80, out: 4.00 },
  'claude-sonnet-4-6':         { in: 3.00, out: 15.00 },
  'claude-opus-4-7':           { in: 15.00, out: 75.00 },
};

export async function analyzeGameForBenchmark(pgn, {
  tone = 'intermediate',
  model = DEFAULT_MODEL,
  depth = 15,
  source = 'pgn-paste',
  sourceUrl = null,
  apiKey,
  stockfishPath = STOCKFISH_PATH,
  onProgress,
} = {}) {
  const key = apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('No ANTHROPIC_API_KEY');

  const parsed = parseGame(pgn);

  const engine = new StockfishEngine(stockfishPath);
  try {
    const detailed = await engine.analyzeFullGameDetailed(parsed.positions, { depth, onProgress });
    if (!detailed) throw new Error('Stockfish aborted');
    const { evals, perPly } = detailed;

    const game = reclassifyWithEvals(parsed, evals);

    // Pre-compute before-move alternatives for each selected moment.
    // This is the engine ground truth that v1.2 uses instead of LLM-invented moves.
    const altDepth = Math.max(depth, 20);
    const topMoments = selectMoments(game.moments, game.evals);
    const momentEngineData = {};
    for (const m of topMoments) {
      const fenBefore = parsed.positions[m.moveIdx - 1]?.fen;
      if (!fenBefore) continue;
      // positions[m.moveIdx - 1].color is who just moved to reach fenBefore;
      // if that was White, Black is to move → negate for White's perspective.
      const needsFlip = parsed.positions[m.moveIdx - 1]?.color === 'w';
      const sign = needsFlip ? -1 : 1;
      const altLines = await engine.analyzePosition(fenBefore, altDepth, 3).catch(() => null);
      const refEntry = perPly.find(p => p.ply === m.moveIdx);
      momentEngineData[m.moveIdx] = {
        top_alternatives: (altLines ?? []).map(l => ({
          san: l.pv?.[0] ?? null,
          eval_cp: l.mate != null ? null : Math.round((l.score ?? 0) * 100 * sign),
          mate: l.mate != null ? (needsFlip ? -l.mate : l.mate) : null,
          pv_san: l.pv?.slice(0, 5) ?? [],
        })),
        refutation_pv: refEntry?.best_lines?.[0]?.moves_san?.slice(0, 5) ?? [],
      };
    }

    const t1 = Date.now();
    const promptBuilder = (pgn, moments, summary, evals, tone) =>
      buildBenchmarkPrompt(pgn, moments, summary, evals, tone, perPly, parsed.positions, momentEngineData);
    const { result, usage } = await analyzeGameWithUsage(
      pgn, game.moments, game.summary, game.evals, key, tone, model, promptBuilder
    );
    const latencyMs = Date.now() - t1;

    const costs = MODEL_COSTS[model] ?? MODEL_COSTS[DEFAULT_MODEL];
    const costUsd = ((usage.input_tokens * costs.in) + (usage.output_tokens * costs.out)) / 1_000_000;

    const merged = mergeAnalysis(game, result);

    return {
      game_metadata: {
        white: game.summary.white,
        black: game.summary.black,
        result: game.summary.result,
        opening: game.summary.opening ?? null,
        event: game.summary.event ?? null,
        moves_count: parsed.positions.length - 1,
        source,
        source_url: sourceUrl,
      },
      game_summary: result.narrative ?? null,
      patterns: result.pattern ? [result.pattern] : [],
      // Only emit moments that Claude actually commented on (up to MAX_MOMENTS).
      // Unselected moments would appear with null explanations and cause the
      // judge to score false flags on classifications Claude never saw.
      key_moments: merged.moments
        .filter(m => m.explanation != null)
        .map(m => {
          const evalBefore = game.evals[m.moveIdx - 1] ?? 0;
          const evalAfter = game.evals[m.moveIdx] ?? 0;
          const claudeMoment = result.moments?.find(r => r.moveIdx === m.moveIdx);
          const fenBefore = parsed.positions[m.moveIdx - 1]?.fen ?? null;
          const fenAfter  = parsed.positions[m.moveIdx]?.fen ?? null;

          const engineData = momentEngineData[m.moveIdx];

          const rawClaimedLines = claudeMoment?.claimed_lines ?? [];
          // Build set of engine-grounded moves from after-move position
          const engineMovesAfter = new Set([
            ...(engineData?.refutation_pv ?? []),
            ...(perPly.find(p => p.ply === m.moveIdx)?.best_lines?.flatMap(l => l.moves_san?.slice(0, 5) ?? []) ?? []),
          ]);
          const validClaimedLines = rawClaimedLines.filter(line => {
            const moves = line.moves_san ?? [];
            if (!isLegalLine(moves, fenAfter)) return false;
            // Every move must appear somewhere in the engine lines (any position across
            // all PVs). This catches legal-but-invented moves deeper in the line.
            if (moves.length > 0 && engineMovesAfter.size > 0 &&
                moves.some(san => !engineMovesAfter.has(san))) return false;
            return true;
          });

          // Build the set of engine-grounded SANs for this ply (played move +
          // all moves appearing in top_alternatives PVs, refutation_pv, and
          // perPly best_lines). Suffixes (+/#) stripped for comparison.
          const strip = s => s?.replace(/[+#]$/, '');
          const allowedSANs = new Set([
            strip(m.notation),
            ...(engineData?.top_alternatives?.flatMap(a => (a.pv_san ?? []).map(strip)) ?? []),
            ...(engineData?.refutation_pv ?? []).map(strip),
            ...(perPly.find(p => p.ply === m.moveIdx)?.best_lines?.flatMap(l => (l.moves_san ?? []).slice(0, 5).map(strip)) ?? []),
          ].filter(Boolean));

          const scrubbedExpl = scrubExplanation(m.explanation, allowedSANs);

          return {
            ply: m.moveIdx,
            move_san: m.notation,
            fen_before: fenBefore,
            fen_after: fenAfter,
            classification: m.classification,
            eval_before_cp: Math.round(evalBefore * 100),
            eval_after_cp: Math.round(evalAfter * 100),
            explanation: scrubbedExpl,
            claimed_lines: validClaimedLines,
            top_alternatives: engineData?.top_alternatives ?? [],
            refutation_pv: engineData?.refutation_pv ?? [],
          };
        }),
      stockfish_data: {
        depth,
        multipv: 3,
        per_ply: perPly,
      },
      metadata: {
        model,
        prompt_version: PROMPT_VERSION,
        analysis_level: tone,
        total_tokens_in: usage.input_tokens,
        total_tokens_out: usage.output_tokens,
        cost_usd: parseFloat(costUsd.toFixed(6)),
        latency_ms: latencyMs,
      },
    };
  } finally {
    engine.quit();
  }
}

// CLI entry point
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      pgn:          { type: 'string' },
      tone:         { type: 'string', default: 'intermediate' },
      model:        { type: 'string', default: DEFAULT_MODEL },
      depth:        { type: 'string', default: '15' },
      output:       { type: 'string' },
      source:       { type: 'string', default: 'pgn-paste' },
      'source-url': { type: 'string', default: '' },
    },
  });

  if (!values.pgn) {
    console.error('Usage: node benchmark/analyze.js --pgn <file.pgn> [--tone beginner|intermediate|advanced] [--model <id>] [--depth <n>] [--output <file.json>]');
    process.exit(1);
  }

  const pgn = readFileSync(values.pgn, 'utf8');
  let i = 0;

  console.error('Running Stockfish + Claude…');
  const result = await analyzeGameForBenchmark(pgn, {
    tone: values.tone,
    model: values.model,
    depth: parseInt(values.depth),
    source: values.source,
    sourceUrl: values['source-url'] || null,
    onProgress: (cur, total) => {
      if (cur !== i) { process.stderr.write(`\r  Stockfish: ${cur}/${total}`); i = cur; }
    },
  });
  process.stderr.write('\n');

  const json = JSON.stringify(result, null, 2);
  if (values.output) {
    const dir = path.dirname(values.output);
    if (dir !== '.') mkdirSync(dir, { recursive: true });
    writeFileSync(values.output, json);
    console.error(`Wrote ${values.output}`);
  } else {
    console.log(json);
  }
}
