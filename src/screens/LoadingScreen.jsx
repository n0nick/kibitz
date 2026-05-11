// Loading screen — matches design 03 · Analyzing: editorial heading,
// breathing sparkline (a sine wave that pulses while we wait), and a
// phase-aware step list. Stays mounted from PGN fetch through LLM
// narrative drafting.
//
// Phases (in order):
//   "fetch"          → fetching PGN from Lichess / cache
//   "awaiting-evals" → need engine analysis (user clicks "Analyze locally")
//   "engine"         → local Stockfish pass running
//   "llm"            → LLM drafting narrative

import { useKbz, Card, NavBar, Editorial, Sparkline } from "../ui";

export function LoadingScreen({ phase = "fetch", summary, localProgress, startLocalAnalysis, onCancel }) {
  const { k } = useKbz();
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
