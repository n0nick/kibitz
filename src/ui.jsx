// Shared design primitives for the Kibitz redesign.
//
// Inline-styled and theme-tokens-driven rather than Tailwind, to mirror the
// design bundle's surface system (filled cards, hairlines, glyph-and-caps
// classifications) without polluting the global Tailwind config.

import { kbzTokens, CLASS_DEF, sparklinePath } from "./design.js";

export const tokens = kbzTokens("light");
export { CLASS_DEF };

// ────────────────────────────────────────────────────────────────────────────
// Card — filled surface with a soft inset highlight. The whole layout uses
// these as the primary container. Accent prop tints with the sage mint.
export function Card({ children, style, pad = 16, onClick, lift = false, accent = false }) {
  const k = tokens;
  return (
    <div
      onClick={onClick}
      style={{
        background: accent ? k.accentDim : k.surface,
        borderRadius: 14,
        boxShadow: lift
          ? (k.isDark
            ? "0 1px 0 rgba(255,255,255,0.04) inset, 0 8px 24px rgba(0,0,0,0.25)"
            : "0 1px 0 rgba(255,255,255,0.9) inset, 0 4px 16px rgba(60,40,20,0.06)")
          : (k.isDark
            ? "0 1px 0 rgba(255,255,255,0.03) inset"
            : "0 1px 0 rgba(255,255,255,0.7) inset, 0 1px 2px rgba(60,40,20,0.04)"),
        padding: pad,
        fontFamily: k.font.sans,
        color: k.text,
        cursor: onClick ? "pointer" : undefined,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Section header — small-caps label + optional action link on the right.
export function Section({ label, action, onAction, children, style }) {
  const k = tokens;
  return (
    <div style={{ ...style }}>
      {label && (
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            padding: "0 4px 10px",
          }}
        >
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: 0.8,
              textTransform: "uppercase",
              color: k.textMute,
            }}
          >
            {label}
          </span>
          {action && (
            <button
              onClick={onAction}
              style={{
                fontSize: 13,
                color: k.accent,
                fontWeight: 500,
                background: "transparent",
                border: "none",
                cursor: onAction ? "pointer" : "default",
                padding: 0,
              }}
            >
              {action}
            </button>
          )}
        </div>
      )}
      {children}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Editorial display — Newsreader italic pull quote.
export function Editorial({ children, size = 26, style }) {
  const k = tokens;
  return (
    <div
      style={{
        fontFamily: k.font.editorial,
        fontStyle: "italic",
        fontSize: size,
        lineHeight: 1.2,
        fontWeight: 400,
        letterSpacing: -0.3,
        color: k.text,
        textWrap: "pretty",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Classification — glyph + small-caps label, no pill.
export function Classification({ kind, size = 13, weight = 600, style }) {
  const k = tokens;
  const c = CLASS_DEF[kind] ?? CLASS_DEF.good;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        color: c.color,
        fontFamily: k.font.sans,
        fontSize: size,
        fontWeight: weight,
        textTransform: "uppercase",
        letterSpacing: 0.8,
        ...style,
      }}
    >
      <span style={{ fontSize: size + 2, lineHeight: 1 }}>{c.glyph}</span>
      <span>{c.label}</span>
    </span>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Sparkline — whole-game eval over plies. Plot from White's POV (above
// midline = white advantage), with optional vertical guide + dot for a
// turning-point ply.
export function Sparkline({ data, markIdx = -1, w = 320, h = 64, showAxis = true, color }) {
  const k = tokens;
  if (!data || data.length < 2) {
    return <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} />;
  }
  const max = 6;
  const clamp = (v) => Math.max(-max, Math.min(max, v));
  const x = (i) => (i / (data.length - 1)) * (w - 2) + 1;
  const y = (v) => h / 2 - (clamp(v) / max) * (h / 2 - 4);
  const midY = h / 2;
  const path = sparklinePath(data, w, h, max);
  const areaPath = path + ` L${x(data.length - 1).toFixed(1)},${midY} L${x(0).toFixed(1)},${midY} Z`;
  const stroke = color ?? k.accent;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: "block" }}>
      {showAxis && (
        <line
          x1={0}
          y1={midY}
          x2={w}
          y2={midY}
          stroke={k.hairline}
          strokeWidth={1}
          strokeDasharray="2 3"
        />
      )}
      <path d={areaPath} fill={stroke} fillOpacity={0.10} />
      <path d={path} fill="none" stroke={stroke} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      {markIdx >= 0 && markIdx < data.length && (
        <g>
          <line
            x1={x(markIdx)}
            y1={2}
            x2={x(markIdx)}
            y2={h - 2}
            stroke={k.warn}
            strokeWidth={1}
            strokeDasharray="2 2"
          />
          <circle
            cx={x(markIdx)}
            cy={y(data[markIdx])}
            r={4}
            fill={k.warn}
            stroke={k.surface}
            strokeWidth={2}
          />
        </g>
      )}
    </svg>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Small atoms used on the home screen and overview.
export function OpponentDot({ result, size = 8 }) {
  const k = tokens;
  const c = result === "W" ? k.win : result === "L" ? k.loss : k.draw;
  return (
    <span
      style={{
        display: "inline-block",
        width: size,
        height: size,
        borderRadius: size,
        background: c,
        boxShadow: `0 0 0 2px ${c}33`,
        flexShrink: 0,
      }}
    />
  );
}

export function MoveTag({ move, num, side = "w" }) {
  const k = tokens;
  return (
    <span style={{ fontFamily: k.font.mono, fontSize: 13, color: k.text, fontWeight: 500 }}>
      <span style={{ color: k.textDim, marginRight: 4 }}>
        {num}
        {side === "w" ? "." : "…"}
      </span>
      {move}
    </span>
  );
}

export function Stat({ label, value, sub, accent }) {
  const k = tokens;
  return (
    <div>
      <div
        style={{
          fontFamily: k.font.sans,
          fontSize: 22,
          fontWeight: 600,
          color: accent ?? k.text,
          letterSpacing: -0.4,
          lineHeight: 1,
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontSize: 11,
          color: k.textMute,
          marginTop: 6,
          textTransform: "uppercase",
          letterSpacing: 0.6,
          fontWeight: 600,
        }}
      >
        {label}
      </div>
      {sub && <div style={{ fontSize: 11, color: k.textDim, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// NavBar — top of every screen. Left/right slots, optional subtitle.
export function NavBar({ title, subtitle, left, right }) {
  const k = tokens;
  return (
    <div
      style={{
        padding: "22px 18px 12px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        fontFamily: k.font.sans,
      }}
    >
      <div style={{ minWidth: 32, color: k.text, fontSize: 17, fontWeight: 500, display: "flex", alignItems: "center" }}>
        {left}
      </div>
      <div style={{ flex: 1, textAlign: "center", minWidth: 0 }}>
        <div
          style={{
            fontSize: 16,
            fontWeight: 600,
            color: k.text,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {title}
        </div>
        {subtitle && (
          <div style={{ fontSize: 11, color: k.textMute, marginTop: 2 }}>
            {subtitle}
          </div>
        )}
      </div>
      <div
        style={{
          minWidth: 32,
          textAlign: "right",
          color: k.accent,
          fontSize: 15,
          fontWeight: 500,
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
        }}
      >
        {right}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Composer — bottom-of-screen sticky text input used by both coach chats.
export function Composer({ value, onChange, onSend, placeholder, disabled, sticky = true }) {
  const k = tokens;
  return (
    <div
      style={{
        position: sticky ? "sticky" : "static",
        bottom: 0,
        padding: "10px 14px",
        background: `linear-gradient(to top, ${k.bg} 70%, transparent)`,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 12px 8px 14px",
          borderRadius: 22,
          background: k.surface,
          border: `1px solid ${k.hairline}`,
        }}
      >
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !disabled && onSend()}
          placeholder={placeholder}
          disabled={disabled}
          style={{
            flex: 1,
            minWidth: 0,
            background: "transparent",
            border: "none",
            outline: "none",
            color: k.text,
            fontFamily: k.font.sans,
            fontSize: 14,
          }}
        />
        <button
          onClick={onSend}
          disabled={disabled || !value?.trim()}
          aria-label="Send"
          style={{
            width: 30,
            height: 30,
            borderRadius: 15,
            background: k.accent,
            color: k.bg,
            fontSize: 14,
            fontWeight: 700,
            border: "none",
            cursor: disabled || !value?.trim() ? "default" : "pointer",
            opacity: disabled || !value?.trim() ? 0.4 : 1,
            transition: "opacity 0.15s",
          }}
        >
          ↑
        </button>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// External-link glyph used in nav bars and quick-action chips.
export function ExtLinkIcon({ size = 10, color = "currentColor", style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 10 10" style={{ opacity: 0.8, ...style }}>
      <path
        d="M3 1h6v6M9 1L3.5 6.5M1 3v6h6"
        fill="none"
        stroke={color}
        strokeWidth={1.4}
        strokeLinecap="round"
      />
    </svg>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Themed chess board — uses board palette from design tokens (cream + sage by
// default). Renders SVG pieces from /public/pieces, mirrors the existing
// MoveAnalysisView Board API so it can be drop-in swapped.

const PIECE_NAMES = { K: "king", Q: "queen", R: "rook", B: "bishop", N: "knight", P: "pawn" };
const pieceImg = (p) => `/pieces/${p === p.toUpperCase() ? "white" : "black"}-${PIECE_NAMES[p.toUpperCase()]}.svg`;

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

export function ThemedBoard({
  fen,
  fromSq,
  toSq,
  altFromSq,
  altToSq,
  hoverFromSq,
  hoverToSq,
  highlight,
  flip = false,
  rounded = 12,
  showCoords = true,
  analysisHref,
  hideLink = false,
}) {
  const k = tokens;
  const board = parseFen(fen);
  const palette = k.board;
  return (
    <div
      style={{
        width: "100%",
        userSelect: "none",
        padding: 6,
        background: k.isDark ? "#15171A" : "#E9E4D7",
        borderRadius: rounded,
        boxShadow: k.isDark
          ? "0 1px 0 rgba(255,255,255,0.04) inset, 0 8px 28px rgba(0,0,0,0.4)"
          : "0 1px 0 rgba(255,255,255,0.8) inset, 0 6px 22px rgba(60,40,20,0.10)",
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(8, 1fr)",
          borderRadius: 4,
          overflow: "hidden",
        }}
      >
        {Array.from({ length: 8 }, (_, ri) => {
          const rankNum = flip ? ri + 1 : 8 - ri;
          return Array.from({ length: 8 }, (_, fi) => {
            const fileIdx = flip ? 7 - fi : fi;
            const piece = board[flip ? 7 - ri : ri]?.[fileIdx];
            const light = (ri + fi) % 2 === 0;
            const sq = `${"abcdefgh"[fileIdx]}${rankNum}`;
            const isMove = sq === fromSq || sq === toSq;
            const isAlt = sq === altFromSq || sq === altToSq;
            const isHover = sq === hoverFromSq || sq === hoverToSq;
            const isHighlight = sq === highlight;
            return (
              <div
                key={`${ri}-${fi}`}
                style={{
                  position: "relative",
                  aspectRatio: "1 / 1",
                  background: light ? palette.light : palette.dark,
                }}
              >
                {isMove && (
                  <div style={{ position: "absolute", inset: 0, background: palette.lastMove, opacity: 0.5 }} />
                )}
                {isAlt && (
                  <div style={{ position: "absolute", inset: 0, background: "rgba(70,120,200,0.55)" }} />
                )}
                {isHover && (
                  <div style={{ position: "absolute", inset: 0, background: "rgba(140,120,220,0.40)" }} />
                )}
                {isHighlight && (
                  <div style={{ position: "absolute", inset: "8%", border: `2.5px solid ${k.warn}`, borderRadius: 2, pointerEvents: "none" }} />
                )}
                {showCoords && fi === 0 && (
                  <span
                    style={{
                      position: "absolute",
                      top: 2,
                      left: 4,
                      fontSize: 9,
                      fontWeight: 700,
                      lineHeight: 1,
                      fontFamily: k.font.mono,
                      color: light ? palette.coord : palette.light,
                      opacity: 0.7,
                      pointerEvents: "none",
                    }}
                  >
                    {rankNum}
                  </span>
                )}
                {showCoords && ri === 7 && (
                  <span
                    style={{
                      position: "absolute",
                      bottom: 2,
                      right: 4,
                      fontSize: 9,
                      fontWeight: 700,
                      lineHeight: 1,
                      fontFamily: k.font.mono,
                      color: light ? palette.coord : palette.light,
                      opacity: 0.7,
                      pointerEvents: "none",
                    }}
                  >
                    {"abcdefgh"[fileIdx]}
                  </span>
                )}
                {piece && (
                  <img
                    src={pieceImg(piece)}
                    alt={piece}
                    draggable={false}
                    style={{
                      position: "absolute",
                      inset: 0,
                      width: "100%",
                      height: "100%",
                      padding: "5%",
                      filter: "drop-shadow(0 2px 3px rgba(0,0,0,0.35))",
                      pointerEvents: "none",
                    }}
                  />
                )}
              </div>
            );
          });
        }).flat()}
      </div>
      {!hideLink && (
        <div style={{ display: "flex", justifyContent: "flex-end", paddingTop: 4, paddingRight: 2 }}>
          <a
            href={analysisHref ?? `https://lichess.org/analysis/${fen?.replace(/ /g, "_")}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontSize: 10, color: k.textDim, fontFamily: k.font.sans, fontWeight: 500, textDecoration: "none", letterSpacing: 0.4 }}
          >
            {analysisHref ? "lichess ↗" : "analyze ↗"}
          </a>
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Editorial-style eval bar — minimal: before label, slim bar, after label,
// and a small swing readout coloured for the user's perspective.
export function EvalBar({ before, after, perspective }) {
  const k = tokens;
  const fmt = (v) => v >= 99 ? "M" : v <= -99 ? "-M" : v > 0 ? `+${v.toFixed(1)}` : v.toFixed(1);
  const toPercent = (v) => v >= 99 ? 95 : v <= -99 ? 5 : ((Math.max(-6, Math.min(6, v)) + 6) / 12) * 100;
  const pct = toPercent(after);
  const isMateAfter = after >= 99;
  const isMatedAfter = after <= -99;
  const swing = isMateAfter ? 99 - before : isMatedAfter ? -99 - before : after - before;
  const gaining = perspective === "black" ? swing < 0 : swing > 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <span style={{ fontFamily: k.font.mono, fontSize: 11, color: k.textMute, width: 36, textAlign: "right", flexShrink: 0 }}>
        {fmt(before)}
      </span>
      <div style={{ flex: 1, height: 6, borderRadius: 3, background: k.surface3, overflow: "hidden" }}>
        <div style={{ height: "100%", borderRadius: 3, background: k.text, width: `${pct}%`, transition: "width 0.5s ease-out" }} />
      </div>
      <span style={{ fontFamily: k.font.mono, fontSize: 11, color: k.text, width: 36, flexShrink: 0 }}>{fmt(after)}</span>
      <span style={{ fontFamily: k.font.sans, fontSize: 11, fontWeight: 600, width: 44, textAlign: "right", color: gaining ? k.accent : k.bad, flexShrink: 0 }}>
        {isMateAfter ? "▲ M" : isMatedAfter ? "▼ M" : `${gaining ? "▲" : "▼"} ${Math.min(Math.abs(swing), 9.9).toFixed(1)}`}
      </span>
    </div>
  );
}

// Re-export tokens so screens can pull them without re-importing design.js.
export const k = tokens;
