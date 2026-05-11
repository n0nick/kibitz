import { useState, useEffect, useRef, useContext } from "react";
import { analyzeSinglePosition, chatAboutPosition, DEFAULT_MODEL, PROMPT_VERSION, ANNOTATION_RULES } from "./analyzeGame";
import { computeSingleMoveEngineData } from "./pipeline";
import { browserEngine, engineLineText, analyzePosition } from "./stockfish";
import { sanToSquares } from "./parseGame";
import { FlagButton } from "./FlagButton";
import { perMoveKey } from "./migrations";
import { GameContext } from "./context";

// ─── Helpers shared with overview ────────────────────────────────────────────

export const PIECE_NAMES = { K: "king", Q: "queen", R: "rook", B: "bishop", N: "knight", P: "pawn" };
export const pieceImg = (p) => `/pieces/${p === p.toUpperCase() ? "white" : "black"}-${PIECE_NAMES[p.toUpperCase()]}.svg`;

export const CLS = {
  brilliant:  { label: "Brilliant!!", icon: "✦", bg: "bg-indigo-500/20",  text: "text-indigo-400",  border: "border-indigo-500/40"  },
  great:      { label: "Great move",  icon: "!",  bg: "bg-sky-500/20",    text: "text-sky-400",     border: "border-sky-500/40"     },
  good:       { label: "Good",        icon: "✓", bg: "bg-emerald-500/20", text: "text-emerald-400", border: "border-emerald-500/40" },
  inaccuracy: { label: "Inaccuracy",  icon: "?!", bg: "bg-yellow-500/20", text: "text-yellow-400",  border: "border-yellow-500/40"  },
  mistake:    { label: "Mistake",     icon: "?",  bg: "bg-orange-500/20", text: "text-orange-400",  border: "border-orange-500/40"  },
  blunder:    { label: "Blunder",     icon: "??", bg: "bg-red-500/20",    text: "text-red-400",     border: "border-red-500/40"     },
};

export function Chip({ classification, small }) {
  const s = CLS[classification] ?? CLS.good;
  return (
    <span className={`inline-flex items-center gap-1 font-medium rounded-full border ${s.bg} ${s.text} ${s.border} ${small ? "text-[10px] px-2 py-0.5" : "text-xs px-2.5 py-1"}`}>
      <span className="opacity-70">{s.icon}</span>{s.label}
    </span>
  );
}

function parseFen(fen) {
  const rows = fen.split(" ")[0].split("/");
  return rows.map((row) => {
    const rank = [];
    for (const ch of row) {
      const n = parseInt(ch, 10);
      if (!isNaN(n)) for (let i = 0; i < n; i++) rank.push(null);
      else rank.push(ch);
    }
    return rank;
  });
}

export function Board({ fen, fromSq, toSq, altFromSq, altToSq, hoverFromSq, hoverToSq, analysisHref, flip = false, hideLink = false }) {
  const board = parseFen(fen);
  return (
    <div className="w-full mx-auto select-none"
      style={{ padding: 8, background: "#1e1008", borderRadius: 6, boxShadow: "0 8px 40px rgba(0,0,0,0.75), inset 0 1px 0 rgba(255,255,255,0.06)" }}>
      <div className="grid rounded-sm overflow-hidden" style={{ gridTemplateColumns: "repeat(8, 1fr)" }}>
        {Array.from({ length: 8 }, (_, ri) => {
          const rankNum = flip ? ri + 1 : 8 - ri;
          return Array.from({ length: 8 }, (_, fi) => {
            const fileIdx = flip ? 7 - fi : fi;
            const piece = board[flip ? 7 - ri : ri]?.[fileIdx];
            const light = (ri + fi) % 2 === 0;
            const sq = `${"abcdefgh"[fileIdx]}${rankNum}`;
            const isMove  = sq === fromSq    || sq === toSq;
            const isAlt   = sq === altFromSq  || sq === altToSq;
            const isHover = sq === hoverFromSq || (hoverToSq ? sq === hoverToSq : false);
            return (
              <div key={`${ri}-${fi}`} className="aspect-square relative"
                style={{ background: light ? "#f0d9b5" : "#a07040" }}>
                {isMove  && <div className="absolute inset-0" style={{ background: "rgba(210,175,0,0.48)" }} />}
                {isAlt   && <div className="absolute inset-0" style={{ background: "rgba(20,140,200,0.42)" }} />}
                {isHover && <div className="absolute inset-0" style={{ background: "rgba(140,80,220,0.40)" }} />}
                {fi === 0 && (
                  <span className="absolute top-[2px] left-[3px] text-[9px] font-bold leading-none pointer-events-none z-10"
                    style={{ color: light ? "#8a6030" : "#d4a870" }}>{rankNum}</span>
                )}
                {ri === 7 && (
                  <span className="absolute bottom-[2px] right-[3px] text-[9px] font-bold leading-none pointer-events-none z-10"
                    style={{ color: light ? "#8a6030" : "#d4a870" }}>{"abcdefgh"[fileIdx]}</span>
                )}
                {piece && (
                  <img src={pieceImg(piece)} alt={piece} className="absolute inset-0 w-full h-full p-[5%] z-10"
                    draggable={false} style={{ filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.55))" }} />
                )}
              </div>
            );
          });
        }).flat()}
      </div>
      {!hideLink && (
        <div className="flex justify-end pt-1 pr-0.5">
          <a href={analysisHref ?? `https://lichess.org/analysis/${fen.replace(/ /g, "_")}`}
            target="_blank" rel="noopener noreferrer"
            className="text-[9px] leading-none font-medium transition-colors"
            style={{ color: "#6b4e2a" }}
            onMouseEnter={(e) => { e.currentTarget.style.color = "#a0784a"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = "#6b4e2a"; }}
            title="Open position in Lichess Analysis Board">
            {analysisHref ? "lichess ↗" : "analyze ↗"}
          </a>
        </div>
      )}
    </div>
  );
}

export function EvalBar({ before, after, perspective }) {
  const fmt = (v) => v >= 99 ? "M" : v <= -99 ? "-M" : v > 0 ? `+${v.toFixed(1)}` : v.toFixed(1);
  const toPercent = (v) => v >= 99 ? 95 : v <= -99 ? 5 : ((Math.max(-6, Math.min(6, v)) + 6) / 12) * 100;
  const pct = toPercent(after);
  const isMateAfter  = after >= 99;
  const isMatedAfter = after <= -99;
  const swing = isMateAfter ? 99 - before : isMatedAfter ? -99 - before : after - before;
  // positive swing = White gaining; for Black player that means losing ground
  const gaining = perspective === 'black' ? swing < 0 : swing > 0;
  return (
    <div className="flex items-center gap-2.5">
      <span className="text-xs font-mono tabular-nums text-zinc-500 w-9 text-right shrink-0">{fmt(before)}</span>
      <div className="flex-1 h-2 rounded-full bg-zinc-800 overflow-hidden">
        <div className="h-full rounded-full bg-zinc-200 transition-all duration-700 ease-out" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-mono tabular-nums text-zinc-300 w-9 shrink-0">{fmt(after)}</span>
      <span className={`text-xs font-semibold w-12 text-right shrink-0 ${gaining ? "text-emerald-400" : "text-red-400"}`}>
        {isMateAfter  ? "▲ M" : isMatedAfter ? "▼ M" : <>{gaining ? "▲" : "▼"} {Math.min(Math.abs(swing), 9.9).toFixed(1)}</>}
      </span>
    </div>
  );
}

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
  for (const fen of [fenBefore, fenAfter].filter(Boolean)) {
    const result = sanToSquares(fen, raw);
    if (result) return { display, ...result };
  }
  return { display, from: null, to: null };
}

export function AnnotatedText({ text, onHover, fenBefore, fenAfter }) {
  if (!text) return null;
  const parts = text.split(/(\[\[[^\]]*\]\])/);
  return (
    <>
      {parts.map((part, i) => {
        const match = part.match(/^\[\[([^\]]*)\]\]$/);
        if (!match) return <span key={i}>{part}</span>;
        const { display, from, to } = parseAnnotation(match[1], fenBefore, fenAfter);
        return (
          <span key={i}
            className="underline decoration-dotted underline-offset-2 cursor-pointer text-zinc-200 hover:text-white transition-colors"
            onMouseEnter={() => onHover({ from, to })}
            onMouseLeave={() => onHover(null)}>
            {display}
          </span>
        );
      })}
    </>
  );
}

function RichText({ text, onHover, fenBefore, fenAfter }) {
  if (!text) return null;
  function renderInline(str) {
    const tokens = str.split(/(\[\[[^\]]*\]\]|\*\*[^*]+\*\*|\*[^*]+\*)/);
    return tokens.map((token, i) => {
      if (token.startsWith("[[") && token.endsWith("]]")) {
        const { display, from, to } = parseAnnotation(token.slice(2, -2), fenBefore, fenAfter);
        return (
          <span key={i} className="underline decoration-dotted underline-offset-2 cursor-pointer text-zinc-200 hover:text-white transition-colors"
            onMouseEnter={() => onHover?.({ from, to })} onMouseLeave={() => onHover?.(null)}>{display}</span>
        );
      }
      if (token.startsWith("**") && token.endsWith("**")) return <strong key={i} className="font-semibold text-zinc-200">{renderInline(token.slice(2, -2))}</strong>;
      if (token.startsWith("*") && token.endsWith("*") && token.length > 2) return <em key={i} className="italic">{renderInline(token.slice(1, -1))}</em>;
      return <span key={i}>{token}</span>;
    });
  }
  const elements = [];
  for (const [i, line] of text.split("\n").entries()) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const heading = trimmed.match(/^#{1,3}\s+(.+)/);
    if (heading) elements.push(<p key={i} className="font-semibold text-zinc-200">{renderInline(heading[1])}</p>);
    else elements.push(<p key={i} className="leading-relaxed">{renderInline(trimmed)}</p>);
  }
  return <div className="space-y-1.5">{elements}</div>;
}

function gameSource(id) {
  if (!id || id === "opera-1858") return "demo";
  if (id.startsWith("pgn-")) return "pgn";
  return "lichess";
}

const CACHE_TTL = 7 * 24 * 60 * 60 * 1000;

// ─── MoveAnalysisView ─────────────────────────────────────────────────────────
// Renders full analysis for a single ply. Used in drill-in route and old review.
// Manages its own analysis state, pulling from/saving to localStorage.

export function MoveAnalysisView({ initialPly, gameId, apiKey, tone, perspective, onBack, analysisStatus, onPatchMoment, turningPoints = [] }) {
  const game = useContext(GameContext);
  const { positions, evals, moments, momentByMoveIdx, summary, pgn, promptSentToLlm, momentEngineData } = game;

  const [plyIdx, setPlyIdx] = useState(initialPly ?? 1);

  const currentMoment = momentByMoveIdx[plyIdx] ?? null;
  const currentPos = positions[plyIdx];

  const [analysisText, setAnalysisText] = useState(null);
  const [analysisPrompt, setAnalysisPrompt] = useState(null);
  const [perMoveEngData, setPerMoveEngData] = useState(null);
  const [richEngData, setRichEngData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [expandedAlt, setExpandedAlt] = useState(null);
  const [hoverHighlight, setHoverHighlight] = useState(null);
  const [chatHistory, setChatHistory] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [chatSending, setChatSending] = useState(false);
  const chatEndRef = useRef(null);
  const rightPanelRef = useRef(null);
  const engineTimerRef = useRef(null);

  const flip = perspective === 'black';
  const fenBefore = positions[plyIdx - 1]?.fen;
  const fenAfter = currentPos?.fen;
  const altHighlight = currentMoment?.betterMoves?.[expandedAlt]
    ? sanToSquares(positions[currentMoment.moveIdx - 1].fen, currentMoment.betterMoves[expandedAlt].move)
    : null;

  const turningPointSet = new Set(turningPoints);
  const isKeyMoment = turningPointSet.has(plyIdx);

  // Reset per-ply state and load cache when plyIdx changes
  useEffect(() => {
    setAnalysisText(null);
    setAnalysisPrompt(null);
    setPerMoveEngData(null);
    setRichEngData(null);
    setLoading(false);
    setError(false);
    setExpandedAlt(null);
    setHoverHighlight(null);
    setChatHistory([]);
    setChatInput("");
    setChatSending(false);
    rightPanelRef.current?.scrollTo({ top: 0 });

    const moment = momentByMoveIdx[plyIdx];
    if (!moment?.explanation) {
      const cacheKey = perMoveKey(gameId, plyIdx, tone, perspective);
      try {
        const raw = localStorage.getItem(cacheKey);
        if (raw) {
          const { text, prompt, ts } = JSON.parse(raw);
          if (Date.now() - ts < CACHE_TTL) { setAnalysisText(text); setAnalysisPrompt(prompt); }
        }
      } catch {}
    }

  }, [plyIdx, gameId, tone]);

  const touchStartX = useRef(null);

  // Keyboard navigation
  useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.key === 'ArrowLeft') setPlyIdx(p => Math.max(1, p - 1));
      if (e.key === 'ArrowRight') setPlyIdx(p => Math.min(positions.length - 1, p + 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [positions.length]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatHistory]);

  const runAnalysis = async () => {
    if (!apiKey) return;
    setLoading(true);
    setError(false);
    try {
      const engData = perMoveEngData ?? await computeSingleMoveEngineData(
        positions, plyIdx, browserEngine,
        { lichessGameId: gameSource(gameId) === 'lichess' ? gameId : null }
      ).catch(() => null);
      if (engData && !perMoveEngData) setPerMoveEngData(engData);

      if (currentMoment) {
        const { text, prompt } = await analyzeSinglePosition({
          summary,
          moveNumber: currentMoment.moveNumber,
          notation: currentMoment.notation,
          classification: currentMoment.classification,
          evalBefore: evals[plyIdx - 1] ?? 0,
          evalAfter: evals[plyIdx],
          fen: fenAfter,
          tone,
          engineData: engData,
          perspective,
        }, apiKey);
        onPatchMoment?.(currentMoment.id, text, prompt);
      } else {
        const mn = `${Math.ceil(plyIdx / 2)}${plyIdx % 2 === 1 ? "." : "..."}`;
        const { text, prompt } = await analyzeSinglePosition({
          summary,
          moveNumber: mn,
          notation: currentPos.san,
          classification: "good",
          evalBefore: evals[plyIdx - 1] ?? 0,
          evalAfter: evals[plyIdx],
          fen: fenAfter,
          tone,
          engineData: engData,
          perspective,
        }, apiKey);
        setAnalysisText(text);
        setAnalysisPrompt(prompt);
        const cacheKey = perMoveKey(gameId, plyIdx, tone, perspective);
        try { localStorage.setItem(cacheKey, JSON.stringify({ text, prompt, ts: Date.now() })); } catch {}
      }
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  const sendChat = async () => {
    const q = chatInput.trim();
    if (!q || chatSending || !apiKey) return;
    setChatSending(true);
    setChatInput("");
    const currentMsgs = [...chatHistory];
    setChatHistory(prev => [...prev, { role: "user", text: q }]);
    try {
      const fenCurrent = fenAfter ?? fenBefore;
      // Load 10-PV engine data lazily on first chat message
      let engData = richEngData;
      if (!engData && fenCurrent) {
        engData = await computeSingleMoveEngineData(positions, plyIdx, browserEngine, {
          depth: 14,
          lichessGameId: gameSource(gameId) === 'lichess' ? gameId : null,
          numPv: 10,
        }).catch(() => null);
        if (engData) setRichEngData(engData);
      }
      const fmtCp = cp => cp == null ? '?' : `${cp >= 0 ? '+' : ''}${(cp / 100).toFixed(1)}`;
      const engineLine = engData?.top_alternatives?.length
        ? `Top ${engData.top_alternatives.length} engine moves at this position:\n` +
          engData.top_alternatives.map((alt, i) => {
            const ev = alt.mate != null ? (alt.mate > 0 ? '+M' : '-M') : fmtCp(alt.eval_cp);
            const cont = alt.pv_san?.slice(1, 4).join(' ');
            return `  ${i + 1}. ${alt.san} (${ev})${cont ? ` — continuation: ${cont}` : ''}`;
          }).join('\n') +
          `\nSystem prompt for chat: You have engine evaluations for the top ${engData.top_alternatives.length} candidate moves at this position. If the user asks about a move not in this list, acknowledge that you don't have engine-verified analysis for that move and respond cautiously based on general principles. Do not invent tactical sequences.`
        : null;

      const moment = currentMoment ?? {
        id: `pos-${plyIdx}`,
        moveIdx: plyIdx,
        moveNumber: `${Math.ceil(plyIdx / 2)}${plyIdx % 2 === 1 ? "." : "..."}`,
        notation: currentPos.san,
        classification: "good",
        explanation: analysisText ?? null,
        qa: null,
      };

      const { text: answer, systemPrompt } = await chatAboutPosition(
        { summary, moment, messages: currentMsgs, question: q, tone, fen: fenCurrent, engineLine, perspective },
        apiKey
      );
      setChatHistory(prev => [...prev, { role: "assistant", text: answer, systemPrompt }]);
    } catch {
      setChatHistory(prev => [...prev, { role: "assistant", text: "Analysis failed. Check your API key." }]);
    } finally {
      setChatSending(false);
    }
  };

  const explanation = currentMoment?.explanation ?? analysisText;
  const promptForFlag = currentMoment?.singleAnalysisPrompt ?? analysisPrompt ?? promptSentToLlm;
  const moveLabel = currentMoment
    ? `${currentMoment.moveNumber} ${currentMoment.notation}`
    : `${Math.ceil(plyIdx / 2)}${plyIdx % 2 === 1 ? "." : "..."} ${currentPos?.san}`;
  const classification = currentMoment?.classification ?? "good";
  const suggestedQ = currentMoment?.qa?.question;

  if (!currentPos) return null;

  return (
    <div className="h-screen bg-zinc-950 text-zinc-100 flex flex-col overflow-hidden"
      onTouchStart={(e) => { touchStartX.current = e.touches[0].clientX; }}
      onTouchEnd={(e) => {
        if (touchStartX.current === null) return;
        const dx = e.changedTouches[0].clientX - touchStartX.current;
        touchStartX.current = null;
        if (Math.abs(dx) < 40) return;
        if (dx < 0) setPlyIdx(p => Math.min(positions.length - 1, p + 1));
        else setPlyIdx(p => Math.max(1, p - 1));
      }}>
      {/* Header */}
      <div className="flex items-center bg-zinc-900/90 backdrop-blur border-b border-zinc-800 shrink-0 px-2">
        <button onClick={onBack}
          className="px-3 py-3.5 text-zinc-600 hover:text-zinc-300 transition-colors text-sm shrink-0">←</button>
        <div className="flex-1 flex items-center gap-2.5 px-2 py-3.5 min-w-0">
          <span className="text-sm font-mono font-semibold text-zinc-100 shrink-0">{moveLabel}</span>
          <Chip classification={classification} small />
          {isKeyMoment && <span className="text-[9px] text-amber-400 font-bold uppercase tracking-widest shrink-0">key</span>}
        </div>
        <div className="flex items-center gap-0.5 px-2 shrink-0">
          <button onClick={() => setPlyIdx(p => Math.max(1, p - 1))} disabled={plyIdx <= 1}
            className="px-2.5 py-2 text-zinc-400 hover:text-zinc-100 disabled:opacity-25 disabled:cursor-default transition-colors text-lg font-light leading-none select-none">{"←"}</button>
          <span className="text-[10px] text-zinc-500 tabular-nums w-14 text-center font-mono">{plyIdx} / {positions.length - 1}</span>
          <button onClick={() => setPlyIdx(p => Math.min(positions.length - 1, p + 1))} disabled={plyIdx >= positions.length - 1}
            className="px-2.5 py-2 text-zinc-400 hover:text-zinc-100 disabled:opacity-25 disabled:cursor-default transition-colors text-lg font-light leading-none select-none">{"→"}</button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto md:overflow-hidden md:flex">
        {/* Left panel: board + eval bar */}
        <div className="md:w-[420px] md:shrink-0 md:border-r md:border-zinc-800 md:overflow-y-auto">
          <div className="px-4 pt-5 pb-3">
            <Board
              fen={currentPos.fen}
              fromSq={currentPos.from}
              toSq={currentPos.to}
              altFromSq={altHighlight?.from}
              altToSq={altHighlight?.to}
              hoverFromSq={hoverHighlight?.from}
              hoverToSq={hoverHighlight?.to}
              flip={flip}
              analysisHref={gameSource(gameId) === "lichess" ? `https://lichess.org/${gameId}#${plyIdx}` : undefined}
            />
          </div>
          <div className="px-4 pb-4">
            <EvalBar before={evals[plyIdx - 1] ?? 0} after={evals[plyIdx]} perspective={perspective} />
          </div>
        </div>

        {/* Right panel: commentary + chat */}
        <div ref={rightPanelRef} className="md:flex-1 md:overflow-y-auto">
        <div className="max-w-2xl mx-auto md:py-6 md:px-4">

        {/* Commentary card */}
        <div className="mx-4 mb-4 md:mx-0 rounded-2xl bg-zinc-900 border border-zinc-800 overflow-hidden">
          <div className="px-4 py-4">
            {explanation ? (
              <div>
                <p className="text-sm text-zinc-300 leading-[1.75]">
                  <AnnotatedText text={explanation} onHover={setHoverHighlight} fenBefore={fenBefore} fenAfter={fenAfter} />
                </p>
                <div className="mt-2 flex justify-end">
                  <FlagButton context={{
                    type: 'moment',
                    model: DEFAULT_MODEL,
                    promptVersion: PROMPT_VERSION,
                    gameId,
                    pgn,
                    promptSentToLlm: promptForFlag,
                    move: moveLabel,
                    ply: plyIdx,
                    classification,
                    evalBefore: evals[plyIdx - 1] ?? 0,
                    evalAfter: evals[plyIdx],
                    fenBefore,
                    fenAfter,
                    commentary: explanation,
                    engineData: momentEngineData?.[plyIdx],
                  }} />
                </div>
              </div>
            ) : loading ? (
              <p className="text-sm text-zinc-600 italic animate-pulse">Analyzing…</p>
            ) : error ? (
              <p className="text-sm text-red-500/70">Analysis failed. Check your API key.</p>
            ) : analysisStatus === "loading" ? (
              <p className="text-sm text-zinc-600 italic animate-pulse">Analyzing…</p>
            ) : apiKey ? (
              <button onClick={runAnalysis}
                className="text-xs text-zinc-500 border border-zinc-700/60 rounded-xl px-4 py-2.5 hover:border-zinc-600 hover:text-zinc-300 transition-colors">
                Analyze this move
              </button>
            ) : (
              <p className="text-sm text-zinc-600">Add an Anthropic API key on the import screen to enable AI analysis.</p>
            )}
          </div>

          {/* Better moves */}
          {currentMoment?.betterMoves?.length > 0 && (
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
                      }`}>
                      {alt.move}
                    </button>
                    {expandedAlt === i && (
                      <p className="mt-2 text-xs text-zinc-400 bg-zinc-800/80 border border-zinc-700/60 rounded-xl px-3.5 py-2.5 leading-relaxed">
                        <AnnotatedText text={alt.reason} onHover={setHoverHighlight} fenBefore={fenBefore} fenAfter={fenAfter} />
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Chat */}
        <div className="mx-4 mb-8 md:mx-0">
          {/* Suggested question chip */}
          {chatHistory.length === 0 && !chatSending && suggestedQ && (
            <button
              className="w-full text-left text-xs text-zinc-500 bg-zinc-900/50 rounded-xl px-4 py-3 mb-3 border border-zinc-800 hover:border-zinc-700 active:bg-zinc-800 transition-colors"
              onClick={() => setChatInput(suggestedQ)}>
              <span className="text-zinc-600">Try: </span>
              <span className="italic">"{suggestedQ}"</span>
            </button>
          )}

          {/* Chat messages */}
          {(chatHistory.length > 0 || chatSending) && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl mb-3 overflow-hidden divide-y divide-zinc-800/70">
              {chatHistory.map((msg, i) => (
                <div key={i} className={`px-4 py-3 text-sm leading-relaxed ${msg.role === "user" ? "text-zinc-300" : "text-zinc-400"}`}>
                  <div className="flex items-center gap-2 mb-1.5">
                    <div className={`text-[9px] font-bold uppercase tracking-widest flex-1 ${msg.role === "user" ? "text-zinc-600" : "text-indigo-500"}`}>
                      {msg.role === "user" ? "You" : "Coach"}
                    </div>
                    {msg.role === "assistant" && (
                      <FlagButton context={{
                        type: 'chat', model: DEFAULT_MODEL, promptVersion: PROMPT_VERSION,
                        gameId, pgn, promptSentToLlm: msg.systemPrompt,
                        move: moveLabel, ply: plyIdx, classification, fenBefore, fenAfter,
                        commentary: msg.text, chatHistory: chatHistory.slice(0, i),
                      }} />
                    )}
                  </div>
                  {msg.role === "assistant"
                    ? <RichText text={msg.text} onHover={setHoverHighlight} fenBefore={fenBefore} fenAfter={fenAfter} />
                    : <p>{msg.text}</p>}
                </div>
              ))}
              {chatSending && (
                <div className="px-4 py-3 text-sm text-zinc-500 italic animate-pulse">
                  <div className="text-[9px] font-bold uppercase tracking-widest mb-1.5 text-indigo-500">Coach</div>
                  Thinking…
                </div>
              )}
              <div ref={chatEndRef} />
            </div>
          )}

          <div className="flex gap-2">
            <input type="text" value={chatInput} onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendChat()}
              placeholder="Ask about this position…" disabled={chatSending}
              className="flex-1 min-w-0 bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-600 disabled:opacity-50 transition-colors" />
            <button onClick={sendChat} disabled={chatSending || !chatInput.trim() || !apiKey}
              className="px-5 py-3 bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 disabled:opacity-40 rounded-xl text-sm font-semibold transition-colors shrink-0">
              Ask
            </button>
          </div>
          {!apiKey && (
            <p className="text-xs text-zinc-600 mt-2 text-center">Add an API key on the import screen to enable chat.</p>
          )}
        </div>

        </div>{/* max-w-2xl */}
        </div>{/* right panel */}
      </div>{/* body flex */}
    </div>
  );
}
