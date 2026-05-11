import { useState, useEffect, useRef, useContext } from "react";
import { analyzeSinglePosition, chatAboutPosition, DEFAULT_MODEL, PROMPT_VERSION } from "./analyzeGame";
import { computeSingleMoveEngineData } from "./pipeline";
import { browserEngine } from "./stockfish";
import { sanToSquares } from "./parseGame";
import { FlagButton } from "./FlagButton";
import { perMoveKey } from "./migrations";
import { GameContext } from "./context";
import {
  k, Card, NavBar, Classification, ThemedBoard, EvalBar, Sparkline,
  Composer, ExtLinkIcon, CLASS_DEF,
} from "./ui";

// ─── Re-exports kept for backwards-compat with other modules ────────────────
// (GameOverview imports CLS from here for its turning-point card.)
export const CLS = {
  brilliant:  { label: "Brilliant", icon: CLASS_DEF.brilliant.glyph,  bg: "transparent", text: "text-emerald-400", border: "transparent" },
  great:      { label: "Great",     icon: CLASS_DEF.great.glyph,      bg: "transparent", text: "text-sky-400",     border: "transparent" },
  good:       { label: "Good",      icon: CLASS_DEF.good.glyph,       bg: "transparent", text: "text-zinc-400",    border: "transparent" },
  inaccuracy: { label: "Inaccuracy",icon: CLASS_DEF.inaccuracy.glyph, bg: "transparent", text: "text-yellow-400",  border: "transparent" },
  mistake:    { label: "Mistake",   icon: CLASS_DEF.mistake.glyph,    bg: "transparent", text: "text-orange-400",  border: "transparent" },
  blunder:    { label: "Blunder",   icon: CLASS_DEF.blunder.glyph,    bg: "transparent", text: "text-red-400",     border: "transparent" },
};

export function Chip({ classification }) {
  return <Classification kind={classification} size={11} />;
}

export const Board = ThemedBoard;

export function EvalBarLegacy(props) { return <EvalBar {...props} />; }

// ─── Annotated text helpers ─────────────────────────────────────────────────

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
  return parts.map((part, i) => {
    const match = part.match(/^\[\[([^\]]*)\]\]$/);
    if (!match) return <span key={i}>{part}</span>;
    const { display, from, to } = parseAnnotation(match[1], fenBefore, fenAfter);
    return (
      <span
        key={i}
        style={{
          color: k.text,
          background: k.accentDim,
          padding: "0 4px",
          borderRadius: 3,
          fontWeight: 500,
          cursor: "pointer",
        }}
        onMouseEnter={() => onHover?.({ from, to })}
        onMouseLeave={() => onHover?.(null)}
      >
        {display}
      </span>
    );
  });
}

function RichText({ text, onHover, fenBefore, fenAfter }) {
  if (!text) return null;
  function renderInline(str) {
    const tokens = str.split(/(\[\[[^\]]*\]\]|\*\*[^*]+\*\*|\*[^*]+\*)/);
    return tokens.map((token, i) => {
      if (!token) return null;
      if (token.startsWith("[[") && token.endsWith("]]")) {
        const { display, from, to } = parseAnnotation(token.slice(2, -2), fenBefore, fenAfter);
        return (
          <span
            key={i}
            style={{ color: k.text, background: k.accentDim, padding: "0 4px", borderRadius: 3, fontWeight: 500, cursor: "pointer" }}
            onMouseEnter={() => onHover?.({ from, to })}
            onMouseLeave={() => onHover?.(null)}
          >
            {display}
          </span>
        );
      }
      if (token.startsWith("**") && token.endsWith("**")) {
        return <strong key={i} style={{ fontWeight: 600, color: k.text }}>{renderInline(token.slice(2, -2))}</strong>;
      }
      if (token.startsWith("*") && token.endsWith("*") && token.length > 2) {
        return <em key={i} style={{ fontStyle: "italic" }}>{renderInline(token.slice(1, -1))}</em>;
      }
      return <span key={i}>{token}</span>;
    });
  }
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {lines.map((line, i) => {
        const heading = line.match(/^#{1,3}\s+(.+)/);
        const bullet = line.match(/^[-*]\s+(.+)/);
        if (heading) {
          return (
            <div key={i} className="kbz-caps" style={{ marginTop: i > 0 ? 4 : 0, color: k.textMute }}>
              {renderInline(heading[1])}
            </div>
          );
        }
        if (bullet) {
          return (
            <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
              <span style={{ color: k.accent, lineHeight: 1.5 }}>•</span>
              <span style={{ flex: 1, lineHeight: 1.5 }}>{renderInline(bullet[1])}</span>
            </div>
          );
        }
        return <p key={i} style={{ margin: 0, lineHeight: 1.55 }}>{renderInline(line)}</p>;
      })}
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function gameSource(id) {
  if (!id || id === "opera-1858") return "demo";
  if (id.startsWith("pgn-")) return "pgn";
  return "lichess";
}

const CACHE_TTL = 7 * 24 * 60 * 60 * 1000;

function stripAnnotations(text) {
  if (!text) return text;
  return text.replace(/\[\[([^\]|]*?)(?:\|[^\]]*?)?\]\]/g, "$1");
}

// First sentence of the explanation — promoted to an editorial headline.
function firstSentence(text) {
  if (!text) return null;
  const stripped = stripAnnotations(text);
  const m = stripped.match(/^[^.!?]*[.!?]/);
  return (m ? m[0] : stripped).trim();
}

// Belt-and-braces guard: occasionally the model starts the explanation with a
// conjunction that flows from the headline above ("But Black had already…").
// Read in isolation that's jarring — capitalise the next clause instead.
function deconjunct(text) {
  if (!text) return text;
  return text.replace(
    /^(\s*)(but|and|so|yet|however)[, ]+([a-z])/i,
    (_, lead, _conj, ch) => lead + ch.toUpperCase()
  );
}

// Format the eval swing readout shown next to the sparkline header.
function fmtSwing(before, after, perspective) {
  if (after >= 99) return "+M";
  if (after <= -99) return "−M";
  const raw = after - before;
  const fromUser = perspective === "black" ? -raw : raw;
  const sign = fromUser >= 0 ? "+" : "−";
  return `${sign}${Math.min(Math.abs(fromUser), 9.9).toFixed(1)}`;
}

function swingColor(before, after, perspective, kk) {
  if (after >= 99 || after <= -99) return after >= 99 ? kk.accent : kk.bad;
  const raw = after - before;
  const fromUser = perspective === "black" ? -raw : raw;
  return fromUser >= 0 ? kk.accent : kk.bad;
}

// Resize-observed sparkline wrapper, so the SVG width fits the parent card.
function SparklineFit({ data, markIdx, h }) {
  const ref = useRef(null);
  const [w, setW] = useState(320);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver((entries) => {
      const cw = entries[0].contentRect.width;
      if (cw > 0) setW(cw);
    });
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={ref}>
      <Sparkline data={data} markIdx={markIdx} w={w} h={h} />
    </div>
  );
}

// Renders one alt continuation as inline mono notation plus a one-line
// rationale. Tap header to cycle through betterMoves when there's more than one.
function BetterLine({ alt, alts, index, onCycle, moveNumber, fenBefore, fenAfter, onHover }) {
  if (!alt) return null;
  const ply = parseInt((moveNumber ?? "").match(/\d+/)?.[0] ?? "0", 10);
  const isBlackMove = (moveNumber ?? "").includes("..");
  const startToken = isBlackMove ? `${ply}…` : `${ply}.`;
  return (
    <div>
      <div style={{ fontFamily: k.font.mono, fontSize: 13, lineHeight: 1.7, color: k.text }}>
        <span style={{ color: k.textDim }}>{startToken}</span>{" "}
        <span style={{ color: k.accent, fontWeight: 600 }}>{alt.move}</span>
        <span
          style={{
            marginLeft: 8,
            background: k.accentDim,
            color: k.text,
            padding: "1px 6px",
            borderRadius: 4,
            fontWeight: 600,
            fontSize: 12,
          }}
        >
          better
        </span>
      </div>
      {alt.reason && (
        <div style={{ marginTop: 8, fontSize: 12, color: k.textMute, lineHeight: 1.5 }}>
          <AnnotatedText text={alt.reason} onHover={onHover} fenBefore={fenBefore} fenAfter={fenAfter} />
        </div>
      )}
      {alts.length > 1 && (
        <button
          onClick={onCycle}
          style={{
            marginTop: 8,
            background: "transparent", color: k.accent,
            border: "none", padding: 0,
            fontSize: 11, fontWeight: 600, cursor: "pointer",
            fontFamily: k.font.sans,
            letterSpacing: 0.4,
          }}
        >
          Next alternative ({((index + 1) % alts.length) + 1}/{alts.length}) ›
        </button>
      )}
    </div>
  );
}

// ─── MoveAnalysisView ─────────────────────────────────────────────────────────

export function MoveAnalysisView({ initialPly, gameId, apiKey, tone, perspective, onBack, analysisStatus, onPatchMoment, turningPoints = [] }) {
  const game = useContext(GameContext);
  const { positions, evals, momentByMoveIdx, summary, pgn, promptSentToLlm, momentEngineData } = game;

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
  const scrollerRef = useRef(null);

  const flip = perspective === "black";
  const fenBefore = positions[plyIdx - 1]?.fen;
  const fenAfter = currentPos?.fen;
  const altHighlight = currentMoment?.betterMoves?.[expandedAlt]
    ? sanToSquares(positions[currentMoment.moveIdx - 1].fen, currentMoment.betterMoves[expandedAlt].move)
    : null;

  const turningPointSet = new Set(turningPoints);
  const isKeyMoment = turningPointSet.has(plyIdx);

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
    scrollerRef.current?.scrollTo({ top: 0 });

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
  }, [plyIdx, gameId, tone]); // eslint-disable-line react-hooks/exhaustive-deps

  const touchStartX = useRef(null);

  useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
      if (e.key === "ArrowLeft") setPlyIdx((p) => Math.max(1, p - 1));
      if (e.key === "ArrowRight") setPlyIdx((p) => Math.min(positions.length - 1, p + 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [positions.length]);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [chatHistory]);

  const runAnalysis = async () => {
    if (!apiKey) return;
    setLoading(true);
    setError(false);
    try {
      const engData = perMoveEngData ?? await computeSingleMoveEngineData(
        positions, plyIdx, browserEngine,
        { lichessGameId: gameSource(gameId) === "lichess" ? gameId : null }
      ).catch(() => null);
      if (engData && !perMoveEngData) setPerMoveEngData(engData);

      if (currentMoment) {
        const { text, prompt } = await analyzeSinglePosition({
          summary, moveNumber: currentMoment.moveNumber, notation: currentMoment.notation,
          classification: currentMoment.classification, evalBefore: evals[plyIdx - 1] ?? 0,
          evalAfter: evals[plyIdx], fen: fenAfter, tone, engineData: engData, perspective,
        }, apiKey);
        onPatchMoment?.(currentMoment.id, text, prompt);
      } else {
        const mn = `${Math.ceil(plyIdx / 2)}${plyIdx % 2 === 1 ? "." : "..."}`;
        const { text, prompt } = await analyzeSinglePosition({
          summary, moveNumber: mn, notation: currentPos.san, classification: "good",
          evalBefore: evals[plyIdx - 1] ?? 0, evalAfter: evals[plyIdx],
          fen: fenAfter, tone, engineData: engData, perspective,
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

  const sendChat = async (override) => {
    const q = ((override ?? chatInput) || "").trim();
    if (!q || chatSending || !apiKey) return;
    setChatSending(true);
    if (override == null) setChatInput("");
    const currentMsgs = [...chatHistory];
    setChatHistory((prev) => [...prev, { role: "user", text: q }]);
    try {
      const fenCurrent = fenAfter ?? fenBefore;
      let engData = richEngData;
      if (!engData && fenCurrent) {
        engData = await computeSingleMoveEngineData(positions, plyIdx, browserEngine, {
          depth: 14, lichessGameId: gameSource(gameId) === "lichess" ? gameId : null, numPv: 10,
        }).catch(() => null);
        if (engData) setRichEngData(engData);
      }
      const fmtCp = (cp) => cp == null ? "?" : `${cp >= 0 ? "+" : ""}${(cp / 100).toFixed(1)}`;
      const engineLine = engData?.top_alternatives?.length
        ? `Top ${engData.top_alternatives.length} engine moves at this position:\n` +
          engData.top_alternatives.map((alt, i) => {
            const ev = alt.mate != null ? (alt.mate > 0 ? "+M" : "-M") : fmtCp(alt.eval_cp);
            const cont = alt.pv_san?.slice(1, 4).join(" ");
            return `  ${i + 1}. ${alt.san} (${ev})${cont ? ` — continuation: ${cont}` : ""}`;
          }).join("\n") +
          `\nSystem prompt for chat: You have engine evaluations for the top ${engData.top_alternatives.length} candidate moves at this position. If the user asks about a move not in this list, acknowledge that you don't have engine-verified analysis for that move and respond cautiously based on general principles. Do not invent tactical sequences.`
        : null;

      const moment = currentMoment ?? {
        id: `pos-${plyIdx}`, moveIdx: plyIdx,
        moveNumber: `${Math.ceil(plyIdx / 2)}${plyIdx % 2 === 1 ? "." : "..."}`,
        notation: currentPos.san, classification: "good",
        explanation: analysisText ?? null, qa: null,
      };

      const { text: answer, systemPrompt } = await chatAboutPosition(
        { summary, moment, messages: currentMsgs, question: q, tone, fen: fenCurrent, engineLine, perspective },
        apiKey
      );
      setChatHistory((prev) => [...prev, { role: "assistant", text: answer, systemPrompt }]);
    } catch {
      setChatHistory((prev) => [...prev, { role: "assistant", text: "Analysis failed. Check your API key." }]);
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
  const cdef = CLASS_DEF[classification] ?? CLASS_DEF.good;
  const suggestedQ = currentMoment?.qa?.question;
  const headline = currentMoment?.headline ?? firstSentence(explanation);

  if (!currentPos) return null;

  const moverIsWhite = plyIdx % 2 === 1;
  const sideLabel = moverIsWhite ? "White" : "Black";
  // Half-move disambiguator: 9. for white's 9th, 9… for black's 9th.
  // Mirrors standard chess notation so readers can tell the plies apart.
  const moveNumLabel = `${Math.ceil(plyIdx / 2)}${moverIsWhite ? "." : "…"}`;

  return (
    <div
      ref={scrollerRef}
      style={{
        minHeight: "100vh", background: k.bg, color: k.text,
        fontFamily: k.font.sans, paddingBottom: 96,
      }}
      onTouchStart={(e) => { touchStartX.current = e.touches[0].clientX; }}
      onTouchEnd={(e) => {
        if (touchStartX.current === null) return;
        const dx = e.changedTouches[0].clientX - touchStartX.current;
        touchStartX.current = null;
        if (Math.abs(dx) < 40) return;
        if (dx < 0) setPlyIdx((p) => Math.min(positions.length - 1, p + 1));
        else setPlyIdx((p) => Math.max(1, p - 1));
      }}
    >
      <NavBar
        left={
          <button
            onClick={onBack}
            aria-label="Back"
            style={{ background: "transparent", border: "none", color: k.textMute, fontSize: 20, lineHeight: 1, cursor: "pointer", padding: 4 }}
          >
            ‹
          </button>
        }
        title={`${moveNumLabel} · ${sideLabel}`}
        subtitle={isKeyMoment ? `${moveLabel} · the turning point` : moveLabel}
        right={
          gameSource(gameId) === "lichess" ? (
            <a
              href={`https://lichess.org/${gameId}#${plyIdx}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 13, color: k.accent, fontWeight: 500, textDecoration: "none" }}
            >
              Lichess <ExtLinkIcon size={9} />
            </a>
          ) : null
        }
      />

      <div style={{ maxWidth: 540, margin: "0 auto" }}>
        {/* Per-ply navigation */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, padding: "0 18px 8px" }}>
          <button
            onClick={() => setPlyIdx((p) => Math.max(1, p - 1))}
            disabled={plyIdx <= 1}
            style={{
              background: k.surface2, color: plyIdx <= 1 ? k.textDim : k.text,
              border: `1px solid ${k.hairline}`, borderRadius: 10, padding: "6px 12px",
              fontSize: 14, cursor: plyIdx <= 1 ? "default" : "pointer",
              opacity: plyIdx <= 1 ? 0.4 : 1,
            }}
          >
            ←
          </button>
          <span style={{ fontFamily: k.font.mono, fontSize: 11, color: k.textMute, minWidth: 80, textAlign: "center" }}>
            ply {plyIdx} / {positions.length - 1}
          </span>
          <button
            onClick={() => setPlyIdx((p) => Math.min(positions.length - 1, p + 1))}
            disabled={plyIdx >= positions.length - 1}
            style={{
              background: k.surface2, color: plyIdx >= positions.length - 1 ? k.textDim : k.text,
              border: `1px solid ${k.hairline}`, borderRadius: 10, padding: "6px 12px",
              fontSize: 14, cursor: plyIdx >= positions.length - 1 ? "default" : "pointer",
              opacity: plyIdx >= positions.length - 1 ? 0.4 : 1,
            }}
          >
            →
          </button>
        </div>

        {/* Board */}
        <div style={{ padding: "4px 18px 8px" }}>
          <ThemedBoard
            fen={currentPos.fen}
            fromSq={currentPos.from}
            toSq={currentPos.to}
            altFromSq={altHighlight?.from}
            altToSq={altHighlight?.to}
            hoverFromSq={hoverHighlight?.from}
            hoverToSq={hoverHighlight?.to}
            flip={flip}
            rounded={12}
            showCoords
            hideLink
          />
        </div>

        {/* Classification + move notation */}
        <div style={{ padding: "10px 22px 4px", display: "flex", alignItems: "center", gap: 10 }}>
          <Classification kind={classification} size={12} />
          <span style={{ flex: 1 }} />
          <span style={{ fontFamily: k.font.mono, fontSize: 13, color: k.text, fontWeight: 600 }}>
            {currentMoment?.moveNumber ?? `${Math.ceil(plyIdx / 2)}${plyIdx % 2 === 1 ? "." : "…"}`}
            <span style={{ color: ["mistake", "blunder"].includes(classification) ? cdef.color : k.text }}>
              {" "}{currentPos.san}
            </span>
          </span>
        </div>

        {/* Editorial headline */}
        {headline && (
          <div style={{ padding: "10px 22px 4px" }}>
            <div className="kbz-editorial" style={{ fontSize: 20, lineHeight: 1.3, color: k.text }}>
              {headline}
            </div>
          </div>
        )}

        {/* Eval-swing card — sparkline + (optional) explanation + better line */}
        <div style={{ padding: "16px 16px 0" }}>
          <Card pad={14}>
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              marginBottom: 10,
            }}>
              <span className="kbz-caps">Eval swing</span>
              <span style={{ fontFamily: k.font.mono, fontSize: 12, fontWeight: 600, color: swingColor(evals[plyIdx - 1] ?? 0, evals[plyIdx], perspective, k) }}>
                {fmtSwing(evals[plyIdx - 1] ?? 0, evals[plyIdx], perspective)}
              </span>
            </div>
            <SparklineFit data={evals} markIdx={plyIdx} h={56} />

            {/* Coach's read — soft paragraph below the sparkline */}
            {(explanation || loading || analysisStatus === "loading" || (!apiKey && !explanation)) && (
              <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${k.hairline}` }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <span className="kbz-caps">Coach's read</span>
                  <span style={{ flex: 1 }} />
                  {explanation && (
                    <FlagButton context={{
                      type: "moment", model: DEFAULT_MODEL, promptVersion: PROMPT_VERSION,
                      gameId, pgn, promptSentToLlm: promptForFlag,
                      move: moveLabel, ply: plyIdx, classification,
                      evalBefore: evals[plyIdx - 1] ?? 0, evalAfter: evals[plyIdx],
                      fenBefore, fenAfter, commentary: explanation,
                      engineData: momentEngineData?.[plyIdx],
                    }} />
                  )}
                </div>
                {explanation ? (
                  <div style={{ fontSize: 13, color: k.textMute, lineHeight: 1.55 }}>
                    <AnnotatedText text={deconjunct(explanation)} onHover={setHoverHighlight} fenBefore={fenBefore} fenAfter={fenAfter} />
                  </div>
                ) : loading || analysisStatus === "loading" ? (
                  <div style={{ fontSize: 13, color: k.textDim, fontStyle: "italic", animation: "kbz-pulse 1.4s ease-in-out infinite" }}>
                    Analyzing…
                  </div>
                ) : error ? (
                  <div style={{ fontSize: 13, color: k.bad }}>Analysis failed. Check your API key.</div>
                ) : !apiKey ? (
                  <div style={{ fontSize: 12, color: k.textDim }}>
                    Add an API key from settings to enable AI analysis.
                  </div>
                ) : null}
                {!explanation && apiKey && !loading && analysisStatus !== "loading" && !error && (
                  <button
                    onClick={runAnalysis}
                    style={{
                      marginTop: 8,
                      background: k.surface2, color: k.text,
                      border: `1px solid ${k.hairline}`, borderRadius: 10,
                      padding: "6px 12px", fontSize: 12, fontWeight: 500,
                      cursor: "pointer", fontFamily: k.font.sans,
                    }}
                  >
                    Analyze this move →
                  </button>
                )}
              </div>
            )}

            {/* Better line — inline mono notation, hidden cycle through alts */}
            {currentMoment?.betterMoves?.length > 0 && (
              <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${k.hairline}` }}>
                <div className="kbz-caps" style={{ marginBottom: 8 }}>Better line</div>
                <BetterLine
                  alt={currentMoment.betterMoves[expandedAlt ?? 0]}
                  alts={currentMoment.betterMoves}
                  index={expandedAlt ?? 0}
                  onCycle={() => setExpandedAlt(((expandedAlt ?? 0) + 1) % currentMoment.betterMoves.length)}
                  moveNumber={currentMoment.moveNumber}
                  fenBefore={fenBefore}
                  fenAfter={fenAfter}
                  onHover={setHoverHighlight}
                />
              </div>
            )}
          </Card>
        </div>

        {/* Coach prompt seed card */}
        {apiKey && chatHistory.length === 0 && (
          <div style={{ padding: "12px 16px 0" }}>
            <Card pad={14}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div
                  style={{
                    width: 28, height: 28, borderRadius: 14,
                    background: k.accentDim, color: k.accent,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 14, flexShrink: 0,
                  }}
                >
                  ✦
                </div>
                <div style={{ flex: 1, fontSize: 13, color: k.text }}>
                  {suggestedQ ?? "Why did this feel right at the board?"}
                </div>
                <button
                  onClick={() => sendChat(suggestedQ ?? "Why did this feel right at the board?")}
                  disabled={chatSending}
                  style={{ background: "transparent", border: "none", color: k.accent, fontSize: 12, fontWeight: 600, cursor: chatSending ? "default" : "pointer", opacity: chatSending ? 0.5 : 1 }}
                >
                  Ask ›
                </button>
              </div>
            </Card>
          </div>
        )}

        {/* Chat divider */}
        {(chatHistory.length > 0 || chatSending) && (
          <div style={{ display: "flex", alignItems: "center", padding: "20px 22px 12px", gap: 12 }}>
            <span style={{ flex: 1, height: 1, background: k.hairline }} />
            <span className="kbz-caps" style={{ fontSize: 10, display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span style={{ color: k.accent }}>✦</span>
              Coach · talking about this move
            </span>
            <span style={{ flex: 1, height: 1, background: k.hairline }} />
          </div>
        )}

        {(chatHistory.length > 0 || chatSending) && (
          <div style={{ padding: "0 18px 8px", display: "flex", flexDirection: "column", gap: 10 }}>
            {chatHistory.map((msg, i) => {
              const isCoach = msg.role === "assistant";
              return (
                <div
                  key={i}
                  style={{
                    alignSelf: isCoach ? "flex-start" : "flex-end",
                    maxWidth: "82%",
                    background: isCoach ? k.surface : k.accentDim,
                    color: k.text,
                    borderRadius: 16,
                    padding: "12px 14px",
                    fontSize: 14, lineHeight: 1.5,
                    border: isCoach ? `1px solid ${k.hairline}` : "none",
                  }}
                >
                  {isCoach ? (
                    <>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                        <div className="kbz-caps" style={{ flex: 1, color: k.accent }}>Coach</div>
                        <FlagButton context={{
                          type: "chat", model: DEFAULT_MODEL, promptVersion: PROMPT_VERSION,
                          gameId, pgn, promptSentToLlm: msg.systemPrompt,
                          move: moveLabel, ply: plyIdx, classification,
                          fenBefore, fenAfter, commentary: msg.text,
                          chatHistory: chatHistory.slice(0, i),
                        }} />
                      </div>
                      <RichText text={msg.text} onHover={setHoverHighlight} fenBefore={fenBefore} fenAfter={fenAfter} />
                    </>
                  ) : (
                    msg.text
                  )}
                </div>
              );
            })}
            {chatSending && (
              <div style={{ alignSelf: "flex-start", display: "flex", gap: 4, padding: "8px 14px" }}>
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    style={{
                      width: 6, height: 6, borderRadius: 3, background: k.textDim,
                      animation: `kbz-bounce 1.2s ease-in-out ${i * 0.15}s infinite`,
                    }}
                  />
                ))}
              </div>
            )}
            <div ref={chatEndRef} />
          </div>
        )}

        {/* Sticky composer at bottom */}
        <div style={{
          position: "sticky", bottom: 0, marginTop: 16,
          padding: "0 0 calc(env(safe-area-inset-bottom, 0) + 8px)",
        }}>
          <Composer
            value={chatInput}
            onChange={setChatInput}
            onSend={sendChat}
            placeholder={apiKey ? "Ask about this move…" : "Add API key from settings to chat"}
            disabled={chatSending || !apiKey}
          />
        </div>
      </div>
    </div>
  );
}
