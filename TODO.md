# Chess Reviewer — TODO

## In progress
- Lichess account integration (personal API token → games list → on-demand analysis request)

## Planned

### Lichess
- Upgrade from personal token to full OAuth 2.0 PKCE flow
  (ref: https://lichess.org/api#section/Introduction/Authentication)
  so users don't need to manually create/paste a token

### Analysis
- Per-game analysis TTL / cache expiry (currently cached indefinitely)
- Stockfish WASM fallback for games without Lichess evals
- More tones selection: Beginner / Novice / Intermediate / Club / Expert - or
  maybe personas or something else

### UI / UX
- Style polish pass (spacing, typography, mobile tweaks)
- PGN paste / file upload as a third import mode
- Links should support opening in new tab etc.

### Future
- Lichess OAuth games list (private games, puzzles, studies)
- Multi-game history view / session persistence
- Look into Anthropic full OAuth PKCD flow
