import { useState, useRef, useEffect } from "react";
import { parseLichessUrl, fetchLichessGame, parseGame, reclassifyWithEvals } from "./parseGame";
import { TONES, DEFAULT_MODEL, PROMPT_VERSION, selectMoments, MAX_OVERVIEW_MOMENTS } from "./analyzeGame";
import ReportViewer from "./ReportViewer";
import { fetchLichessAccount, fetchLichessRecentGames } from "./lichess";
import { browserEngine } from "./stockfish";
import { mergeAnalysis, analyzePositions, analyzeWithClaude } from "./pipeline";
import { runMigrations, evalsKey } from "./migrations";
import { GameOverview } from "./GameOverview";
import { MoveAnalysisView } from "./MoveAnalysisView";
import { GameContext } from "./context";
import { k, Card, Section, Editorial, NavBar, Sparkline, OpponentDot, Stat, ExtLinkIcon } from "./ui";

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

// ─── Import / Home screen ─────────────────────────────────────────────────────

const timeAgo = (ms) => {
  if (!ms) return "";
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
  return new Date(ms).toLocaleDateString();
};

// Tiny inline sparkline used inside game cards on the home screen.
function MiniSpark({ evals, markIdx }) {
  const w = 64, h = 22, max = 3;
  if (!evals || evals.length < 2) {
    return (
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
        <line x1="0" y1={h / 2} x2={w} y2={h / 2} stroke={k.hairline} strokeDasharray="2 3" />
      </svg>
    );
  }
  const x = (i) => (i / (evals.length - 1)) * (w - 2) + 1;
  const y = (v) => h / 2 - Math.max(-max, Math.min(max, v)) / max * (h / 2 - 3);
  const d = evals.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      <line x1="0" y1={h / 2} x2={w} y2={h / 2} stroke={k.hairline} strokeDasharray="2 3" />
      <path d={d} fill="none" stroke={k.accent} strokeWidth="1.4" strokeLinecap="round" />
      {markIdx !== undefined && markIdx > 0 && (
        <circle
          cx={x(markIdx)}
          cy={y(evals[markIdx])}
          r="2.5"
          fill={k.warn}
          stroke={k.bg}
          strokeWidth="1"
        />
      )}
    </svg>
  );
}

// Result -> W/L/D from the user's perspective.
function resultForUser(game, lichessUser) {
  if (!lichessUser) return null;
  const u = lichessUser.toLowerCase();
  const userIsWhite = game.white?.toLowerCase() === u;
  const userIsBlack = game.black?.toLowerCase() === u;
  if (!userIsWhite && !userIsBlack) return null;
  if (!game.winner) return "D";
  if (game.winner === "white" && userIsWhite) return "W";
  if (game.winner === "black" && userIsBlack) return "W";
  return "L";
}

function ImportScreen({ onImport, onImportPgn, onDemo, error, setError, apiKey, setApiKey, tone, setTone, lichessToken, lichessUser, setLichess }) {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingId, setLoadingId] = useState(null);
  const [forceReanalyze, setForceReanalyze] = useState(false);
  const [drawer, setDrawer] = useState(null); // null | "settings" | "add"
  const [keyDraft, setKeyDraft] = useState(apiKey);
  const [keyVisible, setKeyVisible] = useState(false);
  const [lichessDraft, setLichessDraft] = useState(lichessToken);
  const [lichessVisible, setLichessVisible] = useState(false);
  const [lichessError, setLichessError] = useState(null);
  const [games, setGames] = useState(null);
  const [gamesStale, setGamesStale] = useState(false);
  const [gamesError, setGamesError] = useState(null);
  const [history] = useState(() => getHistory());

  // Auto-open the Settings drawer the first time, when no credentials are set.
  useEffect(() => {
    if (!apiKey && !lichessUser) setDrawer("settings");
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { setKeyDraft(apiKey); }, [apiKey]);
  useEffect(() => { setLichessDraft(lichessToken); }, [lichessToken]);

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
  }, [lichessUser]); // eslint-disable-line react-hooks/exhaustive-deps

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
    setDrawer(null);
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

  // Aggregate top-of-page stats from the games list.
  const gamesArr = Array.isArray(games) ? games : [];
  const accGames = gamesArr.filter((g) => g.stats?.accuracy != null);
  const youAvgAcc = (() => {
    if (!lichessUser || accGames.length === 0) return null;
    const accs = accGames.map((g) => {
      const u = lichessUser.toLowerCase();
      if (g.white?.toLowerCase() === u) return g.stats.whiteAccuracy;
      if (g.black?.toLowerCase() === u) return g.stats.blackAccuracy;
      return null;
    }).filter((v) => v != null);
    if (!accs.length) return null;
    return accs.reduce((s, v) => s + v, 0) / accs.length;
  })();
  const sessions = gamesArr.length;
  const streak = (() => {
    if (!gamesArr.length) return 0;
    const days = new Set(gamesArr.map((g) => new Date(g.playedAt).toDateString()));
    let s = 0;
    for (let i = 0; i < 365; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      if (days.has(d.toDateString())) s++;
      else if (i > 0) break;
    }
    return s;
  })();

  const refreshGames = () => {
    if (!lichessUser) return;
    const cacheKey = `kibitz-games-${lichessUser}`;
    setGamesStale(true);
    fetchLichessRecentGames(lichessUser, lichessToken)
      .then((fresh) => { setGames(fresh); setGamesStale(false); try { localStorage.setItem(cacheKey, JSON.stringify(fresh)); } catch {} })
      .catch((e) => { setGamesError(e.message); setGamesStale(false); });
  };

  const lichessIds = new Set(Array.isArray(games) ? games.map((g) => g.id) : []);
  const historyFiltered = history.filter((h) => !lichessIds.has(h.id));

  return (
    <div style={{ minHeight: "100vh", background: k.bg, color: k.text, fontFamily: k.font.sans, paddingBottom: 64 }}>
      <NavBar
        left={
          <button
            onClick={() => setDrawer(drawer === "settings" ? null : "settings")}
            aria-label="Settings"
            style={{ background: "transparent", border: "none", color: k.textMute, lineHeight: 0, cursor: "pointer", padding: 6 }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
        }
        title="Kibitz"
        right={
          <button
            onClick={() => setDrawer(drawer === "add" ? null : "add")}
            aria-label="Add a game"
            style={{ background: "transparent", border: "none", color: k.accent, fontSize: 26, lineHeight: 1, cursor: "pointer", padding: 4, fontWeight: 300 }}
          >
            +
          </button>
        }
      />

      <div style={{ maxWidth: 540, margin: "0 auto" }}>
        {/* Editorial hero */}
        <div style={{ padding: "4px 22px 22px" }}>
          <Editorial size={32} style={{ lineHeight: 1.1 }}>
            Every game has a moment.<br />
            <span style={{ color: k.accent }}>Let's find yours.</span>
          </Editorial>

          {(lichessUser && (youAvgAcc != null || sessions > 0)) && (
            <div style={{ marginTop: 18, display: "flex", gap: 22, flexWrap: "wrap" }}>
              {youAvgAcc != null && (
                <Stat label="Avg accuracy" value={youAvgAcc.toFixed(1)} />
              )}
              {sessions > 0 && <Stat label="Sessions" value={String(sessions)} sub="loaded" />}
              {streak > 0 && <Stat label="Streak" value={String(streak)} sub={streak === 1 ? "day" : "days"} accent={k.accent} />}
            </div>
          )}

          {!lichessUser && !apiKey && (
            <div style={{ marginTop: 16, fontSize: 13, color: k.textMute, lineHeight: 1.5 }}>
              Add an Anthropic API key and connect your Lichess account from{" "}
              <button
                onClick={() => setDrawer("settings")}
                style={{ background: "transparent", border: "none", color: k.accent, cursor: "pointer", padding: 0, fontSize: 13, fontWeight: 500 }}
              >
                settings
              </button>{" "}
              — or tap the <span style={{ color: k.accent }}>+</span> to paste a game.
            </div>
          )}
        </div>

        {/* Tone selector — small inline strip, not a full section */}
        <div style={{ padding: "0 22px 16px" }}>
          <div className="kbz-caps" style={{ marginBottom: 8 }}>Analysis tone</div>
          <div style={{ display: "flex", gap: 6 }}>
            {TONES.map((t) => {
              const on = tone === t.value;
              return (
                <button
                  key={t.value}
                  onClick={() => setTone(t.value)}
                  style={{
                    flex: 1,
                    padding: "8px 0",
                    fontSize: 12,
                    fontWeight: 500,
                    color: on ? k.text : k.textMute,
                    background: on ? k.surface2 : "transparent",
                    border: `1px solid ${on ? k.hairline : "transparent"}`,
                    borderRadius: 10,
                    cursor: "pointer",
                    fontFamily: k.font.sans,
                    letterSpacing: 0.2,
                  }}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Error banner */}
        {error && (
          <div style={{ margin: "0 16px 12px", padding: 12, borderRadius: 12, background: `${k.bad}22`, color: k.bad, fontSize: 13 }}>
            {error.message ?? String(error)}
            {error.gameUrl && (
              <> — <a href={error.gameUrl} target="_blank" rel="noreferrer" style={{ color: k.bad, textDecoration: "underline" }}>open on Lichess</a></>
            )}
          </div>
        )}

        {/* Recent games */}
        <Section
          label={lichessUser ? "Recent" : "Try a sample"}
          action={lichessUser ? (gamesStale ? "↻ refreshing…" : "Refresh") : undefined}
          onAction={lichessUser ? refreshGames : undefined}
          style={{ padding: "0 16px" }}
        >
          {!lichessUser ? (
            <Card onClick={onDemo} pad={14}>
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <div style={{ width: 40, height: 40, borderRadius: 10, background: k.accentDim, color: k.accent, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 }}>
                  ♞
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 15 }}>Opera Game (1858)</div>
                  <div style={{ fontSize: 12, color: k.textMute, marginTop: 2 }}>Morphy vs Duke Karl — pre-analysed, no signup</div>
                </div>
                <div style={{ color: k.textDim, fontSize: 20 }}>›</div>
              </div>
            </Card>
          ) : games === "loading" ? (
            <div style={{ color: k.textDim, fontSize: 13, padding: "12px 4px", animation: "kbz-pulse 1.2s ease-in-out infinite" }}>
              Loading games…
            </div>
          ) : gamesError ? (
            <div style={{ color: k.bad, fontSize: 13, padding: "12px 4px" }}>{gamesError}</div>
          ) : Array.isArray(games) && games.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {games.map((g) => {
                const opp = g.white?.toLowerCase() === lichessUser.toLowerCase() ? g.black : g.white;
                const userResult = resultForUser(g, lichessUser);
                const userElo = g.white?.toLowerCase() === lichessUser.toLowerCase() ? g.whiteRating : g.blackRating;
                const oppElo = g.white?.toLowerCase() === lichessUser.toLowerCase() ? g.blackRating : g.whiteRating;
                const time = g.clockInitial != null
                  ? `${Math.floor((g.clockInitial ?? 0) / 60)}+${g.clockIncrement ?? 0}`
                  : g.speed;
                const isLoading = loadingId === g.id;
                return (
                  <a
                    key={g.id}
                    href={`?game=${g.id}`}
                    onClick={loading ? undefined : spaClick(() => { setError(null); handleListLoad(g.id); })}
                    style={{ textDecoration: "none", color: "inherit", display: "block", cursor: "pointer", opacity: loading && !isLoading ? 0.5 : 1, pointerEvents: loading ? "none" : "auto" }}
                  >
                    <Card pad={14} lift={isLoading} style={{ position: "relative", cursor: "pointer" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                        <OpponentDot result={userResult ?? "D"} />
                        <span style={{ fontWeight: 600, fontSize: 15 }}>vs {opp ?? "Unknown"}</span>
                        {oppElo && (
                          <span style={{ fontFamily: k.font.mono, fontSize: 11, color: k.textDim }}>{oppElo}</span>
                        )}
                        <span style={{ flex: 1 }} />
                        <span style={{ fontFamily: k.font.mono, fontSize: 13, color: k.textMute }}>
                          {g.result === "½-½" ? "½–½" : g.result}
                        </span>
                      </div>
                      <div style={{
                        display: "flex", alignItems: "center", justifyContent: "space-between",
                        fontSize: 12, color: k.textMute, marginBottom: 10,
                      }}>
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "70%" }}>
                          {g.opening ? g.opening.split(":")[0] : "Unknown opening"}{time ? ` · ${time}` : ""}
                        </span>
                        <span>{timeAgo(g.playedAt)}</span>
                      </div>
                      <div style={{
                        display: "flex", alignItems: "center", gap: 12,
                        paddingTop: 10, borderTop: `1px solid ${k.hairline}`,
                      }}>
                        <MiniSpark evals={g.evals} markIdx={g.stats?.biggestSwingIdx} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          {g.hasEvals ? (
                            <>
                              <div style={{ fontSize: 12, color: k.text, fontWeight: 500, marginBottom: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {g.stats?.insight ?? "Computer-analysed"}
                              </div>
                              <div style={{ fontSize: 11, color: k.textDim, display: "flex", gap: 10, flexWrap: "wrap" }}>
                                {g.stats?.accuracy != null && <span>{g.stats.accuracy.toFixed(1)}% acc</span>}
                                {g.stats?.turningPoints > 0 && (
                                  <span>· {g.stats.turningPoints} turning point{g.stats.turningPoints !== 1 ? "s" : ""}</span>
                                )}
                              </div>
                            </>
                          ) : (
                            <div style={{ fontSize: 12, color: k.textDim, fontStyle: "italic" }}>
                              No computer analysis yet
                            </div>
                          )}
                        </div>
                        {isLoading ? (
                          <span style={{ color: k.accent, fontSize: 11, fontWeight: 600, animation: "kbz-pulse 1.2s ease-in-out infinite" }}>loading…</span>
                        ) : (
                          <span style={{ color: k.textDim, fontSize: 18 }}>›</span>
                        )}
                      </div>
                    </Card>
                  </a>
                );
              })}
            </div>
          ) : Array.isArray(games) ? (
            <div style={{ color: k.textDim, fontSize: 13, padding: "12px 4px" }}>No recent games found.</div>
          ) : null}
        </Section>

        {/* Previously reviewed (non-lichess history only) */}
        {historyFiltered.length > 0 && (
          <Section label="Previously reviewed" style={{ padding: "20px 16px 0" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {historyFiltered.map((h) => {
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
                    style={{ textDecoration: "none", color: "inherit", display: "block", cursor: "pointer", opacity: loading && !isLoading ? 0.5 : 1, pointerEvents: loading ? "none" : "auto" }}
                  >
                    <Card pad={12} style={{ cursor: "pointer" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: 3, background: h.source === "lichess" ? k.accent : k.warn }} />
                        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 14, fontWeight: 500 }}>
                          {h.white} vs {h.black}
                        </span>
                        <span style={{ color: k.textMute, fontSize: 12, fontFamily: k.font.mono }}>{h.result}</span>
                        <span style={{ color: k.textDim, fontSize: 11 }}>{timeAgo(h.reviewedAt)}</span>
                      </div>
                    </Card>
                  </a>
                );
              })}
            </div>
          </Section>
        )}
      </div>

      {/* ─── Settings drawer ────────────────────────────────────────────── */}
      {drawer === "settings" && (() => {
        const firstRun = !apiKey && !lichessUser;
        return (
        <Drawer
          onClose={() => setDrawer(null)}
          title={firstRun ? "Welcome to Kibitz" : "Settings"}
          subtitle={
            firstRun
              ? null
              : lichessUser
              ? `Connected as ${lichessUser}`
              : "Not connected"
          }
        >
          {firstRun && (
            <div style={{ marginBottom: 20 }}>
              <Editorial size={22} style={{ lineHeight: 1.25, marginBottom: 12 }}>
                Every game has a moment.<br />
                <span style={{ color: k.accent }}>Let's find yours.</span>
              </Editorial>
              <div style={{ fontSize: 13, color: k.textMute, lineHeight: 1.5 }}>
                Add an{" "}
                <a
                  href="https://console.anthropic.com/settings/keys"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: k.accent, textDecoration: "underline", textUnderlineOffset: 2, textDecorationColor: `${k.accent}66` }}
                >
                  Anthropic API key
                </a>{" "}
                for coaching, and{" "}
                <a
                  href="https://lichess.org/account/oauth/token/create?scopes[]=&description=Kibitz"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: k.accent, textDecoration: "underline", textUnderlineOffset: 2, textDecorationColor: `${k.accent}66` }}
                >
                  connect Lichess
                </a>{" "}
                to pull your games.
              </div>
            </div>
          )}

          <DrawerField label="Anthropic API key" hint={apiKey ? "saved" : undefined}>
            <DrawerInputRow
              type={keyVisible ? "text" : "password"}
              value={keyDraft}
              onChange={setKeyDraft}
              onBlur={saveApiKey}
              onEnter={saveApiKey}
              placeholder="sk-ant-…"
              monospace
              toggleLabel={keyVisible ? "hide" : "show"}
              onToggle={() => setKeyVisible((v) => !v)}
            />
          </DrawerField>

          <DrawerField label="Lichess personal token" hint={lichessUser ?? undefined}>
            <DrawerInputRow
              type={lichessVisible ? "text" : "password"}
              value={lichessDraft}
              onChange={setLichessDraft}
              onBlur={saveLichessToken}
              onEnter={saveLichessToken}
              placeholder="lip_…"
              monospace
              toggleLabel={lichessVisible ? "hide" : "show"}
              onToggle={() => setLichessVisible((v) => !v)}
            />
            {lichessError && <div style={{ fontSize: 12, color: k.bad, marginTop: 6 }}>{lichessError}</div>}
            <div style={{ fontSize: 11, color: k.textDim, marginTop: 8 }}>
              Create at{" "}
              <a href="https://lichess.org/account/oauth/token" target="_blank" rel="noopener noreferrer" style={{ color: k.accent }}>
                lichess.org/account/oauth/token
              </a>{" "}
              — no scopes needed.
            </div>
          </DrawerField>

          <div style={{ paddingTop: 12, borderTop: `1px solid ${k.hairline}`, marginTop: 8 }}>
            <a
              href="https://github.com/n0nick/kibitz"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                fontSize: 12,
                color: k.textDim,
                textDecoration: "none",
              }}
            >
              View on GitHub <ExtLinkIcon />
            </a>
          </div>
        </Drawer>
        );
      })()}

      {/* ─── Add-game full-screen page (screen 02) ──────────────────────── */}
      {drawer === "add" && (
        <AddGameScreen
          onClose={() => { setDrawer(null); setError(null); }}
          onOpenSettings={() => setDrawer("settings")}
          onSubmit={handleUrlLoad}
          url={url}
          setUrl={(v) => { setUrl(v); setError(null); }}
          isPgn={isPgn}
          canLoad={canLoad}
          loading={loading}
          forceReanalyze={forceReanalyze}
          setForceReanalyze={setForceReanalyze}
          lichessUser={lichessUser}
          onDemo={() => { setDrawer(null); onDemo(); }}
        />
      )}
    </div>
  );
}

// ─── Add-game screen (full-screen, matches design 02 · First run) ────────────

function AddGameScreen({ onClose, onOpenSettings, onSubmit, url, setUrl, isPgn, canLoad, loading, forceReanalyze, setForceReanalyze, lichessUser, onDemo }) {
  const [pgnExpanded, setPgnExpanded] = useState(isPgn || url.length > 0);
  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 50,
        background: k.bg, color: k.text,
        fontFamily: k.font.sans,
        overflowY: "auto",
      }}
    >
      <NavBar
        left={
          <button
            onClick={onClose}
            aria-label="Back"
            style={{ background: "transparent", border: "none", color: k.textMute, fontSize: 20, lineHeight: 1, cursor: "pointer", padding: 4 }}
          >
            ‹
          </button>
        }
        title="Add a game"
      />

      <div style={{ maxWidth: 540, margin: "0 auto", padding: "0 22px 32px" }}>
        {/* Decorative tiny endgame board */}
        <div style={{ display: "flex", justifyContent: "center", margin: "20px 0 28px" }}>
          <div style={{ width: 96 }}>
            <TinyEndgameBoard />
          </div>
        </div>

        {/* Editorial heading + sub */}
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <Editorial size={28} style={{ marginBottom: 12 }}>
            Hand me a game.<br />
            I'll find the moment it turned.
          </Editorial>
          <div style={{ fontSize: 14, color: k.textMute, lineHeight: 1.5 }}>
            Kibitz reads your games like a coach,<br />
            not an engine printout.
          </div>
        </div>

        {/* Source cards */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {/* Lichess */}
          {lichessUser ? (
            <Card pad={14} onClick={onClose}>
              <SourceRow
                glyph="♞"
                glyphColor={k.accent}
                title="Lichess"
                sub={`Connected as ${lichessUser} — see your recent games`}
              />
            </Card>
          ) : (
            <Card pad={14} onClick={onOpenSettings}>
              <SourceRow
                glyph="♞"
                glyphColor={k.accent}
                title="Lichess"
                sub="Connect your account to pull recent games"
              />
            </Card>
          )}

          {/* URL */}
          <Card pad={14}>
            <SourceRow
              glyph="↗"
              glyphColor="#9CC9F5"
              title="From a URL"
              sub="Paste a lichess.org/<id> link"
            />
            <div style={{ marginTop: 10 }}>
              <input
                type="text"
                value={isPgn ? "" : url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://lichess.org/…"
                style={{
                  width: "100%",
                  background: k.surface2,
                  border: `1px solid ${k.hairline}`,
                  borderRadius: 10,
                  padding: "10px 12px",
                  color: k.text,
                  fontFamily: k.font.sans,
                  fontSize: 14,
                  outline: "none",
                }}
              />
            </div>
          </Card>

          {/* PGN */}
          <Card pad={14}>
            <div onClick={() => setPgnExpanded((v) => !v)} style={{ cursor: "pointer" }}>
              <SourceRow
                glyph="❑"
                glyphColor={k.textMute}
                title="Paste PGN"
                sub={pgnExpanded ? "Paste raw PGN below" : "Or drop a .pgn file"}
                trail={pgnExpanded ? "▲" : "▼"}
              />
            </div>
            {pgnExpanded && (
              <div style={{ marginTop: 10 }}>
                <textarea
                  value={isPgn ? url : ""}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder={'[Event "..."]\n[White "..."]\n[Black "..."]\n…\n1. e4 e5 2. Nf3 …'}
                  rows={6}
                  style={{
                    width: "100%",
                    background: k.surface2,
                    border: `1px solid ${k.hairline}`,
                    borderRadius: 10,
                    padding: "10px 12px",
                    color: k.text,
                    fontFamily: k.font.mono,
                    fontSize: 13,
                    outline: "none",
                    resize: "vertical",
                    minHeight: 96,
                  }}
                />
              </div>
            )}
          </Card>
        </div>

        {/* Re-analyze + Open button */}
        <div style={{ marginTop: 18 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: k.textMute, marginBottom: 12, cursor: "pointer", userSelect: "none" }}>
            <input
              type="checkbox"
              checked={forceReanalyze}
              onChange={(e) => setForceReanalyze(e.target.checked)}
              style={{ accentColor: k.accent }}
            />
            Re-analyze (overwrite saved)
          </label>
          <button
            onClick={onSubmit}
            disabled={loading || !canLoad}
            style={{
              width: "100%",
              padding: "14px 16px",
              borderRadius: 12,
              background: canLoad ? k.accent : k.surface2,
              color: canLoad ? k.surface : k.textDim,
              fontSize: 14,
              fontWeight: 600,
              border: "none",
              cursor: canLoad && !loading ? "pointer" : "default",
              transition: "opacity 0.15s",
              opacity: loading ? 0.6 : 1,
            }}
          >
            {loading ? "Loading…" : "Open game →"}
          </button>
        </div>

        {/* "or" divider */}
        <div style={{ display: "flex", alignItems: "center", padding: "22px 0 14px", gap: 12 }}>
          <span style={{ flex: 1, height: 1, background: k.hairline }} />
          <span style={{ fontSize: 10, color: k.textDim, textTransform: "uppercase", letterSpacing: 0.9, fontWeight: 600 }}>or</span>
          <span style={{ flex: 1, height: 1, background: k.hairline }} />
        </div>

        {/* Sample game */}
        <Card pad={14} onClick={onDemo}>
          <SourceRow
            glyph="♟"
            glyphColor={k.textMute}
            title="Try a sample game"
            sub="Morphy vs Duke Karl, 1858 · no signup"
            trail="›"
          />
        </Card>
      </div>
    </div>
  );
}

// Small atom — source-option row used inside AddGameScreen cards.
function SourceRow({ glyph, glyphColor, title, sub, trail }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
      <div
        style={{
          width: 40, height: 40, borderRadius: 10,
          background: `${glyphColor}22`,
          color: glyphColor,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 22, flexShrink: 0,
        }}
      >
        {glyph}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 15 }}>{title}</div>
        <div style={{ fontSize: 12, color: k.textMute, marginTop: 2 }}>{sub}</div>
      </div>
      {trail && <span style={{ color: k.textDim, fontSize: 18 }}>{trail}</span>}
    </div>
  );
}

// Decorative 120px K-vs-k endgame board used on the Add-a-game screen.
function TinyEndgameBoard() {
  const palette = k.board;
  // 2k5 / 8 / 8 / 8 / 8 / 5K2 / 8 / 8 — black king on c6, white king on f3
  const rows = ["8","8","2k5","8","8","5K2","8","8"];
  const parsed = rows.map((row) => {
    const out = [];
    for (const ch of row) {
      const n = parseInt(ch, 10);
      if (!isNaN(n)) for (let i = 0; i < n; i++) out.push(null);
      else out.push(ch);
    }
    return out;
  });
  return (
    <div
      style={{
        background: "#E9E4D7",
        borderRadius: 14,
        padding: 4,
        boxShadow: "0 1px 0 rgba(255,255,255,0.8) inset, 0 6px 22px rgba(60,40,20,0.10)",
      }}
    >
      <div style={{ display: "grid", gridTemplateColumns: "repeat(8, 1fr)", borderRadius: 6, overflow: "hidden" }}>
        {parsed.map((row, ri) =>
          row.map((p, fi) => {
            const light = (ri + fi) % 2 === 0;
            return (
              <div
                key={`${ri}-${fi}`}
                style={{
                  position: "relative",
                  aspectRatio: "1 / 1",
                  background: light ? palette.light : palette.dark,
                }}
              >
                {p && (
                  <img
                    src={p === "K" ? "/pieces/white-king.svg" : "/pieces/black-king.svg"}
                    alt={p}
                    style={{ position: "absolute", inset: 0, width: "100%", height: "100%", padding: "8%", pointerEvents: "none" }}
                    draggable={false}
                  />
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ─── Small drawer used by Settings + Add-game ────────────────────────────────

function Drawer({ children, onClose, title, subtitle }) {
  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
          backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)",
          zIndex: 40,
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        style={{
          position: "fixed", left: 0, right: 0, bottom: 0,
          maxHeight: "85vh", overflowY: "auto",
          background: k.surface, color: k.text,
          borderTopLeftRadius: 22, borderTopRightRadius: 22,
          boxShadow: "0 -8px 32px rgba(0,0,0,0.45)",
          padding: "10px 18px 28px",
          fontFamily: k.font.sans,
          zIndex: 41,
          maxWidth: 540,
          margin: "0 auto",
        }}
      >
        <div style={{ display: "flex", justifyContent: "center", padding: "6px 0 10px" }}>
          <span style={{ width: 42, height: 4, borderRadius: 2, background: k.surface3 }} />
        </div>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 600 }}>{title}</div>
            {subtitle && <div style={{ fontSize: 12, color: k.textMute, marginTop: 2 }}>{subtitle}</div>}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{ background: "transparent", border: "none", color: k.textMute, fontSize: 22, cursor: "pointer", lineHeight: 1, padding: 4 }}
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </>
  );
}

function DrawerField({ label, hint, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
        <label className="kbz-caps">{label}</label>
        {hint && <span style={{ fontSize: 10, color: k.accent, fontWeight: 600 }}>{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function DrawerInputRow({ type, value, onChange, onBlur, onEnter, placeholder, monospace, toggleLabel, onToggle }) {
  return (
    <div style={{ display: "flex", gap: 8 }}>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        onKeyDown={(e) => e.key === "Enter" && onEnter?.()}
        placeholder={placeholder}
        style={{
          flex: 1, minWidth: 0,
          background: k.surface2, color: k.text,
          border: `1px solid ${k.hairline}`,
          borderRadius: 10,
          padding: "10px 12px",
          fontFamily: monospace ? k.font.mono : k.font.sans,
          fontSize: 14,
          outline: "none",
        }}
      />
      {onToggle && (
        <button
          onClick={onToggle}
          style={{
            padding: "0 12px",
            background: k.surface2, color: k.textMute,
            border: `1px solid ${k.hairline}`, borderRadius: 10,
            fontSize: 12, cursor: "pointer",
            fontFamily: k.font.sans,
          }}
        >
          {toggleLabel}
        </button>
      )}
    </div>
  );
}

// ─── Loading screen ───────────────────────────────────────────────────────────

// Loading screen — matches design 03 · Analyzing: editorial heading,
// breathing sparkline (a sine wave that pulses while we wait), and a phase-aware
// step list. Stays mounted from PGN fetch through LLM narrative drafting.
//
// Phases (in order):
//   "fetch"          → fetching PGN from Lichess / cache
//   "awaiting-evals" → need engine analysis (user clicks "Analyze locally")
//   "engine"         → local Stockfish pass running
//   "llm"            → LLM drafting narrative
function LoadingScreen({ phase = "fetch", summary, localProgress, startLocalAnalysis, onCancel }) {
  const order = ["fetch", "engine", "llm"];
  const phaseIdx = phase === "awaiting-evals" ? 1 : Math.max(0, order.indexOf(phase));

  const steps = [
    {
      key: "fetch",
      label: "Fetching the game",
      detail: "From Lichess or PGN cache",
    },
    {
      key: "engine",
      label: phase === "awaiting-evals" ? "Awaiting engine analysis" : "Running engine pass",
      detail: phase === "awaiting-evals"
        ? "No Lichess evals — run a quick local analysis"
        : localProgress
        ? `Stockfish · ply ${localProgress.current} / ${localProgress.total}`
        : "Stockfish · classifying each ply",
    },
    {
      key: "llm",
      label: "Drafting narrative",
      detail: "Coaching voice",
    },
  ];

  // Pre-built gentle wave so the sparkline has shape while we wait.
  const wave = Array.from({ length: 24 }, (_, i) =>
    Math.sin(i / 2.4) * 0.8 + Math.sin(i / 4.5) * 0.4
  );

  const oppName = summary && (summary.black && summary.white)
    ? `${summary.white} vs ${summary.black}`
    : null;

  return (
    <div style={{
      minHeight: "100vh",
      background: k.bg, color: k.text,
      fontFamily: k.font.sans,
      paddingBottom: 64, position: "relative",
    }}>
      <NavBar
        left={
          onCancel ? (
            <button
              onClick={onCancel}
              aria-label="Cancel"
              style={{ background: "transparent", border: "none", color: k.textMute, fontSize: 20, lineHeight: 1, cursor: "pointer", padding: 4 }}
            >
              ‹
            </button>
          ) : <span style={{ color: k.textMute, fontSize: 20 }}>‹</span>
        }
        title="Analyzing"
        subtitle={oppName}
      />

      <div style={{ maxWidth: 540, margin: "0 auto" }}>
        <div style={{ padding: "20px 22px 0", textAlign: "center" }}>
          <div className="kbz-caps" style={{ marginBottom: 8 }}>Reading your game</div>
          <Editorial size={26} style={{ marginBottom: 4 }}>
            Looking for the moment<br />it turned…
          </Editorial>
        </div>

        {/* Breathing sparkline — gentle pulse on opacity */}
        <div style={{
          padding: "30px 22px 12px",
          display: "flex",
          justifyContent: "center",
          animation: "kbz-pulse 2.4s ease-in-out infinite",
        }}>
          <Sparkline data={wave} markIdx={-1} w={340} h={88} showAxis={false} />
        </div>

        <div style={{ padding: "10px 18px" }}>
          <Card pad={4}>
            {steps.map((s, i) => {
              const done = i < phaseIdx;
              const active = i === phaseIdx;
              return (
                <div key={s.key} style={{
                  display: "flex", alignItems: "center", gap: 12,
                  padding: "12px 14px",
                  borderBottom: i < steps.length - 1 ? `1px solid ${k.hairline}` : "none",
                }}>
                  <div style={{
                    width: 18, height: 18, borderRadius: 9,
                    border: `1.5px solid ${done || active ? k.accent : k.hairline}`,
                    background: done ? k.accent : "transparent",
                    color: k.surface,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 11, fontWeight: 700,
                    flexShrink: 0,
                  }}>
                    {done ? "✓" : active ? (
                      <span style={{
                        width: 8, height: 8, borderRadius: 4, background: k.accent,
                        animation: "kbz-pulse 1.2s ease-in-out infinite",
                      }} />
                    ) : null}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 500, fontSize: 14, color: done || active ? k.text : k.textMute }}>
                      {s.label}
                    </div>
                    <div style={{ fontSize: 11, color: k.textDim, marginTop: 2 }}>{s.detail}</div>
                  </div>
                </div>
              );
            })}
          </Card>

          {/* Awaiting-evals CTA */}
          {phase === "awaiting-evals" && startLocalAnalysis && (
            <button
              onClick={startLocalAnalysis}
              style={{
                width: "100%", marginTop: 14,
                padding: "12px 16px", borderRadius: 12,
                background: k.accent, color: k.surface,
                fontSize: 14, fontWeight: 600,
                border: "none", cursor: "pointer",
                fontFamily: k.font.sans,
              }}
            >
              Analyze locally (~1 min)
            </button>
          )}

          {/* Engine progress bar */}
          {phase === "engine" && localProgress && (
            <div style={{ marginTop: 14, height: 4, background: k.surface2, borderRadius: 2, overflow: "hidden" }}>
              <div style={{
                height: "100%", background: k.accent,
                transition: "width 300ms",
                width: `${(localProgress.current / Math.max(1, localProgress.total)) * 100}%`,
              }} />
            </div>
          )}
        </div>
      </div>

      <div style={{
        position: "absolute", bottom: 28, left: 0, right: 0,
        textAlign: "center", fontSize: 12, color: k.textDim, padding: "0 40px",
      }}>
        Most games take about 15 seconds.
      </div>
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

  // Keep the editorial loading state up through the engine + LLM phases,
  // so the user lands directly on a fully-populated overview when ready.
  // Cuts to the overview if analysis is already done (cached) or simply
  // not running (no API key, or already errored — we still want to show
  // whatever structural data we have).
  const showLoading =
    screen === "loading" ||
    (screen === "overview" && (
      analysisStatus === "loading" ||
      (analysisStatus === "awaiting-evals" && !localProgress) ||
      (localProgress && localProgress.current < localProgress.total)
    ));
  if (showLoading) {
    const phase = screen === "loading"
      ? "fetch"
      : analysisStatus === "awaiting-evals"
      ? "awaiting-evals"
      : localProgress
      ? "engine"
      : "llm";
    return (
      <LoadingScreen
        phase={phase}
        summary={gameData?.summary}
        localProgress={localProgress}
        startLocalAnalysis={phase === "awaiting-evals" ? startLocalAnalysis : null}
        onCancel={handleReset}
      />
    );
  }

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
