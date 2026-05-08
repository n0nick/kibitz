const BASE = "https://lichess.org";

export async function fetchLichessAccount(token) {
  const res = await fetch(`${BASE}/api/account`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Lichess auth failed (${res.status})`);
  return res.json();
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
    return {
      id: g.id,
      white: g.players.white.user?.name ?? "White",
      black: g.players.black.user?.name ?? "Black",
      whiteRating: g.players.white.rating ?? null,
      blackRating: g.players.black.rating ?? null,
      result: g.winner === "white" ? "1-0" : g.winner === "black" ? "0-1" : "½-½",
      opening: g.opening?.name ?? null,
      speed: g.speed,
      playedAt: g.lastMoveAt,
      hasEvals: typeof g.pgn === "string" ? g.pgn.includes("[%eval") : (Array.isArray(g.analysis) && g.analysis.length > 0),
    };
  });
}
