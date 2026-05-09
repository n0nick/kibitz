import { parseGame, reclassifyWithEvals } from './parseGame.js';
import { analyzeGame } from './analyzeGame.js';

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

// Run Claude commentary on an already-evaluated game.
// promptBuilder: optional fn(pgn, moments, summary, evals, tone) => string to override the default prompt
export async function analyzeWithClaude(game, pgn, { apiKey, tone = 'beginner', model, promptBuilder } = {}) {
  const key = apiKey
    ?? (typeof process !== 'undefined' ? process.env?.ANTHROPIC_API_KEY : null);
  if (!key) throw new Error('No Anthropic API key — set ANTHROPIC_API_KEY env var or pass apiKey');
  const effectivePgn = pgn ?? reconstructPgn(game);
  const result = await analyzeGame(effectivePgn, game.moments, game.summary, game.evals, key, tone, model, promptBuilder);
  return { result, merged: mergeAnalysis(game, result) };
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
