// Design tokens + eval-derived helpers for the Kibitz redesign.
//
// Theme is "mostly dark" (cream-on-charcoal) per the design spec. A `light`
// variant is exposed via `kbzTokens('light')` for the future switcher.

const BOARD_PALETTES = {
  "cream-sage": { light: "#EDE6D2", dark: "#8FA88E", coord: "#5C6760", lastMove: "#D9C66B" },
  "warm-wood":  { light: "#EFD9B4", dark: "#B68762", coord: "#5C3A22", lastMove: "#E9B83D" },
  "slate-mute": { light: "#D6D8DC", dark: "#7C8290", coord: "#3F4250", lastMove: "#E3B344" },
  "paper-ink":  { light: "#F1ECE3", dark: "#2F2C28", coord: "#7A746A", lastMove: "#C96442" },
};

export function kbzTokens(theme = "dark", board = "cream-sage") {
  const dark = theme === "dark";
  return {
    isDark: dark,
    bg:        dark ? "#0E0F10" : "#F6F4EF",
    surface:   dark ? "#17181B" : "#FFFFFF",
    surface2:  dark ? "#1F2024" : "#EFEDE6",
    surface3:  dark ? "#26272C" : "#E6E3DA",
    text:      dark ? "#E8E7E3" : "#1A1A1C",
    textMute:  dark ? "#9A9994" : "#6B6863",
    textDim:   dark ? "#5F5E5A" : "#9A968E",
    hairline:  dark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.07)",
    inset:     dark ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.65)",
    accent:    "#7FD1A8",
    accentDim: dark ? "rgba(127,209,168,0.16)" : "rgba(127,209,168,0.22)",
    warn:      "#E8B14A",
    bad:       "#D77467",
    win:       "#7FD1A8",
    loss:      "#D77467",
    draw:      "#A8A39A",
    font: {
      sans:      '"Geist", -apple-system, system-ui, sans-serif',
      editorial: '"Newsreader", "Geist", serif',
      mono:      '"Geist Mono", ui-monospace, "SF Mono", monospace',
    },
    board: BOARD_PALETTES[board] ?? BOARD_PALETTES["cream-sage"],
  };
}

// Glyph-and-caps classification taxonomy (no pills).
export const CLASS_DEF = {
  brilliant:  { glyph: "◆", label: "Brilliant",  color: "#7FD1A8" },
  great:      { glyph: "★", label: "Great",      color: "#9CC9F5" },
  best:       { glyph: "✓", label: "Best",       color: "#7FD1A8" },
  good:       { glyph: "✓", label: "Good",       color: "#A8A39A" },
  book:       { glyph: "❑", label: "Book",       color: "#A8A39A" },
  inaccuracy: { glyph: "◐", label: "Inaccuracy", color: "#E8B14A" },
  mistake:    { glyph: "▲", label: "Mistake",    color: "#E89A4A" },
  blunder:    { glyph: "✕", label: "Blunder",    color: "#D77467" },
  missed:     { glyph: "✦", label: "Missed win", color: "#D77467" },
};

// ────────────────────────────────────────────────────────────────────────────
// Eval-derived helpers — used both for the home-screen game cards and the
// in-game eval visualisations. All input arrays follow the parseGame.js
// convention: evals[0] = starting position, evals[i] = eval after move i.

// Lichess uses a logistic mapping from centipawn loss to per-move accuracy.
// See: https://lichess.org/page/accuracy. The formula below mirrors theirs.
function winPctFromEval(ev) {
  if (ev >= 99) return 100;
  if (ev <= -99) return 0;
  // ev is in pawn units; lichess WP formula uses centipawns
  const cp = ev * 100;
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}

function moveAccuracy(prevWP, curWP) {
  // From the perspective of the side that just moved. Lichess clamps to [0, 100].
  const drop = Math.max(0, prevWP - curWP);
  const acc = 103.1668 * Math.exp(-0.04354 * drop) - 3.1669;
  return Math.max(0, Math.min(100, acc));
}

// Average accuracy across the whole game (both sides), or per side when
// `side` is "white" | "black".
export function avgAccuracy(evals, side = null) {
  if (!evals || evals.length < 2) return null;
  // For each move i (1-indexed), the mover is white when i is odd.
  const wpFromMover = (ev, moverIsWhite) => {
    const wp = winPctFromEval(ev);
    return moverIsWhite ? wp : 100 - wp;
  };
  const accs = [];
  for (let i = 1; i < evals.length; i++) {
    const moverIsWhite = i % 2 === 1;
    if (side === "white" && !moverIsWhite) continue;
    if (side === "black" && moverIsWhite) continue;
    const prevWP = wpFromMover(evals[i - 1], moverIsWhite);
    const curWP = wpFromMover(evals[i], moverIsWhite);
    accs.push(moveAccuracy(prevWP, curWP));
  }
  if (accs.length === 0) return null;
  return accs.reduce((s, v) => s + v, 0) / accs.length;
}

// Number of significant turning points (mistakes + blunders), counted per
// `loss` (eval drop in pawn units from mover's POV).
export function turningPointCount(evals) {
  if (!evals || evals.length < 2) return 0;
  let n = 0;
  for (let i = 1; i < evals.length; i++) {
    const moverIsWhite = i % 2 === 1;
    const before = evals[i - 1] ?? 0;
    const after = evals[i] ?? before;
    const loss = moverIsWhite ? before - after : after - before;
    if (loss >= 1.0) n++;
  }
  return n;
}

// Index of the single most significant turning point in `evals`, or -1.
export function biggestSwingIdx(evals) {
  if (!evals || evals.length < 2) return -1;
  let bestIdx = -1;
  let bestLoss = 0.5; // threshold — anything smaller doesn't count
  for (let i = 1; i < evals.length; i++) {
    const moverIsWhite = i % 2 === 1;
    const before = evals[i - 1] ?? 0;
    const after = evals[i] ?? before;
    const loss = moverIsWhite ? before - after : after - before;
    if (loss > bestLoss) { bestLoss = loss; bestIdx = i; }
  }
  return bestIdx;
}

// Build a smooth path string for an evals sparkline. Clamps to ±max pawns.
export function sparklinePath(evals, width, height, max = 6) {
  if (!evals || evals.length < 2) return "";
  const n = evals.length;
  const clamp = (v) => Math.max(-max, Math.min(max, v));
  const x = (i) => (i / (n - 1)) * (width - 2) + 1;
  const y = (v) => height / 2 - (clamp(v) / max) * (height / 2 - 4);
  return evals.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
}

// Reasonable insight teaser based purely on evals — used when no LLM
// narrative is available yet (eg. lichess game list cards).
export function evalInsightText(evals) {
  if (!evals || evals.length < 2) return null;
  const idx = biggestSwingIdx(evals);
  if (idx < 0) return "Quiet game — no major swings.";
  const before = evals[idx - 1] ?? 0;
  const after = evals[idx] ?? 0;
  const moveNum = Math.ceil(idx / 2);
  const side = idx % 2 === 1 ? "White" : "Black";
  const fmt = (v) => v >= 99 ? "+M" : v <= -99 ? "−M" : `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}`;
  return `Move ${moveNum} (${side}) swung ${fmt(before)} → ${fmt(after)}`;
}
