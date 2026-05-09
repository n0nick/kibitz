#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import { parseArgs } from 'util';
import { fileURLToPath } from 'url';
import { Chess } from 'chess.js';
import { parseGame, reclassifyWithEvals } from '../src/parseGame.js';
import { TONES, selectMoments, DEFAULT_MODEL, analyzeGameWithUsage } from '../src/analyzeGame.js';
import { mergeAnalysis } from '../src/pipeline.js';
import { StockfishEngine } from './stockfish-node.js';

export const PROMPT_VERSION = 'v1.1';
export const STOCKFISH_PATH = process.env.STOCKFISH_PATH ?? '/opt/homebrew/bin/stockfish';

const ANNOTATION_RULES = `Board annotations — USE THEM in every explanation and reason:
- Square reference: [[e6]]
- Piece on a square: [[Ng5|g5]]
- Move (MUST include explicit from–to): [[Nxe6|g5-e6]]
- NEVER use [[SAN]] without a pipe — always provide |from-to
- Use lowercase algebraic squares (a1–h8)
- Include 2–3 annotations per explanation; annotate every key square and move`;

function toneDesc(tone) {
  return TONES.find(t => t.value === tone)?.desc ?? TONES[0].desc;
}

export function buildBenchmarkPrompt(pgn, moments, summary, evals, tone, perPly = [], positions = []) {
  const cleanPgn = pgn.replace(/\{[^}]*\}/g, '').replace(/\s+/g, ' ').trim();
  const fmt = v => v >= 99 ? 'M' : v <= -99 ? '-M' : v.toFixed(1);
  const fmtCp = cp => cp == null ? '?' : `${cp >= 0 ? '+' : ''}${(cp / 100).toFixed(1)}`;
  const topMoments = selectMoments(moments, evals);
  const momentsList = topMoments.map(m => {
    const before = evals[m.moveIdx - 1] ?? 0;
    const after = evals[m.moveIdx];
    const delta = after - before;
    const side = m.player === 'white' ? 'White' : 'Black';

    let entry = `- moveIdx ${m.moveIdx} (${m.moveNumber} ${m.notation}) [${side}]: ${m.classification}, eval ${fmt(before)} → ${fmt(after)} (${delta >= 0 ? '+' : ''}${delta.toFixed(1)})`;

    const fenAfter = positions[m.moveIdx]?.fen;
    if (fenAfter) entry += `\n  FEN after move: ${fenAfter}`;

    const plyEntry = perPly.find(p => p.ply === m.moveIdx);
    const engineLines = plyEntry?.best_lines?.slice(0, 3) ?? [];
    if (engineLines.length > 0) {
      entry += '\n  Engine best lines from this position:';
      engineLines.forEach((l, i) => {
        const ev = l.mate != null ? (l.mate > 0 ? '+M' : '-M') : fmtCp(l.eval_cp);
        entry += `\n    ${i + 1}. ${l.moves_san.slice(0, 4).join(' ')} (${ev})`;
      });
    }

    return entry;
  }).join('\n');

  return `Analyze this chess game. Tone: ${toneDesc(tone)}

White: ${summary.white} | Black: ${summary.black} | Result: ${summary.result}
Opening: ${summary.opening ?? 'Unknown'} | Event: ${summary.event}

PGN:
${cleanPgn}

Key moments (eval in pawns, positive = White advantage; each entry names the side that just moved — an eval change that benefits that side is a strong move, one that hurts them is an error):
${momentsList}

Return ONLY valid JSON, no markdown:
{
  "narrative": "2-3 sentences: how the game unfolded and what decided it",
  "pattern": "1-2 sentences: a recurring theme or lesson",
  "moments": [
    {
      "moveIdx": <number>,
      "explanation": "1-2 sentences with [[square/piece/move]] annotations: what happened and why it matters",
      "betterMoves": [{"move": "<SAN>", "reason": "<one sentence with [[annotations]]>"}],
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
- betterMoves only for inaccuracy/mistake/blunder ([] for great/brilliant), max 2
- claimed_lines: include the concrete tactical line justifying the classification; empty [] for good/great with no tactical refutation
- All moves in claimed_lines MUST appear in the engine best lines provided above — do not invent moves
- Output exactly the moveIdx values listed above, no more, no less
- ${ANNOTATION_RULES}`;
}

function isLegalLine(movesSan, startFen) {
  if (!movesSan || movesSan.length === 0 || !startFen) return false;
  try {
    const chess = new Chess(startFen);
    for (const san of movesSan) {
      if (!chess.move(san)) return false;
    }
    return true;
  } catch {
    return false;
  }
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

    const t1 = Date.now();
    const promptBuilder = (pgn, moments, summary, evals, tone) =>
      buildBenchmarkPrompt(pgn, moments, summary, evals, tone, perPly, parsed.positions);
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

          const rawClaimedLines = claudeMoment?.claimed_lines ?? [];
          const validClaimedLines = rawClaimedLines.filter(line =>
            isLegalLine(line.moves_san ?? [], fenAfter)
          );

          const rawAlternatives = (m.betterMoves ?? []).map(bm => ({
            move_san: bm.move,
            eval_cp: null,
            reason: bm.reason,
          }));
          const validAlternatives = rawAlternatives.filter(alt =>
            isLegalLine([alt.move_san], fenBefore)
          );

          return {
            ply: m.moveIdx,
            move_san: m.notation,
            fen_before: fenBefore,
            fen_after: fenAfter,
            classification: m.classification,
            eval_before_cp: Math.round(evalBefore * 100),
            eval_after_cp: Math.round(evalAfter * 100),
            explanation: m.explanation,
            claimed_lines: validClaimedLines,
            alternatives: validAlternatives,
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
