import { spawn } from 'child_process';
import { Chess } from 'chess.js';

function uciToSan(fen, uciMoves) {
  try {
    const chess = new Chess(fen);
    const sans = [];
    for (const uci of uciMoves) {
      const move = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] ?? undefined });
      if (!move) break;
      sans.push(move.san);
    }
    return sans;
  } catch {
    return [];
  }
}

// UCI wrapper around the native stockfish binary.
// Implements the same analyzeFullGame interface as src/stockfish.js so benchmark
// code can treat them interchangeably.
export class StockfishEngine {
  constructor(enginePath = 'stockfish') {
    this._proc = spawn(enginePath);
    this._bests = {};
    this._resolve = null;
    this._reject = null;
    this._buf = '';
    this._ready = new Promise((res, rej) => {
      this._readyResolve = res;
      this._readyReject = rej;
    });

    this._proc.stdout.on('data', (data) => {
      this._buf += data.toString();
      const lines = this._buf.split('\n');
      this._buf = lines.pop();
      for (const line of lines) this._handleLine(line.trim());
    });

    this._proc.stderr.on('data', () => {});
    this._proc.on('error', (err) => {
      this._readyReject?.(err);
      this._reject?.(err);
    });

    this._proc.stdin.write('uci\n');
    this._proc.stdin.write('isready\n');
  }

  _handleLine(l) {
    if (!l) return;
    if (l === 'readyok') {
      this._readyResolve?.();
      this._readyResolve = null;
      return;
    }
    if (l.startsWith('info') && l.includes(' pv ')) {
      const score = l.match(/score cp (-?\d+)/);
      const mate  = l.match(/score mate (-?\d+)/);
      const pv    = l.match(/ pv ([\w ]+)/);
      const depth = l.match(/\bdepth (\d+)/);
      const mpv   = l.match(/\bmultipv (\d+)/);
      const idx   = mpv ? parseInt(mpv[1]) : 1;
      if (pv) {
        this._bests[idx] = {
          score: score ? parseInt(score[1]) / 100 : null,
          mate:  mate  ? parseInt(mate[1]) : null,
          pvUci: pv[1].trim().split(' '),
          depth: depth ? parseInt(depth[1]) : 0,
        };
      }
      return;
    }
    if (l.startsWith('bestmove') && this._resolve) {
      const resolve = this._resolve;
      const bests = this._bests;
      this._resolve = null;
      this._reject = null;
      this._bests = {};
      resolve(bests);
    }
  }

  analyzePosition(fen, depth = 15, numPv = 3) {
    return new Promise(async (resolve, reject) => {
      await this._ready;
      if (this._resolve) {
        this._proc.stdin.write('stop\n');
        await new Promise(r => setTimeout(r, 50));
      }
      this._bests = {};
      this._resolve = (raw) => {
        const lines = Object.keys(raw)
          .sort((a, b) => Number(a) - Number(b))
          .map(k => {
            const r = raw[k];
            return r ? { ...r, pv: uciToSan(fen, r.pvUci ?? []) } : null;
          })
          .filter(Boolean);
        resolve(lines.length > 0 ? lines : null);
      };
      this._reject = reject;
      this._proc.stdin.write(`setoption name MultiPV value ${numPv}\n`);
      this._proc.stdin.write(`position fen ${fen}\n`);
      this._proc.stdin.write(`go depth ${depth}\n`);
    });
  }

  // Same signature as analyzeFullGame in src/stockfish.js
  async analyzeFullGame(positions, { depth = 15, onProgress, signal } = {}) {
    const evals = [0.0];
    for (let i = 1; i < positions.length; i++) {
      if (signal?.aborted) return null;
      const lines = await this.analyzePosition(positions[i].fen, depth, 1).catch(() => null);
      const r = lines?.[0];
      // UCI scores are from the side-to-move perspective. When White just moved
      // (positions[i].color === 'w'), Black is to move and the score is from Black's
      // view — negate to get a consistent White-perspective eval throughout.
      const rawScore = r
        ? (r.mate != null ? (r.mate > 0 ? 99 : -99) : (r.score ?? 0))
        : evals[evals.length - 1];
      const score = (r && positions[i].color === 'w') ? -rawScore : rawScore;
      evals.push(score);
      onProgress?.(i, positions.length - 1);
    }
    return signal?.aborted ? null : evals;
  }

  // Like analyzeFullGame but returns { evals, perPly } for detailed benchmark output.
  async analyzeFullGameDetailed(positions, { depth = 15, onProgress, signal } = {}) {
    const evals = [0.0];
    const perPly = [];
    for (let i = 1; i < positions.length; i++) {
      if (signal?.aborted) return null;
      const lines = await this.analyzePosition(positions[i].fen, depth, 3).catch(() => null);
      const top = lines?.[0];
      // Negate when White just moved (Black to move) to convert to White's perspective.
      const needsFlip = top && positions[i].color === 'w';
      const rawScore = top
        ? (top.mate != null ? (top.mate > 0 ? 99 : -99) : (top.score ?? 0))
        : evals[evals.length - 1];
      evals.push(needsFlip ? -rawScore : rawScore);
      perPly.push({
        ply: i,
        best_lines: (lines ?? []).map(l => ({
          moves_uci: l.pvUci ?? [],
          moves_san: l.pv ?? [],
          // Also convert per-line evals to White's perspective
          eval_cp: l.mate != null ? null : Math.round((l.score ?? 0) * 100 * (needsFlip ? -1 : 1)),
          mate: l.mate != null ? (needsFlip ? -l.mate : l.mate) : null,
        })),
      });
      onProgress?.(i, positions.length - 1);
    }
    return signal?.aborted ? null : { evals, perPly };
  }

  quit() {
    try { this._proc.stdin.write('quit\n'); } catch {}
  }
}
