import { useState, useRef, useEffect } from "react";
import { chatAboutGame, selectMoments, MAX_OVERVIEW_MOMENTS, DEFAULT_MODEL, PROMPT_VERSION } from "./analyzeGame";
import { FlagButton } from "./FlagButton";
import { Board, EvalBar, Chip, CLS } from "./MoveAnalysisView";

function stripAnnotations(text) {
  if (!text) return text;
  return text.replace(/\[\[([^\]|]*?)(?:\|[^\]]*?)?\]\]/g, "$1");
}

function RichText({ text }) {
  if (!text) return null;
  const elements = [];
  for (const [i, line] of text.split("\n").entries()) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    elements.push(<p key={i} className="leading-relaxed">{trimmed}</p>);
  }
  return <div className="space-y-1.5">{elements}</div>;
}

// ─── Overview card ────────────────────────────────────────────────────────────

function OverviewCard({ summary, analysisStatus, pgn, gameId, promptSentToLlm }) {
  const flagCtx = { type: 'game-overview', model: DEFAULT_MODEL, promptVersion: PROMPT_VERSION, gameId, pgn, promptSentToLlm };
  const loading = analysisStatus === 'loading';

  const ResultBadge = () => {
    const color = summary.result === '1-0'
      ? 'text-zinc-100 bg-white/10 border-white/20'
      : summary.result === '0-1'
      ? 'text-zinc-400 bg-zinc-800 border-zinc-700'
      : 'text-zinc-400 bg-zinc-800 border-zinc-700';
    return (
      <span className={`inline-flex px-3 py-1.5 rounded-full border text-sm font-bold ${color}`}>
        {summary.result}
      </span>
    );
  };

  return (
    <div className="h-full flex flex-col px-4 py-5 overflow-y-auto">
      <ResultBadge />
      <div className="mt-4 space-y-3 flex-1">
        {loading ? (
          <div className="space-y-2 animate-pulse">
            <div className="h-4 bg-zinc-800 rounded w-full" />
            <div className="h-4 bg-zinc-800 rounded w-5/6" />
            <div className="h-4 bg-zinc-800 rounded w-4/6" />
          </div>
        ) : summary.narrative ? (
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-2.5">
              <div className="text-[9px] text-zinc-500 uppercase tracking-widest flex-1">Game narrative</div>
              <FlagButton context={{ ...flagCtx, commentary: summary.narrative }} />
            </div>
            <p className="text-sm text-zinc-300 leading-[1.75]">{stripAnnotations(summary.narrative)}</p>
          </div>
        ) : (
          <div className="bg-zinc-900/40 border border-zinc-800/40 rounded-2xl p-4">
            <p className="text-sm text-zinc-600">
              {analysisStatus === 'error'
                ? 'Analysis failed. Check your API key.'
                : 'Narrative will appear here once analysis completes.'}
            </p>
          </div>
        )}
        {summary.pattern && (
          <div className="bg-indigo-950/50 border border-indigo-500/20 rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-2.5">
              <div className="text-[9px] text-indigo-400 uppercase tracking-widest flex-1">Pattern observed</div>
              <FlagButton context={{ ...flagCtx, commentary: summary.pattern }} />
            </div>
            <p className="text-sm text-zinc-300 leading-[1.75]">{stripAnnotations(summary.pattern)}</p>
          </div>
        )}
      </div>
      <p className="text-[10px] text-zinc-400 text-center mt-4">swipe to explore →</p>
    </div>
  );
}

// ─── Turning point card ───────────────────────────────────────────────────────

function TurningPointCard({ moment, position, evalBefore, evalAfter, flip, onDrillIn, desktop, perspective }) {
  const boardSize = desktop ? "w-[300px] mx-auto" : "w-full";
  const teaser = moment.card_teaser ?? stripAnnotations(moment.explanation ?? '');

  return (
    <div className={`${desktop ? 'flex flex-col bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden h-full' : 'h-full flex flex-col px-4 py-5 overflow-y-auto'}`}>
      {/* Move header */}
      <div className={`${desktop ? 'px-4 pt-4 pb-3' : 'mb-3'} flex items-center gap-2 flex-wrap`}>
        <span className={`font-mono font-bold text-base ${CLS[moment.classification]?.text ?? 'text-zinc-300'}`}>
          {moment.moveNumber} {moment.notation}
        </span>
        <Chip classification={moment.classification} small />
      </div>

      {/* Board — tappable, link suppressed so click goes cleanly to drill-in */}
      <div className={`${desktop ? 'px-3 pb-3' : 'mb-3'} ${boardSize}`}>
        <div
          className="cursor-pointer hover:opacity-90 active:opacity-80 transition-opacity"
          onClick={onDrillIn}
        >
          <Board
            fen={position.fen}
            fromSq={position.from}
            toSq={position.to}
            flip={flip}
            hideLink
          />
        </div>
      </div>

      {/* Eval swing */}
      <div className={`${desktop ? 'px-4 pb-3' : 'mb-3'}`}>
        <EvalBar before={evalBefore} after={evalAfter} perspective={perspective} />
      </div>

      {/* Teaser text */}
      <div className={`${desktop ? 'px-4 pb-4 flex-1' : 'flex-1 mb-4'}`}>
        {teaser ? (
          <p className="text-sm text-zinc-400 leading-relaxed">{teaser}</p>
        ) : (
          <p className="text-sm text-zinc-700 italic">Analysis loading…</p>
        )}
      </div>

      {/* Analyze button */}
      <div className={`${desktop ? 'px-4 pb-4' : ''}`}>
        <button
          onClick={onDrillIn}
          className="w-full py-2.5 rounded-xl border border-zinc-700/60 text-xs text-zinc-400 hover:border-zinc-500 hover:text-zinc-200 transition-colors"
        >
          Analyze this move →
        </button>
      </div>
    </div>
  );
}

// ─── Bridge card ──────────────────────────────────────────────────────────────

function BridgeCard({ onStartReview, chatHistory, chatInput, setChatInput, onSend, sending, apiKey }) {
  const chatEndRef = useRef(null);
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [chatHistory]);

  return (
    <div className="h-full flex flex-col justify-center px-4 py-5 overflow-y-auto">
      <div className="space-y-4">
        <div className="text-center">
          <p className="text-sm text-zinc-500 mb-3">Want to go deeper?</p>
          <button
            onClick={onStartReview}
            className="text-sm text-indigo-400 hover:text-indigo-300 underline underline-offset-2 transition-colors"
          >
            Start from move 1 →
          </button>
        </div>

        <div className="border-t border-zinc-800 pt-4">
          <div className="text-[9px] text-zinc-500 uppercase tracking-widest mb-3">Ask about this game</div>

          {(chatHistory.length > 0 || sending) && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl mb-3 overflow-hidden divide-y divide-zinc-800/70">
              {chatHistory.map((msg, i) => (
                <div key={i} className={`px-4 py-3 text-sm leading-relaxed ${msg.role === "user" ? "text-zinc-300" : "text-zinc-400"}`}>
                  <div className={`text-[9px] font-bold uppercase tracking-widest mb-1.5 ${msg.role === "user" ? "text-zinc-600" : "text-indigo-500"}`}>
                    {msg.role === "user" ? "You" : "Coach"}
                  </div>
                  <p>{msg.text}</p>
                </div>
              ))}
              {sending && (
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
              onKeyDown={(e) => e.key === "Enter" && onSend()}
              placeholder="Ask about this game…" disabled={sending}
              className="flex-1 min-w-0 bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-600 disabled:opacity-50 transition-colors" />
            <button onClick={onSend} disabled={sending || !chatInput.trim() || !apiKey}
              className="px-5 py-3 bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 disabled:opacity-40 rounded-xl text-sm font-semibold transition-colors shrink-0">
              Ask
            </button>
          </div>
          {!apiKey && (
            <p className="text-xs text-zinc-600 mt-2 text-center">Add an API key on the import screen to enable chat.</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Perspective prompt ───────────────────────────────────────────────────────

function PerspectivePrompt({ onChoose }) {
  return (
    <div className="fixed inset-0 z-50 bg-zinc-950/90 flex items-center justify-center p-6">
      <div className="w-full max-w-sm bg-zinc-900 border border-zinc-800 rounded-2xl p-6 text-center space-y-4">
        <div className="text-sm font-medium text-zinc-200">Which side are you analyzing as?</div>
        <div className="flex gap-3">
          <button
            onClick={() => onChoose('white')}
            className="flex-1 py-4 rounded-xl bg-zinc-100 hover:bg-white text-zinc-900 text-sm font-bold transition-colors"
          >
            ♔ White
          </button>
          <button
            onClick={() => onChoose('black')}
            className="flex-1 py-4 rounded-xl bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-100 text-sm font-bold transition-colors"
          >
            ♚ Black
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── GameOverview ─────────────────────────────────────────────────────────────

export function GameOverview({
  game, gameId, perspective, onPerspectiveSet, onReset, onDrillIn, onStartReview,
  apiKey, tone, analysisStatus, localProgress, startLocalAnalysis, initialCard = 0,
}) {
  const { positions, evals, summary, pgn, promptSentToLlm } = game;
  // Cap to MAX_OVERVIEW_MOMENTS (5), proportionally distributed across game thirds
  const moments = selectMoments(game.moments, evals, MAX_OVERVIEW_MOMENTS);
  const [activeCard, setActiveCard] = useState(initialCard);
  const [gameChatHistory, setGameChatHistory] = useState([]);
  const [gameChatInput, setGameChatInput] = useState('');
  const [gameChatSending, setGameChatSending] = useState(false);
  const reelRef = useRef(null);

  // Scroll to initialCard on mount (restores position after back-nav from drill-in)
  useEffect(() => {
    if (initialCard > 0 && reelRef.current) {
      reelRef.current.scrollLeft = reelRef.current.clientWidth * initialCard;
    }
  }, []);

  const flip = perspective === 'black';
  const totalCards = 1 + moments.length + 1; // overview + turning points + bridge

  const handleReelScroll = () => {
    if (!reelRef.current) return;
    const idx = Math.round(reelRef.current.scrollLeft / reelRef.current.clientWidth);
    setActiveCard(Math.max(0, Math.min(totalCards - 1, idx)));
  };

  const sendGameChat = async () => {
    const q = gameChatInput.trim();
    if (!q || gameChatSending || !apiKey) return;
    setGameChatSending(true);
    setGameChatInput('');
    const currentMsgs = [...gameChatHistory];
    setGameChatHistory(prev => [...prev, { role: 'user', text: q }]);
    try {
      const { text } = await chatAboutGame({
        summary,
        narrative: summary.narrative,
        turningPoints: moments,
        pgn,
        evals,
        messages: currentMsgs,
        question: q,
        tone,
        perspective,
      }, apiKey);
      setGameChatHistory(prev => [...prev, { role: 'assistant', text }]);
    } catch {
      setGameChatHistory(prev => [...prev, { role: 'assistant', text: 'Analysis failed. Check your API key.' }]);
    } finally {
      setGameChatSending(false);
    }
  };

  const perspectiveLabel = perspective === 'white' ? '♔ White' : '♚ Black';

  return (
    <div className="h-screen bg-zinc-950 text-zinc-100 flex flex-col overflow-hidden">
      {/* Perspective prompt */}
      {perspective === null && <PerspectivePrompt onChoose={onPerspectiveSet} />}

      {/* Sticky header */}
      <header className="shrink-0 bg-zinc-900/90 backdrop-blur border-b border-zinc-800">
        <div className="flex items-start gap-2 px-4 py-3">
          <button onClick={onReset}
            className="text-zinc-600 hover:text-zinc-300 transition-colors text-sm shrink-0 pt-0.5">←</button>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-zinc-100 truncate">
              {summary.white} <span className="text-zinc-500 font-normal">vs</span> {summary.black}
            </div>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              <span className="text-xs text-zinc-500">{summary.opening ?? 'Unknown opening'}</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400 border border-zinc-700">{summary.result}</span>
              {perspective && (
                <span className="text-[10px] text-indigo-400">Playing as {perspectiveLabel}</span>
              )}
            </div>
          </div>
          {/* Mobile progress dots */}
          <div className="md:hidden flex items-center gap-2 pt-1.5 shrink-0">
            <div className="flex items-center gap-1">
              {Array.from({ length: totalCards }, (_, i) => (
                <div key={i} className={`rounded-full transition-all ${i === activeCard ? 'w-4 h-1.5 bg-zinc-300' : 'w-1.5 h-1.5 bg-zinc-700'}`} />
              ))}
            </div>
          </div>
        </div>

        {/* Analysis loading bar */}
        {analysisStatus === 'loading' && (
          <div className="h-0.5 bg-zinc-800">
            <div className="h-full bg-indigo-500 animate-pulse w-1/2" />
          </div>
        )}
        {localProgress && (
          <div className="h-0.5 bg-zinc-800">
            <div className="h-full bg-amber-500 transition-all duration-300"
              style={{ width: `${(localProgress.current / localProgress.total) * 100}%` }} />
          </div>
        )}
      </header>

      {/* Awaiting evals banner */}
      {analysisStatus === 'awaiting-evals' && (
        <div className="shrink-0 bg-amber-950/40 border-b border-amber-800/30 px-4 py-3">
          <p className="text-xs text-amber-400 mb-2">Computer analysis needed to identify key moments.</p>
          <button onClick={startLocalAnalysis}
            className="py-2 px-4 rounded-xl bg-amber-600 hover:bg-amber-500 text-xs font-semibold text-white transition-colors">
            Analyze locally (~1 min)
          </button>
        </div>
      )}

      {/* Mobile: horizontal scroll-snap reel */}
      <div
        ref={reelRef}
        onScroll={handleReelScroll}
        className="md:hidden flex-1 flex overflow-x-auto"
        style={{ scrollSnapType: 'x mandatory', scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}
      >
        {/* Card 0: Overview */}
        <div style={{ scrollSnapAlign: 'start', minWidth: '100%', height: '100%' }}>
          <OverviewCard
            summary={summary}
            analysisStatus={analysisStatus}
            pgn={pgn}
            gameId={gameId}
            promptSentToLlm={promptSentToLlm}
          />
        </div>

        {/* Cards 1..N: Turning points */}
        {moments.map(moment => {
          const pos = positions[moment.moveIdx];
          if (!pos) return null;
          return (
            <div key={moment.moveIdx} style={{ scrollSnapAlign: 'start', minWidth: '100%', height: '100%' }}>
              <TurningPointCard
                moment={moment}
                position={pos}
                evalBefore={evals[moment.moveIdx - 1] ?? 0}
                evalAfter={evals[moment.moveIdx]}
                flip={flip}
                onDrillIn={() => onDrillIn(moment.moveIdx)}
                perspective={perspective}
              />
            </div>
          );
        })}

        {/* Bridge card */}
        <div style={{ scrollSnapAlign: 'start', minWidth: '100%', height: '100%' }}>
          <BridgeCard
            onStartReview={onStartReview}
            chatHistory={gameChatHistory}
            chatInput={gameChatInput}
            setChatInput={setGameChatInput}
            onSend={sendGameChat}
            sending={gameChatSending}
            apiKey={apiKey}
          />
        </div>
      </div>

      {/* Desktop: grid layout */}
      <div className="hidden md:block flex-1 overflow-y-auto">
        <div className="max-w-6xl mx-auto px-6 py-6 space-y-8">
          {/* Narrative section */}
          {(analysisStatus === 'loading' || summary.narrative) && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6">
              {analysisStatus === 'loading' && !summary.narrative ? (
                <div className="space-y-2 animate-pulse">
                  <div className="h-4 bg-zinc-800 rounded w-full" />
                  <div className="h-4 bg-zinc-800 rounded w-5/6" />
                  <div className="h-4 bg-zinc-800 rounded w-4/6" />
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-2 mb-3">
                    <div className="text-[9px] text-zinc-500 uppercase tracking-widest flex-1">Game narrative</div>
                    <FlagButton context={{ type: 'game-overview', model: DEFAULT_MODEL, promptVersion: PROMPT_VERSION, gameId, pgn, promptSentToLlm, commentary: summary.narrative }} />
                  </div>
                  <p className="text-sm text-zinc-300 leading-[1.75]">{stripAnnotations(summary.narrative ?? '')}</p>
                  {summary.pattern && (
                    <p className="text-xs text-zinc-500 mt-3 pt-3 border-t border-zinc-800">{stripAnnotations(summary.pattern)}</p>
                  )}
                </>
              )}
            </div>
          )}

          {/* Turning points grid */}
          {moments.length > 0 && (
            <div>
              <div className="text-[9px] text-zinc-500 uppercase tracking-widest mb-4">Key moments</div>
              <div className="grid grid-cols-2 xl:grid-cols-3 gap-4">
                {moments.map(moment => {
                  const pos = positions[moment.moveIdx];
                  if (!pos) return null;
                  return (
                    <TurningPointCard
                      key={moment.moveIdx}
                      moment={moment}
                      position={pos}
                      evalBefore={evals[moment.moveIdx - 1] ?? 0}
                      evalAfter={evals[moment.moveIdx]}
                      flip={flip}
                      onDrillIn={() => onDrillIn(moment.moveIdx)}
                      desktop
                      perspective={perspective}
                    />
                  );
                })}
              </div>
            </div>
          )}

          {/* Bridge section */}
          <div className="border-t border-zinc-800 pt-8 pb-8">
            <div className="flex items-center justify-between mb-6">
              <button onClick={onStartReview}
                className="text-sm text-indigo-400 hover:text-indigo-300 underline underline-offset-2 transition-colors">
                Start from move 1 →
              </button>
            </div>
            <div className="max-w-2xl">
              <div className="text-[9px] text-zinc-500 uppercase tracking-widest mb-3">Ask about this game</div>
              {(gameChatHistory.length > 0 || gameChatSending) && (
                <div className="bg-zinc-900 border border-zinc-800 rounded-2xl mb-3 overflow-hidden divide-y divide-zinc-800/70">
                  {gameChatHistory.map((msg, i) => (
                    <div key={i} className={`px-4 py-3 text-sm leading-relaxed ${msg.role === "user" ? "text-zinc-300" : "text-zinc-400"}`}>
                      <div className={`text-[9px] font-bold uppercase tracking-widest mb-1.5 ${msg.role === "user" ? "text-zinc-600" : "text-indigo-500"}`}>
                        {msg.role === "user" ? "You" : "Coach"}
                      </div>
                      <p>{msg.text}</p>
                    </div>
                  ))}
                  {gameChatSending && (
                    <div className="px-4 py-3 text-sm text-zinc-500 italic animate-pulse">
                      <div className="text-[9px] font-bold uppercase tracking-widest mb-1.5 text-indigo-500">Coach</div>
                      Thinking…
                    </div>
                  )}
                </div>
              )}
              <div className="flex gap-2">
                <input type="text" value={gameChatInput} onChange={(e) => setGameChatInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && sendGameChat()}
                  placeholder="Ask about this game…" disabled={gameChatSending}
                  className="flex-1 min-w-0 bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-600 disabled:opacity-50 transition-colors" />
                <button onClick={sendGameChat} disabled={gameChatSending || !gameChatInput.trim() || !apiKey}
                  className="px-5 py-3 bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 disabled:opacity-40 rounded-xl text-sm font-semibold transition-colors shrink-0">
                  Ask
                </button>
              </div>
              {!apiKey && (
                <p className="text-xs text-zinc-600 mt-2">Add an API key on the import screen to enable chat.</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
