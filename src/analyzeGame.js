const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";

export const TONES = [
  { value: "beginner",     label: "Beginner",     desc: "Explain everything simply — no chess jargon, plain everyday language" },
  { value: "intermediate", label: "Intermediate",  desc: "Casual club player — some chess terms are fine, explain key concepts" },
  { value: "advanced",     label: "Advanced",      desc: "Experienced player — use standard chess terminology freely" },
];

function toneDesc(tone) {
  return TONES.find((t) => t.value === tone)?.desc ?? TONES[0].desc;
}

async function callApi(messages, apiKey, { system, maxTokens = 1024 } = {}) {
  const body = {
    model: "claude-haiku-4-5-20251001",
    max_tokens: maxTokens,
    messages,
  };
  if (system) body.system = system;

  const res = await fetch(ANTHROPIC_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message ?? `API error ${res.status}`);
  }

  const data = await res.json();
  return data.content[0].text;
}

const ANNOTATION_RULES = `Board annotations (in explanations and reasons only):
- Square reference: [[e6]]
- Piece on a square: [[Ng5|g5]]
- Move (MUST include explicit from–to): [[Nxe6|g5-e6]]
- NEVER use [[SAN]] without a pipe — always provide |from-to
- Use lowercase algebraic squares (a1–h8)
- Annotate 2–3 most important references only`;

function buildPrompt(pgn, moments, summary, evals, tone) {
  const cleanPgn = pgn.replace(/\{[^}]*\}/g, "").replace(/\s+/g, " ").trim();
  const fmt = (v) => (v >= 99 ? "M" : v <= -99 ? "-M" : v.toFixed(1));

  const momentsList = moments
    .map((m) => {
      const before = evals[m.moveIdx - 1] ?? 0;
      const after = evals[m.moveIdx];
      const delta = after - before;
      return `- moveIdx ${m.moveIdx} (${m.moveNumber} ${m.notation}): ${m.classification}, eval ${fmt(before)} → ${fmt(after)} (${delta >= 0 ? "+" : ""}${delta.toFixed(1)})`;
    })
    .join("\n");

  return `Analyze this chess game. Tone: ${toneDesc(tone)}

White: ${summary.white} | Black: ${summary.black} | Result: ${summary.result}
Opening: ${summary.opening ?? "Unknown"} | Event: ${summary.event}

PGN:
${cleanPgn}

Key moments (eval in pawns, positive = white advantage):
${momentsList}

Return ONLY valid JSON, no markdown:
{
  "narrative": "2-3 sentences: how the game unfolded and what decided it",
  "pattern": "1-2 sentences: a recurring theme or lesson",
  "moments": [
    {
      "moveIdx": <number>,
      "explanation": "2-3 sentences: what happened and why it matters",
      "betterMoves": [{"move": "<SAN>", "reason": "<one sentence>"}],
      "suggestedQuestion": "A specific follow-up question"
    }
  ]
}

Rules:
- betterMoves only for inaccuracy/mistake/blunder ([] for great/brilliant), max 2
- Every moveIdx in input must appear in output
- ${ANNOTATION_RULES}`;
}

export async function analyzeGame(pgn, moments, summary, evals, apiKey, tone = "beginner") {
  const text = await callApi(
    [{ role: "user", content: buildPrompt(pgn, moments, summary, evals, tone) }],
    apiKey,
    { maxTokens: 4096 }
  );
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("No JSON in API response");
  return JSON.parse(match[0]);
}

export async function analyzeSinglePosition({ summary, moveNumber, notation, classification, evalBefore, evalAfter, fen, tone }, apiKey) {
  const fmt = (v) => (v >= 99 ? "M" : v <= -99 ? "-M" : v.toFixed(1));
  const prompt = `Analyze this chess position in 2-3 sentences. Tone: ${toneDesc(tone)}

Game: ${summary.white} vs ${summary.black} (${summary.opening ?? "Unknown opening"})
Move: ${moveNumber} ${notation} (${classification})
Eval: ${fmt(evalBefore)} → ${fmt(evalAfter)}

Focus on what's important about this position and what each player should consider.

${ANNOTATION_RULES}

Reply with plain text only (no JSON).`;

  return callApi([{ role: "user", content: prompt }], apiKey);
}

export async function chatAboutPosition({ summary, moment, messages, question, tone }, apiKey) {
  const system = `You are a chess coach. Game: ${summary.white} vs ${summary.black} (${summary.opening ?? "Unknown"}, ${summary.result}).
Current move: ${moment.moveNumber} ${moment.notation} (${moment.classification})${moment.explanation ? `\nContext: ${moment.explanation}` : ""}
Tone: ${toneDesc(tone)}
Be concise. Use board annotations when referencing specific squares or moves: [[e6]], [[Ng5|g5]], [[Nxe6|g5-e6]].`;

  const apiMessages = [
    ...messages.map((m) => ({ role: m.role === "user" ? "user" : "assistant", content: m.text })),
    { role: "user", content: question },
  ];

  return callApi(apiMessages, apiKey, { system, maxTokens: 512 });
}
