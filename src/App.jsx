import { useState, useRef, useEffect } from "react";
import { fetchLichessGame, parseGame, reclassifyWithEvals } from "./parseGame";
import { DEFAULT_MODEL, PROMPT_VERSION, selectMoments, MAX_OVERVIEW_MOMENTS } from "./analyzeGame";
import ReportViewer from "./ReportViewer";
import { browserEngine } from "./stockfish";
import { mergeAnalysis, analyzePositions, analyzeWithClaude } from "./pipeline";
import { runMigrations, evalsKey } from "./migrations";
import { GameOverview } from "./GameOverview";
import { MoveAnalysisView } from "./MoveAnalysisView";
import { GameContext } from "./context";
import { useApiKey, useTone, useLichess } from "./hooks/credentials";
import { CACHE_TTL, gameSource, getCachedPgn, setCachedPgn, addToHistory, pgnGameId } from "./lib/games";
import { DEMO_GAME } from "./demoGame";
import { ImportScreen } from "./screens/ImportScreen";
import { LoadingScreen } from "./screens/LoadingScreen";

// ─── App router ───────────────────────────────────────────────────────────────
//
// Manages the cross-screen state: which game is loaded, the
// engine/LLM analysis lifecycle, perspective, drill-in target, and
// transitions between screens. Each screen is its own module under
// src/screens.

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
