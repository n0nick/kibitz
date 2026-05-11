// Add-game full-screen page (design 02 · First run). Decorative endgame
// board, editorial heading, source cards for Lichess / URL / PGN, and a
// quieter sample-game footer.

import { useState } from "react";
import { useKbz, Card, NavBar, Editorial } from "../ui";

export function AddGameScreen({ onClose, onOpenSettings, onSubmit, url, setUrl, isPgn, canLoad, loading, forceReanalyze, setForceReanalyze, lichessUser, onDemo }) {
  const { k } = useKbz();
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
  const { k } = useKbz();
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
  const { k } = useKbz();
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
