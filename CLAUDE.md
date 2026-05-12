# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
vercel dev    # Dev server (required for /report blob reads + SPA rewrite)
npm run build
npm run lint
```

No test suite — use the benchmark pipeline (`npm run bench`) for analysis quality validation.

## Key non-obvious things

- **Styling**: layout is inline styles via `kbzTokens()` tokens, not Tailwind. Tailwind is nearly absent.
- **Prompt caching**: bump `PROMPT_VERSION` in `analyzeGame.js` whenever prompt changes would invalidate cached analyses.
- **Board palettes**: four defined in `design.js` but no switcher UI yet — always defaults to `cream-sage`.
- **No proxy**: Anthropic API key is sent directly from the browser (`anthropic-dangerous-direct-browser-access` header).
