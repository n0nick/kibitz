// Shared design primitives for the Kibitz redesign.
//
// Inline-styled and theme-tokens-driven rather than Tailwind, to mirror the
// design bundle's surface system (filled cards, hairlines, glyph-and-caps
// classifications) without polluting the global Tailwind config.

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { kbzTokens, CLASS_DEF, sparklinePath, fmtEval, fmtEvalShort } from "./design.js";
import { sanToSquares } from "./parseGame.js";

// Module-level fallback token set — used by anything that reads tokens
// outside a React component (rare) and by primitives that haven't been
// reached by the theme provider for some reason. Components that want to
// react to theme flips should call useKbz() instead.
export const tokens = kbzTokens("light");
export { CLASS_DEF };

// ────────────────────────────────────────────────────────────────────────────
// Theme provider + hook. The provider:
//   • resolves initial theme from localStorage → system pref → "light"
//   • persists user's explicit choice
//   • flips the `data-theme` attr on <html> so CSS vars track the JS tokens
//   • updates the iOS theme-color meta tag

const KbzThemeContext = createContext(null);

function readSavedTheme() {
  try {
    const t = localStorage.getItem("kibitz-theme");
    if (t === "light" || t === "dark") return t;
  } catch {}
  return null;
}

function systemPref() {
  if (typeof window === "undefined" || !window.matchMedia) return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function KbzThemeProvider({ children }) {
  const [theme, setThemeRaw] = useState(() => readSavedTheme() ?? systemPref());

  const setTheme = (t) => {
    setThemeRaw(t);
    try {
      if (t === "system") localStorage.removeItem("kibitz-theme");
      else localStorage.setItem("kibitz-theme", t);
    } catch {}
  };

  // Track system preference changes while the user is following system.
  useEffect(() => {
    if (readSavedTheme()) return; // user picked a side; ignore system
    if (!window.matchMedia) return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setThemeRaw(mq.matches ? "dark" : "light");
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, [theme]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.dataset.theme = theme;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", theme === "dark" ? "#0E0F10" : "#F6F4EF");
  }, [theme]);

  const value = useMemo(() => {
    const k = kbzTokens(theme);
    const saved = readSavedTheme();
    return {
      theme,
      setTheme,
      k,
      // `mode` is what the user selected (light / dark / system); `theme` is
      // what's actually applied right now.
      mode: saved ?? "system",
    };
  }, [theme]);

  return <KbzThemeContext.Provider value={value}>{children}</KbzThemeContext.Provider>;
}

export function useKbz() {
  const ctx = useContext(KbzThemeContext);
  if (ctx) return ctx;
  // Fallback for unit tests / SSR — return a light snapshot.
  return { theme: "light", mode: "system", setTheme: () => {}, k: tokens };
}

// ────────────────────────────────────────────────────────────────────────────
// Card — filled surface with a soft inset highlight. The whole layout uses
// these as the primary container. Accent prop tints with the sage mint.
export function Card({ children, style, pad = 16, onClick, lift = false, accent = false }) {
  const { k } = useKbz();
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
  const { k } = useKbz();
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
  const { k } = useKbz();
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
  const { k } = useKbz();
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
  const { k } = useKbz();
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
  const { k } = useKbz();
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
  const { k } = useKbz();
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
  const { k } = useKbz();
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
  const { k } = useKbz();
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
// When `sticky` is true the composer pins to the viewport bottom with a
// tight 14px fade-in at its top edge (just enough to mask the seam without
// veiling chat content) and an iOS-friendly safe-area inset.
export function Composer({ value, onChange, onSend, placeholder, disabled, sticky = true }) {
  const { k } = useKbz();
  return (
    <div
      style={{
        position: sticky ? "sticky" : "static",
        bottom: 0,
        padding: "10px 14px",
        paddingBottom: sticky ? "calc(10px + env(safe-area-inset-bottom, 0px))" : 10,
        background: sticky ? `linear-gradient(to top, ${k.bg} calc(100% - 14px), ${k.bg}00)` : "transparent",
        zIndex: 5,
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
          boxShadow: k.isDark
            ? "0 4px 14px rgba(0,0,0,0.35)"
            : "0 4px 14px rgba(60,40,20,0.06)",
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
// DrillInScreen Board API so it can be drop-in swapped.

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
  const { k } = useKbz();
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
  const { k } = useKbz();
  const fmt = fmtEvalShort;
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

// ────────────────────────────────────────────────────────────────────────────
// HoverSparkline — resize-fitting wrapper around Sparkline that tracks the
// pointer to show a "move N · +1.4" readout, and optionally invokes
// onClickIdx(ply) when the user taps a point on the line.
//
// Shared by OverviewScreen (whole-game eval) and DrillInScreen (drill-in
// swing visual). Both screens want the same affordances.
// ────────────────────────────────────────────────────────────────────────────
// Coach prose renderer — single component that handles every inline /
// block-level affordance the LLM emits. Replaces three previous helpers
// (AnnotatedText, RichText, ProseText) that had drifted in feature coverage.
//
//   text         — raw coach prose
//   mode         — "inline" (default, single paragraph)
//                   "rich"   (block-level: ### headings, - bullets)
//   bold/italic  — `**bold**`, `*italic*` markers (on by default)
//   swing        — `++positive++`, `~~cost~~` markers (off by default)
//   mutedParens  — render parenthetical asides in muted color (off by default)
//   onHover      — hover callback for [[annotation]] spans, fed { from, to }
//   fenBefore/After — passed to sanToSquares to resolve SAN → from/to squares
//
// Backwards-compat aliases <AnnotatedText>, <RichText>, <ProseText> are
// exported below so existing call sites keep working.

export function stripAnnotations(text) {
  if (!text) return text;
  return text.replace(/\[\[([^\]|]*?)(?:\|[^\]]*?)?\]\]/g, "$1");
}

function parseAnnotation(raw, fenBefore, fenAfter) {
  const sq = (s) => (/^[a-h][1-8]$/.test(s) ? s : null);
  const pipeIdx = raw.indexOf("|");
  if (pipeIdx !== -1) {
    const display = raw.slice(0, pipeIdx);
    const parts = raw.slice(pipeIdx + 1).split("-");
    return { display, from: sq(parts[0]), to: sq(parts[1]) ?? null };
  }
  if (sq(raw)) return { display: raw, from: raw, to: null };
  for (const fen of [fenBefore, fenAfter].filter(Boolean)) {
    const result = sanToSquares(fen, raw);
    if (result) return { display: raw, ...result };
  }
  return { display: raw, from: null, to: null };
}

export function Annotated({
  text,
  mode = "inline",
  bold = true,
  italic = true,
  swing = false,
  mutedParens = false,
  onHover,
  fenBefore,
  fenAfter,
}) {
  const { k } = useKbz();
  if (!text) return null;

  // Build the splitter regex once based on enabled features.
  const parts = [String.raw`\[\[[^\]]*\]\]`];
  if (swing) {
    parts.push(String.raw`\+\+[^+\n]+\+\+`);
    parts.push(String.raw`~~[^~\n]+~~`);
  }
  if (bold) parts.push(String.raw`\*\*[^*\n]+\*\*`);
  if (italic) parts.push(String.raw`\*[^*\n]+\*`);
  const splitter = new RegExp(`(${parts.join("|")})`);

  function renderInline(str) {
    const tokens = str.split(splitter);
    return tokens.map((tok, i) => {
      if (!tok) return null;
      if (tok.startsWith("[[") && tok.endsWith("]]")) {
        const { display, from, to } = parseAnnotation(tok.slice(2, -2), fenBefore, fenAfter);
        return (
          <span
            key={i}
            style={{
              color: k.text,
              background: k.accentDim,
              padding: "0 4px",
              borderRadius: 3,
              fontWeight: 500,
              cursor: onHover ? "pointer" : undefined,
            }}
            onMouseEnter={onHover ? () => onHover({ from, to }) : undefined}
            onMouseLeave={onHover ? () => onHover(null) : undefined}
          >
            {display}
          </span>
        );
      }
      if (swing && tok.startsWith("++") && tok.endsWith("++")) {
        return (
          <span key={i} style={{ background: k.accentDim, color: k.text, padding: "0 5px", borderRadius: 3 }}>
            {tok.slice(2, -2)}
          </span>
        );
      }
      if (swing && tok.startsWith("~~") && tok.endsWith("~~")) {
        return <span key={i} style={{ color: k.bad, fontWeight: 500 }}>{tok.slice(2, -2)}</span>;
      }
      if (bold && tok.startsWith("**") && tok.endsWith("**")) {
        return <strong key={i} style={{ fontWeight: 600, color: k.text }}>{renderInline(tok.slice(2, -2))}</strong>;
      }
      if (italic && tok.startsWith("*") && tok.endsWith("*") && tok.length > 2) {
        return <em key={i} style={{ fontStyle: "italic" }}>{renderInline(tok.slice(1, -1))}</em>;
      }
      // Plain text — optionally mute parenthetical asides.
      if (mutedParens && tok.includes("(")) {
        const subparts = tok.split(/(\([^)]*\))/g);
        return subparts.map((p, j) =>
          p.startsWith("(") && p.endsWith(")")
            ? <span key={`${i}-${j}`} style={{ color: k.textMute }}>{p}</span>
            : <span key={`${i}-${j}`}>{p}</span>
        );
      }
      return <span key={i}>{tok}</span>;
    });
  }

  if (mode !== "rich") return <>{renderInline(text)}</>;

  // Block-level: headings (#/##/###), bullets (- ), paragraphs.
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

// ────────────────────────────────────────────────────────────────────────────
// Drawer — iOS-style bottom sheet with backdrop + grab handle. Closes via
// backdrop tap, the × button, or onClose.

export function Drawer({ children, onClose, title, subtitle }) {
  const { k } = useKbz();
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

// Caps-label + optional accent hint row above a drawer field's input.
export function DrawerField({ label, hint, children }) {
  const { k } = useKbz();
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

// Single-line input + optional toggle button to the right (used for the
// password/show-or-hide combo on the credential fields).
export function DrawerInputRow({ type, value, onChange, onBlur, onEnter, placeholder, monospace, toggleLabel, onToggle }) {
  const { k } = useKbz();
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

// Pulsing placeholder bar used while LLM-generated content is loading.
// Width is a CSS length (px / %) — defaults to 100% of the parent.
export function Skeleton({ w = "100%", h = 14, style }) {
  const { k } = useKbz();
  return (
    <div
      style={{
        width: w,
        height: h,
        background: k.surface2,
        borderRadius: 4,
        animation: "kbz-pulse 1.4s ease-in-out infinite",
        ...style,
      }}
    />
  );
}

export function HoverSparkline({ data, markIdx = -1, h = 64, onClickIdx, showAxis = true }) {
  const { k } = useKbz();
  const ref = useRef(null);
  const [w, setW] = useState(360);
  const [hoverIdx, setHoverIdx] = useState(null);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver((entries) => {
      const cw = entries[0].contentRect.width;
      if (cw > 0) setW(cw);
    });
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);

  const idxFromEvent = (e) => {
    if (!ref.current || !data || data.length < 2) return null;
    const rect = ref.current.getBoundingClientRect();
    const cx = (e.touches?.[0]?.clientX ?? e.changedTouches?.[0]?.clientX ?? e.clientX) - rect.left;
    const rel = Math.max(0, Math.min(1, cx / Math.max(1, rect.width)));
    return Math.round(rel * (data.length - 1));
  };
  const onMove = (e) => { const idx = idxFromEvent(e); if (idx != null) setHoverIdx(idx); };
  const onLeave = () => setHoverIdx(null);
  const onClick = (e) => {
    if (!onClickIdx) return;
    const idx = idxFromEvent(e);
    if (idx != null && idx > 0) onClickIdx(idx);
  };

  const displayIdx = hoverIdx ?? markIdx;
  const displayEv = displayIdx != null && displayIdx >= 0 && data && displayIdx < data.length ? data[displayIdx] : null;
  const moveNum = displayIdx != null && displayIdx > 0 ? Math.ceil(displayIdx / 2) : null;
  const side = displayIdx != null && displayIdx > 0 ? (displayIdx % 2 === 1 ? "w" : "b") : null;

  return (
    <div style={{ position: "relative" }}>
      {hoverIdx != null && displayEv != null && (
        <div
          style={{
            position: "absolute",
            top: -28,
            left: 0,
            right: 0,
            display: "flex",
            justifyContent: "center",
            pointerEvents: "none",
            zIndex: 2,
          }}
        >
          <span
            style={{
              fontFamily: k.font.mono,
              fontSize: 11,
              padding: "3px 8px",
              borderRadius: 6,
              background: k.surface,
              color: k.text,
              border: `1px solid ${k.hairline}`,
              boxShadow: k.isDark
                ? "0 2px 8px rgba(0,0,0,0.45)"
                : "0 2px 8px rgba(0,0,0,0.08)",
            }}
          >
            <span style={{ color: k.textMute }}>
              {moveNum != null ? `${moveNum}${side === "w" ? "." : "…"}` : "start"}
            </span>{" "}
            <span style={{ color: displayEv >= 0 ? k.accent : k.bad }}>{fmtEval(displayEv)}</span>
          </span>
        </div>
      )}
      <div
        ref={ref}
        onMouseMove={onMove}
        onMouseLeave={onLeave}
        onTouchStart={onMove}
        onTouchMove={onMove}
        onTouchEnd={(e) => { onClick(e); onLeave(); }}
        onClick={onClick}
        style={{ cursor: onClickIdx ? "pointer" : "crosshair", touchAction: "none" }}
        title={onClickIdx ? "Tap to jump to this ply" : undefined}
      >
        <Sparkline data={data} markIdx={hoverIdx ?? markIdx} w={w} h={h} showAxis={showAxis} />
      </div>
    </div>
  );
}
