# Kibitz Benchmarking System — Implementation Plan

## Context

Kibitz is an AI chess game reviewer (Stockfish + Claude Haiku 4.5) that generates commentary on user games. The current commentary quality is uneven — sometimes it's insightful, sometimes it hallucinates tactics or feels generic. We need a systematic way to measure quality, catch regressions when prompts/models change, and identify specific failure modes.

This plan describes a benchmarking system that runs Kibitz's analysis pipeline against a curated test set and scores the output using an LLM judge with Stockfish as ground truth.

**Repo:** https://github.com/n0nick/kibitz
**Live app:** https://kibitz-six.vercel.app
**Stack:** React 19 + Vite, Tailwind, chess.js, Stockfish 18 WASM, Anthropic API (Haiku 4.5)

## Goals

1. Detect regressions when prompts or models change
2. Quantify where Kibitz is weak across move selection, tactical accuracy, explanation quality, pedagogical value, and voice
3. Compare model choices (Haiku 4.5 vs Sonnet 4.6 vs Opus 4.7) on cost/quality tradeoff
4. Catch hallucinated tactics automatically before users see them
5. Enable a tight feedback loop: change a prompt → run benchmark → see scores delta in minutes, not days

## Prerequisite — Refactor for testability FIRST

**Do this before anything else.** Nothing in this plan works until Kibitz's analysis pipeline can be called headlessly.

Currently the analysis function is likely entangled with React state, the Vite dev server, and the browser environment (Stockfish WASM, OAuth flows, sessionStorage). The benchmark needs to:

- Take a PGN string as input (PGN paste is already implemented — leverage that path)
- Run the full analysis pipeline (Stockfish multi-PV evaluation + Claude commentary pass)
- Return structured JSON output (see "Output Contract" below)
- Run from a Node.js script with no browser, no UI, no user interaction

### Refactoring tasks

1. **Extract the core analysis function** into a pure module that takes `(pgn: string, options: AnalysisOptions) => Promise<AnalysisResult>`. No React, no DOM, no global state.
2. **Stockfish in Node**: the browser uses Stockfish WASM via a Web Worker. For the benchmark, either:
   - Use `stockfish.js` (npm) which works in Node, OR
   - Run a native Stockfish binary via child_process and speak UCI to it
   The native binary is faster and more deterministic; the WASM build matches what the browser actually runs. Pick based on whether you want "test what users see" (WASM) or "test fast" (native). Recommend native for benchmark speed, with one sanity-check run on WASM per release.
3. **Anthropic API calls** should already be portable — they're just HTTP. Make sure the API key is read from env (`ANTHROPIC_API_KEY`), not from localStorage/Settings UI.
4. **No sessionStorage / localStorage dependencies** in the core analysis path. If caching is needed, accept a cache adapter as a parameter (default to no-op for benchmark runs).
5. **Configuration via parameters**, not UI: model name, analysis level (beginner/intermediate/advanced), Stockfish depth, multi-PV count.

### Output contract — structured JSON

The analysis function must emit this shape (suggested — adjust to match what you already produce internally, but don't lose any of these fields):

```json
{
  "game_metadata": {
    "white": "...",
    "black": "...",
    "result": "1-0",
    "moves_count": 42,
    "source": "lichess|pgn-paste|chesscom",
    "source_url": "..."
  },
  "game_summary": "3-4 sentence narrative of the game arc",
  "patterns": [
    "Pattern observation across the whole game"
  ],
  "key_moments": [
    {
      "ply": 35,
      "move_san": "Nf6",
      "move_uci": "e4f6",
      "fen_before": "...",
      "fen_after": "...",
      "classification": "blunder|mistake|inaccuracy|good|brilliant|missed_mate",
      "eval_before_cp": -180,
      "eval_after_cp": 210,
      "explanation": "2-3 sentence coaching explanation",
      "claimed_lines": [
        {
          "label": "refutation",
          "moves_san": ["Bxf6", "gxf6", "Qh6"],
          "claim": "wins material via the weak king"
        }
      ],
      "alternatives": [
        {
          "move_san": "Rc8",
          "eval_cp": -170,
          "reason": "defends the c-pawn and keeps the position balanced"
        }
      ]
    }
  ],
  "stockfish_data": {
    "depth": 22,
    "multipv": 3,
    "per_ply": [
      {
        "ply": 1,
        "best_lines": [
          { "moves_uci": ["e2e4", "..."], "eval_cp": 35, "mate": null }
        ]
      }
    ]
  },
  "metadata": {
    "model": "claude-haiku-4-5",
    "prompt_version": "v1.2",
    "analysis_level": "intermediate",
    "total_tokens_in": 12000,
    "total_tokens_out": 3000,
    "cost_usd": 0.011,
    "latency_ms": 8400
  }
}
```

The `claimed_lines` field is critical — it's what the judge cross-references against Stockfish to detect hallucinations. Every tactical claim in the prose `explanation` should also appear here in machine-checkable form. If the prompt produces prose without structured lines, change the prompt to require both.

### Acceptance criteria for the refactor

- [ ] `npm run analyze -- --pgn <file>` produces the JSON above
- [ ] No browser APIs touched in the analysis path
- [ ] Reading a PGN file, analyzing, and writing JSON works in under 90 seconds for a typical 40-move game on a laptop
- [ ] The same function powers the existing UI (don't fork — refactor)
- [ ] Existing tests (if any) still pass; UI behavior unchanged

Once this is in place, the benchmark is straightforward.

---

## Benchmark architecture

```
[PGN sources]
     ↓
[Kibitz analysis (refactored)] → produces structured JSON + Stockfish lines
     ↓
[Judge LLM (Opus 4.7)]
     ↓ uses Stockfish as ground truth
     ↓ uses human reference annotations where available
     ↓
[Per-dimension scores + flagged issues]
     ↓
[CSV / JSON results, optional dashboard]
```

## Test set — four buckets

Total ~15 games to start. Layout under `benchmark/games/`:

```
benchmark/
  games/
    A_canonical/      # 3 famous games
    B_titled/         # 5 titled-player annotated, lesser-known
    C_amateur/        # 5 amateur games (your own + random 1500-1800)
    D_synthetic/      # 2-3 hand-crafted adversarial PGNs (grow over time)
  references/
    A_canonical/      # human-annotated reference PGNs (with comments)
    B_titled/         # human-annotated reference PGNs
  results/
    <timestamp>_<model>_<prompt-version>.json
    <timestamp>_<model>_<prompt-version>.csv
```

### Bucket A — Canonical (3 games)

Famous games where Claude has likely seen commentary in training. Sanity check only; don't over-weight. Source from Lichess studies that include human annotations.

- Morphy vs. Duke of Brunswick (Opera Game, 1858)
- Fischer vs. Spassky, Game 6, 1972 ("Game of the Century" candidate)
- Kasparov vs. Topalov, Wijk aan Zee, 1999 ("Kasparov's Immortal")

Reference annotations: pull from public Lichess studies (e.g., https://lichess.org/study/yzrPOxUF, https://lichess.org/study/18uvMnYq/xxzuqvm0) and store as PGN with `{}` comments preserved.

### Bucket B — Titled-player annotated (5 games)

The real test. Less canonical games annotated by FMs/IMs/GMs. Pick from at least 3 different annotators to avoid overfitting to one voice. Source from Lichess studies — search for studies by titled players (display name has "FM"/"IM"/"GM" prefix).

Selection criteria:
- Annotated by titled player
- Not in the top-50 most-discussed games (less likely memorized)
- Mix of openings and game phases (not all middlegame attacks)

### Bucket C — Amateur games (5 games)

The actual use case. No reference annotations. Judged on internal consistency and tactical accuracy via Stockfish ground truth.

- 3 of your own Lichess games (mix of time controls)
- 2 from random 1500-1800 rated players (use Lichess API to fetch a few)

### Bucket D — Synthetic adversarial (2-3 to start, grows over time)

Hand-crafted positions designed to break things. **This is the most valuable bucket long-term.** Each adversarial PGN comes with a "must get right" assertion file.

Starting set:

1. **Greek Gift sacrifice setup** — must identify Bxh7+ as winning, must give correct king-walk line (Kxh7, Ng5+, Kg6 or Kg8, Qh5, etc.)
2. **Poisoned pawn position** — must explain *why* the pawn is poisoned with the real refutation, not "it looks unsafe"
3. **Fortress endgame** — must recognize the fortress and not parrot a misleading engine eval
4. **Quiet best move** — a position where the played move is best but looks like a blunder (e.g., a deflection sac); must not mistakenly criticize it
5. **Zugzwang** — must name zugzwang as the mechanism, not just "every move loses"

Format: each adversarial PGN paired with `<game>.assertions.json`:

```json
{
  "must_flag_moves": [{"ply": 19, "expected_classification": "brilliant"}],
  "must_not_flag_moves": [{"ply": 22}],
  "required_concepts": ["greek gift", "king walk"],
  "forbidden_claims": [
    "Nxh7 wins immediately",
    "Black has adequate defense"
  ]
}
```

Add a new adversarial PGN every time you find a real failure in the wild.

## Scoring rubric

Each game scored on five dimensions, 1-5:

| Dimension | What it measures | 1 (bad) | 5 (good) |
|---|---|---|---|
| **Move selection** | Did it flag the right critical moments? | Missed key turning point or flagged trivial moves | Flagged exactly the moments a coach would |
| **Tactical accuracy** | Are the lines and refutations real? | Invented tactics, wrong refutations, illegal moves named | All lines match Stockfish, no hallucinated threats |
| **Causal explanation** | Does it explain *why*, not just *what*? | "This is a blunder" with no insight | Names the tactical/positional mechanism clearly |
| **Pedagogical value** | Would a learner improve from reading this? | Generic, jargon-heavy or jargon-free in the wrong way | Memorable insight tied to a transferable pattern |
| **Voice** | Does it sound like a coach or a database? | Robotic, repetitive structure across moves | Conversational, varied, appropriate confidence |

**Tactical accuracy is the make-or-break score.** A game with tactical accuracy < 4 is shipping bugs. The other dimensions can be improved with prompting; tactical accuracy depends on whether Stockfish grounding is actually working in the prompt.

### Aggregate metrics

Track per benchmark run:
- Mean and median per dimension, per bucket
- Hallucination count (any flagged tactical claim contradicted by Stockfish)
- Missed-moment count (critical moves the human flagged that Kibitz didn't, Buckets A/B)
- False-flag count (moves Kibitz flagged that neither human nor Stockfish considers critical)
- Cost per game, latency per game

### Pass/fail thresholds (suggested)

- Tactical accuracy mean ≥ 4.5 across all buckets
- Zero hallucinations on Bucket D
- Move selection mean ≥ 4.0 on Bucket B
- Bucket D assertions: 100% of `must_flag_moves` flagged, 0 of `forbidden_claims` present

If these aren't met, the change isn't ready to ship.

## The judge

Use **Opus 4.7** as the judge. It's strong enough at chess reasoning to verify tactical claims given Stockfish lines, and strong enough at meta-evaluation to score voice and pedagogy reliably.

### Judge prompt — Buckets A and B (with human reference)

```
You are evaluating AI-generated chess commentary against human expert annotations and Stockfish ground truth. Be rigorous and specific. Cite move numbers in every justification.

GAME PGN:
{pgn}

STOCKFISH ANALYSIS (depth 22, multi-PV 3):
{stockfish_json}

HUMAN ANNOTATIONS:
{human_pgn_with_comments}

AI COMMENTARY UNDER TEST:
{kibitz_json}

Score the AI commentary on five dimensions, 1-5 each. For each dimension, give the score and a one-sentence justification citing specific moves.

1. **Move selection**: Did the AI flag approximately the same critical moments the human did? Extra moments are fine if substantive. Missing moments the human flagged is bad.

2. **Tactical accuracy**: Compare every claimed tactical line in the AI output (the `claimed_lines` field and any tactical claims in `explanation`) against the Stockfish lines. Flag any claim that:
   - Contains illegal moves
   - Doesn't actually refute what it claims to refute (verify by replaying the line mentally and checking Stockfish's eval)
   - Contradicts the engine's top lines without justification
   - Asserts a tactic that Stockfish doesn't see
   Score 1 if any hallucinated tactics are present. Score 5 only if every line is verified.

3. **Causal explanation**: Does the AI explain WHY moves are good or bad, not just label them? Compare to the human's reasoning where present. Generic explanations ("this loses material", "this is passive") score low; mechanism-specific explanations ("this allows Bxf6 shattering the kingside, after which Qh6 is unstoppable") score high.

4. **Pedagogical value**: Does the AI's commentary teach a transferable idea (a named pattern, a principle, a strategic theme), or is it positionally specific without generalization? A great explanation gives the learner something they can apply to similar positions.

5. **Voice**: Does the AI sound like a coach (varied, confident-where-appropriate, conversational) or a template (repetitive structure, hedge words, generic phrasing)? Read 3-5 of the explanations to assess.

Then list:
- **HALLUCINATIONS**: any tactical claims contradicted by Stockfish (specific move references)
- **MISSED MOMENTS**: critical moves the human flagged that the AI didn't (specific move references)
- **FALSE FLAGS**: moves the AI flagged that don't merit it per BOTH Stockfish AND the human (specific move references)

Output strictly as JSON, no preamble:

{
  "scores": {
    "move_selection": 4,
    "tactical_accuracy": 5,
    "causal_explanation": 3,
    "pedagogical_value": 3,
    "voice": 4
  },
  "justifications": {
    "move_selection": "Flagged moves 18, 23, 31 matching human; missed move 14 (which human noted as the strategic turning point)",
    "tactical_accuracy": "All claimed lines verified against Stockfish; refutation on move 18 matches multi-PV line 1",
    "causal_explanation": "Explanations on moves 18 and 23 are mechanism-specific; move 31 is generic 'this loses' with no insight",
    "pedagogical_value": "Identifies the weak-square pattern on move 18 well; misses the chance to teach the f-file pressure theme on move 23",
    "voice": "Reads naturally; some repetition in opening phrases ('This move is...') across 3 of 5 explanations"
  },
  "hallucinations": [],
  "missed": [
    {"ply": 27, "human_note": "the strategic turning point", "severity": "high"}
  ],
  "false_flags": []
}
```

### Judge prompt — Buckets C and D (no human reference)

Same structure, but no human reference is provided. The judge independently classifies each move from the Stockfish data, then checks whether Kibitz's classification and lines match. Move selection is scored against the judge's own classification rather than a human's.

For Bucket D specifically, append:

```
ASSERTIONS FOR THIS POSITION:
{assertions_json}

In addition to the standard scoring, verify each assertion:
- For each move in `must_flag_moves`: did the AI flag it with the expected classification?
- For each move in `must_not_flag_moves`: did the AI correctly NOT flag it?
- For each concept in `required_concepts`: does the AI's commentary mention or explain the concept?
- For each claim in `forbidden_claims`: does the AI commentary make this (incorrect) claim anywhere?

Append to your output JSON:

{
  ...standard fields...,
  "assertion_results": {
    "must_flag_moves": [{"ply": 19, "passed": true}],
    "must_not_flag_moves": [{"ply": 22, "passed": true}],
    "required_concepts": [{"concept": "greek gift", "found": true}],
    "forbidden_claims": [{"claim": "Nxh7 wins immediately", "made": false}]
  }
}
```

## Implementation tasks

### Phase 1 — Refactor for testability (PREREQUISITE, see above)

- [ ] Extract analysis function into pure module
- [ ] Make Stockfish callable from Node (native binary or stockfish.js)
- [ ] Read API key from env
- [ ] Remove all browser-API dependencies from the analysis path
- [ ] Define and emit the structured JSON output contract
- [ ] Wire `npm run analyze -- --pgn <file>` CLI
- [ ] Verify UI still works unchanged

### Phase 2 — Benchmark runner

- [ ] `benchmark/runner.js` that takes a bucket directory, runs analysis on every PGN, saves results to `benchmark/results/<timestamp>/<bucket>/<game>.analysis.json`
- [ ] `benchmark/judge.js` that takes an analysis JSON + (optional) human reference + (optional) assertions, calls Opus 4.7 with the appropriate judge prompt, saves results to `benchmark/results/<timestamp>/<bucket>/<game>.judge.json`
- [ ] `benchmark/aggregate.js` that walks a results directory and produces a CSV with one row per game and a summary JSON with means/medians/pass-fail
- [ ] `npm run benchmark -- [--bucket A,B,C,D] [--model claude-haiku-4-5] [--prompt-version v1.2]`

### Phase 3 — Test data

- [ ] Source 3 canonical games + human annotations into `benchmark/games/A_canonical/` and `benchmark/references/A_canonical/`
- [ ] Source 5 titled-player annotated games for Bucket B
- [ ] Add 5 amateur games to Bucket C (3 from the project owner's Lichess account, 2 from random 1500-1800 players via Lichess API)
- [ ] Construct 5 synthetic adversarial PGNs for Bucket D with assertion files

### Phase 4 — Reporting

- [ ] CSV output with columns: `game_id, bucket, model, prompt_version, move_selection, tactical_accuracy, causal_explanation, pedagogical_value, voice, hallucination_count, missed_count, false_flag_count, cost_usd, latency_ms`
- [ ] Summary JSON per run with aggregate metrics and pass/fail status
- [ ] (Optional) HTML dashboard that diffs two runs side by side, highlighting regressions in red and improvements in green
- [ ] (Optional) GitHub Action that runs the benchmark on PRs touching prompts and posts a comment with the score delta

## Cost estimate

- Kibitz analysis pass: ~$0.01 per game (Haiku 4.5)
- Judge pass: ~$0.05–0.10 per game (Opus 4.7, large input with PGN + Stockfish + AI output)
- Full benchmark run on 15 games: ~$1–2

Cheap enough to run on every prompt change. Budget $20/month for benchmark infrastructure.

## What to track over time

A simple line chart per dimension across runs, with model and prompt version annotated. Looking for:

- Tactical accuracy trending up, hallucinations trending to zero
- Move selection improving, especially on Bucket B
- Voice can lag — improve it last, after correctness is locked
- Bucket D pass rate at 100% as a hard gate

## Notes and gotchas

**The judge can itself hallucinate.** Especially when scoring "voice" or "pedagogical value" where there's no ground truth. Re-read judge outputs manually for the first few runs to calibrate. Tactical accuracy is the dimension where the judge has Stockfish as ground truth and can be trusted most.

**Don't over-weight Bucket A.** Famous games are likely memorized by Claude. High scores there don't mean Kibitz is good; low scores there mean Kibitz is broken. Treat A as a smoke test, not a quality bar.

**Bucket D is the highest-leverage investment over time.** Every real-world failure should become a synthetic test case. The set should grow to 20–30 positions within a few months of regular use.

**Run benchmarks before merging prompt changes.** If a prompt tweak improves voice on Bucket B but tanks tactical accuracy on Bucket D, you need to know that before users do.

**The structured JSON output (`claimed_lines`) is non-negotiable.** Without it, the judge can't auto-verify tactical claims and you're back to manual review. If the current prompt produces prose-only output, modify the prompt to require structured lines alongside the prose.

## Open questions for the implementer

- Native Stockfish binary or stockfish.js for benchmark runs? (Recommend native for speed, with one WASM sanity-check run per release.)
- Should the benchmark runner support parallel game analysis, or sequential? (Sequential is simpler and fine for 15 games; parallelize later if needed.)
- Where to host benchmark results long-term? (Local filesystem + git for now; consider a small SQLite or DuckDB store if it grows.)
- Should the judge run on the same model that powers Kibitz, or always on a stronger one? (Always stronger — Opus 4.7 judges Haiku output. If Kibitz upgrades to Opus, the judge needs to upgrade to whatever's next, or at minimum a separately-prompted Opus instance to reduce same-model bias.)
