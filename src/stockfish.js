import { Chess } from "chess.js";

let worker = null;
let engineReady = false;
let pendingResolve = null;
let pendingReject = null;
let currentBest = null;

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
      if (pv) {
        currentBest = {
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
      resolve(currentBest);
      currentBest = null;
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

export function analyzePosition(fen, depth = 15) {
  return new Promise((resolve, reject) => {
    const w = getWorker();
    if (pendingResolve) {
      w.postMessage("stop");
      pendingResolve = null;
      pendingReject  = null;
    }
    currentBest = null;
    pendingResolve = (raw) => {
      if (!raw) { resolve(null); return; }
      resolve({ ...raw, pv: uciToSan(fen, raw.pvUci ?? []) });
    };
    pendingReject = reject;

    const go = () => {
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

export function engineLineText(result) {
  if (!result) return null;
  const { score, mate, pv, depth } = result;
  const evalStr = mate != null
    ? `Mate in ${Math.abs(mate)} for ${mate > 0 ? "White" : "Black"}`
    : `eval ${score >= 0 ? "+" : ""}${score?.toFixed(1)} (White perspective)`;
  const line = pv?.slice(0, 6).join(" ");
  return `Engine (depth ${depth}): ${evalStr} — best line: ${line}`;
}
