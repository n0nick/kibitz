// Home / games-list screen — the editorial hero, recent games (with eval-
// derived sparkline + accuracy + turning-point count), previously
// reviewed history, and the Settings + Add-a-game drawers/pages.

import { useState, useEffect } from "react";
import {
  useKbz, Card, Section, Editorial, NavBar, OpponentDot, Stat, ExtLinkIcon,
  Drawer, DrawerField, DrawerInputRow,
} from "../ui";
import { TONES } from "../analyzeGame";
import { fetchLichessAccount, fetchLichessRecentGames } from "../lichess";
import { parseLichessUrl } from "../parseGame";
import { spaClick, gameSource, getCachedPgn, getHistory, timeAgo, resultForUser } from "../lib/games";
import { AddGameScreen } from "./AddGameScreen";

// Tiny inline sparkline used inside game cards on the home screen.
function MiniSpark({ evals, markIdx }) {
  const { k } = useKbz();
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

// Three-up segmented control: System / Light / Dark. The currently active
// option carries the surface-2 background; selecting "system" clears the
// user's persisted preference so the OS pref drives the theme.
function ThemePicker({ value, onChange }) {
  const { k } = useKbz();
  const opts = [
    { v: "system", label: "System" },
    { v: "light", label: "Light" },
    { v: "dark", label: "Dark" },
  ];
  return (
    <div style={{ display: "flex", gap: 6 }}>
      {opts.map((o) => {
        const on = value === o.v;
        return (
          <button
            key={o.v}
            onClick={() => onChange(o.v)}
            style={{
              flex: 1,
              padding: "8px 0",
              borderRadius: 10,
              fontFamily: k.font.sans,
              fontSize: 12,
              fontWeight: 500,
              color: on ? k.text : k.textMute,
              background: on ? k.surface2 : "transparent",
              border: `1px solid ${on ? k.hairline : "transparent"}`,
              cursor: "pointer",
              letterSpacing: 0.2,
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function ImportScreen({ onImport, onImportPgn, onDemo, error, setError, apiKey, setApiKey, tone, setTone, lichessToken, lichessUser, setLichess }) {
  const { k, mode: themeMode, setTheme } = useKbz();
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

          <DrawerField label="Theme">
            <ThemePicker value={themeMode} onChange={setTheme} />
          </DrawerField>

          <div style={{
            paddingTop: 12, borderTop: `1px solid ${k.hairline}`, marginTop: 8,
            display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
          }}>
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
            {typeof __BUILD_SHA__ === "string" && __BUILD_SHA__ !== "dev" && (
              <a
                href={`https://github.com/n0nick/kibitz/commit/${__BUILD_SHA__}`}
                target="_blank"
                rel="noopener noreferrer"
                title="Deployed commit"
                style={{
                  fontFamily: k.font.mono,
                  fontSize: 11,
                  color: k.textDim,
                  textDecoration: "none",
                  letterSpacing: 0.3,
                }}
              >
                {__BUILD_SHA__.slice(0, 7)}
              </a>
            )}
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
