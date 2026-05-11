import { Chess } from 'chess.js';
import { parseGame, reclassifyWithEvals } from './parseGame.js';
import { analyzeGameWithUsage, buildPrompt, selectMoments, scrubExplanation } from './analyzeGame.js';

// Merging Claude commentary into parsed game state.
// Exported so App.jsx and the benchmark share the same logic.
export function mergeAnalysis(game, result) {
  if (!game) return game;
  if (!result) return game;
  const updatedMoments = game.moments.map((m) => {
    const a = result.moments?.find((r) => r.moveIdx === m.moveIdx);
    if (!a) return m;
    return {
      ...m,
      headline: a.headline ?? m.headline,
      card_teaser: a.card_teaser ?? m.card_teaser,
      explanation: a.explanation ?? m.explanation,
      betterMoves: a.betterMoves ?? m.betterMoves,
      qa: a.suggestedQuestion ? { question: a.suggestedQuestion, answer: null } : m.qa,
    };
  });
  return {
    ...game,
    summary: {
      ...game.summary,
      narrative: result.narrative ?? game.summary.narrative,
      pattern: result.pattern ?? game.summary.pattern,
    },
    moments: updatedMoments,
    momentByMoveIdx: Object.fromEntries(updatedMoments.map((m) => [m.moveIdx, m])),
  };
}

// Run Stockfish analysis on an already-parsed game object.
// engine must implement: analyzeFullGame(positions, { signal, onProgress }) => Promise<number[]|null>
export async function analyzePositions(parsed, engine, { signal, onProgress } = {}) {
  const evals = await engine.analyzeFullGame(parsed.positions, { signal, onProgress });
  if (!evals) return null;
  return reclassifyWithEvals(parsed, evals);
}

// Pre-computes before-move engine alternatives for each selected moment.
// engine must implement analyzePosition(fen, depth, numPv) => Promise<Line[]|null>.
// Returns a momentEngineData map keyed by moveIdx for use in buildPrompt v1.2.
export async function computeMomentEngineData(game, engine, { depth = 12 } = {}) {
  const topMoments = selectMoments(game.moments, game.evals);
  const momentEngineData = {};
  for (const m of topMoments) {
    const posBefore = game.positions[m.moveIdx - 1];
    const fenBefore = posBefore?.fen;
    if (!fenBefore) continue;
    // posBefore.color is who just moved to arrive at fenBefore;
    // if White just moved, Black is to move — negate for White-perspective eval.
    const needsFlip = posBefore.color === 'w';
    const sign = needsFlip ? -1 : 1;
    const altLines = await engine.analyzePosition(fenBefore, depth, 3).catch(() => null);
    const fenAfter = game.positions[m.moveIdx]?.fen;
    const refLines = fenAfter
      ? await engine.analyzePosition(fenAfter, depth, 1).catch(() => null)
      : null;
    momentEngineData[m.moveIdx] = {
      top_alternatives: (altLines ?? []).map(l => ({
        san: l.pv?.[0] ?? null,
        eval_cp: l.mate != null ? null : Math.round((l.score ?? 0) * 100 * sign),
        mate: l.mate != null ? (needsFlip ? -l.mate : l.mate) : null,
        pv_san: l.pv?.slice(0, 5) ?? [],
      })),
      refutation_pv: refLines?.[0]?.pv?.slice(0, 5) ?? [],
    };
  }
  return momentEngineData;
}

function uciToSan(fen, uciMoves) {
  try {
    const chess = new Chess(fen);
    const sans = [];
    for (const uci of uciMoves) {
      const move = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
      if (!move) break;
      sans.push(move.san);
    }
    return sans;
  } catch {
    return [];
  }
}

async function fetchLichessCloudEval(fen, multiPv, needsFlip) {
  const sign = needsFlip ? -1 : 1;
  const res = await fetch(`https://lichess.org/api/cloud-eval?fen=${encodeURIComponent(fen)}&multiPv=${multiPv}`);
  if (!res.ok) return null;
  const data = await res.json();
  if (!data.pvs?.length) return null;
  return data.pvs.map(pv => {
    const uciMoves = pv.moves?.split(' ') ?? [];
    const pvSan = uciToSan(fen, uciMoves);
    return {
      san: pvSan[0] ?? null,
      eval_cp: pv.cp != null ? Math.round(pv.cp * sign) : null,
      mate: pv.mate != null ? (needsFlip ? -pv.mate : pv.mate) : null,
      pv_san: pvSan.slice(0, 5),
    };
  }).filter(alt => alt.san);
}

// Computes engine data for a single ply (used for lazy per-move analysis).
// Tries Lichess cloud-eval first if lichessGameId provided, falls back to local engine.
// Returns { top_alternatives, refutation_pv } in the same shape as computeMomentEngineData.
export async function computeSingleMoveEngineData(positions, plyIdx, engine, { depth = 18, lichessGameId, numPv = 3 } = {}) {
  const posBefore = positions[plyIdx - 1];
  const fenBefore = posBefore?.fen;
  if (!fenBefore) return null;
  const needsFlip = posBefore.color === 'w';
  const sign = needsFlip ? -1 : 1;

  let topAlternatives = null;
  if (lichessGameId) {
    topAlternatives = await fetchLichessCloudEval(fenBefore, numPv, needsFlip).catch(() => null);
  }
  if (!topAlternatives && engine?.analyzePosition) {
    const altLines = await engine.analyzePosition(fenBefore, depth, numPv).catch(() => null);
    topAlternatives = (altLines ?? []).map(l => ({
      san: l.pv?.[0] ?? null,
      eval_cp: l.mate != null ? null : Math.round((l.score ?? 0) * 100 * sign),
      mate: l.mate != null ? (needsFlip ? -l.mate : l.mate) : null,
      pv_san: l.pv?.slice(0, 5) ?? [],
    })).filter(alt => alt.san);
  }

  let refutationPv = [];
  const fenAfter = positions[plyIdx]?.fen;
  if (fenAfter && engine?.analyzePosition) {
    const refLines = await engine.analyzePosition(fenAfter, depth, 1).catch(() => null);
    refutationPv = refLines?.[0]?.pv?.slice(0, 5) ?? [];
  }

  return {
    top_alternatives: topAlternatives ?? [],
    refutation_pv: refutationPv,
  };
}

function scrubResultExplanations(result, momentEngineData) {
  if (!result?.moments) return;
  const strip = s => s?.replace(/[+#]$/, '');
  result.moments = result.moments.map(m => {
    const engineData = momentEngineData[m.moveIdx];
    if (!engineData) return m;
    const allowedSANs = new Set([
      ...(engineData.top_alternatives?.flatMap(a => (a.pv_san ?? []).map(strip)) ?? []),
      ...(engineData.refutation_pv ?? []).map(strip),
    ].filter(Boolean));
    if (allowedSANs.size === 0) return m;
    const scrubbed = scrubExplanation(m.explanation, allowedSANs);
    return scrubbed !== m.explanation ? { ...m, explanation: scrubbed } : m;
  });
}

// Run Claude commentary on an already-evaluated game.
// Pass engine to enable v1.2 engine-grounded prompt (pre-computes alternatives per moment).
// promptBuilder: optional fn(pgn, moments, summary, evals, tone) => string override (skips engine path).
export async function analyzeWithClaude(game, pgn, { apiKey, tone = 'beginner', model, promptBuilder, engine, engineDepth = 12, perspective = null } = {}) {
  const key = apiKey
    ?? (typeof process !== 'undefined' ? process.env?.ANTHROPIC_API_KEY : null);
  if (!key) throw new Error('No Anthropic API key — set ANTHROPIC_API_KEY env var or pass apiKey');
  const effectivePgn = pgn ?? reconstructPgn(game);

  let effectivePromptBuilder = promptBuilder;
  let momentEngineData = null;
  if (!effectivePromptBuilder && engine?.analyzePosition) {
    momentEngineData = await computeMomentEngineData(game, engine, { depth: engineDepth });
    effectivePromptBuilder = (pgn, moments, summary, evals, tone) =>
      buildPrompt(pgn, moments, summary, evals, tone, { momentEngineData, perspective });
  }

  const { result, prompt } = await analyzeGameWithUsage(effectivePgn, game.moments, game.summary, game.evals, key, tone, model, effectivePromptBuilder);
  if (momentEngineData) scrubResultExplanations(result, momentEngineData);
  return { result, merged: mergeAnalysis(game, result), prompt, momentEngineData };
}

function reconstructPgn(game) {
  return game.positions.slice(1).map((p, i) => {
    const n = Math.ceil((i + 1) / 2);
    return (i % 2 === 0 ? `${n}. ` : '') + p.san;
  }).join(' ');
}

// Full pipeline: parse PGN → Stockfish → Claude.
// Returns { game, claudeResult, merged } or null if aborted.
export async function analyzePgn(pgn, {
  engine,
  apiKey,
  tone = 'beginner',
  model,
  promptBuilder,
  signal,
  onProgress,
} = {}) {
  const parsed = parseGame(pgn);
  const game = await analyzePositions(parsed, engine, { signal, onProgress });
  if (!game) return null;
  const { result, merged } = await analyzeWithClaude(game, pgn, { apiKey, tone, model, promptBuilder });
  return { game, claudeResult: result, merged };
}
