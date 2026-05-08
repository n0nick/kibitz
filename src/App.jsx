import { useState, useRef, useEffect, createContext, useContext } from "react";
import { parseLichessUrl, fetchLichessGame, parseGame, sanToSquares } from "./parseGame";
import { analyzeGame, analyzeSinglePosition, chatAboutPosition, TONES } from "./analyzeGame";

// ─── Game context ─────────────────────────────────────────────────────────────

const GameContext = createContext(null);

// ─── Piece unicode ────────────────────────────────────────────────────────────

const PIECE = {
  K: "♔", Q: "♕", R: "♖", B: "♗", N: "♘", P: "♙",
  k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟",
};

// ─── Classification styles ────────────────────────────────────────────────────

const CLS = {
  brilliant:  { label: "Brilliant!!", icon: "✦", bg: "bg-indigo-500/20",  text: "text-indigo-400",  border: "border-indigo-500/40",  dot: "bg-indigo-400"  },
  great:      { label: "Great move",  icon: "!",  bg: "bg-sky-500/20",    text: "text-sky-400",     border: "border-sky-500/40",     dot: "bg-sky-400"     },
  good:       { label: "Good",        icon: "✓", bg: "bg-emerald-500/20", text: "text-emerald-400", border: "border-emerald-500/40", dot: "bg-emerald-400" },
  inaccuracy: { label: "Inaccuracy",  icon: "?!", bg: "bg-yellow-500/20", text: "text-yellow-400",  border: "border-yellow-500/40",  dot: "bg-yellow-400"  },
  mistake:    { label: "Mistake",     icon: "?",  bg: "bg-orange-500/20", text: "text-orange-400",  border: "border-orange-500/40",  dot: "bg-orange-400"  },
  blunder:    { label: "Blunder",     icon: "??", bg: "bg-red-500/20",    text: "text-red-400",     border: "border-red-500/40",     dot: "bg-red-400"     },
};

// ─── Demo game (Opera Game, 1858) ─────────────────────────────────────────────

const DEMO_PGN = `[Event "Paris Opera"]
[Site "Paris FRA"]
[Date "1858.11.02"]
[White "Paul Morphy"]
[Black "Duke Karl / Count Isouard"]
[Result "1-0"]

1. e4 e5 2. Nf3 d6 3. d4 Bg4 4. dxe5 Bxf3 5. Qxf3 dxe5 6. Bc4 Nf6 7. Qb3 Qe7
8. Nc3 c6 9. Bg5 b5 10. Nxb5 cxb5 11. Bxb5+ Nbd7 12. O-O-O Rd8 13. Rxd7 Rxd7
14. Rd1 Qe6 15. Bxd7+ Nxd7 16. Qb8+ Nxb8 17. Rd8# 1-0`;

const DEMO_EVALS = [
  0.0,
  0.2, 0.2, 0.3, 0.2, 0.3, 0.1, 0.3, 0.1,
  0.3, 0.2, 0.3, 0.2, 0.4, 0.2, 0.3, 0.2,
  0.2,
  0.8,
  2.1,
  2.6,
  3.0,
  3.0,
  4.2,
  4.2,
  6.8,
  6.8,
  7.5,
  7.8,
  8.3,
  8.5,
  99,
  99,
  99,
];

const DEMO_SUMMARY = {
  white: "Paul Morphy",
  black: "Duke Karl / Count Isouard",
  result: "1-0",
  event: "Opera House, Paris · 1858",
  opening: "Philidor Defense",
  moveCount: 17,
  narrative:
    "Morphy played a textbook lesson in rapid development and open-file domination. The opening was crisp — every piece activated, every move purposeful. The critical sequence began on move 10, when a knight sacrifice ripped open Black's queenside before the opponent could castle. From that point, Black was in freefall — each White move added a new attacker, and the tangled Black pieces could never untangle. The finish, a queen sacrifice on move 16, is among the most celebrated combinations in chess history.",
  pattern:
    "Piece activity over material: across the entire game, Morphy sacrificed a knight and two exchanges, but each sacrifice deepened the initiative rather than ceding it. This is the core philosophy of the romantic era — create threats that cannot all be met simultaneously, and the material will follow.",
};

const DEMO_MOMENTS = [
  {
    id: 1,
    moveIdx: 18,
    moveNumber: "9...",
    notation: "b5?!",
    player: "black",
    classification: "inaccuracy",
    explanation:
      "Black advances the b-pawn to [[b5]] to challenge White's bishop on [[Bc4|c4]], but this loosens the queenside pawn structure at precisely the wrong moment — before castling is complete. The pawn push invites the knight leap that follows and opens lines toward the uncastled king on [[e8]].",
    betterMoves: [
      { move: "Nbd7", reason: "Develops the knight to [[d7]] toward the center without weakening the queenside." },
      { move: "Be7", reason: "Quiet development to [[e7]] that prepares castling and keeps the structure sound." },
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
      "Morphy sacrifices a knight with [[Nxb5|c3-b5]] to demolish Black's queenside pawn cover. The [[c6]] pawn is forced to recapture, opening the b-file and creating a pin that Black cannot survive. Material is irrelevant here — Morphy's overwhelming development advantage makes the sacrifice practically mandatory for any advantage-seeking player.",
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
      "Black is forced to capture on [[b5]], but recapturing with the pawn opens the b-file directly toward the uncastled king on [[e8]]. There was no satisfactory alternative — declining leaves a powerful knight anchored on [[b5]], and taking with the queen drops [[c6]] anyway.",
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
      "The bishop recaptures with [[Bxb5+|c4-b5]], forcing Black's knight to interpose on [[d7]]. This blocks the queen's defense of the d-file and creates immediate coordination problems. The [[Nd7|d7]] knight is now badly placed — it will soon become the target of a discovered attack.",
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
      "Morphy castles queenside, placing the rook immediately on [[d1]] — the most critical open line in the position. The rook now eyes [[d7]], where Black's pieces are completely tangled. This move also removes the king from the center with tempo, while simultaneously loading the most powerful gun in chess: a rook on an open file.",
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
      "A second exchange sacrifice that tears apart Black's coordination entirely. The rook sweeps in with [[Rxd7|d1-d7]], and after the forced recapture White swings the second rook to [[d1]] to maintain absolute control of the file. Morphy has given up a rook for a knight but gained an initiative that cannot be stopped.",
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
      "One of the most famous queen sacrifices in chess history. The queen lands on [[Qb8+|b3-b8]] and Black must accept — any other move loses immediately. But after Nxb8, the rook delivers checkmate on [[d8]]. The geometry is perfect: the queen draws away the one piece guarding [[d8]], completing the combination.",
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
      "Checkmate. The rook delivers the final blow with [[Rd8#|d1-d8]], completing a combination that began six moves earlier. The black king on [[e8]] has no escape — Black's queen on [[Qe6|e6]] is pinned by the incoming rook and cannot interpose. A perfectly executed miniature, played over the board in an opera box in 1858.",
    betterMoves: [],
    qa: {
      question: "What made this game so historically famous?",
      answer:
        "The Opera Game is famous because it demonstrates every principle of classical chess — rapid development, open files, piece coordination, and decisive sacrifices — condensed into just 17 moves, against opponents who were distracted and playing casually. Morphy was barely 21. The combination starting with Nxb5 was entirely over-the-board, and it remains one of the clearest illustrations of initiative ever played.",
    },
  },
];

const _demoParsed = parseGame(DEMO_PGN);
const DEMO_GAME = {
  positions: _demoParsed.positions,
  summary: DEMO_SUMMARY,
  evals: DEMO_EVALS,
  moments: DEMO_MOMENTS,
  momentByMoveIdx: Object.fromEntries(DEMO_MOMENTS.map((m) => [m.moveIdx, m])),
  keyMoveIdxs: DEMO_MOMENTS.map((m) => m.moveIdx),
  hasEvals: true,
};

// ─── Analysis merge ───────────────────────────────────────────────────────────

function mergeAnalysis(game, result) {
  const updatedMoments = game.moments.map((m) => {
    const a = result.moments?.find((r) => r.moveIdx === m.moveIdx);
    if (!a) return m;
    return {
      ...m,
      explanation: a.explanation ?? m.explanation,
      betterMoves: a.betterMoves ?? m.betterMoves,
      qa: a.suggestedQuestion ? { question: a.suggestedQuestion, answer: null } : m.qa,
    };
  });
  return {
    ...game,
    summary: {
      ...game.summary,
      narrative: result.narrative ?? game.summary.narrative,
      pattern: result.pattern ?? game.summary.pattern,
    },
    moments: updatedMoments,
    momentByMoveIdx: Object.fromEntries(updatedMoments.map((m) => [m.moveIdx, m])),
  };
}

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

function Board({ fen, fromSq, toSq, altFromSq, altToSq, hoverFromSq, hoverToSq }) {
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
                const sq = `${"abcdefgh"[fi]}${8 - ri}`;
                const isAlt = sq === altFromSq || sq === altToSq;
                const isHover = sq === hoverFromSq || (hoverToSq ? sq === hoverToSq : false);
                const isMove = sq === fromSq || sq === toSq;
                const bg = isAlt
                  ? light ? "#b4d0e7" : "#6699cc"
                  : isHover
                  ? light ? "#d4b8e8" : "#9b72cf"
                  : isMove
                  ? light ? "#f6f669" : "#baca44"
                  : light ? "#f0d9b5" : "#b58863";
                return (
                  <div
                    key={`${ri}-${fi}`}
                    className="aspect-square flex items-center justify-center"
                    style={{ background: bg }}
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

// ─── Annotated text ───────────────────────────────────────────────────────────

function parseAnnotation(raw, fenBefore, fenAfter) {
  const sq = (s) => (/^[a-h][1-8]$/.test(s) ? s : null);
  const pipeIdx = raw.indexOf("|");
  if (pipeIdx !== -1) {
    const display = raw.slice(0, pipeIdx);
    const parts = raw.slice(pipeIdx + 1).split("-");
    return { display, from: sq(parts[0]), to: sq(parts[1]) ?? null };
  }
  const display = raw;
  if (sq(raw)) return { display, from: raw, to: null };
  // Fallback: try resolving as SAN against the surrounding positions
  for (const fen of [fenBefore, fenAfter].filter(Boolean)) {
    const result = sanToSquares(fen, raw);
    if (result) return { display, ...result };
  }
  return { display, from: null, to: null };
}

function AnnotatedText({ text, onHover, fenBefore, fenAfter }) {
  if (!text) return null;
  const parts = text.split(/(\[\[[^\]]*\]\])/);
  return (
    <>
      {parts.map((part, i) => {
        const match = part.match(/^\[\[([^\]]*)\]\]$/);
        if (!match) return <span key={i}>{part}</span>;
        const { display, from, to } = parseAnnotation(match[1], fenBefore, fenAfter);
        return (
          <span
            key={i}
            className="underline decoration-dotted underline-offset-2 cursor-pointer text-zinc-200 hover:text-white transition-colors"
            onMouseEnter={() => onHover({ from, to })}
            onMouseLeave={() => onHover(null)}
          >
            {display}
          </span>
        );
      })}
    </>
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
  const { positions, momentByMoveIdx } = useContext(GameContext);
  const pos = positions[posIdx];
  const moment = momentByMoveIdx[posIdx];
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
  const { positions } = useContext(GameContext);
  const chipRefs = useRef({});

  useEffect(() => {
    chipRefs.current[moveIdx]?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "center",
    });
  }, [moveIdx]);

  const pairs = [];
  for (let w = 1; w < positions.length; w += 2) {
    pairs.push({ num: Math.ceil(w / 2), w, b: w + 1 < positions.length ? w + 1 : null });
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

// ─── Rich text (markdown + annotations) ──────────────────────────────────────

function RichText({ text, onHover, fenBefore, fenAfter }) {
  if (!text) return null;

  function renderInline(str) {
    const tokens = str.split(/(\[\[[^\]]*\]\]|\*\*[^*]+\*\*|\*[^*]+\*)/);
    return tokens.map((token, i) => {
      if (token.startsWith("[[") && token.endsWith("]]")) {
        const { display, from, to } = parseAnnotation(token.slice(2, -2), fenBefore, fenAfter);
        return (
          <span
            key={i}
            className="underline decoration-dotted underline-offset-2 cursor-pointer text-zinc-200 hover:text-white transition-colors"
            onMouseEnter={() => onHover?.({ from, to })}
            onMouseLeave={() => onHover?.(null)}
          >
            {display}
          </span>
        );
      }
      if (token.startsWith("**") && token.endsWith("**")) {
        return <strong key={i} className="font-semibold text-zinc-200">{renderInline(token.slice(2, -2))}</strong>;
      }
      if (token.startsWith("*") && token.endsWith("*") && token.length > 2) {
        return <em key={i} className="italic">{renderInline(token.slice(1, -1))}</em>;
      }
      return <span key={i}>{token}</span>;
    });
  }

  const elements = [];
  for (const [i, line] of text.split("\n").entries()) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const heading = trimmed.match(/^#{1,3}\s+(.+)/);
    if (heading) {
      elements.push(<p key={i} className="font-semibold text-zinc-200">{renderInline(heading[1])}</p>);
    } else {
      elements.push(<p key={i} className="leading-relaxed">{renderInline(trimmed)}</p>);
    }
  }
  return <div className="space-y-1.5">{elements}</div>;
}

// ─── Chat ─────────────────────────────────────────────────────────────────────

function Chat({ moment, history, setHistory, apiKey, tone, onHover }) {
  const { summary, positions } = useContext(GameContext);
  const fenBefore = positions[moment.moveIdx - 1]?.fen;
  const fenAfter = positions[moment.moveIdx]?.fen;
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const endRef = useRef(null);
  const msgs = history[moment.id] || [];

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history, moment.id]);

  const send = async () => {
    const q = input.trim();
    if (!q || sending) return;
    setSending(true);
    setInput("");
    const currentMsgs = msgs;
    setHistory((prev) => ({
      ...prev,
      [moment.id]: [...(prev[moment.id] || []), { role: "user", text: q }],
    }));
    try {
      const answer = apiKey
        ? await chatAboutPosition({ summary, moment, messages: currentMsgs, question: q, tone }, apiKey)
        : "Add an Anthropic API key on the import screen to enable AI chat.";
      setHistory((prev) => ({
        ...prev,
        [moment.id]: [...(prev[moment.id] || []), { role: "assistant", text: answer }],
      }));
    } catch {
      setHistory((prev) => ({
        ...prev,
        [moment.id]: [...(prev[moment.id] || []), { role: "assistant", text: "Analysis failed. Check your API key." }],
      }));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="mx-4 mb-8">
      {msgs.length === 0 && !sending && moment.qa?.question && (
        <button
          className="w-full text-left text-xs text-zinc-500 bg-zinc-900/50 rounded-xl px-4 py-3 mb-3 border border-zinc-800 hover:border-zinc-700 active:bg-zinc-800 transition-colors"
          onClick={() => setInput(moment.qa.question)}
        >
          <span className="text-zinc-600">Try: </span>
          <span className="italic">"{moment.qa.question}"</span>
        </button>
      )}
      {(msgs.length > 0 || sending) && (
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
              {msg.role === "assistant" ? (
                <RichText text={msg.text} onHover={onHover} fenBefore={fenBefore} fenAfter={fenAfter} />
              ) : (
                <p>{msg.text}</p>
              )}
            </div>
          ))}
          {sending && (
            <div className="px-4 py-3 text-sm text-zinc-500 italic animate-pulse">
              <div className="text-[9px] font-bold uppercase tracking-widest mb-1.5 text-indigo-500">Coach</div>
              Thinking…
            </div>
          )}
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
          disabled={sending}
          className="flex-1 min-w-0 bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-600 disabled:opacity-50 transition-colors"
        />
        <button
          onClick={send}
          disabled={sending || !input.trim()}
          className="px-5 py-3 bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 disabled:opacity-40 rounded-xl text-sm font-semibold transition-colors shrink-0"
        >
          Ask
        </button>
      </div>
    </div>
  );
}

// ─── Summary screen ───────────────────────────────────────────────────────────

function SummaryContent({ onClose, onJump }) {
  const { summary, moments } = useContext(GameContext);
  return (
    <>
      <div className="flex items-center justify-between px-4 py-4 bg-zinc-900 border-b border-zinc-800 shrink-0">
        <div>
          <div className="text-sm font-semibold text-zinc-100">{summary.white}</div>
          <div className="text-xs text-zinc-500">vs {summary.black}</div>
        </div>
        <button
          onClick={onClose}
          className="w-9 h-9 flex items-center justify-center rounded-xl bg-zinc-800 text-zinc-400 hover:text-zinc-100 transition-colors text-xl leading-none"
        >
          ×
        </button>
      </div>
      <div className="p-4 space-y-4">
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: "Result", value: summary.result, color: "text-emerald-400" },
            { label: "Moves", value: summary.moveCount, color: "text-zinc-100" },
            { label: "Opening", value: summary.opening ?? "—", color: "text-zinc-100" },
          ].map((s) => (
            <div key={s.label} className="bg-zinc-900 border border-zinc-800 rounded-xl p-3 text-center">
              <div className={`text-lg font-bold truncate ${s.color}`}>{s.value}</div>
              <div className="text-[9px] text-zinc-500 uppercase tracking-widest mt-0.5">{s.label}</div>
            </div>
          ))}
        </div>
        {(summary.whiteElo || summary.blackElo || summary.whiteAcpl != null || summary.blackAcpl != null) && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800">
                  <th className="text-left px-4 py-2.5 text-[9px] text-zinc-500 uppercase tracking-widest font-medium w-1/3">Player</th>
                  <th className="text-center px-3 py-2.5 text-[9px] text-zinc-500 uppercase tracking-widest font-medium">Rating</th>
                  <th className="text-center px-3 py-2.5 text-[9px] text-zinc-500 uppercase tracking-widest font-medium">Avg loss</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60">
                {[
                  { name: summary.white, elo: summary.whiteElo, acpl: summary.whiteAcpl },
                  { name: summary.black, elo: summary.blackElo, acpl: summary.blackAcpl },
                ].map((p) => (
                  <tr key={p.name}>
                    <td className="px-4 py-2.5 text-zinc-300 truncate max-w-0 w-1/3">{p.name}</td>
                    <td className="px-3 py-2.5 text-center font-mono text-zinc-400">{p.elo ?? "—"}</td>
                    <td className="px-3 py-2.5 text-center font-mono">
                      {p.acpl != null ? (
                        <span className={p.acpl <= 20 ? "text-emerald-400" : p.acpl <= 40 ? "text-yellow-400" : "text-red-400"}>
                          {p.acpl}
                        </span>
                      ) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {summary.narrative && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
            <div className="text-[9px] text-zinc-500 uppercase tracking-widest mb-2.5">Game narrative</div>
            <p className="text-sm text-zinc-300 leading-[1.75]">{summary.narrative}</p>
          </div>
        )}
        {summary.pattern && (
          <div className="bg-indigo-950/50 border border-indigo-500/20 rounded-2xl p-4">
            <div className="text-[9px] text-indigo-400 uppercase tracking-widest mb-2.5">Pattern observed</div>
            <p className="text-sm text-zinc-300 leading-[1.75]">{summary.pattern}</p>
          </div>
        )}
        <div>
          <div className="text-[9px] text-zinc-500 uppercase tracking-widest mb-2.5">Key moments</div>
          <div className="space-y-1.5">
            {moments.map((m) => (
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
                  {m.explanation && (
                    <p className="text-xs text-zinc-500 leading-relaxed mt-1.5 line-clamp-2">{m.explanation}</p>
                  )}
                </div>
                <span className="text-zinc-600 text-xs mt-0.5 shrink-0">→</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

function SummaryScreen({ onClose, onJump }) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-zinc-950 overflow-y-auto max-w-md mx-auto md:hidden">
      <SummaryContent onClose={onClose} onJump={onJump} />
    </div>
  );
}

// ─── API key hook ─────────────────────────────────────────────────────────────

const API_KEY_STORAGE = "chess-reviewer-anthropic-key";

function useApiKey() {
  const [apiKey, setApiKeyState] = useState(() => localStorage.getItem(API_KEY_STORAGE) ?? "");
  const setApiKey = (val) => {
    const trimmed = val.trim();
    if (trimmed) localStorage.setItem(API_KEY_STORAGE, trimmed);
    else localStorage.removeItem(API_KEY_STORAGE);
    setApiKeyState(trimmed);
  };
  return [apiKey, setApiKey];
}

function useTone() {
  const [tone, setToneState] = useState(() => localStorage.getItem("chess-reviewer-tone") ?? "beginner");
  const setTone = (v) => { localStorage.setItem("chess-reviewer-tone", v); setToneState(v); };
  return [tone, setTone];
}

// ─── Import screen ────────────────────────────────────────────────────────────

function ImportScreen({ onImport, onDemo, error, setError, apiKey, setApiKey, tone, setTone }) {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [keyDraft, setKeyDraft] = useState(apiKey);
  const [keyVisible, setKeyVisible] = useState(false);

  const saveKey = () => setApiKey(keyDraft);

  const handleImport = async () => {
    const gameId = parseLichessUrl(url);
    if (!gameId) {
      setError({ message: "Paste a Lichess game URL (e.g. lichess.org/abc12345)" });
      return;
    }
    setLoading(true);
    await onImport(gameId);
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-md space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Chess Reviewer</h1>
          <p className="text-zinc-500 text-sm mt-1">Paste a Lichess game URL to get started</p>
        </div>

        {/* Game URL */}
        <div className="space-y-3">
          <input
            type="url"
            value={url}
            onChange={(e) => { setUrl(e.target.value); setError(null); }}
            onKeyDown={(e) => e.key === "Enter" && handleImport()}
            placeholder="https://lichess.org/abc12345"
            className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-600 transition-colors"
            autoFocus
          />
          {error && (
            <p className="text-sm text-red-400">
              {error.message ?? error}
              {error.gameUrl && (
                <> — <a href={error.gameUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-red-300">open on Lichess</a></>
              )}
            </p>
          )}
          <button
            onClick={handleImport}
            disabled={loading || !url.trim()}
            className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 disabled:opacity-40 rounded-xl text-sm font-semibold transition-colors"
          >
            {loading ? "Loading…" : "Import game"}
          </button>
        </div>

        <div className="text-center">
          <button
            onClick={onDemo}
            className="text-sm text-zinc-500 hover:text-zinc-300 transition-colors underline underline-offset-2"
          >
            Or try the Opera Game (demo)
          </button>
        </div>

        {/* API key */}
        <div className="border-t border-zinc-800 pt-5 space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs text-zinc-500 uppercase tracking-widest">Anthropic API key</label>
            {apiKey && (
              <span className="text-[10px] text-emerald-500">saved</span>
            )}
          </div>
          <div className="flex gap-2">
            <input
              type={keyVisible ? "text" : "password"}
              value={keyDraft}
              onChange={(e) => setKeyDraft(e.target.value)}
              onBlur={saveKey}
              onKeyDown={(e) => e.key === "Enter" && saveKey()}
              placeholder="sk-ant-…"
              className="flex-1 min-w-0 bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-600 transition-colors font-mono"
            />
            <button
              onClick={() => setKeyVisible((v) => !v)}
              className="px-3 py-3 bg-zinc-900 border border-zinc-800 rounded-xl text-zinc-500 hover:text-zinc-300 transition-colors text-xs"
              aria-label={keyVisible ? "Hide key" : "Show key"}
            >
              {keyVisible ? "hide" : "show"}
            </button>
          </div>
          <p className="text-xs text-zinc-600">
            Used for AI analysis. Stored in your browser only — never sent anywhere except Anthropic.
          </p>
        </div>

        {/* Tone */}
        <div className="space-y-2">
          <label className="text-xs text-zinc-500 uppercase tracking-widest">Analysis level</label>
          <div className="flex gap-2">
            {TONES.map((t) => (
              <button
                key={t.value}
                onClick={() => setTone(t.value)}
                className={`flex-1 py-2.5 rounded-xl text-sm font-medium border transition-colors ${
                  tone === t.value
                    ? "bg-zinc-700 border-zinc-500 text-zinc-100"
                    : "bg-zinc-900 border-zinc-800 text-zinc-500 hover:text-zinc-300 hover:border-zinc-700"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <p className="text-xs text-zinc-600 text-center leading-relaxed">
          Only games with computer analysis are supported. To add analysis, open the game on Lichess and click
          "Request a computer analysis".
        </p>
      </div>
    </div>
  );
}

// ─── Loading screen ───────────────────────────────────────────────────────────

function LoadingScreen() {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center">
      <p className="text-zinc-500 text-sm">Loading game…</p>
    </div>
  );
}

// ─── Game review (inner) ──────────────────────────────────────────────────────

function GameReviewContent({ gameId, onReset, apiKey, tone, onPatchMoment, analysisStatus }) {
  const { positions, evals, moments, momentByMoveIdx, keyMoveIdxs, summary } = useContext(GameContext);

  const [moveIdx, setMoveIdx] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const moveParam = parseInt(params.get("move"), 10);
    if (!isNaN(moveParam) && moveParam >= 0 && moveParam < positions.length) {
      return moveParam;
    }
    return 1;
  });
  const [showSummary, setShowSummary] = useState(false);
  const [chatHistory, setChatHistory] = useState({});
  const [analysisCache, setAnalysisCache] = useState({});
  const [expandedAlt, setExpandedAlt] = useState(null);
  const [hoverHighlight, setHoverHighlight] = useState(null);
  const [momentLoading, setMomentLoading] = useState({});
  const touchStartX = useRef(null);
  const scrollRef = useRef(null);
  const leftPanelRef = useRef(null);
  const rightPanelRef = useRef(null);

  const currentMoment = momentByMoveIdx[moveIdx] ?? null;
  const currentPos = positions[moveIdx];

  useEffect(() => {
    const params = new URLSearchParams();
    params.set("game", gameId);
    params.set("move", moveIdx);
    history.replaceState(null, "", "?" + params.toString());
  }, [moveIdx, gameId]);

  const prevKeyMoment = [...keyMoveIdxs].reverse().find((i) => i < moveIdx);
  const nextKeyMoment = keyMoveIdxs.find((i) => i > moveIdx);
  const currentMomentRank = currentMoment ? moments.indexOf(currentMoment) + 1 : null;

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
    if (next >= 1 && next < positions.length) jumpTo(next);
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

  const altMove = currentMoment?.betterMoves?.[expandedAlt];
  const altHighlight = altMove
    ? sanToSquares(positions[currentMoment.moveIdx - 1].fen, altMove.move)
    : null;

  const onTouchStart = (e) => { touchStartX.current = e.touches[0].clientX; };
  const onTouchEnd = (e) => {
    if (touchStartX.current === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    if (Math.abs(dx) > 60) goKeyMoment(dx < 0 ? 1 : -1);
    touchStartX.current = null;
  };

  const counterLabel = moveIdx === 0 ? "Start" : `${moveIdx} / ${positions.length - 1}`;
  const counterSub = currentMoment ? "key moment" : "move";

  const commentarySection = currentMoment ? (
    <div className="mx-4 mb-4 rounded-2xl bg-zinc-900 border border-zinc-800 overflow-hidden">
      <div className="px-4 pt-4 pb-3.5 border-b border-zinc-800/60">
        <div className="flex items-center gap-3 flex-wrap mb-3">
          <span className="text-xl font-bold tracking-tight text-zinc-100 font-mono">
            {currentMoment.moveNumber} {currentMoment.notation}
          </span>
          <Chip classification={currentMoment.classification} />
        </div>
        <EvalBar before={evals[currentMoment.moveIdx - 1] ?? 0} after={evals[currentMoment.moveIdx]} />
      </div>
      <div className="px-4 py-4">
        {currentMoment.explanation ? (
          <p className="text-sm text-zinc-300 leading-[1.75]"><AnnotatedText text={currentMoment.explanation} onHover={setHoverHighlight} fenBefore={positions[currentMoment.moveIdx - 1]?.fen} fenAfter={positions[currentMoment.moveIdx]?.fen} /></p>
        ) : momentLoading[currentMoment.id] === "loading" ? (
          <p className="text-sm text-zinc-600 italic animate-pulse">Analyzing…</p>
        ) : momentLoading[currentMoment.id] === "error" ? (
          <p className="text-sm text-red-500/70">Analysis failed. Check your API key.</p>
        ) : analysisStatus === "loading" ? (
          <p className="text-sm text-zinc-600 italic animate-pulse">Analyzing…</p>
        ) : analysisStatus === "error" ? (
          <p className="text-sm text-red-500/70">Analysis failed. Check your API key.</p>
        ) : apiKey ? (
          <button
            onClick={async () => {
              setMomentLoading((prev) => ({ ...prev, [currentMoment.id]: "loading" }));
              try {
                const text = await analyzeSinglePosition({
                  summary,
                  moveNumber: currentMoment.moveNumber,
                  notation: currentMoment.notation,
                  classification: currentMoment.classification,
                  evalBefore: evals[currentMoment.moveIdx - 1] ?? 0,
                  evalAfter: evals[currentMoment.moveIdx],
                  fen: positions[currentMoment.moveIdx]?.fen,
                  tone,
                }, apiKey);
                onPatchMoment(currentMoment.id, text);
                setMomentLoading((prev) => ({ ...prev, [currentMoment.id]: "done" }));
              } catch {
                setMomentLoading((prev) => ({ ...prev, [currentMoment.id]: "error" }));
              }
            }}
            className="text-xs text-zinc-500 border border-zinc-700/60 rounded-xl px-4 py-2.5 hover:border-zinc-600 hover:text-zinc-300 transition-colors"
          >
            Analyze this moment
          </button>
        ) : (
          <p className="text-sm text-zinc-600">Add an Anthropic API key on the import screen to enable AI analysis.</p>
        )}
      </div>
      {currentMoment.betterMoves && currentMoment.betterMoves.length > 0 && (
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
                    <AnnotatedText text={alt.reason} onHover={setHoverHighlight} fenBefore={positions[currentMoment.moveIdx - 1]?.fen} fenAfter={positions[currentMoment.moveIdx]?.fen} />
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
          <EvalBar before={evals[moveIdx - 1] ?? 0} after={evals[moveIdx]} />
        </div>
        <div className="px-4 py-4">
          {analysisCache[moveIdx] === "loading" ? (
            <p className="text-sm text-zinc-600 italic animate-pulse">Analyzing…</p>
          ) : analysisCache[moveIdx] === "error" ? (
            <p className="text-sm text-red-500/70">Analysis failed. Check your API key.</p>
          ) : analysisCache[moveIdx] ? (
            <p className="text-sm text-zinc-400 leading-[1.75]">
              <AnnotatedText text={analysisCache[moveIdx]} onHover={setHoverHighlight} fenBefore={positions[moveIdx - 1]?.fen} fenAfter={currentPos.fen} />
            </p>
          ) : (
            <button
              onClick={async () => {
                if (!apiKey) return;
                setAnalysisCache((prev) => ({ ...prev, [moveIdx]: "loading" }));
                try {
                  const mn = `${Math.ceil(moveIdx / 2)}${moveIdx % 2 === 1 ? "." : "..."}`;
                  const text = await analyzeSinglePosition({
                    summary,
                    moveNumber: mn,
                    notation: currentPos.san,
                    classification: "good",
                    evalBefore: evals[moveIdx - 1] ?? 0,
                    evalAfter: evals[moveIdx],
                    fen: currentPos.fen,
                    tone,
                  }, apiKey);
                  setAnalysisCache((prev) => ({ ...prev, [moveIdx]: text }));
                } catch {
                  setAnalysisCache((prev) => ({ ...prev, [moveIdx]: "error" }));
                }
              }}
              disabled={!apiKey}
              className="text-xs text-zinc-500 border border-zinc-700/60 rounded-xl px-4 py-2.5 hover:border-zinc-600 hover:text-zinc-300 disabled:opacity-40 transition-colors"
            >
              Analyze this position
            </button>
          )}
        </div>
      </div>
    )
  );

  const chatSection = currentMoment && (
    <Chat moment={currentMoment} history={chatHistory} setHistory={setChatHistory} apiKey={apiKey} tone={tone} onHover={setHoverHighlight} />
  );

  const controls = (
    <div className="flex items-center justify-between px-4 py-3 gap-1.5">
      <button
        onClick={() => goKeyMoment(-1)}
        disabled={prevKeyMoment === undefined}
        className="w-11 h-11 flex items-center justify-center rounded-xl bg-zinc-800/80 disabled:opacity-20 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200 active:bg-zinc-600 transition-colors text-base font-bold"
        aria-label="Previous key moment"
      >
        «
      </button>
      <button
        onClick={() => stepMove(-1)}
        disabled={moveIdx <= 1}
        className="w-11 h-11 flex items-center justify-center rounded-xl bg-zinc-800/80 disabled:opacity-20 text-zinc-300 hover:bg-zinc-700 hover:text-zinc-100 active:bg-zinc-600 transition-colors text-base"
        aria-label="Previous move"
      >
        ‹
      </button>
      <div className="text-center flex-1">
        <div className="text-sm">
          <span className={`font-semibold tabular-nums ${currentMoment ? "text-zinc-100" : "text-zinc-500"}`}>
            {counterLabel}
          </span>
        </div>
        <div className={`text-[9px] uppercase tracking-widest mt-0.5 ${currentMoment ? "text-zinc-400" : "text-zinc-600"}`}>
          {counterSub}
        </div>
      </div>
      <button
        onClick={() => stepMove(1)}
        disabled={moveIdx === positions.length - 1}
        className="w-11 h-11 flex items-center justify-center rounded-xl bg-zinc-800/80 disabled:opacity-20 text-zinc-300 hover:bg-zinc-700 hover:text-zinc-100 active:bg-zinc-600 transition-colors text-base"
        aria-label="Next move"
      >
        ›
      </button>
      <button
        onClick={() => goKeyMoment(1)}
        disabled={nextKeyMoment === undefined}
        className="w-11 h-11 flex items-center justify-center rounded-xl bg-zinc-800/80 disabled:opacity-20 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200 active:bg-zinc-600 transition-colors text-base font-bold"
        aria-label="Next key moment"
      >
        »
      </button>
    </div>
  );

  return (
    <div className="h-screen bg-zinc-950 text-zinc-100 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center bg-zinc-900/90 backdrop-blur border-b border-zinc-800 shrink-0">
        <button
          onClick={onReset}
          className="px-3 py-3.5 text-zinc-600 hover:text-zinc-300 transition-colors text-sm shrink-0"
          aria-label="Back to import"
        >
          ←
        </button>
        <button
          className="flex-1 flex items-center justify-between px-2 py-3.5 text-left hover:bg-zinc-900 active:bg-zinc-800 transition-colors min-w-0"
          onClick={() => setShowSummary(true)}
        >
          <div className="min-w-0">
            <div className="text-sm font-semibold text-zinc-100 leading-tight truncate">
              {summary.white} <span className="text-zinc-500 font-normal">vs</span>{" "}
              <span className="text-zinc-300">{summary.black}</span>
            </div>
            <div className="text-xs text-zinc-500 mt-0.5">{summary.event}</div>
          </div>
          <div className="flex items-center gap-2 ml-3 shrink-0">
            <span className="text-xs px-2.5 py-1 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 font-semibold">
              {summary.result}
            </span>
            <span className="text-zinc-600 text-xs font-light">↑</span>
          </div>
        </button>
      </div>

      {/* Body */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto md:overflow-hidden md:flex"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        {/* Left panel */}
        <div
          ref={leftPanelRef}
          className="shrink-0 md:w-[420px] md:overflow-y-auto md:border-r md:border-zinc-800"
        >
          <div className="px-4 pt-5 pb-3">
            <Board fen={currentPos.fen} fromSq={currentPos.from} toSq={currentPos.to} altFromSq={altHighlight?.from} altToSq={altHighlight?.to} hoverFromSq={hoverHighlight?.from} hoverToSq={hoverHighlight?.to} />
          </div>
          <MoveTimeline moveIdx={moveIdx} onJump={jumpTo} />
          {controls}
          <div className="md:hidden">
            {commentarySection}
            {chatSection}
          </div>
        </div>

        {/* Right panel (desktop) */}
        <div
          ref={rightPanelRef}
          className="hidden md:flex md:flex-col md:flex-1 md:overflow-y-auto"
        >
          {showSummary ? (
            <SummaryContent
              onClose={() => setShowSummary(false)}
              onJump={(targetMoveIdx) => { jumpTo(targetMoveIdx); setShowSummary(false); }}
            />
          ) : (
            <div className="flex-1 py-6 max-w-2xl w-full mx-auto">
              {commentarySection}
              {chatSection}
            </div>
          )}
        </div>
      </div>

      {/* Summary overlay (mobile) */}
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

function GameReview({ game, gameId, onReset, apiKey, tone, onPatchMoment, analysisStatus }) {
  return (
    <GameContext.Provider value={game}>
      <GameReviewContent gameId={gameId} onReset={onReset} apiKey={apiKey} tone={tone} onPatchMoment={onPatchMoment} analysisStatus={analysisStatus} />
    </GameContext.Provider>
  );
}

// ─── App router ───────────────────────────────────────────────────────────────

export default function App() {
  const [apiKey, setApiKey] = useApiKey();
  const [tone, setTone] = useTone();
  const [screen, setScreen] = useState("import");
  const [gameData, setGameData] = useState(null);
  const [gameId, setGameId] = useState(null);
  const [importError, setImportError] = useState(null);
  const [analysisStatus, setAnalysisStatus] = useState(null); // null | 'loading' | 'done' | 'error'

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const gid = params.get("game");
    if (!gid) return;
    if (gid === "opera-1858") {
      setGameData(DEMO_GAME);
      setGameId("opera-1858");
      setScreen("review");
    } else {
      doImport(gid);
    }
  }, []);

  const doImport = async (id) => {
    setScreen("loading");
    setImportError(null);
    try {
      const pgn = await fetchLichessGame(id);
      const parsed = parseGame(pgn);
      if (!parsed.hasEvals) {
        setImportError({
          message: 'This game has no computer analysis. Request it on Lichess first.',
          gameUrl: `https://lichess.org/${id}`,
        });
        setScreen("import");
        return;
      }
      setGameData(parsed);
      setGameId(id);
      setScreen("review");
      if (apiKey) runAnalysis(parsed, pgn, apiKey, tone, id);
    } catch (e) {
      setImportError(e.message);
      setScreen("import");
    }
  };

  const runAnalysis = async (game, pgn, key, t, id) => {
    const cacheKey = `chess-analysis-${id}-${t}`;
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      try {
        setGameData((prev) => mergeAnalysis(prev, JSON.parse(cached)));
        setAnalysisStatus("done");
        return;
      } catch {
        localStorage.removeItem(cacheKey);
      }
    }
    setAnalysisStatus("loading");
    try {
      const result = await analyzeGame(pgn, game.moments, game.summary, game.evals, key, t);
      localStorage.setItem(cacheKey, JSON.stringify(result));
      setGameData((prev) => mergeAnalysis(prev, result));
      setAnalysisStatus("done");
    } catch (e) {
      console.error("Analysis failed:", e);
      setAnalysisStatus("error");
    }
  };

  const patchMomentExplanation = (momentId, explanation) => {
    setGameData((prev) => {
      const moments = prev.moments.map((m) => m.id === momentId ? { ...m, explanation } : m);
      return { ...prev, moments, momentByMoveIdx: Object.fromEntries(moments.map((m) => [m.moveIdx, m])) };
    });
  };

  const handleReset = () => {
    setScreen("import");
    setGameData(null);
    setGameId(null);
    setAnalysisStatus(null);
    history.replaceState(null, "", window.location.pathname);
  };

  if (screen === "loading") return <LoadingScreen />;
  if (screen === "review" && gameData) {
    return <GameReview game={gameData} gameId={gameId} onReset={handleReset} apiKey={apiKey} tone={tone} onPatchMoment={patchMomentExplanation} analysisStatus={analysisStatus} />;
  }
  return (
    <ImportScreen
      onImport={doImport}
      onDemo={() => {
        setGameData(DEMO_GAME);
        setGameId("opera-1858");
        setScreen("review");
      }}
      error={importError}
      setError={setImportError}
      apiKey={apiKey}
      setApiKey={setApiKey}
      tone={tone}
      setTone={setTone}
    />
  );
}
