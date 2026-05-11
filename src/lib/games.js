// Pure (no React) helpers for game routing, PGN caching, and small UI nits.
//
// Used by both the App router and the screens — keeping them in one
// place so the screen files can stay focused on layout.

export const CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

// SPA-safe click — preserves cmd/ctrl/middle-click so users can open the
// game in a new tab without us hijacking the navigation.
export function spaClick(handler) {
  return (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    handler(e);
  };
}

export function gameSource(id) {
  if (!id || id === "opera-1858") return "demo";
  if (id.startsWith("pgn-")) return "pgn";
  return "lichess";
}

export function getCachedPgn(id) {
  try {
    const raw = localStorage.getItem(`kibitz-pgn-${id}`);
    if (!raw) return null;
    const { data, ts } = JSON.parse(raw);
    if (Date.now() - ts < CACHE_TTL) return data;
    localStorage.removeItem(`kibitz-pgn-${id}`);
  } catch {}
  return null;
}

export function setCachedPgn(id, pgn) {
  try { localStorage.setItem(`kibitz-pgn-${id}`, JSON.stringify({ data: pgn, ts: Date.now() })); } catch {}
}

export function getHistory() {
  try { return JSON.parse(localStorage.getItem("kibitz-history") ?? "[]"); } catch { return []; }
}

export function addToHistory({ id, source, white, black, result }) {
  try {
    const prev = getHistory().filter((h) => h.id !== id);
    prev.unshift({ id, source, white, black, result, reviewedAt: Date.now() });
    localStorage.setItem("kibitz-history", JSON.stringify(prev.slice(0, 30)));
  } catch {}
}

// Deterministic game id for a pasted PGN — uses the Lichess site tag if
// present, otherwise a fast hash of the move text.
export function pgnGameId(pgn) {
  const m = pgn.match(/\[Site\s+"https?:\/\/(?:www\.)?lichess\.org\/([a-zA-Z0-9]{8})(?:[/?#][^"]*)?"]/);
  if (m) return m[1];
  const moves = pgn.replace(/\[[^\]]*\]/g, '').replace(/\{[^}]*\}/g, '').replace(/\s+/g, ' ').trim();
  let h = 0;
  for (let i = 0; i < moves.length; i++) h = Math.imul(31, h) + moves.charCodeAt(i) | 0;
  return `pgn-${(h >>> 0).toString(36)}`;
}

// "12m ago" / "3h ago" / "5d ago" / "Mar 4"
export function timeAgo(ms) {
  if (!ms) return "";
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
  return new Date(ms).toLocaleDateString();
}

// W/L/D from the user's perspective (when we know which side they played).
export function resultForUser(game, lichessUser) {
  if (!lichessUser) return null;
  const u = lichessUser.toLowerCase();
  const userIsWhite = game.white?.toLowerCase() === u;
  const userIsBlack = game.black?.toLowerCase() === u;
  if (!userIsWhite && !userIsBlack) return null;
  if (!game.winner) return "D";
  if (game.winner === "white" && userIsWhite) return "W";
  if (game.winner === "black" && userIsBlack) return "W";
  return "L";
}
