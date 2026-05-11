import { avgAccuracy, turningPointCount, biggestSwingIdx, evalInsightText } from "./design.js";

const BASE = "https://lichess.org";

export async function fetchLichessAccount(token) {
  const res = await fetch(`${BASE}/api/account`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Lichess auth failed (${res.status})`);
  return res.json();
}

// Extracts the inline [%eval ...] tags Lichess embeds in computer-analysed
// PGNs, in pawn units (mate scores clamped to ±99). Mirrors parseGame.js.
function extractEvalsFromPgn(pgn) {
  if (!pgn || typeof pgn !== "string") return [];
  const evals = [];
  for (const m of pgn.matchAll(/\{[^}]*\[%eval ([^\]]+)\][^}]*\}/g)) {
    const v = m[1];
    if (v.startsWith("#-")) evals.push(-99);
    else if (v.startsWith("#")) evals.push(99);
    else evals.push(parseFloat(v));
  }
  // evals[0] = starting position by convention; the rest follow each ply.
  return [0, ...evals];
}

export async function fetchLichessRecentGames(username, token) {
  const params = new URLSearchParams({ max: 30, opening: true, moves: true, clocks: false, evals: true, pgnInJson: true });
  const headers = { Accept: "application/x-ndjson" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}/api/games/user/${encodeURIComponent(username)}?${params}`, { headers });
  if (!res.ok) throw new Error(`Failed to fetch games (${res.status})`);
  const text = await res.text();
  return text.trim().split("\n").filter(Boolean).map((line) => {
    const g = JSON.parse(line);
    const pgn = typeof g.pgn === "string" ? g.pgn : null;
    const evals = extractEvalsFromPgn(pgn);
    const hasEvals = evals.length > 1 ||
      (Array.isArray(g.analysis) && g.analysis.length > 0);
    return {
      id: g.id,
      white: g.players.white.user?.name ?? "White",
      black: g.players.black.user?.name ?? "Black",
      whiteRating: g.players.white.rating ?? null,
      blackRating: g.players.black.rating ?? null,
      result: g.winner === "white" ? "1-0" : g.winner === "black" ? "0-1" : "½-½",
      winner: g.winner ?? null, // "white" | "black" | null (draw)
      opening: g.opening?.name ?? null,
      speed: g.speed,
      clockInitial: g.clock?.initial ?? null,
      clockIncrement: g.clock?.increment ?? null,
      playedAt: g.lastMoveAt,
      hasEvals,
      evals, // [] when no eval annotations
      stats: hasEvals && evals.length > 1
        ? {
            accuracy: avgAccuracy(evals),
            whiteAccuracy: avgAccuracy(evals, "white"),
            blackAccuracy: avgAccuracy(evals, "black"),
            turningPoints: turningPointCount(evals),
            biggestSwingIdx: biggestSwingIdx(evals),
            insight: evalInsightText(evals),
          }
        : null,
    };
  });
}
