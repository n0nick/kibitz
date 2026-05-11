import { useState, useRef, useEffect, useContext } from "react";
import { parseLichessUrl, fetchLichessGame, parseGame, reclassifyWithEvals } from "./parseGame";
import { TONES, DEFAULT_MODEL, PROMPT_VERSION, selectMoments, MAX_OVERVIEW_MOMENTS } from "./analyzeGame";
import { FlagButton } from "./FlagButton";
import ReportViewer from "./ReportViewer";
import { fetchLichessAccount, fetchLichessRecentGames } from "./lichess";
import { browserEngine } from "./stockfish";
import { mergeAnalysis, analyzePositions, analyzeWithClaude } from "./pipeline";
import { runMigrations, evalsKey } from "./migrations";
import { GameOverview } from "./GameOverview";
import { MoveAnalysisView } from "./MoveAnalysisView";
import { GameContext } from "./context";

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
  pgn: DEMO_PGN,
  gameId: "opera-1858",
};

// ─── SPA-safe click: prevent default only for plain left-clicks so cmd/ctrl/middle still open new tabs

function spaClick(handler) {
  return (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    handler(e);
  };
}

const CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

function getCachedPgn(id) {
  try {
    const raw = localStorage.getItem(`kibitz-pgn-${id}`);
    if (!raw) return null;
    const { data, ts } = JSON.parse(raw);
    if (Date.now() - ts < CACHE_TTL) return data;
    localStorage.removeItem(`kibitz-pgn-${id}`);
  } catch {}
  return null;
}

function setCachedPgn(id, pgn) {
  try { localStorage.setItem(`kibitz-pgn-${id}`, JSON.stringify({ data: pgn, ts: Date.now() })); } catch {}
}

function gameSource(id) {
  if (!id || id === "opera-1858") return "demo";
  if (id.startsWith("pgn-")) return "pgn";
  return "lichess";
}

function getHistory() {
  try { return JSON.parse(localStorage.getItem("kibitz-history") ?? "[]"); } catch { return []; }
}

function addToHistory({ id, source, white, black, result }) {
  try {
    const prev = getHistory().filter((h) => h.id !== id);
    prev.unshift({ id, source, white, black, result, reviewedAt: Date.now() });
    localStorage.setItem("kibitz-history", JSON.stringify(prev.slice(0, 30)));
  } catch {}
}

function pgnGameId(pgn) {
  const m = pgn.match(/\[Site\s+"https?:\/\/(?:www\.)?lichess\.org\/([a-zA-Z0-9]{8})(?:[/?#][^"]*)?"]/);
  if (m) return m[1];
  const moves = pgn.replace(/\[[^\]]*\]/g, '').replace(/\{[^}]*\}/g, '').replace(/\s+/g, ' ').trim();
  let h = 0;
  for (let i = 0; i < moves.length; i++) h = Math.imul(31, h) + moves.charCodeAt(i) | 0;
  return `pgn-${(h >>> 0).toString(36)}`;
}

// ─── API key hook ─────────────────────────────────────────────────────────────

const API_KEY_STORAGE = "kibitz-anthropic-key";

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
  const [tone, setToneState] = useState(() => localStorage.getItem("kibitz-tone") ?? "beginner");
  const setTone = (v) => { localStorage.setItem("kibitz-tone", v); setToneState(v); };
  return [tone, setTone];
}

function useLichess() {
  const [token, setTokenState] = useState(() => localStorage.getItem("kibitz-lichess-token") ?? "");
  const [username, setUsernameState] = useState(() => localStorage.getItem("kibitz-lichess-username") ?? "");
  const setLichess = (tok, uname) => {
    const t = (tok ?? "").trim();
    if (t) localStorage.setItem("kibitz-lichess-token", t);
    else { localStorage.removeItem("kibitz-lichess-token"); localStorage.removeItem("kibitz-lichess-username"); }
    setTokenState(t);
    if (!t) { setUsernameState(""); return; }
    if (uname !== undefined) {
      if (uname) localStorage.setItem("kibitz-lichess-username", uname);
      else localStorage.removeItem("kibitz-lichess-username");
      setUsernameState(uname ?? "");
    }
  };
  return [token, username, setLichess];
}

// ─── Import screen ────────────────────────────────────────────────────────────

function ImportScreen({ onImport, onImportPgn, onDemo, error, setError, apiKey, setApiKey, tone, setTone, lichessToken, lichessUser, setLichess }) {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingId, setLoadingId] = useState(null);
  const [forceReanalyze, setForceReanalyze] = useState(false);
  const [keyDraft, setKeyDraft] = useState(apiKey);
  const [keyVisible, setKeyVisible] = useState(false);
  const [lichessDraft, setLichessDraft] = useState(lichessToken);
  const [lichessVisible, setLichessVisible] = useState(false);
  const [lichessError, setLichessError] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(!(apiKey && lichessUser));
  const [games, setGames] = useState(null);
  const [gamesStale, setGamesStale] = useState(false);
  const [gamesError, setGamesError] = useState(null);
  const [history] = useState(() => getHistory());

  useEffect(() => {
    if (!lichessUser) { setGames(null); setGamesStale(false); return; }
    const cacheKey = `kibitz-games-${lichessUser}`;
    const cached = (() => { try { const r = localStorage.getItem(cacheKey); return r ? JSON.parse(r) : null; } catch { return null; } })();
    if (cached) {
      setGames(cached);
      setGamesStale(true);
    } else {
      setGames("loading");
    }
    setGamesError(null);
    fetchLichessRecentGames(lichessUser, lichessToken)
      .then((fresh) => {
        setGames(fresh);
        setGamesStale(false);
        try { localStorage.setItem(cacheKey, JSON.stringify(fresh)); } catch {}
      })
      .catch((e) => {
        if (!cached) { setGamesError(e.message); setGames(null); }
        setGamesStale(false);
      });
  }, [lichessUser]);

  const saveApiKey = () => setApiKey(keyDraft);
  const saveLichessToken = async () => {
    const t = lichessDraft.trim();
    if (!t) { setLichess(""); setLichessError(null); return; }
    setLichessError(null);
    try {
      const account = await fetchLichessAccount(t);
      setLichess(t, account.username);
    } catch {
      setLichessError("Invalid token or connection failed.");
    }
  };

  const isUrl = /^https?:\/\//.test(url.trim());
  const isPgn = !isUrl && url.trim().length > 0;
  const urlGameId = isUrl ? parseLichessUrl(url) : null;
  const canLoad = isPgn || urlGameId !== null;

  const handleListLoad = async (id) => {
    setLoading(true);
    setLoadingId(id);
    await onImport(id, forceReanalyze);
    setLoading(false);
    setLoadingId(null);
    setForceReanalyze(false);
  };

  const handleUrlLoad = async () => {
    if (!canLoad) return;
    setLoading(true);
    if (isPgn) {
      setLoadingId("pgn");
      await onImportPgn(url, forceReanalyze);
    } else {
      setLoadingId(urlGameId);
      await onImport(urlGameId, forceReanalyze);
    }
    setLoading(false);
    setLoadingId(null);
    setForceReanalyze(false);
  };

  const timeAgo = (ms) => {
    const s = Math.floor((Date.now() - ms) / 1000);
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col items-center pt-16 p-6">
      <div className="w-full max-w-md space-y-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Kibitz</h1>
          <p className="text-zinc-500 text-sm mt-1">
            {lichessUser ? `Connected as ${lichessUser}` : "Analyze your chess games with AI"}
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
                  tone === t.value ? "bg-zinc-700 border-zinc-500 text-zinc-100" : "bg-zinc-900 border-zinc-800 text-zinc-500 hover:text-zinc-300 hover:border-zinc-700"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* My games — click to load */}
        {lichessUser && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs text-zinc-500 uppercase tracking-widest flex items-center gap-1.5">
                My recent games
                {gamesStale && <span className="text-zinc-600 animate-pulse">↻</span>}
              </label>
              <button
                onClick={() => {
                  const cacheKey = `kibitz-games-${lichessUser}`;
                  setGamesStale(true);
                  fetchLichessRecentGames(lichessUser, lichessToken)
                    .then((fresh) => { setGames(fresh); setGamesStale(false); try { localStorage.setItem(cacheKey, JSON.stringify(fresh)); } catch {} })
                    .catch((e) => { setGamesError(e.message); setGamesStale(false); });
                }}
                className="text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors"
              >
                refresh
              </button>
            </div>
            {games === "loading" ? (
              <p className="text-xs text-zinc-600 animate-pulse py-2">Loading games…</p>
            ) : gamesError ? (
              <p className="text-xs text-red-500/70">{gamesError}</p>
            ) : Array.isArray(games) && games.length > 0 ? (
              <div className="rounded-xl border border-zinc-800 overflow-hidden divide-y divide-zinc-800/60 max-h-56 overflow-y-auto">
                {games.map((g) => {
                  const opp = g.white.toLowerCase() === lichessUser.toLowerCase() ? g.black : g.white;
                  const isLoading = loadingId === g.id;
                  return (
                    <a
                      key={g.id}
                      href={`?game=${g.id}`}
                      onClick={loading ? undefined : spaClick(() => { setError(null); handleListLoad(g.id); })}
                      className={`w-full text-left flex items-center gap-3 px-3.5 py-2.5 text-sm transition-colors ${
                        isLoading ? "bg-indigo-600/10" : "hover:bg-zinc-800/60"
                      } ${loading ? "opacity-60 pointer-events-none" : ""}`}
                    >
                      <span className={`shrink-0 text-[8px] ${g.hasEvals ? "text-emerald-400" : "text-amber-400"}`}>●</span>
                      <span className="flex-1 min-w-0 truncate">
                        <span className="text-zinc-200 font-medium">vs {opp}</span>
                        {g.opening && <span className="text-zinc-500 text-xs ml-2">{g.opening.split(":")[0]}</span>}
                      </span>
                      <span className="text-zinc-500 text-xs shrink-0">{g.result}</span>
                      {isLoading
                        ? <span className="text-zinc-500 text-[10px] shrink-0 animate-pulse">loading…</span>
                        : <span className="text-zinc-700 text-[10px] shrink-0">{timeAgo(g.playedAt)}</span>
                      }
                    </a>
                  );
                })}
              </div>
            ) : Array.isArray(games) ? (
              <p className="text-xs text-zinc-600 py-2">No recent games found.</p>
            ) : null}
          </div>
        )}

        {/* Previously reviewed */}
        {(() => {
          const lichessIds = new Set(Array.isArray(games) ? games.map((g) => g.id) : []);
          const filtered = history.filter((h) => !lichessIds.has(h.id));
          if (!filtered.length) return null;
          return (
            <div className="space-y-2">
              <label className="text-xs text-zinc-500 uppercase tracking-widest">Previously reviewed</label>
              <div className="rounded-xl border border-zinc-800 overflow-hidden divide-y divide-zinc-800/60 max-h-56 overflow-y-auto">
                {filtered.map((h) => {
                  const isLoading = loadingId === h.id;
                  return (
                    <a
                      key={h.id}
                      href={`?game=${h.id}`}
                      onClick={loading ? undefined : spaClick(() => {
                        setError(null);
                        if (gameSource(h.id) === "pgn") {
                          const pgn = getCachedPgn(h.id);
                          if (pgn) { setLoading(true); setLoadingId(h.id); onImportPgn(pgn).finally(() => { setLoading(false); setLoadingId(null); }); }
                        } else {
                          handleListLoad(h.id);
                        }
                      })}
                      className={`w-full text-left flex items-center gap-3 px-3.5 py-2.5 text-sm transition-colors ${isLoading ? "bg-indigo-600/10" : "hover:bg-zinc-800/60"} ${loading ? "opacity-60 pointer-events-none" : ""}`}
                    >
                      <span className={`shrink-0 text-[8px] ${h.source === "lichess" ? "text-emerald-400" : "text-indigo-400"}`}>●</span>
                      <span className="flex-1 min-w-0 truncate text-zinc-200 font-medium">
                        {h.white} vs {h.black}
                      </span>
                      <span className="text-zinc-500 text-xs shrink-0">{h.result}</span>
                      <span className="text-zinc-700 text-[10px] shrink-0">{timeAgo(h.reviewedAt)}</span>
                    </a>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {/* URL / PGN input */}
        <div className="space-y-2">
          {lichessUser && <p className="text-xs text-zinc-600 text-center">— or paste a URL or PGN —</p>}
          <div className="flex gap-2">
            <div className="relative flex-1 min-w-0">
              <input
                type="text"
                value={url}
                onChange={(e) => { setUrl(e.target.value); setError(null); }}
                onKeyDown={(e) => e.key === "Enter" && handleUrlLoad()}
                placeholder="https://lichess.org/… or paste a PGN"
                className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-2.5 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-600 transition-colors"
                autoFocus={!lichessUser}
              />
              {isPgn && (
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-medium text-indigo-400 bg-indigo-950/60 px-1.5 py-0.5 rounded pointer-events-none">
                  PGN
                </span>
              )}
            </div>
            <button
              onClick={handleUrlLoad}
              disabled={loading || !canLoad}
              className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 disabled:opacity-30 rounded-xl text-sm font-semibold transition-colors shrink-0"
            >
              {loadingId && loading ? "…" : "Load →"}
            </button>
          </div>
          {error && (
            <p className="text-sm text-red-400">
              {error.message ?? error}
              {error.gameUrl && (
                <> — <a href={error.gameUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-red-300">open on Lichess</a></>
              )}
            </p>
          )}
        </div>

        {/* Re-analyze + Opera Game */}
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input type="checkbox" checked={forceReanalyze} onChange={(e) => setForceReanalyze(e.target.checked)} className="w-3.5 h-3.5 accent-indigo-500" />
            <span className="text-xs text-zinc-500">Re-analyze (overwrite saved)</span>
          </label>
          <div className="flex items-center gap-3">
            <button onClick={onDemo} className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors underline underline-offset-2">
              try the Opera Game
            </button>
            <a href="https://github.com/n0nick/kibitz" target="_blank" rel="noopener noreferrer" className="text-xs text-zinc-700 hover:text-zinc-500 transition-colors">
              GitHub
            </a>
          </div>
        </div>

        {/* Settings */}
        <div className="border-t border-zinc-800 pt-4">
          <button
            onClick={() => setSettingsOpen((v) => !v)}
            className="flex items-center justify-between w-full group"
          >
            <span className="text-xs text-zinc-500 uppercase tracking-widest">Settings</span>
            <span className="flex items-center gap-3">
              {!settingsOpen && (
                <span className="flex items-center gap-2 text-[10px]">
                  {apiKey && <span className="text-emerald-500">Anthropic ✓</span>}
                  {lichessUser && <span className="text-emerald-500">Lichess ✓</span>}
                </span>
              )}
              <span className="text-zinc-600 group-hover:text-zinc-400 transition-colors text-xs">
                {settingsOpen ? "▲" : "▼"}
              </span>
            </span>
          </button>
          {settingsOpen && (
            <div className="mt-4 space-y-4">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs text-zinc-600">Anthropic API key</label>
                  {apiKey && <span className="text-[10px] text-emerald-500">saved</span>}
                </div>
                <div className="flex gap-2">
                  <input
                    type={keyVisible ? "text" : "password"}
                    value={keyDraft}
                    onChange={(e) => setKeyDraft(e.target.value)}
                    onBlur={saveApiKey}
                    onKeyDown={(e) => e.key === "Enter" && saveApiKey()}
                    placeholder="sk-ant-…"
                    className="flex-1 min-w-0 bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-2.5 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-600 transition-colors font-mono"
                  />
                  <button onClick={() => setKeyVisible((v) => !v)} className="px-3 bg-zinc-900 border border-zinc-800 rounded-xl text-zinc-500 hover:text-zinc-300 transition-colors text-xs">
                    {keyVisible ? "hide" : "show"}
                  </button>
                </div>
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs text-zinc-600">Lichess personal token</label>
                  {lichessUser && <span className="text-[10px] text-emerald-500">{lichessUser}</span>}
                </div>
                <div className="flex gap-2">
                  <input
                    type={lichessVisible ? "text" : "password"}
                    value={lichessDraft}
                    onChange={(e) => setLichessDraft(e.target.value)}
                    onBlur={saveLichessToken}
                    onKeyDown={(e) => e.key === "Enter" && saveLichessToken()}
                    placeholder="lip_…"
                    className="flex-1 min-w-0 bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-2.5 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-600 transition-colors font-mono"
                  />
                  <button onClick={() => setLichessVisible((v) => !v)} className="px-3 bg-zinc-900 border border-zinc-800 rounded-xl text-zinc-500 hover:text-zinc-300 transition-colors text-xs">
                    {lichessVisible ? "hide" : "show"}
                  </button>
                </div>
                {lichessError && <p className="text-xs text-red-400">{lichessError}</p>}
                <p className="text-xs text-zinc-600">Create at <a href="https://lichess.org/account/oauth/token" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-zinc-400 transition-colors">lichess.org/account/oauth/token</a> — no scopes needed.</p>
              </div>
            </div>
          )}
        </div>
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


// ─── App router ───────────────────────────────────────────────────────────────

export default function App() {
  const [apiKey, setApiKey] = useApiKey();
  const [tone, setTone] = useTone();
  const [lichessToken, lichessUser, setLichess] = useLichess();
  const [screen, setScreen] = useState("import");
  const [gameData, setGameData] = useState(null);
  const [gameId, setGameId] = useState(null);
  const [importError, setImportError] = useState(null);
  const [analysisStatus, setAnalysisStatus] = useState(null); // null | 'awaiting-evals' | 'loading' | 'done' | 'error'
  const [localProgress, setLocalProgress] = useState(null); // null | { current, total }
  const [perspective, setPerspective] = useState(null); // null | 'white' | 'black'
  const [drillInPly, setDrillInPly] = useState(null);
  const [overviewCard, setOverviewCard] = useState(0);
  const pollingRef = useRef(null);
  const localAbortRef = useRef(null);

  // Run cache migrations on startup
  useEffect(() => { runMigrations(); }, []);

  // Perspective inference: runs whenever a game is loaded
  useEffect(() => {
    if (!gameData?.summary || !gameId) return;
    const saved = localStorage.getItem(`kibitz-perspective-${gameId}`);
    if (saved === 'white' || saved === 'black') { setPerspective(saved); return; }
    if (lichessUser) {
      const user = lichessUser.toLowerCase();
      if (gameData.summary.white?.toLowerCase() === user) { setPerspective('white'); return; }
      if (gameData.summary.black?.toLowerCase() === user) { setPerspective('black'); return; }
    }
    setPerspective(null); // Show perspective prompt
  }, [gameData?.summary, gameId, lichessUser]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const gid = params.get("game");
    const moveParam = parseInt(params.get("move"), 10);
    const view = params.get("view");
    if (!gid) return;
    if (gid === "opera-1858") {
      setGameData(DEMO_GAME);
      setGameId("opera-1858");
      if (!isNaN(moveParam) && !view) {
        setDrillInPly(moveParam);
        setScreen("drill-in");
      } else {
        setScreen("overview");
      }
    } else if (gameSource(gid) === "pgn") {
      const pgn = getCachedPgn(gid);
      if (pgn) doImportPgn(pgn, false, !isNaN(moveParam) && !view ? moveParam : null, view);
    } else {
      doImport(gid, false, !isNaN(moveParam) && !view ? moveParam : null, view);
    }
  }, []);

  useEffect(() => {
    if (analysisStatus !== "awaiting-evals" || !gameId) return;
    if (gameSource(gameId) !== "lichess") return;
    pollingRef.current = setInterval(async () => {
      try {
        const pgn = await fetchLichessGame(gameId);
        const parsed = parseGame(pgn);
        if (parsed.hasEvals) {
          clearInterval(pollingRef.current);
          localAbortRef.current?.abort();
          setLocalProgress(null);
          localStorage.removeItem(evalsKey(gameId));
          setGameData({ ...parsed, pgn, gameId });
          if (apiKey) runAnalysis(parsed, pgn, apiKey, tone, gameId);
          else setAnalysisStatus(null);
        }
      } catch { /* keep polling */ }
    }, 5000);
    return () => clearInterval(pollingRef.current);
  }, [analysisStatus, gameId]);

  const startLocalAnalysis = async () => {
    const controller = new AbortController();
    localAbortRef.current = controller;
    setLocalProgress({ current: 0, total: gameData.positions.length - 1 });

    const evKey = evalsKey(gameId);
    try {
      const raw = localStorage.getItem(evKey);
      if (raw) {
        const { data, ts } = JSON.parse(raw);
        if (Date.now() - ts < CACHE_TTL) {
          const reclassified = reclassifyWithEvals(gameData, data);
          setGameData(prev => ({ ...reclassified, pgn: prev?.pgn, gameId: prev?.gameId }));
          setLocalProgress(null);
          if (apiKey) runAnalysis(reclassified, null, apiKey, tone, gameId);
          else setAnalysisStatus(null);
          return;
        }
        localStorage.removeItem(evKey);
      }
    } catch { localStorage.removeItem(evKey); }

    const reclassified = await analyzePositions(gameData, browserEngine, {
      signal: controller.signal,
      onProgress: (current, total) => setLocalProgress({ current, total }),
    });
    if (!reclassified) return;

    localStorage.setItem(evKey, JSON.stringify({ data: reclassified.evals, ts: Date.now() }));
    setGameData(prev => ({ ...reclassified, pgn: prev?.pgn, gameId: prev?.gameId }));
    setLocalProgress(null);
    if (apiKey) runAnalysis(reclassified, null, apiKey, tone, gameId);
    else setAnalysisStatus(null);
  };

  const resolveScreen = (initialPly) => {
    if (initialPly !== null && initialPly !== undefined && !isNaN(initialPly)) return "drill-in";
    return "overview";
  };

  const doImport = async (id, force = false, initialPly = null, view = null) => {
    setScreen("loading");
    setImportError(null);
    setPerspective(null);
    setDrillInPly(null);
    setOverviewCard(0);
    try {
      const cached = !force && getCachedPgn(id);
      let pgn;
      if (cached) {
        pgn = cached;
        fetchLichessGame(id).then((fresh) => setCachedPgn(id, fresh)).catch(() => {});
      } else {
        pgn = await fetchLichessGame(id);
        setCachedPgn(id, pgn);
      }
      const parsed = parseGame(pgn);
      addToHistory({ id, source: "lichess", white: parsed.summary.white, black: parsed.summary.black, result: parsed.summary.result });
      const gameWithMeta = { ...parsed, pgn, gameId: id };
      if (!parsed.hasEvals) {
        setGameData(gameWithMeta);
        setGameId(id);
        setScreen("overview");
        window.history.replaceState(null, "", `?game=${id}`);
        setAnalysisStatus("awaiting-evals");
        return;
      }
      setGameData(gameWithMeta);
      setGameId(id);
      if (initialPly !== null) {
        setDrillInPly(initialPly);
        window.history.replaceState(null, "", `?game=${id}&move=${initialPly}`);
      } else {
        window.history.replaceState(null, "", `?game=${id}`);
      }
      setScreen(resolveScreen(initialPly));
      if (apiKey) runAnalysis(parsed, pgn, apiKey, tone, id, force);
    } catch (e) {
      setImportError(e.message);
      setScreen("import");
    }
  };

  const doImportPgn = async (pgn, force = false, initialPly = null, view = null) => {
    setScreen("loading");
    setImportError(null);
    setPerspective(null);
    setDrillInPly(null);
    setOverviewCard(0);
    try {
      const parsed = parseGame(pgn);
      const id = pgnGameId(pgn);
      setCachedPgn(id, pgn);
      addToHistory({ id, source: "pgn", white: parsed.summary.white, black: parsed.summary.black, result: parsed.summary.result });
      setGameData({ ...parsed, pgn, gameId: id });
      setGameId(id);
      if (initialPly !== null) {
        setDrillInPly(initialPly);
        window.history.replaceState(null, "", `?game=${id}&move=${initialPly}`);
      } else {
        window.history.replaceState(null, "", `?game=${id}`);
      }
      if (!parsed.hasEvals) {
        setScreen("overview");
        setAnalysisStatus("awaiting-evals");
        return;
      }
      setScreen(resolveScreen(initialPly));
      if (apiKey) runAnalysis(parsed, pgn, apiKey, tone, id, force);
    } catch (e) {
      setImportError(e.message ?? "Invalid PGN");
      setScreen("import");
    }
  };

  const runAnalysis = async (game, pgn, key, t, id, force = false) => {
    const p = perspective ?? 'none';
    const cacheKey = `kibitz-analysis-${id}-${t}-${DEFAULT_MODEL}-${PROMPT_VERSION}-${p}`;
    if (!force) {
      try {
        const raw = localStorage.getItem(cacheKey);
        if (raw) {
          const { data, prompt: cachedPrompt, ts } = JSON.parse(raw);
          if (Date.now() - ts < CACHE_TTL) {
            setGameData((prev) => ({ ...mergeAnalysis(prev, data), promptSentToLlm: cachedPrompt ?? null }));
            setAnalysisStatus("done");
            return;
          }
          localStorage.removeItem(cacheKey);
        }
      } catch {
        localStorage.removeItem(cacheKey);
      }
    }
    setAnalysisStatus("loading");
    try {
      const { result, prompt, momentEngineData } = await analyzeWithClaude(game, pgn, { apiKey: key, tone: t, engine: browserEngine, perspective });
      localStorage.setItem(cacheKey, JSON.stringify({ data: result, prompt, ts: Date.now() }));
      setGameData((prev) => prev ? { ...mergeAnalysis(prev, result), promptSentToLlm: prompt, momentEngineData } : prev);
      setAnalysisStatus("done");
    } catch (e) {
      console.error("Analysis failed:", e);
      setAnalysisStatus("error");
    }
  };

  // Re-run analysis when perspective is first determined, since analysis may have
  // run before perspective was set (race between perspective inference and analysis start).
  useEffect(() => {
    if (!perspective || !gameData?.moments || !apiKey) return;
    runAnalysis(gameData, gameData.pgn, apiKey, tone, gameId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perspective]);

  const patchMomentExplanation = (momentId, explanation, singleAnalysisPrompt = null) => {
    setGameData((prev) => {
      const moments = prev.moments.map((m) => m.id === momentId ? { ...m, explanation, ...(singleAnalysisPrompt ? { singleAnalysisPrompt } : {}) } : m);
      return { ...prev, moments, momentByMoveIdx: Object.fromEntries(moments.map((m) => [m.moveIdx, m])) };
    });
  };

  const handleReset = () => {
    setScreen("import");
    setGameData(null);
    setGameId(null);
    setAnalysisStatus(null);
    setPerspective(null);
    setDrillInPly(null);
    history.replaceState(null, "", window.location.pathname);
  };

  const handlePerspectiveSet = (p) => {
    setPerspective(p);
    try { localStorage.setItem(`kibitz-perspective-${gameId}`, p); } catch {}
  };

  const handleDrillIn = (plyIdx) => {
    if (gameData) {
      const tps = selectMoments(gameData.moments, gameData.evals, MAX_OVERVIEW_MOMENTS);
      const cardIdx = tps.findIndex(m => m.moveIdx === plyIdx) + 1;
      setOverviewCard(cardIdx > 0 ? cardIdx : 0);
    }
    setDrillInPly(plyIdx);
    setScreen("drill-in");
    const params = new URLSearchParams();
    params.set("game", gameId);
    params.set("move", plyIdx);
    window.history.pushState(null, "", "?" + params.toString());
  };

  const handleBackFromDrillIn = () => {
    setScreen("overview");
    const params = new URLSearchParams();
    params.set("game", gameId);
    window.history.pushState(null, "", "?" + params.toString());
  };

  if (window.location.pathname === '/report') return <ReportViewer />;
  if (screen === "loading") return <LoadingScreen />;

  if (screen === "overview" && gameData) {
    return (
      <GameContext.Provider value={gameData}>
        <GameOverview
          game={gameData}
          gameId={gameId}
          perspective={perspective}
          onPerspectiveSet={handlePerspectiveSet}
          onReset={handleReset}
          onDrillIn={handleDrillIn}
          onStartReview={() => handleDrillIn(1)}
          apiKey={apiKey}
          tone={tone}
          analysisStatus={analysisStatus}
          localProgress={localProgress}
          startLocalAnalysis={startLocalAnalysis}
          initialCard={overviewCard}
        />
      </GameContext.Provider>
    );
  }

  if (screen === "drill-in" && gameData && drillInPly !== null) {
    const turningPoints = selectMoments(gameData.moments, gameData.evals, MAX_OVERVIEW_MOMENTS).map(m => m.moveIdx);
    return (
      <GameContext.Provider value={gameData}>
        <MoveAnalysisView
          initialPly={drillInPly}
          gameId={gameId}
          apiKey={apiKey}
          tone={tone}
          perspective={perspective}
          onBack={handleBackFromDrillIn}
          analysisStatus={analysisStatus}
          onPatchMoment={patchMomentExplanation}
          turningPoints={turningPoints}
        />
      </GameContext.Provider>
    );
  }

  return (
    <ImportScreen
      onImport={doImport}
      onImportPgn={doImportPgn}
      onDemo={() => {
        setGameData(DEMO_GAME);
        setGameId("opera-1858");
        setScreen("overview");
      }}
      error={importError}
      setError={setImportError}
      apiKey={apiKey}
      setApiKey={setApiKey}
      tone={tone}
      setTone={setTone}
      lichessToken={lichessToken}
      lichessUser={lichessUser}
      setLichess={setLichess}
    />
  );
}
