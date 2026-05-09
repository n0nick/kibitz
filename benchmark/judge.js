#!/usr/bin/env node
/**
 * LLM judge — evaluates a benchmark analysis JSON using Opus 4.7.
 * Supports all four bucket types; injects human references and assertions
 * where available.
 *
 * Usage:
 *   node benchmark/judge.js --analysis <file.analysis.json>
 *                           [--reference <file.pgn>]
 *                           [--assertions <file.assertions.json>]
 *                           [--output <file.judge.json>]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseArgs } from 'util';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const JUDGE_MODEL = 'claude-opus-4-7';
const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';

async function callApi(prompt, apiKey) {
  const res = await fetch(ANTHROPIC_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: JUDGE_MODEL,
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message ?? `API error ${res.status}`);
  }
  const data = await res.json();
  return { text: data.content[0].text, usage: data.usage };
}

function buildJudgePrompt(analysis, referencePgn, assertions) {
  const hasReference = !!referencePgn;
  const hasAssertions = !!assertions;

  const stockfishSummary = analysis.stockfish_data?.per_ply?.length
    ? `(${analysis.stockfish_data.per_ply.length} plies analyzed at depth ${analysis.stockfish_data.depth})`
    : '(not available)';

  // Compact stockfish data: only include lines for key moments
  const keyPlies = new Set(analysis.key_moments.map(m => m.ply));
  const stockfishLines = analysis.stockfish_data?.per_ply
    ?.filter(p => keyPlies.has(p.ply))
    ?.map(p => `Ply ${p.ply}: ${p.best_lines.slice(0, 2).map(l => `[${l.eval_cp != null ? (l.eval_cp / 100).toFixed(2) : `M${l.mate}`}] ${l.moves_san.slice(0, 5).join(' ')}`).join(' | ')}`)
    ?.join('\n') ?? 'Not available';

  const kibitzMoments = analysis.key_moments.map(m =>
    `Ply ${m.ply} (${m.move_san}): ${m.classification} | eval ${(m.eval_before_cp / 100).toFixed(2)}→${(m.eval_after_cp / 100).toFixed(2)}\n  Explanation: ${m.explanation}\n  Claimed lines: ${JSON.stringify(m.claimed_lines)}\n  Alternatives: ${JSON.stringify(m.alternatives)}`
  ).join('\n\n');

  let prompt = `You are evaluating AI-generated chess commentary against Stockfish ground truth${hasReference ? ' and human expert annotations' : ''}. Be rigorous and specific. Cite move numbers (plies) in every justification.

GAME: ${analysis.game_metadata.white} vs ${analysis.game_metadata.black} (${analysis.game_metadata.result})
Opening: ${analysis.game_metadata.opening ?? 'Unknown'}

NARRATIVE: ${analysis.game_summary}

STOCKFISH ANALYSIS ${stockfishSummary}:
${stockfishLines}
`;

  if (hasReference) {
    prompt += `
HUMAN ANNOTATIONS (reference PGN with comments):
${referencePgn}
`;
  }

  prompt += `
AI COMMENTARY UNDER TEST (key moments):
${kibitzMoments}

Score the AI commentary on five dimensions, 1–5 each. For each dimension, give the score and a one-sentence justification citing specific plies.

1. **Move selection**: Did the AI flag approximately the same critical moments${hasReference ? ' the human did' : ' that Stockfish considers critical'}? Extra moments are fine if substantive. Missing key moments is bad.

2. **Tactical accuracy**: Compare every claimed tactical line in the AI output (the claimed_lines field and any tactical claims in explanation) against the Stockfish lines. Flag any claim that contains illegal moves, doesn't actually achieve what it claims, or contradicts the engine without justification. Score 1 if any hallucinated tactics are present. Score 5 only if every line is verified.

3. **Causal explanation**: Does the AI explain WHY moves are good or bad, not just label them? Generic ("this loses material") scores low; mechanism-specific ("allows Bxf6 shattering the kingside") scores high.

4. **Pedagogical value**: Does the commentary teach a transferable idea (named pattern, principle, theme) or is it positionally specific without generalization?

5. **Voice**: Does the AI sound like a coach (varied, confident where appropriate, conversational) or a template (repetitive, hedge words, generic phrasing)? Read 3–5 explanations to assess.

Then list:
- **HALLUCINATIONS**: tactical claims contradicted by Stockfish (specific ply references)
- **MISSED MOMENTS**: critical moments the AI didn't flag (with severity)
- **FALSE FLAGS**: moves flagged that don't merit it per Stockfish${hasReference ? ' AND human annotations' : ''}
`;

  if (hasAssertions) {
    prompt += `
ASSERTIONS FOR THIS POSITION:
${JSON.stringify(assertions, null, 2)}

In addition to standard scoring, verify each assertion:
- must_flag_moves: did the AI flag it with the expected classification?
- must_not_flag_moves: did the AI correctly NOT flag it?
- required_concepts: does the commentary mention or explain the concept?
- forbidden_claims: does the AI commentary make this (incorrect) claim?
`;
  }

  prompt += `
Output strictly as JSON, no preamble:
{
  "scores": {
    "move_selection": <1-5>,
    "tactical_accuracy": <1-5>,
    "causal_explanation": <1-5>,
    "pedagogical_value": <1-5>,
    "voice": <1-5>
  },
  "justifications": {
    "move_selection": "<one sentence citing specific plies>",
    "tactical_accuracy": "<one sentence citing specific plies>",
    "causal_explanation": "<one sentence citing specific plies>",
    "pedagogical_value": "<one sentence>",
    "voice": "<one sentence>"
  },
  "hallucinations": [],
  "missed": [],
  "false_flags": []${hasAssertions ? `,
  "assertion_results": {
    "must_flag_moves": [],
    "must_not_flag_moves": [],
    "required_concepts": [],
    "forbidden_claims": []
  }` : ''}
}`;

  return prompt;
}

function repairJson(raw) {
  let out = '', inStr = false, esc = false;
  for (const ch of raw) {
    if (esc) { out += ch; esc = false; continue; }
    if (ch === '\\' && inStr) { out += ch; esc = true; continue; }
    if (ch === '"') { out += ch; inStr = !inStr; continue; }
    if (inStr) {
      if (ch === '\n') { out += '\\n'; continue; }
      if (ch === '\r') { out += '\\r'; continue; }
      if (ch === '\t') { out += '\\t'; continue; }
    }
    out += ch;
  }
  return out;
}

export async function judgeAnalysis(analysisPath, { referencePath, assertionsPath, apiKey } = {}) {
  const key = apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('No ANTHROPIC_API_KEY');

  const analysis = JSON.parse(readFileSync(analysisPath, 'utf8'));
  const referencePgn = referencePath ? readFileSync(referencePath, 'utf8') : null;
  const assertions = assertionsPath ? JSON.parse(readFileSync(assertionsPath, 'utf8')) : null;

  const prompt = buildJudgePrompt(analysis, referencePgn, assertions);
  const t0 = Date.now();
  const { text, usage } = await callApi(prompt, key);
  const latencyMs = Date.now() - t0;

  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON in judge response');
  const scores = JSON.parse(repairJson(match[0]));

  return {
    ...scores,
    _meta: {
      judge_model: JUDGE_MODEL,
      game_id: path.basename(analysisPath, '.analysis.json'),
      kibitz_model: analysis.metadata.model,
      prompt_version: analysis.metadata.prompt_version,
      analysis_level: analysis.metadata.analysis_level,
      latency_ms: latencyMs,
      tokens_in: usage.input_tokens,
      tokens_out: usage.output_tokens,
    },
  };
}

// CLI entry point
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      analysis:   { type: 'string' },
      reference:  { type: 'string' },
      assertions: { type: 'string' },
      output:     { type: 'string' },
    },
  });

  if (!values.analysis) {
    console.error('Usage: node benchmark/judge.js --analysis <file.analysis.json> [--reference <ref.pgn>] [--assertions <file.assertions.json>] [--output <file.judge.json>]');
    process.exit(1);
  }

  console.error(`Judging ${values.analysis}…`);
  const result = await judgeAnalysis(values.analysis, {
    referencePath: values.reference,
    assertionsPath: values.assertions,
  });

  const json = JSON.stringify(result, null, 2);
  if (values.output) {
    mkdirSync(path.dirname(values.output), { recursive: true });
    writeFileSync(values.output, json);
    console.error(`Wrote ${values.output}`);
  } else {
    console.log(json);
  }
}
