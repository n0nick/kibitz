import { Chess } from "chess.js";

let worker = null;
let engineReady = false;
let pendingResolve = null;
let pendingReject = null;
let currentBests = {};

function getWorker() {
  if (worker) return worker;
  worker = new Worker("/stockfish.js");
  worker.onmessage = ({ data }) => {
    if (typeof data !== "string") return;
    if (data === "readyok") engineReady = true;
    if (data.startsWith("info") && data.includes(" pv ")) {
      const score = data.match(/score cp (-?\d+)/);
      const mate  = data.match(/score mate (-?\d+)/);
      const pv    = data.match(/ pv ([\w ]+)/);
      const depth = data.match(/\bdepth (\d+)/);
      const mpv   = data.match(/\bmultipv (\d+)/);
      const idx   = mpv ? parseInt(mpv[1]) : 1;
      if (pv) {
        currentBests[idx] = {
          score: score ? parseInt(score[1]) / 100 : null,
          mate:  mate  ? parseInt(mate[1])         : null,
          pvUci: pv[1].trim().split(" "),
          depth: depth ? parseInt(depth[1])         : 0,
        };
      }
    }
    if (data.startsWith("bestmove") && pendingResolve) {
      const resolve = pendingResolve;
      pendingResolve = null;
      pendingReject  = null;
      resolve({ ...currentBests });
      currentBests = {};
    }
  };
  worker.onerror = (e) => {
    if (pendingReject) pendingReject(new Error(e.message));
    pendingResolve = null;
    pendingReject  = null;
  };
  worker.postMessage("uci");
  worker.postMessage("isready");
  return worker;
}

function uciToSan(fen, uciMoves) {
  try {
    const chess = new Chess(fen);
    const sans = [];
    for (const uci of uciMoves) {
      const move = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
      if (!move) break;
      sans.push(move.san);
    }
    return sans;
  } catch {
    return [];
  }
}

export function analyzePosition(fen, depth = 12, numPv = 3) {
  return new Promise((resolve, reject) => {
    const w = getWorker();
    if (pendingResolve) {
      w.postMessage("stop");
      pendingResolve = null;
      pendingReject  = null;
    }
    currentBests = {};
    pendingResolve = (raw) => {
      const lines = Object.keys(raw)
        .sort((a, b) => Number(a) - Number(b))
        .map((k) => {
          const r = raw[k];
          return r ? { ...r, pv: uciToSan(fen, r.pvUci ?? []) } : null;
        })
        .filter(Boolean);
      resolve(lines.length > 0 ? lines : null);
    };
    pendingReject = reject;

    const go = () => {
      w.postMessage(`setoption name MultiPV value ${numPv}`);
      w.postMessage(`position fen ${fen}`);
      w.postMessage(`go depth ${depth}`);
    };

    if (engineReady) {
      go();
    } else {
      const poll = setInterval(() => { if (engineReady) { clearInterval(poll); go(); } }, 50);
      setTimeout(() => { clearInterval(poll); reject(new Error("Stockfish ready timeout")); }, 5000);
    }
  });
}

export async function analyzeFullGame(positions, { onProgress, signal } = {}) {
  const evals = [0.0];
  for (let i = 1; i < positions.length; i++) {
    if (signal?.aborted) return null;
    const lines = await analyzePosition(positions[i].fen, 10, 1).catch(() => null);
    const r = lines?.[0];
    const score = r
      ? (r.mate != null ? (r.mate > 0 ? 99 : -99) : (r.score ?? 0))
      : evals[evals.length - 1];
    evals.push(score);
    onProgress?.(i, positions.length - 1);
  }
  return signal?.aborted ? null : evals;
}

export const browserEngine = { analyzeFullGame };

export function engineLineText(lines) {
  if (!lines || lines.length === 0) return null;
  const depth = lines[0]?.depth;
  const fmtEval = (r) => r.mate != null
    ? `Mate in ${Math.abs(r.mate)} for ${r.mate > 0 ? "White" : "Black"}`
    : `${r.score >= 0 ? "+" : ""}${r.score?.toFixed(1)}`;
  const formatted = lines
    .map((r, i) => `  ${i + 1}. ${r.pv?.slice(0, 5).join(" ")} (${fmtEval(r)})`)
    .join("\n");
  return `Engine top lines (depth ${depth}):\n${formatted}`;
}
