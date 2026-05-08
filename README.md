# Kibitz

A mobile-first web app for reviewing chess games with AI coaching and engine analysis. Load a game from Lichess, get AI-generated commentary on key moments, and chat with a coach about any position.

<img width="590" height="1193" alt="screenshot" src="https://github.com/user-attachments/assets/42b7f953-80af-4890-b753-1d45d249ee74" />

## Features

- **AI game analysis** — Claude identifies blunders, mistakes, inaccuracies, and brilliant moves, explains what happened and why, and suggests alternatives
- **Interactive board** — step through every move, hover annotations to highlight squares, see better alternative moves on the board
- **Chess coaching chat** — ask questions about any position; answers are grounded by Stockfish running locally in the browser (multi-PV, no hallucinated tactics)
- **Lichess integration** — connect your account to browse recent games, or paste any Lichess URL
- **Local engine analysis** — games without Lichess computer evals can be analyzed in-browser using Stockfish 18 WASM (~1 min for a typical game)
- **Analysis cache** — full game analysis cached locally for 7 days; chat history survives page refresh (sessionStorage)

## Setup

You need:
- An **Anthropic API key** — [console.anthropic.com](https://console.anthropic.com)
- Optionally, a **Lichess personal token** (no scopes needed) to browse your games — [lichess.org/account/oauth/token](https://lichess.org/account/oauth/token)

```bash
npm install
npm run dev
```

Open [localhost:5173](http://localhost:5173), enter your API key in Settings, and load a game.

## Usage

**Loading a game:**
- Connect Lichess to browse your recent games (click any to load)
- Or paste a Lichess game URL directly
- Games without computer analysis offer two options: analyze locally (~1 min, cached) or open on Lichess to request server-side analysis

**Reviewing:**
- Use `‹ ›` to step through moves, `« »` to jump between key moments
- Click any annotated term (underlined) to highlight the relevant squares on the board
- Click a better alternative move to see it on the board
- Use `lichess ↗` in the board corner to open the current position in Lichess analysis

**Chat:**
- Ask anything about the current position — the engine runs first so Claude has verified tactical lines
- All navigation supports cmd/ctrl+click to open in a new tab

## Analysis levels

Three tones for AI commentary:
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

## Stack

- React 19 + Vite
- Tailwind CSS
- [chess.js](https://github.com/jhlywa/chess.js) for PGN parsing and move validation
- [Stockfish 18](https://stockfishchess.org/) (lite-single WASM build) for engine analysis
- Anthropic API (Claude Haiku 4.5) for AI commentary and chat
- Lichess public API for game data
