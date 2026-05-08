import { Chess } from "chess.js";

export function parseLichessUrl(input) {
  const match = input.trim().match(/lichess\.org\/([a-zA-Z0-9]{8})/);
  return match?.[1] ?? null;
}

export async function fetchLichessGame(gameId) {
  const res = await fetch(
    `https://lichess.org/game/export/${gameId}?evals=true&clocks=false&moves=true&tags=true`,
    { headers: { Accept: "application/x-chess-pgn" } }
  );
  if (!res.ok) throw new Error(`Game not found (${res.status})`);
  return res.text();
}

function parsePgnHeaders(pgn) {
  const headers = {};
  for (const m of pgn.matchAll(/\[(\w+)\s+"([^"]*)"\]/g)) {
    headers[m[1]] = m[2];
  }
  return headers;
}

function extractEvals(pgn) {
  const evals = [];
  for (const m of pgn.matchAll(/\{[^}]*\[%eval ([^\]]+)\][^}]*\}/g)) {
    const v = m[1];
    if (v.startsWith("#-")) evals.push(-99);
    else if (v.startsWith("#")) evals.push(99);
    else evals.push(parseFloat(v));
  }
  return evals;
}

function buildPositions(pgn) {
  const chess = new Chess();
  chess.loadPgn(pgn);
  const history = chess.history({ verbose: true });
  const temp = new Chess();
  const out = [{ fen: temp.fen(), san: null, color: null, from: null, to: null }];
  for (const mv of history) {
    temp.move(mv.san);
    out.push({ fen: temp.fen(), san: mv.san, color: mv.color, from: mv.from, to: mv.to });
  }
  return out;
}

function evalLoss(before, after, color) {
  const b = before ?? 0;
  const a = after ?? b;
  // Positive = player who just moved lost centipawns
  return color === "w" ? b - a : a - b;
}

function classify(loss) {
  if (loss >= 2.0) return "blunder";
  if (loss >= 0.5) return "mistake";
  if (loss >= 0.2) return "inaccuracy";
  if (loss <= -2.0) return "brilliant";
  if (loss <= -0.5) return "great";
  return "good";
}

export function parseGame(pgn) {
  const headers = parsePgnHeaders(pgn);
  const positions = buildPositions(pgn);
  const rawEvals = extractEvals(pgn);
  const hasEvals = rawEvals.length > 0;

  // evals[0] = starting position (0.0), evals[i] = eval after move i
  const evals = [0.0];
  for (let i = 0; i < positions.length - 1; i++) {
    evals.push(rawEvals[i] ?? evals[evals.length - 1]);
  }

  const moments = [];
  let momentId = 1;
  for (let i = 1; i < positions.length; i++) {
    const pos = positions[i];
    const loss = evalLoss(evals[i - 1], evals[i], pos.color);
    const classification = classify(loss);
    if (classification !== "good") {
      const moveNum = Math.ceil(i / 2);
      const isWhite = i % 2 === 1;
      moments.push({
        id: momentId++,
        moveIdx: i,
        moveNumber: isWhite ? `${moveNum}.` : `${moveNum}...`,
        notation: pos.san,
        player: pos.color === "w" ? "white" : "black",
        classification,
        explanation: null,
        betterMoves: [],
        qa: null,
      });
    }
  }

  const date = headers.Date?.replaceAll(".", "/") ?? null;
  const eloNum = (s) => { const n = parseInt(s, 10); return isNaN(n) ? null : n; };
  const summary = {
    white: headers.White ?? "White",
    black: headers.Black ?? "Black",
    result: headers.Result ?? "*",
    event: [headers.Event, date].filter(Boolean).join(" · "),
    opening: [headers.ECO, headers.Opening].filter(Boolean).join(" · ") || null,
    termination: headers.Termination ?? null,
    whiteElo: eloNum(headers.WhiteElo),
    blackElo: eloNum(headers.BlackElo),
    whiteAcpl: eloNum(headers.WhiteAcpl),
    blackAcpl: eloNum(headers.BlackAcpl),
    moveCount: positions.length - 1,
    narrative: null,
    pattern: null,
  };

  const momentByMoveIdx = Object.fromEntries(moments.map((m) => [m.moveIdx, m]));
  const keyMoveIdxs = moments.map((m) => m.moveIdx);

  return { summary, positions, evals, moments, momentByMoveIdx, keyMoveIdxs, hasEvals };
}
