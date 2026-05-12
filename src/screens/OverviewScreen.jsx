import { useState, useRef, useEffect } from "react";
import { chatAboutGame, selectMoments, MAX_OVERVIEW_MOMENTS, DEFAULT_MODEL, PROMPT_VERSION } from "../analyzeGame";
import { FlagButton } from "../FlagButton";
import {
  useKbz, Card, Section, Editorial, NavBar, HoverSparkline, Classification, ThemedBoard,
  MoveTag, Composer, Annotated, stripAnnotations,
} from "../ui";
import { biggestSwingIdx, fmtEval } from "../design";

// Editorial prose with the full marker set (bold, italic, ++pos++,
// ~~cost~~, [[annotation]], muted parens). Thin alias over <Annotated>.
function ProseText({ text, mutedParens = false }) {
  return <Annotated text={text} mode="inline" swing mutedParens={mutedParens} />;
}

// ─── Perspective prompt — modal overlay on first load ───────────────────────

function PerspectivePrompt({ onChoose }) {
  const { k } = useKbz();
  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 60,
        background: "rgba(14,15,16,0.88)",
        backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 24, fontFamily: k.font.sans,
      }}
    >
      <Card pad={24} style={{ maxWidth: 360, width: "100%", textAlign: "center" }} lift>
        <Editorial size={22} style={{ marginBottom: 18 }}>
          Which side were you?
        </Editorial>
        <div style={{ display: "flex", gap: 10 }}>
          <button
            onClick={() => onChoose("white")}
            style={{
              flex: 1, padding: "16px 0", borderRadius: 12,
              background: "#F2EFE5", color: "#1A1A1C",
              fontFamily: k.font.sans, fontSize: 14, fontWeight: 600,
              border: "none", cursor: "pointer",
            }}
          >
            ♔ White
          </button>
          <button
            onClick={() => onChoose("black")}
            style={{
              flex: 1, padding: "16px 0", borderRadius: 12,
              background: k.surface2, color: k.text,
              border: `1px solid ${k.hairline}`,
              fontFamily: k.font.sans, fontSize: 14, fontWeight: 600,
              cursor: "pointer",
            }}
          >
            ♚ Black
          </button>
        </div>
      </Card>
    </div>
  );
}

// ─── Pattern card — coach's recurring observation ───────────────────────────

function PatternCard({ pattern }) {
  const { k } = useKbz();
  const glyph = pattern.glyph ?? "↺";
  const tag = pattern.tag ?? "Principle";
  return (
    <Card pad={14}>
      <div style={{ display: "flex", gap: 12 }}>
        <div
          style={{
            width: 32, height: 32, borderRadius: 8,
            background: k.surface2, color: k.accent,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 18, flexShrink: 0,
          }}
        >
          {glyph}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          {pattern.title && (
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>{pattern.title}</div>
          )}
          <div style={{ fontSize: 13, color: k.textMute, lineHeight: 1.45 }}>
            <ProseText text={pattern.body} />
          </div>
          <div className="kbz-caps" style={{ marginTop: 8, fontSize: 10 }}>{tag}</div>
        </div>
      </div>
    </Card>
  );
}

// ─── Turning-point row — used inline below the CTA ──────────────────────────

function TurningPointRow({ moment, position, evalBefore, evalAfter, flip, onClick, awaitingLlm }) {
  const { k } = useKbz();
  if (!position) return null;
  const teaser = moment.card_teaser ?? stripAnnotations(moment.explanation ?? "");
  const swingColor = moment.classification === "blunder"
    ? k.bad
    : moment.classification === "mistake"
    ? k.warn
    : k.textMute;
  return (
    <Card pad={14} onClick={onClick}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
        <div style={{ flexShrink: 0, width: 96 }}>
          <ThemedBoard
            fen={position.fen}
            fromSq={position.from}
            toSq={position.to}
            flip={flip}
            rounded={8}
            showCoords={false}
            hideLink
          />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ marginBottom: 6 }}>
            <MoveTag move={moment.notation} num={parseInt(moment.moveNumber)} side={moment.player === "white" ? "w" : "b"} />
          </div>
          <div style={{ marginBottom: 8 }}>
            <Classification kind={moment.classification} size={11} />
          </div>
          {teaser ? (
            <div style={{ fontSize: 13, color: k.text, lineHeight: 1.4, fontWeight: 500 }}>
              {teaser}
            </div>
          ) : awaitingLlm ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ height: 11, background: k.surface2, borderRadius: 4, width: "92%", animation: "kbz-pulse 1.4s ease-in-out infinite" }} />
              <div style={{ height: 11, background: k.surface2, borderRadius: 4, width: "62%", animation: "kbz-pulse 1.4s ease-in-out infinite" }} />
            </div>
          ) : null}
        </div>
      </div>
      <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${k.hairline}`, display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontFamily: k.font.mono, fontSize: 12, color: k.textMute }}>{fmtEval(evalBefore)}</span>
        <svg width="40" height="10" viewBox="0 0 40 10">
          <path d="M2 5 L32 5" stroke={k.textDim} strokeWidth="1" />
          <path d="M28 1 L36 5 L28 9" fill="none" stroke={k.textDim} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span style={{ fontFamily: k.font.mono, fontSize: 12, color: swingColor }}>{fmtEval(evalAfter)}</span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: k.accent, fontWeight: 600 }}>Drill in ›</span>
      </div>
    </Card>
  );
}

// ─── GameOverview ───────────────────────────────────────────────────────────

export function OverviewScreen({
  game, gameId, perspective, onPerspectiveSet, onReset, onDrillIn, onStartReview,
  apiKey, tone, analysisStatus, localProgress, startLocalAnalysis,
}) {
  const { k } = useKbz();
  const { positions, evals, summary, pgn, promptSentToLlm } = game;
  const moments = selectMoments(game.moments, evals, MAX_OVERVIEW_MOMENTS);
  const chatKey = `chess-chat-game-${gameId}`;
  const [gameChatHistory, setGameChatHistory] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem(chatKey) ?? "[]"); } catch { return []; }
  });
  useEffect(() => {
    try { sessionStorage.setItem(chatKey, JSON.stringify(gameChatHistory)); } catch {}
  }, [gameChatHistory, chatKey]);
  const [gameChatInput, setGameChatInput] = useState("");
  const [gameChatSending, setGameChatSending] = useState(false);
  const chatEndRef = useRef(null);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [gameChatHistory]);

  const flip = perspective === "black";
  // Anchor the overview sparkline at the most significant swing (which is
  // usually but not always the first-by-move turning point in `moments`).
  const turningIdx = biggestSwingIdx(evals);
  const flagCtx = { type: "game-overview", model: DEFAULT_MODEL, promptVersion: PROMPT_VERSION, gameId, pgn, promptSentToLlm };
  const loading = analysisStatus === "loading";

  const sendGameChat = async () => {
    const q = gameChatInput.trim();
    if (!q || gameChatSending || !apiKey) return;
    setGameChatSending(true);
    setGameChatInput("");
    const currentMsgs = [...gameChatHistory];
    setGameChatHistory((prev) => [...prev, { role: "user", text: q }]);
    try {
      const { text } = await chatAboutGame({
        summary, narrative: summary.narrative, turningPoints: moments,
        pgn, evals, messages: currentMsgs, question: q, tone, perspective,
      }, apiKey);
      setGameChatHistory((prev) => [...prev, { role: "assistant", text }]);
    } catch {
      setGameChatHistory((prev) => [...prev, { role: "assistant", text: "Analysis failed. Check your API key." }]);
    } finally {
      setGameChatSending(false);
    }
  };

  const opening = summary.opening ?? "Unknown opening";
  const result = summary.result ?? "*";
  const speed = summary.event ? summary.event.split("·")[0]?.trim() : null;
  const subtitle = `${result} · ${opening}${speed ? ` · ${speed}` : ""}`;
  const tpNotation = moments
    .slice(0, 3)
    .map((m) => `Move ${m.moveIdx} (${m.classification[0].toUpperCase()}${m.classification.slice(1)})`)
    .join(" · ");

  // Player labels for the title bar — opponent emphasised when perspective known
  const titleHtml = perspective
    ? perspective === "white"
      ? `vs ${summary.black}`
      : `vs ${summary.white}`
    : `${summary.white} vs ${summary.black}`;

  return (
    <div style={{
      minHeight: "100vh",
      background: k.bg,
      color: k.text,
      fontFamily: k.font.sans,
      paddingBottom: 40,
    }}>
      {perspective === null && <PerspectivePrompt onChoose={onPerspectiveSet} />}

      <NavBar
        left={
          <button
            onClick={onReset}
            style={{ background: "transparent", border: "none", color: k.textMute, fontSize: 20, lineHeight: 1, cursor: "pointer", padding: 4 }}
            aria-label="Back to games"
          >
            ‹
          </button>
        }
        title={titleHtml}
        subtitle={subtitle}
        right={
          <FlagButton context={{ ...flagCtx, commentary: summary.narrative ?? "" }} />
        }
      />

      <div style={{ maxWidth: 540, margin: "0 auto" }}>
        {/* Meta strip — analyzed N ago + re-analyze ↻ */}
        <div style={{
          padding: "2px 22px 10px", display: "flex", alignItems: "center", gap: 8,
          fontSize: 11, color: k.textMute, flexWrap: "wrap",
        }}>
          <span style={{ width: 5, height: 5, borderRadius: 3, background: analysisStatus === "done" ? k.accent : k.warn }} />
          <span>
            {analysisStatus === "loading" ? "Analyzing now…"
              : analysisStatus === "awaiting-evals" ? "Awaiting computer analysis"
              : analysisStatus === "error" ? "Analysis failed — check API key"
              : "Computer-analysed · Stockfish"}
          </span>
          {perspective && (
            <>
              <span style={{ color: k.textDim }}>·</span>
              <span style={{
                display: "inline-flex", alignItems: "center", gap: 4,
                color: k.accent, fontWeight: 600,
              }}>
                <span style={{ fontSize: 13, lineHeight: 1 }}>{perspective === "white" ? "♔" : "♚"}</span>
                Playing as {perspective === "white" ? "White" : "Black"}
              </span>
            </>
          )}
          <span style={{ flex: 1 }} />
          {analysisStatus === "awaiting-evals" ? (
            <button
              onClick={startLocalAnalysis}
              style={{ background: "transparent", border: "none", color: k.accent, fontWeight: 600, fontSize: 11, cursor: "pointer", padding: 0 }}
            >
              Analyze locally ↻
            </button>
          ) : (
            <span style={{ color: k.textDim }}>
              {localProgress ? `${localProgress.current}/${localProgress.total}` : ""}
            </span>
          )}
        </div>

        {/* Loading / local-progress bars */}
        {loading && (
          <div style={{ height: 2, margin: "0 18px 12px", background: k.surface3, borderRadius: 1, overflow: "hidden" }}>
            <div style={{ height: "100%", background: k.accent, width: "50%", animation: "kbz-pulse 1.5s ease-in-out infinite" }} />
          </div>
        )}
        {localProgress && (
          <div style={{ height: 2, margin: "0 18px 12px", background: k.surface3, borderRadius: 1, overflow: "hidden" }}>
            <div style={{ height: "100%", background: k.warn, transition: "width 300ms", width: `${(localProgress.current / Math.max(1, localProgress.total)) * 100}%` }} />
          </div>
        )}

        {/* Whole-game eval sparkline */}
        {evals && evals.length > 1 && (
          <div style={{ padding: "6px 18px 6px" }}>
            <div style={{
              display: "flex", justifyContent: "space-between",
              padding: "0 4px 6px",
            }}>
              <span className="kbz-caps" style={{ fontSize: 10 }}>Eval · whole game</span>
              {turningIdx >= 0 && moments[0] && (
                <button
                  onClick={() => onDrillIn(turningIdx)}
                  style={{
                    fontSize: 10,
                    color: k.warn,
                    textTransform: "uppercase",
                    letterSpacing: 0.6,
                    fontWeight: 600,
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    padding: 0,
                    fontFamily: k.font.sans,
                    textDecoration: "underline",
                    textUnderlineOffset: 3,
                    textDecorationColor: `${k.warn}66`,
                  }}
                >
                  turn at move {Math.ceil(turningIdx / 2)} ›
                </button>
              )}
            </div>
            <HoverSparkline data={perspective === 'black' ? evals.map(v => -v) : evals} markIdx={turningIdx} h={68} onClickIdx={onDrillIn} />
          </div>
        )}

        {/* Editorial narrative */}
        <div style={{ padding: "18px 22px 4px" }}>
          <div className="kbz-caps" style={{ marginBottom: 10 }}>The story</div>
          {loading && !summary.narrative ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ height: 18, background: k.surface2, borderRadius: 6, animation: "kbz-pulse 1.4s ease-in-out infinite" }} />
              <div style={{ height: 18, width: "85%", background: k.surface2, borderRadius: 6, animation: "kbz-pulse 1.4s ease-in-out infinite" }} />
              <div style={{ height: 18, width: "60%", background: k.surface2, borderRadius: 6, animation: "kbz-pulse 1.4s ease-in-out infinite" }} />
            </div>
          ) : summary.narrative ? (
            <Editorial size={20} style={{ lineHeight: 1.4 }}>
              <ProseText text={summary.narrative} mutedParens />
            </Editorial>
          ) : (
            <div style={{ fontSize: 13, color: k.textDim }}>
              {analysisStatus === "error"
                ? "Analysis failed. Check your API key."
                : "The story will appear once analysis completes."}
            </div>
          )}
        </div>

        {/* Pattern observation */}
        {(summary.pattern || loading) && (
          <div style={{ padding: "18px 16px 0" }}>
            <Section label="Patterns I noticed" style={{ marginBottom: 6 }} />
            {summary.pattern ? (
              <PatternCard pattern={{
                glyph: "↺",
                title: undefined,
                body: stripAnnotations(summary.pattern),
                tag: "Principle",
              }} />
            ) : (
              <Card pad={14}>
                <div style={{ display: "flex", gap: 12 }}>
                  <div style={{
                    width: 32, height: 32, borderRadius: 8,
                    background: k.surface2, flexShrink: 0,
                  }} />
                  <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
                    <div style={{ height: 14, background: k.surface2, borderRadius: 4, width: "90%", animation: "kbz-pulse 1.4s ease-in-out infinite" }} />
                    <div style={{ height: 14, background: k.surface2, borderRadius: 4, width: "70%", animation: "kbz-pulse 1.4s ease-in-out infinite" }} />
                    <div style={{ height: 10, background: k.surface2, borderRadius: 4, width: 60, marginTop: 4, animation: "kbz-pulse 1.4s ease-in-out infinite" }} />
                  </div>
                </div>
              </Card>
            )}
          </div>
        )}

        {/* CTA: see turning points */}
        {moments.length > 0 && (
          <div style={{ padding: "18px 16px 0" }}>
            <Card pad={16} accent onClick={() => onDrillIn(moments[0].moveIdx)}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 15, color: k.text, marginBottom: 2 }}>
                    See the {moments.length} turning point{moments.length !== 1 ? "s" : ""}
                  </div>
                  <div style={{ fontSize: 12, color: k.textMute }}>
                    {tpNotation || "Tap to start"}
                  </div>
                </div>
                <div style={{ color: k.accent, fontSize: 20 }}>›</div>
              </div>
            </Card>
          </div>
        )}

        {/* Turning points list */}
        {moments.length > 0 && (
          <Section label="Turning points" style={{ padding: "20px 16px 0" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {moments.map((moment) => {
                const pos = positions[moment.moveIdx];
                return (
                  <TurningPointRow
                    key={moment.moveIdx}
                    moment={moment}
                    position={pos}
                    evalBefore={evals[moment.moveIdx - 1] ?? 0}
                    evalAfter={evals[moment.moveIdx]}
                    flip={flip}
                    onClick={() => onDrillIn(moment.moveIdx)}
                  />
                );
              })}
            </div>
          </Section>
        )}

        {/* Start review */}
        <div style={{ padding: "20px 16px 8px" }}>
          <button
            onClick={onStartReview}
            style={{
              width: "100%", padding: "14px 16px", borderRadius: 12,
              background: k.surface, color: k.text,
              border: `1px solid ${k.hairline}`,
              fontSize: 14, fontWeight: 500, cursor: "pointer",
              fontFamily: k.font.sans,
            }}
          >
            Start from move 1 →
          </button>
        </div>

        {/* Ask about this game */}
        <div style={{ padding: "12px 16px 8px" }}>
          <Section label="Ask about this game" style={{ marginBottom: 6 }} />
          {(gameChatHistory.length > 0 || gameChatSending) && (
            <Card pad={0} style={{ marginBottom: 10, overflow: "hidden" }}>
              {gameChatHistory.map((msg, i) => (
                <div
                  key={i}
                  style={{
                    padding: "12px 14px",
                    borderTop: i === 0 ? "none" : `1px solid ${k.hairline}`,
                    fontSize: 14, lineHeight: 1.5,
                    color: msg.role === "user" ? k.text : k.textMute,
                  }}
                >
                  <div className="kbz-caps" style={{ marginBottom: 6, color: msg.role === "user" ? k.textMute : k.accent }}>
                    {msg.role === "user" ? "You" : "Coach"}
                  </div>
                  {msg.role === "assistant"
                    ? <ProseText text={msg.text} />
                    : msg.text}
                </div>
              ))}
              {gameChatSending && (
                <div style={{ padding: "12px 14px", borderTop: `1px solid ${k.hairline}`, fontSize: 14, color: k.textDim, fontStyle: "italic", animation: "kbz-pulse 1.4s ease-in-out infinite" }}>
                  <div className="kbz-caps" style={{ marginBottom: 6, color: k.accent }}>Coach</div>
                  Thinking…
                </div>
              )}
              <div ref={chatEndRef} />
            </Card>
          )}
          <Composer
            value={gameChatInput}
            onChange={setGameChatInput}
            onSend={sendGameChat}
            placeholder="Ask about this game…"
            disabled={gameChatSending || !apiKey}
            sticky={false}
          />
          {!apiKey && (
            <div style={{ fontSize: 11, color: k.textDim, marginTop: 6, padding: "0 14px" }}>
              Add an Anthropic API key from settings to enable chat.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

