import { useState, useRef, useEffect } from "react";
import { Chess } from "chess.js";

// ─── Piece unicode ────────────────────────────────────────────────────────────

const PIECE = {
  K: "♔", Q: "♕", R: "♖", B: "♗", N: "♘", P: "♙",
  k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟",
};

// ─── Classification styles ────────────────────────────────────────────────────

const CLS = {
  brilliant:  { label: "Brilliant!!", icon: "✦", bg: "bg-indigo-500/20",  text: "text-indigo-400",  border: "border-indigo-500/40",  dot: "bg-indigo-400"  },
  good:       { label: "Good",        icon: "✓", bg: "bg-emerald-500/20", text: "text-emerald-400", border: "border-emerald-500/40", dot: "bg-emerald-400" },
  inaccuracy: { label: "Inaccuracy",  icon: "?!", bg: "bg-yellow-500/20", text: "text-yellow-400",  border: "border-yellow-500/40",  dot: "bg-yellow-400"  },
  mistake:    { label: "Mistake",     icon: "?",  bg: "bg-orange-500/20", text: "text-orange-400",  border: "border-orange-500/40",  dot: "bg-orange-400"  },
  blunder:    { label: "Blunder",     icon: "??", bg: "bg-red-500/20",    text: "text-red-400",     border: "border-red-500/40",     dot: "bg-red-400"     },
};

// ─── PGN + position builder ───────────────────────────────────────────────────

const PGN = `[Event "Paris Opera"]
[Site "Paris FRA"]
[Date "1858.11.02"]
[White "Paul Morphy"]
[Black "Duke Karl / Count Isouard"]
[Result "1-0"]

1. e4 e5 2. Nf3 d6 3. d4 Bg4 4. dxe5 Bxf3 5. Qxf3 dxe5 6. Bc4 Nf6 7. Qb3 Qe7
8. Nc3 c6 9. Bg5 b5 10. Nxb5 cxb5 11. Bxb5+ Nbd7 12. O-O-O Rd8 13. Rxd7 Rxd7
14. Rd1 Qe6 15. Bxd7+ Nxd7 16. Qb8+ Nxb8 17. Rd8# 1-0`;

function buildPositions(pgn) {
  const chess = new Chess();
  chess.loadPgn(pgn);
  const history = chess.history({ verbose: true });
  const temp = new Chess();
  const out = [{ fen: temp.fen(), san: null, color: null }];
  for (const mv of history) {
    temp.move(mv.san);
    out.push({ fen: temp.fen(), san: mv.san, color: mv.color });
  }
  return out;
}

const POSITIONS = buildPositions(PGN);

// ─── Evaluations (mock Stockfish) ─────────────────────────────────────────────
// Centipawns/100, positive = white advantage. Index matches POSITIONS (0 = start).
// Source of truth for all eval bars; MOMENTS reference these by moveIdx.
const EVALS = [
  0.0,                                           // 0: start
  0.2, 0.2, 0.3, 0.2, 0.3, 0.1, 0.3, 0.1,     // 1–8
  0.3, 0.2, 0.3, 0.2, 0.4, 0.2, 0.3, 0.2,     // 9–16
  0.2,                                           // 17: 9.Bg5
  0.8,                                           // 18: 9...b5?!
  2.1,                                           // 19: 10.Nxb5!!
  2.6,                                           // 20: 10...cxb5
  3.0,                                           // 21: 11.Bxb5+
  3.0,                                           // 22: 11...Nbd7
  4.2,                                           // 23: 12.O-O-O!
  4.2,                                           // 24: 12...Rd8
  6.8,                                           // 25: 13.Rxd7!
  6.8,                                           // 26: 13...Rxd7
  7.5,                                           // 27: 14.Rd1
  7.8,                                           // 28: 14...Qe6
  8.3,                                           // 29: 15.Bxd7+
  8.5,                                           // 30: 15...Nxd7
  99,                                            // 31: 16.Qb8+!!
  99,                                            // 32: 16...Nxb8
  99,                                            // 33: 17.Rd8#
];

// ─── Mock data ────────────────────────────────────────────────────────────────

const SUMMARY = {
  white: "Paul Morphy",
  black: "Duke Karl / Count Isouard",
  result: "1-0",
  event: "Opera House, Paris · 1858",
  moveCount: 17,
  narrative:
    "Morphy played a textbook lesson in rapid development and open-file domination. The opening was crisp — every piece activated, every move purposeful. The critical sequence began on move 10, when a knight sacrifice ripped open Black's queenside before the opponent could castle. From that point, Black was in freefall — each White move added a new attacker, and the tangled Black pieces could never untangle. The finish, a queen sacrifice on move 16, is among the most celebrated combinations in chess history.",
  pattern:
    "Piece activity over material: across the entire game, Morphy sacrificed a knight and two exchanges, but each sacrifice deepened the initiative rather than ceding it. This is the core philosophy of the romantic era — create threats that cannot all be met simultaneously, and the material will follow.",
};

// moveIdx: 1-indexed position in POSITIONS (0 = start, 1 = after 1.e4, …)
// White move N = position 2N-1, Black move N = position 2N
const MOMENTS = [
  {
    id: 1,
    moveIdx: 18,
    moveNumber: "9...",
    notation: "b5?!",
    player: "black",
    classification: "inaccuracy",
    explanation:
      "Black advances the b-pawn to challenge White's bishop, but this loosens the queenside pawn structure at precisely the wrong moment — before castling is complete. The pawn push invites the knight leap that follows and opens lines toward the uncastled king.",
    betterMoves: [
      { move: "Nbd7", reason: "Develops the knight toward the center without weakening the queenside." },
      { move: "Be7", reason: "Quiet development that prepares castling and keeps the structure sound." },
    ],
    qa: {
      question: "Why is the queenside pawn push risky here?",
      answer:
        "Black's king is still on e8 and hasn't castled. Pushing pawns in front of your uncastled king — especially ones that can be captured with tempo — invites exactly the kind of sacrifice Morphy plays on the next move. The b5 pawn essentially rolls out a red carpet for Nxb5.",
    },
  },
  {
    id: 2,
    moveIdx: 19,
    moveNumber: "10.",
    notation: "Nxb5!!",
    player: "white",
    classification: "brilliant",
    explanation:
      "Morphy sacrifices a knight to demolish Black's queenside pawn cover. The c6 pawn is forced to recapture, opening the b-file and creating a pin that Black cannot survive. Material is irrelevant here — Morphy's overwhelming development advantage makes the sacrifice practically mandatory for any advantage-seeking player.",
    betterMoves: [],
    qa: {
      question: "Why not just play Bxb5 immediately instead of sacrificing a piece?",
      answer:
        "Bxb5 is good but slower. After Nxb5, Black must take with cxb5, and then Bxb5+ comes with tempo — a check that forces the knight to block on d7, walking directly into a future discovered attack. The sequence Nxb5 → Bxb5+ forces Black into passivity immediately rather than giving them a quiet move to reorganize.",
    },
  },
  {
    id: 3,
    moveIdx: 20,
    moveNumber: "10...",
    notation: "cxb5",
    player: "black",
    classification: "mistake",
    explanation:
      "Black is forced to capture, but recapturing with the pawn opens the b-file directly toward the uncastled king. There was no satisfactory alternative — declining leaves a powerful knight anchored on b5, and taking with the queen drops c6 anyway.",
    betterMoves: [
      { move: "Qd8", reason: "Passive, but avoids weakening the pawn structure — at the cost of losing two tempos." },
    ],
    qa: {
      question: "Was there any way for Black to stay in the game after Nxb5?",
      answer:
        "Not really. Black is already in a structurally losing position — no castling rights, a compromised queenside, and White's pieces flooding in. The best practical defense was rapid counterplay, but Morphy was far too precise to allow it. Some positions simply cannot be saved.",
    },
  },
  {
    id: 4,
    moveIdx: 21,
    moveNumber: "11.",
    notation: "Bxb5+",
    player: "white",
    classification: "good",
    explanation:
      "The bishop recaptures with check, forcing Black's knight to interpose on d7. This blocks the queen's defense of the d-file and creates immediate coordination problems. The d7 knight is now badly placed — it will soon become the target of a discovered attack.",
    betterMoves: [],
    qa: {
      question: "What does the check accomplish beyond recovering material?",
      answer:
        "The check forces Nbd7, which paradoxically blocks Black's own defense. The knight on d7 now can't easily untangle, and it walks directly into the coming Rxd7 — a second sacrifice that removes Black's last active piece. Every Morphy move adds a new threat while Black's pieces grow more cramped.",
    },
  },
  {
    id: 5,
    moveIdx: 23,
    moveNumber: "12.",
    notation: "O-O-O!",
    player: "white",
    classification: "brilliant",
    explanation:
      "Morphy castles queenside, connecting his rooks directly to the d-file — the most critical open line in the position. The rook immediately eyes d7, where Black's pieces are completely tangled. This move also removes the king from the center with tempo, while simultaneously loading the most powerful gun in chess: a rook on an open file.",
    betterMoves: [],
    qa: {
      question: "Why queenside instead of kingside castling?",
      answer:
        "Castling queenside places the rook immediately on d1, pointing directly at d7 where Black's pieces are tangled. Kingside castling would require an additional rook move to achieve the same effect — a wasted tempo Morphy simply doesn't want to give. The whole game is about maximizing the efficiency of every move.",
    },
  },
  {
    id: 6,
    moveIdx: 25,
    moveNumber: "13.",
    notation: "Rxd7!",
    player: "white",
    classification: "brilliant",
    explanation:
      "A second exchange sacrifice that tears apart Black's coordination entirely. The rook takes the knight on d7, and after the forced recapture, White will swing the second rook to d1 to maintain absolute control of the file. Morphy has given up a rook for a knight but gained an initiative that cannot be stopped.",
    betterMoves: [],
    qa: {
      question: "What happens if Black doesn't recapture on d7?",
      answer:
        "If Black plays something like Qf6, White plays Rd8+! — a fork that wins immediately. The recapture is forced, and it leads directly into the beautiful finish: Rd1 doubling on the d-file, then Bxd7+ pulling the rook away, and finally the devastating queen sacrifice on b8.",
    },
  },
  {
    id: 7,
    moveIdx: 31,
    moveNumber: "16.",
    notation: "Qb8+!!",
    player: "white",
    classification: "brilliant",
    explanation:
      "One of the most famous queen sacrifices in chess history. The queen is offered on b8, and Black must accept — any other move loses material and the position. But after Nxb8, the rook delivers checkmate on d8. The geometry is perfect: the queen draws away the one piece guarding d8, completing the combination.",
    betterMoves: [],
    qa: {
      question: "Could Black decline the queen sacrifice?",
      answer:
        "Declining with Kd7 or Kf8 both lose quickly to Rd8+ and Qb7, maintaining the decisive material advantage. The queen sacrifice is not strictly necessary for a win, but it is the most forcing and most elegant continuation — and Morphy never missed a chance to be brilliant when brilliance was available.",
    },
  },
  {
    id: 8,
    moveIdx: 33,
    moveNumber: "17.",
    notation: "Rd8#",
    player: "white",
    classification: "good",
    explanation:
      "Checkmate. The rook delivers the final blow on d8, completing a combination that began six moves earlier with a knight sacrifice. The black king has no escape — the bishop on g5 controls f6, and the queen on e6 is pinned by the incoming rook. A perfectly executed miniature, played over the board in an opera box in 1858.",
    betterMoves: [],
    qa: {
      question: "What made this game so historically famous?",
      answer:
        "The Opera Game is famous because it demonstrates every principle of classical chess — rapid development, open files, piece coordination, and decisive sacrifices — condensed into just 17 moves, against opponents who were distracted and playing casually. Morphy was barely 21. The combination starting with Nxb5 was entirely over-the-board, and it remains one of the clearest illustrations of initiative ever played.",
    },
  },
];

const MOMENT_BY_MOVE_IDX = Object.fromEntries(MOMENTS.map((m) => [m.moveIdx, m]));
const KEY_MOVE_IDXS = MOMENTS.map((m) => m.moveIdx); // already sorted ascending

// ─── FEN parser ───────────────────────────────────────────────────────────────

function parseFen(fen) {
  const rows = fen.split(" ")[0].split("/");
  return rows.map((row) => {
    const rank = [];
    for (const ch of row) {
      const n = parseInt(ch, 10);
      if (!isNaN(n)) {
        for (let i = 0; i < n; i++) rank.push(null);
      } else {
        rank.push(ch);
      }
    }
    return rank;
  });
}

// ─── Chess board ──────────────────────────────────────────────────────────────

function Board({ fen }) {
  const board = parseFen(fen);
  const files = ["a", "b", "c", "d", "e", "f", "g", "h"];
  const ranks = ["8", "7", "6", "5", "4", "3", "2", "1"];

  return (
    <div className="w-full mx-auto select-none">
      <div className="flex items-stretch">
        <div className="flex flex-col mr-1" style={{ width: 12 }}>
          {ranks.map((r) => (
            <div key={r} className="flex-1 flex items-center justify-center text-[9px] text-zinc-600 font-mono">
              {r}
            </div>
          ))}
        </div>
        <div className="flex-1 flex flex-col">
          <div
            className="grid border border-zinc-600 rounded-sm overflow-hidden"
            style={{ gridTemplateColumns: "repeat(8, 1fr)" }}
          >
            {board.map((rank, ri) =>
              rank.map((piece, fi) => {
                const light = (ri + fi) % 2 === 0;
                return (
                  <div
                    key={`${ri}-${fi}`}
                    className="aspect-square flex items-center justify-center"
                    style={{ background: light ? "#f0d9b5" : "#b58863" }}
                  >
                    {piece && (
                      <span
                        style={{
                          fontSize: "clamp(13px, 5vw, 30px)",
                          lineHeight: 1,
                          userSelect: "none",
                          color: piece === piece.toUpperCase() ? "#ffffff" : "#1a1008",
                          textShadow:
                            piece === piece.toUpperCase()
                              ? "0 1px 3px rgba(0,0,0,0.95), 0 0 8px rgba(0,0,0,0.7)"
                              : "0 0 4px rgba(255,255,255,0.6), 0 1px 2px rgba(255,255,255,0.4)",
                        }}
                      >
                        {PIECE[piece]}
                      </span>
                    )}
                  </div>
                );
              })
            )}
          </div>
          <div className="flex mt-1">
            {files.map((f) => (
              <div key={f} className="flex-1 text-center text-[9px] text-zinc-600 font-mono">
                {f}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Eval bar ─────────────────────────────────────────────────────────────────

function EvalBar({ before, after }) {
  const fmt = (v) => {
    if (v >= 99) return "M";
    if (v <= -99) return "-M";
    return v > 0 ? `+${v.toFixed(1)}` : v.toFixed(1);
  };
  const toPercent = (v) => {
    if (v >= 99) return 95;
    if (v <= -99) return 5;
    return ((Math.max(-6, Math.min(6, v)) + 6) / 12) * 100;
  };
  const pct = toPercent(after);
  const swing = after >= 99 ? 99 - before : after - before;
  const gaining = swing > 0;
  return (
    <div className="flex items-center gap-2.5">
      <span className="text-xs font-mono tabular-nums text-zinc-500 w-9 text-right shrink-0">{fmt(before)}</span>
      <div className="flex-1 h-2 rounded-full bg-zinc-800 overflow-hidden">
        <div
          className="h-full rounded-full bg-zinc-200 transition-all duration-700 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs font-mono tabular-nums text-zinc-300 w-9 shrink-0">{fmt(after)}</span>
      <span className={`text-xs font-semibold w-12 text-right shrink-0 ${gaining ? "text-emerald-400" : "text-red-400"}`}>
        {after >= 99 ? (
          <span className="text-emerald-400">mate</span>
        ) : (
          <>{gaining ? "▲" : "▼"} {Math.min(Math.abs(swing), 9.9).toFixed(1)}</>
        )}
      </span>
    </div>
  );
}

// ─── Chip ─────────────────────────────────────────────────────────────────────

function Chip({ classification, small }) {
  const s = CLS[classification] ?? CLS.good;
  return (
    <span
      className={`inline-flex items-center gap-1 font-medium rounded-full border ${s.bg} ${s.text} ${s.border} ${
        small ? "text-[10px] px-2 py-0.5" : "text-xs px-2.5 py-1"
      }`}
    >
      <span className="opacity-70">{s.icon}</span>
      {s.label}
    </span>
  );
}

// ─── Move timeline ────────────────────────────────────────────────────────────

function MoveChip({ posIdx, moveIdx, setRef, onJump }) {
  const pos = POSITIONS[posIdx];
  const moment = MOMENT_BY_MOVE_IDX[posIdx];
  const isActive = posIdx === moveIdx;
  const cls = moment ? CLS[moment.classification] : null;

  return (
    <button
      ref={setRef}
      onClick={() => onJump(posIdx)}
      className={`text-[11px] font-mono px-1.5 py-1 rounded transition-all whitespace-nowrap ${
        isActive
          ? "bg-zinc-100 text-zinc-900 font-bold"
          : cls
          ? `${cls.text} hover:bg-zinc-800/60`
          : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/40"
      }`}
    >
      {pos.san}
    </button>
  );
}

function MoveTimeline({ moveIdx, onJump }) {
  const chipRefs = useRef({});

  useEffect(() => {
    chipRefs.current[moveIdx]?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "center",
    });
  }, [moveIdx]);

  const pairs = [];
  for (let w = 1; w < POSITIONS.length; w += 2) {
    pairs.push({ num: Math.ceil(w / 2), w, b: w + 1 < POSITIONS.length ? w + 1 : null });
  }

  return (
    <div className="overflow-x-auto border-b border-zinc-800/60" style={{ scrollbarWidth: "none" }}>
      <div className="flex items-center px-3 py-2 min-w-max gap-0.5">
        {pairs.map(({ num, w, b }) => (
          <div key={num} className="flex items-center gap-0.5">
            <span className="text-[10px] text-zinc-700 font-mono w-5 text-right shrink-0 mr-0.5">{num}.</span>
            <MoveChip
              posIdx={w}
              moveIdx={moveIdx}
              setRef={(el) => (chipRefs.current[w] = el)}
              onJump={onJump}
            />
            {b !== null && (
              <MoveChip
                posIdx={b}
                moveIdx={moveIdx}
                setRef={(el) => (chipRefs.current[b] = el)}
                onJump={onJump}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Chat ─────────────────────────────────────────────────────────────────────

function Chat({ moment, history, setHistory }) {
  const [input, setInput] = useState("");
  const endRef = useRef(null);
  const msgs = history[moment.id] || [];

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history, moment.id]);

  const send = () => {
    const q = input.trim();
    if (!q) return;
    const lq = q.toLowerCase();
    const lqa = moment.qa.question.toLowerCase();
    const qaWords = lqa.split(/\W+/).filter((w) => w.length > 4);
    const overlap = qaWords.filter((w) => lq.includes(w));
    const answer =
      overlap.length >= 2
        ? moment.qa.answer
        : `(LLM response would appear here — asking about the position after ${moment.moveNumber} ${moment.notation}. In a production version, the coaching engine would analyze your specific question and provide a tailored explanation.)`;
    setHistory((prev) => ({
      ...prev,
      [moment.id]: [
        ...(prev[moment.id] || []),
        { role: "user", text: q },
        { role: "assistant", text: answer },
      ],
    }));
    setInput("");
  };

  return (
    <div className="mx-4 mb-8">
      {msgs.length === 0 && (
        <button
          className="w-full text-left text-xs text-zinc-500 bg-zinc-900/50 rounded-xl px-4 py-3 mb-3 border border-zinc-800 hover:border-zinc-700 active:bg-zinc-800 transition-colors"
          onClick={() => setInput(moment.qa.question)}
        >
          <span className="text-zinc-600">Try: </span>
          <span className="italic">"{moment.qa.question}"</span>
        </button>
      )}
      {msgs.length > 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl mb-3 overflow-hidden divide-y divide-zinc-800/70">
          {msgs.map((msg, i) => (
            <div
              key={i}
              className={`px-4 py-3 text-sm leading-relaxed ${msg.role === "user" ? "text-zinc-300" : "text-zinc-400"}`}
            >
              <div
                className={`text-[9px] font-bold uppercase tracking-widest mb-1.5 ${
                  msg.role === "user" ? "text-zinc-600" : "text-indigo-500"
                }`}
              >
                {msg.role === "user" ? "You" : "Coach"}
              </div>
              <p>{msg.text}</p>
            </div>
          ))}
          <div ref={endRef} />
        </div>
      )}
      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder="Ask about this position…"
          className="flex-1 min-w-0 bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-600 transition-colors"
        />
        <button
          onClick={send}
          className="px-5 py-3 bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 rounded-xl text-sm font-semibold transition-colors shrink-0"
        >
          Ask
        </button>
      </div>
    </div>
  );
}

// ─── Summary screen ───────────────────────────────────────────────────────────

function SummaryScreen({ onClose, onJump }) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-zinc-950 max-w-md mx-auto">
      <div className="flex items-center justify-between px-4 py-4 bg-zinc-900 border-b border-zinc-800 shrink-0">
        <div>
          <div className="text-sm font-semibold text-zinc-100">{SUMMARY.white}</div>
          <div className="text-xs text-zinc-500">vs {SUMMARY.black}</div>
        </div>
        <button
          onClick={onClose}
          className="w-9 h-9 flex items-center justify-center rounded-xl bg-zinc-800 text-zinc-400 hover:text-zinc-100 transition-colors text-xl leading-none"
        >
          ×
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        <div className="p-4 space-y-4">
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: "Result", value: SUMMARY.result, color: "text-emerald-400" },
              { label: "Moves", value: SUMMARY.moveCount, color: "text-zinc-100" },
              { label: "Year", value: "1858", color: "text-zinc-100" },
            ].map((s) => (
              <div key={s.label} className="bg-zinc-900 border border-zinc-800 rounded-xl p-3 text-center">
                <div className={`text-lg font-bold ${s.color}`}>{s.value}</div>
                <div className="text-[9px] text-zinc-500 uppercase tracking-widest mt-0.5">{s.label}</div>
              </div>
            ))}
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
            <div className="text-[9px] text-zinc-500 uppercase tracking-widest mb-2.5">Game narrative</div>
            <p className="text-sm text-zinc-300 leading-[1.75]">{SUMMARY.narrative}</p>
          </div>
          <div className="bg-indigo-950/50 border border-indigo-500/20 rounded-2xl p-4">
            <div className="text-[9px] text-indigo-400 uppercase tracking-widest mb-2.5">Pattern observed</div>
            <p className="text-sm text-zinc-300 leading-[1.75]">{SUMMARY.pattern}</p>
          </div>
          <div>
            <div className="text-[9px] text-zinc-500 uppercase tracking-widest mb-2.5">Key moments</div>
            <div className="space-y-1.5">
              {MOMENTS.map((m) => (
                <button
                  key={m.id}
                  className="w-full text-left flex items-start gap-3 px-4 py-3 rounded-xl bg-zinc-900 border border-zinc-800 hover:border-zinc-700 active:bg-zinc-800 transition-colors"
                  onClick={() => onJump(m.moveIdx)}
                >
                  <div className="shrink-0 pt-0.5">
                    <span className={`text-xs font-mono font-semibold ${CLS[m.classification]?.text ?? "text-zinc-300"}`}>
                      {m.moveNumber} {m.notation}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <Chip classification={m.classification} small />
                    <p className="text-xs text-zinc-500 leading-relaxed mt-1.5 line-clamp-2">{m.explanation}</p>
                  </div>
                  <span className="text-zinc-600 text-xs mt-0.5 shrink-0">→</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main app ─────────────────────────────────────────────────────────────────

const GAME_ID = "opera-1858";

function initialIdxFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const moveParam = parseInt(params.get("move"), 10);
  if (!isNaN(moveParam) && moveParam >= 0 && moveParam < POSITIONS.length) {
    return moveParam;
  }
  return 0;
}

export default function App() {
  const [moveIdx, setMoveIdx] = useState(initialIdxFromUrl);
  const [showSummary, setShowSummary] = useState(false);
  const [chatHistory, setChatHistory] = useState({});
  const [analysisCache, setAnalysisCache] = useState({});
  const [expandedAlt, setExpandedAlt] = useState(null);
  const touchStartX = useRef(null);
  const scrollRef = useRef(null);
  const leftPanelRef = useRef(null);
  const rightPanelRef = useRef(null);

  const currentMoment = MOMENT_BY_MOVE_IDX[moveIdx] ?? null;
  const currentPos = POSITIONS[moveIdx];

  useEffect(() => {
    const params = new URLSearchParams();
    params.set("game", GAME_ID);
    params.set("move", moveIdx);
    history.replaceState(null, "", "?" + params.toString());
  }, [moveIdx]);

  const prevKeyMoment = [...KEY_MOVE_IDXS].reverse().find((i) => i < moveIdx);
  const nextKeyMoment = KEY_MOVE_IDXS.find((i) => i > moveIdx);
  const currentMomentRank = currentMoment ? MOMENTS.indexOf(currentMoment) + 1 : null;

  const jumpTo = (idx) => {
    setMoveIdx(idx);
    setExpandedAlt(null);
    for (const ref of [scrollRef, leftPanelRef, rightPanelRef]) {
      ref.current?.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  const goKeyMoment = (dir) => {
    const target = dir > 0 ? nextKeyMoment : prevKeyMoment;
    if (target !== undefined) jumpTo(target);
  };

  const stepMove = (dir) => {
    const next = moveIdx + dir;
    if (next >= 0 && next < POSITIONS.length) jumpTo(next);
  };

  useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
      if (e.key === "ArrowLeft") stepMove(-1);
      if (e.key === "ArrowRight") stepMove(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [moveIdx]);

  const onTouchStart = (e) => { touchStartX.current = e.touches[0].clientX; };
  const onTouchEnd = (e) => {
    if (touchStartX.current === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    if (Math.abs(dx) > 60) goKeyMoment(dx < 0 ? 1 : -1);
    touchStartX.current = null;
  };

  const counterLabel = currentMoment
    ? `${currentMomentRank} / ${MOMENTS.length}`
    : moveIdx === 0
    ? "Start"
    : `${moveIdx} / ${POSITIONS.length - 1}`;
  const counterSub = currentMoment ? "key moments" : "all moves";

  const commentarySection = currentMoment ? (
    <div className="mx-4 mb-4 rounded-2xl bg-zinc-900 border border-zinc-800 overflow-hidden">
      <div className="px-4 pt-4 pb-3.5 border-b border-zinc-800/60">
        <div className="flex items-center gap-3 flex-wrap mb-3">
          <span className="text-xl font-bold tracking-tight text-zinc-100 font-mono">
            {currentMoment.moveNumber} {currentMoment.notation}
          </span>
          <Chip classification={currentMoment.classification} />
        </div>
        <EvalBar before={EVALS[currentMoment.moveIdx - 1] ?? 0} after={EVALS[currentMoment.moveIdx]} />
      </div>
      <div className="px-4 py-4">
        <p className="text-sm text-zinc-300 leading-[1.75]">{currentMoment.explanation}</p>
      </div>
      {currentMoment.betterMoves.length > 0 && (
        <div className="px-4 pb-4 border-t border-zinc-800/60 pt-3.5">
          <div className="text-[9px] text-zinc-500 uppercase tracking-widest mb-3">Better alternatives</div>
          <div className="flex flex-wrap gap-2">
            {currentMoment.betterMoves.map((alt, i) => (
              <div key={i} className="flex-1 min-w-[110px]">
                <button
                  onClick={() => setExpandedAlt(expandedAlt === i ? null : i)}
                  className={`w-full text-sm px-3.5 py-2.5 rounded-xl border transition-all font-mono font-semibold ${
                    expandedAlt === i
                      ? "bg-zinc-700 border-zinc-600 text-zinc-100"
                      : "bg-zinc-800/50 border-zinc-700/50 text-zinc-300 hover:border-zinc-600 hover:bg-zinc-800"
                  }`}
                >
                  {alt.move}
                </button>
                {expandedAlt === i && (
                  <p className="mt-2 text-xs text-zinc-400 bg-zinc-800/80 border border-zinc-700/60 rounded-xl px-3.5 py-2.5 leading-relaxed">
                    {alt.reason}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  ) : (
    moveIdx > 0 && (
      <div className="mx-4 mb-4 rounded-2xl bg-zinc-900/40 border border-zinc-800/40 overflow-hidden">
        <div className="px-4 pt-4 pb-3.5 border-b border-zinc-800/40">
          <div className="mb-3">
            <span className="font-mono text-zinc-400 text-sm font-semibold">
              {Math.ceil(moveIdx / 2)}{moveIdx % 2 === 1 ? "." : "..."} {currentPos.san}
            </span>
          </div>
          <EvalBar before={EVALS[moveIdx - 1] ?? 0} after={EVALS[moveIdx]} />
        </div>
        <div className="px-4 py-4">
          {analysisCache[moveIdx] ? (
            <p className="text-sm text-zinc-400 leading-[1.75]">{analysisCache[moveIdx]}</p>
          ) : (
            <button
              onClick={() =>
                setAnalysisCache((prev) => ({
                  ...prev,
                  [moveIdx]: `(LLM analysis for ${Math.ceil(moveIdx / 2)}${moveIdx % 2 === 1 ? "." : "..."} ${currentPos.san} — in production this would include positional assessment, key threats, and coaching notes tailored to this position.)`,
                }))
              }
              className="text-xs text-zinc-500 border border-zinc-700/60 rounded-xl px-4 py-2.5 hover:border-zinc-600 hover:text-zinc-300 transition-colors"
            >
              Analyze this position
            </button>
          )}
        </div>
      </div>
    )
  );

  const chatSection = currentMoment && (
    <Chat moment={currentMoment} history={chatHistory} setHistory={setChatHistory} />
  );

  const controls = (
    <>
      {/* Primary navigation: key moment jumps */}
      <div className="flex items-center justify-between px-4 pt-2 pb-1 gap-2">
        <button
          onClick={() => goKeyMoment(-1)}
          disabled={prevKeyMoment === undefined}
          className="w-11 h-11 flex items-center justify-center rounded-xl bg-zinc-800/80 disabled:opacity-20 text-zinc-300 hover:bg-zinc-700 active:bg-zinc-600 transition-colors text-lg"
          aria-label="Previous key moment"
        >
          ←
        </button>
        <div className="text-center flex-1">
          <div className="text-sm">
            <span className={`font-semibold tabular-nums ${currentMoment ? "text-zinc-100" : "text-zinc-500"}`}>
              {counterLabel}
            </span>
          </div>
          <div className="text-[9px] text-zinc-600 uppercase tracking-widest mt-0.5">{counterSub}</div>
        </div>
        <button
          onClick={() => goKeyMoment(1)}
          disabled={nextKeyMoment === undefined}
          className="w-11 h-11 flex items-center justify-center rounded-xl bg-zinc-800/80 disabled:opacity-20 text-zinc-300 hover:bg-zinc-700 active:bg-zinc-600 transition-colors text-lg"
          aria-label="Next key moment"
        >
          →
        </button>
      </div>

      {/* Secondary navigation: single-move steps */}
      <div className="flex items-center justify-center gap-6 pb-3">
        <button
          onClick={() => stepMove(-1)}
          disabled={moveIdx === 0}
          className="flex items-center gap-1 text-xs text-zinc-600 disabled:opacity-30 hover:text-zinc-400 active:text-zinc-300 transition-colors py-1 px-2"
          aria-label="Previous move"
        >
          ‹ prev move
        </button>
        <button
          onClick={() => stepMove(1)}
          disabled={moveIdx === POSITIONS.length - 1}
          className="flex items-center gap-1 text-xs text-zinc-600 disabled:opacity-30 hover:text-zinc-400 active:text-zinc-300 transition-colors py-1 px-2"
          aria-label="Next move"
        >
          next move ›
        </button>
      </div>
    </>
  );

  return (
    <div className="h-screen bg-zinc-950 text-zinc-100 flex flex-col overflow-hidden">
      {/* Header */}
      <button
        className="flex items-center justify-between px-4 py-3.5 bg-zinc-900/90 backdrop-blur border-b border-zinc-800 text-left shrink-0 hover:bg-zinc-900 active:bg-zinc-800 transition-colors"
        onClick={() => setShowSummary(true)}
      >
        <div className="min-w-0">
          <div className="text-sm font-semibold text-zinc-100 leading-tight">
            {SUMMARY.white} <span className="text-zinc-500 font-normal">vs</span>{" "}
            <span className="text-zinc-300">{SUMMARY.black}</span>
          </div>
          <div className="text-xs text-zinc-500 mt-0.5">{SUMMARY.event}</div>
        </div>
        <div className="flex items-center gap-2 ml-3 shrink-0">
          <span className="text-xs px-2.5 py-1 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 font-semibold">
            {SUMMARY.result}
          </span>
          <span className="text-zinc-600 text-xs font-light">↑</span>
        </div>
      </button>

      {/* Body — single scroll on mobile, two columns on desktop */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto md:overflow-hidden md:flex"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        {/* Left panel: board + timeline + controls (+ commentary on mobile) */}
        <div
          ref={leftPanelRef}
          className="shrink-0 md:w-[420px] md:overflow-y-auto md:border-r md:border-zinc-800"
        >
          <div className="px-4 pt-5 pb-3">
            <Board fen={currentPos.fen} />
          </div>
          <MoveTimeline moveIdx={moveIdx} onJump={jumpTo} />
          {controls}
          {/* Commentary + chat inline on mobile only */}
          <div className="md:hidden">
            {commentarySection}
            {chatSection}
          </div>
        </div>

        {/* Right panel: commentary + chat on desktop only */}
        <div
          ref={rightPanelRef}
          className="hidden md:flex md:flex-col md:flex-1 md:overflow-y-auto"
        >
          <div className="flex-1 py-6 max-w-2xl w-full mx-auto">
            {commentarySection}
            {chatSection}
          </div>
        </div>
      </div>

      {/* Summary overlay */}
      {showSummary && (
        <SummaryScreen
          onClose={() => setShowSummary(false)}
          onJump={(targetMoveIdx) => {
            jumpTo(targetMoveIdx);
            setShowSummary(false);
          }}
        />
      )}
    </div>
  );
}
