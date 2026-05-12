# Kibitz

A mobile-first web app for reviewing chess games with AI coaching and engine analysis. Load a game from Lichess, get AI-generated commentary on the moments that actually mattered, and chat with a coach about any position.

<img width="590" height="1278" alt="screenshot" src="https://github.com/user-attachments/assets/b69bda9c-e097-4358-9f59-3079cec1f469" />

## Features

**Browse & navigate**
- Editorial home screen showing your recent games as cards — each one with a sparkline of the eval curve, accuracy %, and turning-point count (all derived from Lichess's inline engine evals when present)
- Connect a Lichess account to pull your last 30 games, or paste a Lichess URL / raw PGN from the *Add a game* page
- "Playing as ♔ White / ♚ Black" inferred from your username; falls back to a perspective prompt

**Coach's read**
- Editorial pull-quote headline framing the *stakes* of each turning point ("You gave away the bishop pair — and a winning position — for one pawn and a check.")
- Story-style narrative on the overview screen with inline `++positive++`, `~~cost~~`, and parenthetical emphasis matched to the editorial type
- Per-moment "Coach's read" annotated with tappable squares + moves
- Better-line shown inline as monospace notation; cycle through alternatives in place

**Engine-grounded chat**
- Sticky chat composer underneath every drill-in board — keeps the board, classification, and better-line visible while you ask follow-ups
- Engine alternatives (Lichess cloud-eval or local Stockfish multi-PV) are passed to the LLM as ground truth; the model is forbidden from inventing tactical lines or moves the engine didn't see
- Whole-game eval sparkline is interactive: hover or tap any point to see the eval at that ply; tap to jump straight to that move

**Light & dark themes**
- Default follows the OS `prefers-color-scheme`
- *System / Light / Dark* picker in Settings; "System" clears the persisted choice and follows the OS live

**Local engine + cache**
- Games without Lichess computer evals can be analysed in-browser using Stockfish 18 WASM (~1 min for a typical game)
- Full game analysis cached locally for 7 days (cache key includes prompt version, so prompt revisions invalidate automatically)
- PGN cache survives page refresh; chat history is per-position and resets when you change ply

## Setup

You need:
- An **Anthropic API key** — [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys)
- Optionally, a **Lichess personal token** (no scopes needed) to browse your games — [lichess.org/account/oauth/token](https://lichess.org/account/oauth/token/create?description=Kibitz)

```bash
npm install
npm run dev
```

Open [localhost:5173](http://localhost:5173). The Settings drawer auto-opens on first run; both credential fields link out to the right page.

## Usage

**Loading a game**
- Tap a game card from the home list (Lichess), or tap the `+` button top-right to paste a URL or PGN
- Games without computer analysis bring up the *Analyze locally* button on the loading screen

**Reviewing**
- The overview shows the whole-game eval sparkline, an editorial story, recurring patterns, and the turning points list
- Hover/tap any point on the sparkline to see the eval at that ply; tap to drill in
- Each turning point card opens the drill-in: board, classification glyph + pull-quote headline, eval-swing sparkline marking the current ply, Coach's read, better line
- Use the `←/→` buttons or arrow keys (or swipe on touch) to step through moves; the title uses `9.` / `9…` notation to disambiguate half-moves
- `Lichess ↗` in the nav bar deep-links to the position on lichess.org's analysis board

**Chat**
- "Ask about this game" lives at the bottom of the overview
- "Ask about this move" composer is sticky at the bottom of the drill-in — chat continues below the board context so you don't lose track of what you're discussing
- Tap a suggested-question chip to submit it directly to the coach

## Analysis levels

Three tones for AI commentary, set per session in Settings:
- **Beginner** — plain language, no chess jargon
- **Intermediate** — club player level, some terminology
- **Advanced** — standard chess notation and concepts

## Cost

Uses `claude-haiku-4-5` for all AI calls. Typical cost:
- Full game analysis: ~$0.01
- Chat message: ~$0.001–0.002
- ~$0.025 per typical session (analysis + ~10 chat messages)

Stockfish analysis is free (runs locally in WASM).

## Roadmap

- **Analysis personas** — named coaches with distinct styles beyond Beginner/Intermediate/Advanced
- **Lichess OAuth PKCE** — proper OAuth flow instead of manual personal token
- **Anthropic OAuth** — remove the need to supply an API key manually
- **Cross-game patterns** — surface recurring weaknesses across your last N games

## Stack

- React 19 + Vite
- Editorial type system: Newsreader (display / pull-quotes), Geist (sans), Geist Mono (numerics)
- Inline-styled primitives driven by a `KbzThemeContext` — light & dark token sets, single `useKbz()` hook
- [chess.js](https://github.com/jhlywa/chess.js) for PGN parsing and move validation
- [Stockfish 18](https://stockfishchess.org/) (lite-single WASM build) for engine analysis
- Anthropic API (Claude Haiku 4.5) for AI commentary and chat
- Lichess public API for game data + cloud-eval
- Vercel Blob storage for the bug-report flow — the flag (🚩) on any coach response uploads a markdown report (commentary + FEN + engine alternatives + full prompt) to a public blob and opens it via the `/report` viewer for easy sharing
