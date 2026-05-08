const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";

function buildPrompt(pgn, moments, summary, evals) {
  const cleanPgn = pgn.replace(/\{[^}]*\}/g, "").replace(/\s+/g, " ").trim();

  const momentsList = moments
    .map((m) => {
      const before = evals[m.moveIdx - 1] ?? 0;
      const after = evals[m.moveIdx];
      const delta = after - before;
      const fmt = (v) => (v >= 99 ? "M" : v <= -99 ? "-M" : v.toFixed(1));
      return `- moveIdx ${m.moveIdx} (${m.moveNumber} ${m.notation}): ${m.classification}, eval ${fmt(before)} → ${fmt(after)} (${delta >= 0 ? "+" : ""}${delta.toFixed(1)} from white's perspective)`;
    })
    .join("\n");

  return `Analyze this chess game and return a JSON object. Write for club-level players — clear and specific, not overly technical.

White: ${summary.white}
Black: ${summary.black}
Result: ${summary.result}
Opening: ${summary.opening ?? "Unknown"}
Event: ${summary.event}

PGN:
${cleanPgn}

Key moments to analyze (eval in pawns, positive = white advantage):
${momentsList}

Return ONLY valid JSON with no markdown fences and no text outside the JSON:
{
  "narrative": "2-3 sentences: how the game unfolded and what decided it",
  "pattern": "1-2 sentences: a recurring theme or lesson from this game",
  "moments": [
    {
      "moveIdx": <number matching input>,
      "explanation": "2-3 sentences: what happened and why it matters",
      "betterMoves": [{"move": "<SAN>", "reason": "<one sentence>"}],
      "suggestedQuestion": "A specific follow-up question a student might ask about this position"
    }
  ]
}

Rules:
- betterMoves: only for inaccuracy/mistake/blunder — empty array [] for great/brilliant
- betterMoves: max 2 entries
- moveIdx values must match the input exactly
- Board annotations in explanation and betterMoves reasons only (not suggestedQuestion):
  - Single square: [[d7]] — underlines "d7", highlights that square on the board
  - Move with display text: [[Rxd7|d1-d7]] — underlines "Rxd7", highlights d1→d7
  - Use lowercase algebraic squares (a1–h8)
  - Annotate the 2–3 most important references per explanation, not every mention`;
}

export async function analyzeGame(pgn, moments, summary, evals, apiKey) {
  const res = await fetch(ANTHROPIC_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 4096,
      messages: [{ role: "user", content: buildPrompt(pgn, moments, summary, evals) }],
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message ?? `API error ${res.status}`);
  }

  const data = await res.json();
  const text = data.content[0].text;
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("No JSON in API response");
  return JSON.parse(match[0]);
}
