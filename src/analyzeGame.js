import { Chess } from 'chess.js';
import { fmtMate } from './design.js';

const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";
export const DEFAULT_MODEL = "claude-haiku-4-5-20251001";
// v1.12 — tighten suggestedQuestion spec to steer away from introspective
// self-reflection questions ("Why did I choose X?", "How can I develop
// the habit of Y?") toward questions about the POSITION or a transferable
// PATTERN.
export const PROMPT_VERSION = "v1.12";

export const TONES = [
  { value: "beginner",     label: "Beginner",     desc: "Explain everything simply — no chess jargon, plain everyday language" },
  { value: "intermediate", label: "Intermediate", desc: "Casual club player — some chess terms are fine, explain key concepts" },
  { value: "advanced",     label: "Advanced",     desc: "Experienced player — use standard chess terminology freely" },
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
    "anthropic-beta": "prompt-caching-2024-07-31",
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

const fmtCp = cp => cp == null ? '?' : `${cp >= 0 ? '+' : ''}${(cp / 100).toFixed(1)}`;
const fmtPawns = v => v >= 99 ? 'M' : v <= -99 ? '-M' : v.toFixed(1);

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

// ────────────────────────────────────────────────────────────────────────────
// Shared helpers used by all prompt builders.

// Derives every label we need for a given mover + perspective combo, so the
// four prompt builders don't each re-compute them ad-hoc.
//
//   formatMover('white', 'white') → { color: 'white', other: 'black',
//                                     isUser: true, label: 'you',
//                                     otherLabel: 'your opponent',
//                                     movedBy: 'played by YOU (white)' }
function formatMover(player, perspective) {
  const color = player;
  const other = player === "white" ? "black" : "white";
  const isUser = perspective && perspective === player;
  return {
    color,
    other,
    isUser,
    label: isUser ? "you" : (perspective ? "your opponent" : color),
    otherLabel: isUser ? "your opponent" : (perspective ? "you" : other),
    movedBy: perspective
      ? (isUser ? `played by YOU (${color})` : `played by YOUR OPPONENT (${color})`)
      : `played by ${color}`,
  };
}

// Builds the "Engine alternatives" block used by every prompt surface.
// Three layout variants differ only in the heading and indentation:
//
//   "list" — formatMomentEntry's per-moment block; 2-space heading indent
//            + 4-space item indent so it nests under a moment bullet.
//   "move" — analyzeSinglePosition's per-move block; no heading indent,
//            2-space item indent; heading names the played move + mover.
//   "chat" — chatAboutPosition's chat block; same layout as "move" plus
//            a trailer about off-list move requests.
function formatEngineAlternatives(engineData, { mode, mover, playedSan } = {}) {
  if (!engineData?.top_alternatives?.length) return "";
  const headingIndent = mode === "list" ? "  " : "";
  const itemIndent = mode === "list" ? "    " : "  ";
  const heading = mode === "list"
    ? `${headingIndent}Engine alternatives (what to play instead; eval in pawns; +Mn = forced mate in n half-moves, lower n is faster):`
    : `Engine alternatives — moves ${mover.label} (${mover.color}) could have played INSTEAD of ${playedSan} (these apply to the position BEFORE the move; eval in pawns, +Mn = forced mate in n half-moves):`;
  const lines = engineData.top_alternatives
    .filter(a => a.san)
    .map((alt, i) => {
      const ev = alt.mate != null ? fmtMate(alt.mate) : fmtCp(alt.eval_cp);
      const pv = alt.pv_san?.slice(1, 4).join(" ");
      return `${itemIndent}${i + 1}. ${alt.san} (${ev})${pv ? ` — continuation: ${pv}` : ""}`;
    })
    .join("\n");
  const trailer = mode === "chat"
    ? `\nIf the user asks about a move not in this list, acknowledge that you don't have engine-verified analysis for it and respond cautiously based on general principles. Do not invent tactical sequences. These engine moves are NOT options for the side currently to move — they are alternatives the side that just moved could have chosen.`
    : "";
  return `${heading}\n${lines}${trailer}`;
}

// One short perspective block, shared by every builder. We previously had a
// 15-line ✗→✓ substitution table here; the model follows the rule from a
// single tight sentence at low temperature (verified empirically).
function perspectiveInstruction(perspective) {
  if (!perspective) return "";
  const you = perspective === "white" ? "White" : "Black";
  const opp = perspective === "white" ? "Black" : "White";
  return `PERSPECTIVE: You play the ${you} pieces. Address the user as "you" / "your" — never as "${you}" in third person. The opponent may be "your opponent" or "${opp}" (color is fine for the opponent only). Frame eval swings from your POV; never narrate the user's own moves in third person.`;
}

// ────────────────────────────────────────────────────────────────────────────
// Full-game prompt builder.

export function formatMomentEntry(m, evals, momentEngineData = {}, perPly = [], perspective = null) {
  const before = evals[m.moveIdx - 1] ?? 0;
  const after = evals[m.moveIdx];
  const delta = after - before;
  const side = m.player === "white" ? "White" : "Black";
  const mover = formatMover(m.player, perspective);
  const moverTag = perspective ? `, played by: ${mover.isUser ? "YOU" : "YOUR OPPONENT"}` : "";

  let entry = `- moveIdx ${m.moveIdx} (${m.moveNumber} ${m.notation}) [${side}${moverTag}]: ${m.classification}, eval ${fmtPawns(before)} → ${fmtPawns(after)} (${delta >= 0 ? "+" : ""}${delta.toFixed(1)})`;

  const engineData = momentEngineData[m.moveIdx];
  const alts = formatEngineAlternatives(engineData, { mode: "list" });
  if (alts) entry += "\n" + alts;

  if (engineData?.refutation_pv?.length > 0) {
    entry += `\n  Engine refutation after ${m.notation}: ${engineData.refutation_pv.slice(0, 4).join(" ")}`;
  } else {
    const plyEntry = perPly.find(p => p.ply === m.moveIdx);
    const engineLines = plyEntry?.best_lines?.slice(0, 2) ?? [];
    if (engineLines.length > 0) {
      entry += "\n  Engine lines after move:";
      engineLines.forEach((l, i) => {
        const ev = l.mate != null ? fmtMate(l.mate) : fmtCp(l.eval_cp);
        entry += `\n    ${i + 1}. ${l.moves_san.slice(0, 4).join(" ")} (${ev})`;
      });
    }
  }

  const mpt = engineData?.moved_piece_targets;
  if (mpt) {
    const PIECE_NAMES = { n: "Knight", b: "Bishop", r: "Rook", q: "Queen", k: "King", p: "Pawn" };
    const name = PIECE_NAMES[mpt.piece] ?? mpt.piece.toUpperCase();
    const reachable = mpt.targets.length > 0 ? mpt.targets.sort().join(", ") : "none";
    entry += `\n  Moved piece geometry: ${name} (${mpt.from}→${mpt.to}) can reach from ${mpt.to}: ${reachable}`;
  }

  return entry;
}

export const MAX_MOMENTS = 12;
export const MAX_OVERVIEW_MOMENTS = 5;

export function selectMoments(moments, evals, max = MAX_MOMENTS) {
  if (moments.length <= max) return [...moments].sort((a, b) => a.moveIdx - b.moveIdx);
  const score = (m) => {
    const before = evals[m.moveIdx - 1] ?? 0;
    const after = evals[m.moveIdx] ?? 0;
    const swing = Math.abs(after - before);
    const decisive = Math.abs(before) >= 1.5 || Math.abs(after) >= 1.5;
    return swing * (decisive ? 1.0 : 0.3);
  };
  return [...moments]
    .sort((a, b) => score(b) - score(a))
    .slice(0, max)
    .sort((a, b) => a.moveIdx - b.moveIdx);
}

// ────────────────────────────────────────────────────────────────────────────
// JSON output specs — each field's prompt-side description as a named
// constant so buildPrompt's template literal stays readable and so we can
// A/B individual fields without touching the surrounding scaffolding.

const NARRATIVE_SPEC = `ONE editorial sentence (≤45 words), TWO at most. Calm, present-tense pull-quote — name the key turn, not a move-by-move recap. Use inline emphasis markers (do NOT use any other markdown):
    • ++text++  — positive emphasis: the user's strong/sharp/winning play (renders with a soft sage highlight)
    • ~~text~~  — negative emphasis: the cost, the swing against the user, blunders (renders in alert color)
    • (text)    — natural parens for parenthetical asides (rendered muted)
    Example: 'You played the opening ++sharply++ and were on top through move 21. Then, with a quiet position (nine minutes on the clock), you traded bishop for knight on c3 — and gave up ~~five pawns of advantage~~ in a single move.'
    NO [[annotations]] in the narrative; NO **bold** or *italic*; just plain prose with the three markers above.`;

const PATTERN_SPEC = `1-2 sentences: a recurring theme or lesson. Frame as a principle (eg. 'keep tension when ahead'), not as data the user can't verify (avoid stats like '73% accuracy' unless they're in the eval list).`;

const HEADLINE_SPEC = `ONE editorial-style sentence, plain prose, no annotations, no SAN move names. Pull-quote voice naming the CONSEQUENCE — eg. 'You gave away the bishop pair — and a winning position — for one pawn and a check.' The reader has the board, the move, and the eval swing; the headline names the *stakes*.`;

const CARD_TEASER_SPEC = `ONE plain-language sentence summarising what happened. No annotations. Used on list cards alongside the headline.`;

const EXPLANATION_SPEC = `2-3 short sentences explaining the MECHANISM on the board (what tactical/positional geometry was at play). Annotation-heavy: use [[square]], [[piece|square]], [[move|from-to]] to anchor every key square. MUST start as a self-contained sentence — never with a conjunction ('But', 'And', 'So', 'Yet', 'However') that depends on the headline above. Do NOT restate the swing, the classification, or the better-line move; the UI already shows those.`;

const SUGGESTED_QUESTION_SPEC = `<omit unless there's a genuinely interesting tactical or strategic follow-up about the POSITION or a transferable PATTERN. Phrase it as the user asking the coach in first person — eg. 'Why was h5 worse than developing the knight?' or 'How would I spot this mate pattern next time?'. NOT introspective ('Why did I choose check instead of mate?', 'How can I develop the habit of scanning?') and NOT the coach quizzing the user ('Why didn't you defend your king?').>`;

// When momentEngineData is provided, produces the v1.2 engine-grounded prompt
// (engine alternatives listed per moment, LLM forbidden from inventing moves).
// Falls back to the bare format when called with no engine data.
export function buildPrompt(pgn, moments, summary, evals, tone, { perPly = [], positions = [], momentEngineData = {}, perspective = null } = {}) {
  void positions; // reserved — caller passes it for future per-ply mapping
  const hasEngineData = Object.keys(momentEngineData).length > 0;
  const cleanPgn = pgn.replace(/\{[^}]*\}/g, "").replace(/\s+/g, " ").trim();
  const topMoments = selectMoments(moments, evals);

  const momentsList = topMoments.map(m => {
    if (hasEngineData) return formatMomentEntry(m, evals, momentEngineData, perPly, perspective);
    const before = evals[m.moveIdx - 1] ?? 0;
    const after = evals[m.moveIdx];
    const delta = after - before;
    const mover = formatMover(m.player, perspective);
    const moverTag = perspective ? `, played by: ${mover.isUser ? "YOU" : "YOUR OPPONENT"}` : "";
    return `- moveIdx ${m.moveIdx} (${m.moveNumber} ${m.notation}) [${m.player === "white" ? "White" : "Black"}${moverTag}]: ${m.classification}, eval ${fmtPawns(before)} → ${fmtPawns(after)} (${delta >= 0 ? "+" : ""}${delta.toFixed(1)})`;
  }).join("\n");

  const perspLine = perspectiveInstruction(perspective);
  const systemLine = hasEngineData
    ? `You are a chess coach explaining specific moments in a game. You are NOT a chess engine. All chess truth comes from the engine output provided below. You translate engine analysis into coaching prose.${perspLine ? `\n\n${perspLine}` : ""}\n\n`
    : (perspLine ? `${perspLine}\n\n` : "");

  const evalHeader = hasEngineData
    ? `Key moments (eval in pawns, positive = White advantage; each entry names the side that just moved${perspective ? " and whether it was played by YOU or YOUR OPPONENT" : ""}):`
    : "Key moments (eval in pawns, positive = white advantage):";

  const betterMovesRule = hasEngineData
    ? "betterMoves: use ONLY moves appearing verbatim in the engine alternatives above. Empty [] if none apply."
    : "betterMoves only for inaccuracy/mistake/blunder ([] for great/brilliant), max 2";

  const extraRules = hasEngineData
    ? `\n- NEVER name a move anywhere in your response unless it appears verbatim in the engine alternatives or refutation lines provided above. If you cannot cite an engine-grounded move, describe the idea in words without naming the move.
- Do not make claims about tactical motifs (pins, forks, skewers, discovered attacks) unless the geometry is visible in the provided engine lines.`
    : "";

  const perspRule = perspective
    ? `\n- PERSPECTIVE applies to every text field — narrative, pattern, headline, card_teaser, explanation, betterMoves[].reason. The user must always be "you" — never written as "${perspective === "white" ? "White" : "Black"}". The opponent can be "your opponent" or "${perspective === "white" ? "Black" : "White"}" (color is fine for the opponent only).`
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
  "narrative": "${NARRATIVE_SPEC}",
  "pattern": "${PATTERN_SPEC}",
  "moments": [
    {
      "moveIdx": <number>,
      "headline": "${HEADLINE_SPEC}",
      "card_teaser": "${CARD_TEASER_SPEC}",
      "explanation": "${EXPLANATION_SPEC}",
      "betterMoves": [{"move": "<SAN>", "reason": "<one sentence with [[annotations]]>"}],
      "suggestedQuestion": "${SUGGESTED_QUESTION_SPEC}"
    }
  ]
}

Rules:
- ${betterMovesRule}${extraRules}
- Output exactly the moveIdx values listed above, no more, no less
- headline must NEVER contain [[annotations]], SAN move names, or eval numbers — it's a pull-quote${perspRule}
- card_teaser must be ONE sentence only, no [[annotation]] syntax, plain language a non-expert can read
- ${ANNOTATION_RULES}`;
}

// ────────────────────────────────────────────────────────────────────────────
// Output post-processing.

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

// ────────────────────────────────────────────────────────────────────────────
// API surface.

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

export async function analyzeSinglePosition({ summary, moveNumber, notation, classification, evalBefore, evalAfter, fen, fenBefore, fenAfter, mover, tone, engineData, perspective }, apiKey) {
  // Disambiguate whose move this is so the engine alternatives below are
  // never misinterpreted. Falls back to inferring from moveNumber (`9.` =
  // white, `9...` = black).
  const moverColor = mover ?? (moveNumber?.includes("...") ? "black" : "white");
  const m = formatMover(moverColor, perspective);

  let engineSection = "";
  const alts = formatEngineAlternatives(engineData, { mode: "move", mover: m, playedSan: notation });
  if (alts) engineSection += `\n${alts}`;
  if (engineData?.refutation_pv?.length > 0) {
    engineSection += `\nEngine refutation — how ${m.otherLabel} (${m.other}) punishes ${notation}: ${engineData.refutation_pv.slice(0, 4).join(" ")}`;
  }

  const perspLine = perspectiveInstruction(perspective);
  const systemLine = engineData
    ? `You are a chess coach. You are NOT a chess engine. All chess truth comes from the engine output provided below. You translate engine analysis into coaching prose.${perspLine ? `\n\n${perspLine}` : ""}\n\n`
    : (perspLine ? `${perspLine}\n\n` : "");

  const safetyRules = engineData ? `\nRules:
- NEVER name a move anywhere in your response unless it appears verbatim in the engine alternatives or refutation provided above. If you cannot cite an engine-grounded move, describe the idea in words without naming the move.
- The engine alternatives are moves ${m.color} could have played BEFORE ${notation}. Do not suggest these as moves for ${m.other} to play now.
- Do not make claims about tactical motifs (pins, forks, skewers, discovered attacks) unless the geometry is visible in the provided engine lines.` : "";

  const movedBy = perspective
    ? (m.isUser ? `Move played by YOU (${m.color}).` : `Move played by YOUR OPPONENT (${m.color}).`)
    : `Move played by ${m.color}.`;

  const fenLines = fenBefore || fenAfter
    ? `${fenBefore ? `\nPosition BEFORE the move (${m.color} to move, alternatives below apply here): ${fenBefore}` : ""}${fenAfter ? `\nPosition AFTER the move (${m.other} to move): ${fenAfter}` : ""}`
    : (fen ? `\nPosition (FEN): ${fen}` : "");

  const prompt = `${systemLine}Analyze this chess position in 2-3 sentences. Tone: ${toneDesc(tone)}

Game: ${summary.white} vs ${summary.black} (${summary.opening ?? "Unknown opening"})
Move: ${moveNumber} ${notation} (${classification}) — ${movedBy}
Eval: ${fmtPawns(evalBefore)} → ${fmtPawns(evalAfter)} (positive favours White)${fenLines}${engineSection}

Focus on what ${m.label} could have played differently and why ${notation} was sub-optimal. Use the language of the perspective above.
${safetyRules}
${ANNOTATION_RULES}

Reply with plain text only (no JSON).`;

  const { text } = await callApi([{ role: "user", content: prompt }], apiKey);
  return { text, prompt };
}

// Game-level chat: scoped to full-game context (narrative, eval curve, turning points).
// Does NOT have per-position engine data — model must stay at principles level for tactical claims.
export async function chatAboutGame({ summary, narrative, turningPoints, pgn, evals, messages, question, tone, perspective }, apiKey) {
  const evalSample = evals?.length
    ? "Eval curve (sampled): " + evals
        .map((v, i) => (i % Math.max(1, Math.floor(evals.length / 20)) === 0 ? `m${i}:${fmtPawns(v).startsWith("-") || fmtPawns(v) === "M" ? fmtPawns(v) : `+${fmtPawns(v)}`}` : null))
        .filter(Boolean).join(" ")
    : "";

  const tpSummary = turningPoints?.length
    ? "Key turning points:\n" + turningPoints.map(m =>
        `- Move ${m.moveIdx} (${m.moveNumber} ${m.notation}, ${m.classification}): ${m.card_teaser ?? ""}`
      ).join("\n")
    : "";

  const perspLine = perspectiveInstruction(perspective);
  const system = `You are a chess coach. Game: ${summary.white} vs ${summary.black} (${summary.opening ?? "Unknown"}, ${summary.result}).${perspLine ? `\n${perspLine}` : ""}
${narrative ? `Game narrative: ${narrative}` : ""}
${tpSummary}
${evalSample}
${pgn ? `PGN:\n${pgn}` : ""}
Tone: ${toneDesc(tone)}
Reply in calm, editorial prose. Be concise. Use markdown structure where it helps:
- **bold** for action verbs and key takeaways
- *italics* for chess concepts
- "### What you could have done" as a small section header when prescribing an alternative
- bullet lists (\`- \`) for parallel reasons
Keep the answer short — two short paragraphs at most.
IMPORTANT: You have game-level context but not position-specific engine analysis for arbitrary positions. For strategic/narrative questions, answer from the context above. For specific tactical sequences not shown in the turning points, describe ideas in words rather than naming specific moves you cannot verify.`;

  const cachedSystem = [{ type: "text", text: system, cache_control: { type: "ephemeral" } }];
  const apiMessages = [
    ...messages.map((mm, i) => ({
      role: mm.role === "user" ? "user" : "assistant",
      content: i === messages.length - 1
        ? [{ type: "text", text: mm.text, cache_control: { type: "ephemeral" } }]
        : mm.text,
    })),
    { role: "user", content: question },
  ];

  const { text } = await callApi(apiMessages, apiKey, { system: cachedSystem, maxTokens: 512 });
  return { text, systemPrompt: system };
}

// Per-move chat. Accepts raw `engineData` and builds the engine block
// internally (previously the caller in DrillInScreen constructed
// `engineLine` itself, duplicating the formatter).
export async function chatAboutPosition({ summary, moment, messages, question, tone, fen, fenBefore, fenAfter, engineData, perspective }, apiKey) {
  const moverColor = moment?.player ?? (moment?.moveNumber?.includes("...") ? "black" : "white");
  const m = formatMover(moverColor, perspective);
  const perspLine = perspectiveInstruction(perspective);

  const engineLine = formatEngineAlternatives(engineData, {
    mode: "chat",
    mover: m,
    playedSan: moment.notation,
  });

  const fenLines = fenBefore || fenAfter
    ? `\nPosition BEFORE this move (${m.color} to move, engine alternatives below apply here): ${fenBefore ?? "(unavailable)"}\nPosition AFTER this move (${m.other} to move): ${fenAfter ?? "(unavailable)"}`
    : (fen ? `\nPosition (FEN): ${fen}` : "");

  const altFraming = m.isUser
    ? "Frame alternatives as what you could have played differently."
    : "IMPORTANT: The alternatives are YOUR OPPONENT'S better options — not yours. Never explain them as advice for you. Always attribute them to your opponent (e.g. 'your opponent should have castled', not 'you should castle').";

  const sectionHeader = m.isUser ? "### What you should have done" : "### What your opponent should have done";

  const system = `You are a chess coach. Game: ${summary.white} vs ${summary.black} (${summary.opening ?? "Unknown"}, ${summary.result}).${perspLine ? `\n${perspLine}` : ""}
Current move: ${moment.moveNumber} ${moment.notation} (${moment.classification}) — ${m.movedBy}.${moment.explanation ? `\nContext: ${moment.explanation}` : ""}${fenLines}${engineLine ? `\n${engineLine}` : ""}
Tone: ${toneDesc(tone)}
The engine alternatives, if shown, are moves ${m.color} could have played INSTEAD of ${moment.notation}. They do NOT apply to the current position (where ${m.other} is to move). ${altFraming}
Reply in calm, editorial coach prose. Be concise — two short paragraphs at most. Use markdown to structure the answer:
- **bold** for action verbs (**trade**, **defend**, **push**) and the key takeaway
- *italics* for chess concepts (*initiative*, *bishop pair*)
- "${sectionHeader}" as a small section header when prescribing an alternative
- bullet lists (\`- \`) when listing parallel reasons
Annotate squares and moves with the standard markup so they highlight on the board: ${ANNOTATION_RULES}
IMPORTANT: Only claim a move gives check or captures a piece if it genuinely does so in the given FEN. When an engine line is provided, use it as ground truth for tactical calculation.`;

  const cachedSystem = [{ type: "text", text: system, cache_control: { type: "ephemeral" } }];
  const apiMessages = [
    ...messages.map((mm, i) => ({
      role: mm.role === "user" ? "user" : "assistant",
      content: i === messages.length - 1
        ? [{ type: "text", text: mm.text, cache_control: { type: "ephemeral" } }]
        : mm.text,
    })),
    { role: "user", content: question },
  ];

  const { text } = await callApi(apiMessages, apiKey, { system: cachedSystem, maxTokens: 512 });
  return { text, systemPrompt: system };
}
