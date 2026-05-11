import { Chess } from 'chess.js';

const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";
export const DEFAULT_MODEL = "claude-haiku-4-5-20251001";
export const PROMPT_VERSION = "v1.2";

export const TONES = [
  { value: "beginner",     label: "Beginner",     desc: "Explain everything simply — no chess jargon, plain everyday language" },
  { value: "intermediate", label: "Intermediate",  desc: "Casual club player — some chess terms are fine, explain key concepts" },
  { value: "advanced",     label: "Advanced",      desc: "Experienced player — use standard chess terminology freely" },
];

export function toneDesc(tone) {
  return TONES.find((t) => t.value === tone)?.desc ?? TONES[0].desc;
}

async function callApi(messages, apiKey, { system, maxTokens = 1024, model = DEFAULT_MODEL } = {}) {
  const body = { model, max_tokens: maxTokens, messages };
  if (system) body.system = system;

  const headers = {
    "Content-Type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
  };
  // Browser requires this header for direct API calls; Node does not
  if (typeof window !== "undefined") {
    headers["anthropic-dangerous-direct-browser-access"] = "true";
  }

  const res = await fetch(ANTHROPIC_API, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message ?? `API error ${res.status}`);
  }

  const data = await res.json();
  return { text: data.content[0].text, usage: data.usage };
}

export const ANNOTATION_RULES = `Board annotations — USE THEM in every explanation and reason:
- Square reference: [[e6]]
- Piece on a square: [[<piece><square>|<square>]] — for example, a pawn on e4 would be [[Pe4|e4]]
- Move (MUST include explicit from–to): [[<SAN>|<from>-<to>]] — for example, the standard developing move would be [[Nf3|g1-f3]]
- NEVER use [[SAN]] without a pipe — always provide |from-to
- Use lowercase algebraic squares (a1–h8)
- Include 2–3 annotations per explanation; annotate every key square and move`;

// Regex for piece moves and pawn captures — deliberately excludes bare pawn
// advances (e4, d5) which are too ambiguous with square references in prose.
const PROSE_SAN_RE = /\b(?:[KQRBN][a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?[+#]?|[a-h]x[a-h][1-8](?:=[QRBN])?[+#]?|O-O(?:-O)?[+#]?)\b/g;

export function isLegalLine(movesSan, startFen) {
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

// Extracts move SANs mentioned in text, covering both [[SAN|from-to]] annotations
// and plain prose piece/capture moves. Strips check/mate suffixes for comparison.
export function extractMentionedSANs(text) {
  if (!text) return new Set();
  const mentioned = new Set();
  // Move annotations only: [[SAN|a1-b2]] (second part has a hyphen = from-to)
  const annotRE = /\[\[([^\]|]+)\|([a-h][1-8])-([a-h][1-8])\]\]/g;
  let m;
  while ((m = annotRE.exec(text)) !== null) mentioned.add(m[1].replace(/[+#]$/, ''));
  // Plain prose after stripping all annotations
  const stripped = text.replace(/\[\[[^\]]*\]\]/g, ' ');
  PROSE_SAN_RE.lastIndex = 0;
  while ((m = PROSE_SAN_RE.exec(stripped)) !== null) mentioned.add(m[0].replace(/[+#]$/, ''));
  return mentioned;
}

// Drops sentences whose move mentions aren't in the engine-grounded allowed set.
// Returns null if no sentences survive (caller should drop the moment).
export function scrubExplanation(text, allowedSANs) {
  if (!text || allowedSANs.size === 0) return text;
  const sentences = text.split(/(?<=[.!?])\s+/);
  const valid = sentences.filter(s => {
    const mentioned = extractMentionedSANs(s);
    return [...mentioned].every(san => allowedSANs.has(san));
  });
  return valid.length > 0 ? valid.join(' ').trim() : null;
}

const fmtCp = cp => cp == null ? '?' : `${cp >= 0 ? '+' : ''}${(cp / 100).toFixed(1)}`;

// Formats one moment entry for the prompt, including engine alternatives and
// refutation when momentEngineData is provided (v1.2 architecture).
export function formatMomentEntry(m, evals, momentEngineData = {}, perPly = []) {
  const fmt = v => v >= 99 ? 'M' : v <= -99 ? '-M' : v.toFixed(1);
  const before = evals[m.moveIdx - 1] ?? 0;
  const after = evals[m.moveIdx];
  const delta = after - before;
  const side = m.player === 'white' ? 'White' : 'Black';

  let entry = `- moveIdx ${m.moveIdx} (${m.moveNumber} ${m.notation}) [${side}]: ${m.classification}, eval ${fmt(before)} → ${fmt(after)} (${delta >= 0 ? '+' : ''}${delta.toFixed(1)})`;

  const engineData = momentEngineData[m.moveIdx];

  if (engineData?.top_alternatives?.length > 0) {
    entry += '\n  Engine alternatives (what to play instead):';
    engineData.top_alternatives.forEach((alt, i) => {
      if (!alt.san) return;
      const ev = alt.mate != null ? (alt.mate > 0 ? '+M' : '-M') : fmtCp(alt.eval_cp);
      const pv = alt.pv_san?.slice(1, 4).join(' ');
      entry += `\n    ${i + 1}. ${alt.san} (${ev})${pv ? ` — continuation: ${pv}` : ''}`;
    });
  }

  if (engineData?.refutation_pv?.length > 0) {
    entry += `\n  Engine refutation after ${m.notation}: ${engineData.refutation_pv.slice(0, 4).join(' ')}`;
  } else {
    const plyEntry = perPly.find(p => p.ply === m.moveIdx);
    const engineLines = plyEntry?.best_lines?.slice(0, 2) ?? [];
    if (engineLines.length > 0) {
      entry += '\n  Engine lines after move:';
      engineLines.forEach((l, i) => {
        const ev = l.mate != null ? (l.mate > 0 ? '+M' : '-M') : fmtCp(l.eval_cp);
        entry += `\n    ${i + 1}. ${l.moves_san.slice(0, 4).join(' ')} (${ev})`;
      });
    }
  }

  return entry;
}

export const MAX_MOMENTS = 12;
export const MAX_OVERVIEW_MOMENTS = 5;

export function selectMoments(moments, evals, max = MAX_MOMENTS) {
  if (moments.length <= max) return [...moments].sort((a, b) => a.moveIdx - b.moveIdx);
  // Proportional sampling across game thirds to cover opening/middlegame/endgame
  const totalMoves = evals.length - 1;
  const swing = (m) => Math.abs((evals[m.moveIdx] ?? 0) - (evals[m.moveIdx - 1] ?? 0));
  const bySwing = (arr) => [...arr].sort((a, b) => swing(b) - swing(a));
  const third = totalMoves / 3;
  const sections = [
    bySwing(moments.filter((m) => m.moveIdx <= third)),
    bySwing(moments.filter((m) => m.moveIdx > third && m.moveIdx <= 2 * third)),
    bySwing(moments.filter((m) => m.moveIdx > 2 * third)),
  ];
  const perSection = Math.ceil(max / 3);
  const selected = new Set(sections.flatMap((s) => s.slice(0, perSection)));
  if (selected.size < max) {
    bySwing(moments.filter((m) => !selected.has(m)))
      .slice(0, max - selected.size)
      .forEach((m) => selected.add(m));
  }
  return [...selected].sort((a, b) => a.moveIdx - b.moveIdx);
}

// When momentEngineData is provided, produces the v1.2 engine-grounded prompt
// (engine alternatives listed per moment, LLM forbidden from inventing moves).
// Falls back to v1.1 format when called with no engine data (e.g. promptBuilder override).
export function buildPrompt(pgn, moments, summary, evals, tone, { perPly = [], positions = [], momentEngineData = {} } = {}) {
  const hasEngineData = Object.keys(momentEngineData).length > 0;
  const cleanPgn = pgn.replace(/\{[^}]*\}/g, "").replace(/\s+/g, " ").trim();
  const topMoments = selectMoments(moments, evals);

  const momentsList = topMoments.map(m => {
    if (hasEngineData) return formatMomentEntry(m, evals, momentEngineData, perPly);
    const fmt = v => v >= 99 ? 'M' : v <= -99 ? '-M' : v.toFixed(1);
    const before = evals[m.moveIdx - 1] ?? 0;
    const after = evals[m.moveIdx];
    const delta = after - before;
    return `- moveIdx ${m.moveIdx} (${m.moveNumber} ${m.notation}): ${m.classification}, eval ${fmt(before)} → ${fmt(after)} (${delta >= 0 ? "+" : ""}${delta.toFixed(1)})`;
  }).join("\n");

  const systemLine = hasEngineData
    ? "You are a chess coach explaining specific moments in a game. You are NOT a chess engine. All chess truth comes from the engine output provided below. You translate engine analysis into coaching prose.\n\n"
    : "";

  const evalHeader = hasEngineData
    ? "Key moments (eval in pawns, positive = White advantage; each entry names the side that just moved):"
    : "Key moments (eval in pawns, positive = white advantage):";

  const betterMovesRule = hasEngineData
    ? "betterMoves: use ONLY moves appearing verbatim in the engine alternatives above. Empty [] if none apply."
    : "betterMoves only for inaccuracy/mistake/blunder ([] for great/brilliant), max 2";

  const extraRules = hasEngineData
    ? `\n- NEVER name a move anywhere in your response unless it appears verbatim in the engine alternatives or refutation lines provided above. If you cannot cite an engine-grounded move, describe the idea in words without naming the move.
- Do not make claims about tactical motifs (pins, forks, skewers, discovered attacks) unless the geometry is visible in the provided engine lines.`
    : "";

  return `${systemLine}Analyze this chess game. Tone: ${toneDesc(tone)}

White: ${summary.white} | Black: ${summary.black} | Result: ${summary.result}
Opening: ${summary.opening ?? "Unknown"} | Event: ${summary.event}

PGN:
${cleanPgn}

${evalHeader}
${momentsList}

Return ONLY valid JSON, no markdown:
{
  "narrative": "2-3 sentences: how the game unfolded and what decided it",
  "pattern": "1-2 sentences: a recurring theme or lesson",
  "moments": [
    {
      "moveIdx": <number>,
      "card_teaser": "ONE sentence, no annotations, plain everyday language: what happened at this moment and why it mattered",
      "explanation": "1-2 sentences with [[square/piece/move]] annotations: what happened and why it matters",
      "betterMoves": [{"move": "<SAN>", "reason": "<one sentence with [[annotations]]>"}],
      "suggestedQuestion": "<omit unless there is a genuinely interesting tactical or strategic follow-up question>"
    }
  ]
}

Rules:
- ${betterMovesRule}${extraRules}
- Output exactly the moveIdx values listed above, no more, no less
- card_teaser must be ONE sentence only, no [[annotation]] syntax, plain language a non-expert can read
- ${ANNOTATION_RULES}`;
}

function repairJson(raw) {
  // Escape literal newlines/tabs inside JSON strings (LLMs often emit these)
  let out = "", inStr = false, esc = false;
  for (const ch of raw) {
    if (esc) { out += ch; esc = false; continue; }
    if (ch === "\\" && inStr) { out += ch; esc = true; continue; }
    if (ch === '"') { out += ch; inStr = !inStr; continue; }
    if (inStr) {
      if (ch === "\n") { out += "\\n"; continue; }
      if (ch === "\r") { out += "\\r"; continue; }
      if (ch === "\t") { out += "\\t"; continue; }
    }
    out += ch;
  }
  return out;
}

// promptBuilder: optional fn(pgn, moments, summary, evals, tone) => string override
export async function analyzeGame(pgn, moments, summary, evals, apiKey, tone = "beginner", model, promptBuilder) {
  const prompt = (promptBuilder ?? buildPrompt)(pgn, moments, summary, evals, tone);
  const { text } = await callApi(
    [{ role: "user", content: prompt }],
    apiKey,
    { maxTokens: 8192, model: model ?? DEFAULT_MODEL }
  );
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("No JSON in API response");
  return JSON.parse(repairJson(match[0]));
}

export async function analyzeGameWithUsage(pgn, moments, summary, evals, apiKey, tone = "beginner", model, promptBuilder) {
  const prompt = (promptBuilder ?? buildPrompt)(pgn, moments, summary, evals, tone);
  const { text, usage } = await callApi(
    [{ role: "user", content: prompt }],
    apiKey,
    { maxTokens: 8192, model: model ?? DEFAULT_MODEL }
  );
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("No JSON in API response");
  return { result: JSON.parse(repairJson(match[0])), usage, prompt };
}

export async function analyzeSinglePosition({ summary, moveNumber, notation, classification, evalBefore, evalAfter, fen, tone, engineData }, apiKey) {
  const fmt = (v) => (v >= 99 ? "M" : v <= -99 ? "-M" : v.toFixed(1));
  const fmtCp = cp => cp == null ? '?' : `${cp >= 0 ? '+' : ''}${(cp / 100).toFixed(1)}`;

  let engineSection = '';
  if (engineData?.top_alternatives?.length > 0) {
    engineSection += '\nEngine alternatives (what to play instead):';
    engineData.top_alternatives.forEach((alt, i) => {
      if (!alt.san) return;
      const ev = alt.mate != null ? (alt.mate > 0 ? '+M' : '-M') : fmtCp(alt.eval_cp);
      const pv = alt.pv_san?.slice(1, 4).join(' ');
      engineSection += `\n  ${i + 1}. ${alt.san} (${ev})${pv ? ` — continuation: ${pv}` : ''}`;
    });
  }
  if (engineData?.refutation_pv?.length > 0) {
    engineSection += `\nEngine continuation after ${notation}: ${engineData.refutation_pv.slice(0, 4).join(' ')}`;
  }

  const systemLine = engineData
    ? 'You are a chess coach. You are NOT a chess engine. All chess truth comes from the engine output provided below. You translate engine analysis into coaching prose.\n\n'
    : '';

  const safetyRules = engineData ? `\nRules:
- NEVER name a move anywhere in your response unless it appears verbatim in the engine alternatives or continuation provided above. If you cannot cite an engine-grounded move, describe the idea in words without naming the move.
- Do not make claims about tactical motifs (pins, forks, skewers, discovered attacks) unless the geometry is visible in the provided engine lines.` : '';

  const prompt = `${systemLine}Analyze this chess position in 2-3 sentences. Tone: ${toneDesc(tone)}

Game: ${summary.white} vs ${summary.black} (${summary.opening ?? "Unknown opening"})
Move: ${moveNumber} ${notation} (${classification})
Eval: ${fmt(evalBefore)} → ${fmt(evalAfter)}${fen ? `\nPosition (FEN): ${fen}` : ''}${engineSection}

Focus on what's important about this position and what each player should consider.
${safetyRules}
${ANNOTATION_RULES}

Reply with plain text only (no JSON).`;

  const { text } = await callApi([{ role: "user", content: prompt }], apiKey);
  return { text, prompt };
}

// Game-level chat: scoped to full-game context (narrative, eval curve, turning points).
// Does NOT have per-position engine data — model must stay at principles level for tactical claims.
export async function chatAboutGame({ summary, narrative, turningPoints, pgn, evals, messages, question, tone }, apiKey) {
  const evalSample = evals?.length
    ? 'Eval curve (sampled): ' + evals
        .map((v, i) => (i % Math.max(1, Math.floor(evals.length / 20)) === 0 ? `m${i}:${v >= 99 ? '+M' : v <= -99 ? '-M' : v.toFixed(1)}` : null))
        .filter(Boolean).join(' ')
    : '';

  const tpSummary = turningPoints?.length
    ? 'Key turning points:\n' + turningPoints.map(m =>
        `- Move ${m.moveIdx} (${m.moveNumber} ${m.notation}, ${m.classification}): ${m.card_teaser ?? ''}`
      ).join('\n')
    : '';

  const system = `You are a chess coach. Game: ${summary.white} vs ${summary.black} (${summary.opening ?? 'Unknown'}, ${summary.result}).
${narrative ? `Game narrative: ${narrative}` : ''}
${tpSummary}
${evalSample}
${pgn ? `PGN:\n${pgn}` : ''}
Tone: ${toneDesc(tone)}
Be concise. Use markdown: **bold** for key points, *italic* for concepts.
IMPORTANT: You have game-level context but not position-specific engine analysis for arbitrary positions. For strategic/narrative questions, answer from the context above. For specific tactical sequences not shown in the turning points, describe ideas in words rather than naming specific moves you cannot verify.`;

  const apiMessages = [
    ...messages.map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.text })),
    { role: 'user', content: question },
  ];

  const { text } = await callApi(apiMessages, apiKey, { system, maxTokens: 512 });
  return { text, systemPrompt: system };
}

export async function chatAboutPosition({ summary, moment, messages, question, tone, fen, engineLine }, apiKey) {
  const system = `You are a chess coach. Game: ${summary.white} vs ${summary.black} (${summary.opening ?? "Unknown"}, ${summary.result}).
Current move: ${moment.moveNumber} ${moment.notation} (${moment.classification})${moment.explanation ? `\nContext: ${moment.explanation}` : ""}${fen ? `\nPosition (FEN): ${fen}` : ""}${engineLine ? `\n${engineLine}` : ""}
Tone: ${toneDesc(tone)}
Be concise. Use markdown: **bold** for key points, *italic* for concepts. ${ANNOTATION_RULES}
IMPORTANT: Only claim a move gives check or captures a piece if it genuinely does so in the given FEN. When an engine line is provided, use it as ground truth for tactical calculation.`;

  const apiMessages = [
    ...messages.map((m) => ({ role: m.role === "user" ? "user" : "assistant", content: m.text })),
    { role: "user", content: question },
  ];

  const { text } = await callApi(apiMessages, apiKey, { system, maxTokens: 512 });
  return { text, systemPrompt: system };
}
