# Benchmark Game Sources

Every PGN file in this directory was sourced from a verifiable external reference.
No moves were reconstructed from memory.

## Bucket A — Canonical

| File | Game | Source | Verification |
|------|------|--------|-------------|
| `A_canonical/opera-game.pgn` | Morphy vs Duke of Brunswick & Count Isouard, Paris 1858 | Wikipedia: https://en.wikipedia.org/wiki/Opera_Game and Lichess study: https://lichess.org/study/xAo78qLb/truC6WoM | Verified move-for-move against Lichess study API export (https://lichess.org/api/study/xAo78qLb/truC6WoM.pgn); all 17 moves match exactly |
| `A_canonical/fischer-spassky-1972-g6.pgn` | Fischer vs Spassky, World Championship 1972, Game 6 | Wikipedia: https://en.wikipedia.org/wiki/World_Chess_Championship_1972 (Game 6 section) | Fetched and verified move-for-move against Wikipedia; 41 moves ending Qf4 1-0; note 40.Bc4+ is a discovered check |
| `A_canonical/kasparov-topalov-1999.pgn` | Kasparov vs Topalov, Wijk aan Zee 1999 | Wikipedia: https://en.wikipedia.org/wiki/Kasparov%27s_Immortal | Fetched and verified move-for-move against Wikipedia; 44 moves ending Qa7 1-0 |

## Bucket B — Titled-player annotated

All four games sourced from the ValdemarOrn/Chess GitHub repository:
https://github.com/ValdemarOrn/Chess/tree/master/Annotated%20Games

Raw file used:
- `https://raw.githubusercontent.com/ValdemarOrn/Chess/master/Annotated%20Games/russian_chess.pgn`

The annotated reference versions (in `references/B_titled/`) were extracted verbatim from this file and contain all `{}` comments, `()` variations, and NAGs exactly as written by the annotating GM.

The clean `games/B_titled/` PGNs were verified move-for-move against their references using a PGN tokenizer (stripping headers/comments/variations/NAGs). All 4 games pass: 73, 85, 91, 66 plies respectively. One error was caught and corrected in this process: `svidler-short-2000` had `20. Qd3` where the source has `20. Re1`.

| File | Game | Annotator |
|------|------|-----------|
| `B_titled/svidler-shirov.pgn` | Svidler vs Shirov, Linares 1998 | GM Peter Svidler (self-annotation) |
| `B_titled/sakaev-mrva-istanbul-2000.pgn` | Sakaev vs Mrva, Istanbul Olympiad 2000 | GM Konstantin Sakaev (self-annotation) |
| `B_titled/svidler-short-2000.pgn` | Svidler vs Short, KC Internet Grand Prix 2000 | GM Konstantin Sakaev |
| `B_titled/short-svidler-2000.pgn` | Short vs Svidler, KC Internet Grand Prix 2000 | GM Konstantin Sakaev |

Svidler-Shirov event identification: The file's `[Event ""]` tag is blank, but Svidler's annotation confirms Linares 1998 — he writes "Rounds 7&8 Shirov faced the position after 7.a4 against Kasparov & Anand" in a double round-robin of 7 players, and Svidler was "the last one to play Shirov with White." This matches Linares 1998 (February–March 1998, participants: Anand, Shirov, Kramnik, Kasparov, Svidler, Ivanchuk, Topalov).

## Bucket C — Amateur

All games downloaded from Lichess on 2026-05-08. Player names, game IDs, and site URLs are anonymized in the PGN files (player names replaced with "White"/"Black"; Site tag generalized to "https://lichess.org"). Full provenance kept here only. No reference annotations (judged against Stockfish only).

| File | WhiteElo | BlackElo | Result | Plies | Lichess URL |
|------|----------|----------|--------|-------|-------------|
| `C_amateur/amateur-1.pgn` (owner, vs bot) | 1500 | 1589 | 0-1 | 56 | https://lichess.org/A5z9A0Dd |
| `C_amateur/amateur-2.pgn` | 1649 | 1643 | 1-0 | 111 | https://lichess.org/XtHbKnrE |
| `C_amateur/amateur-3.pgn` | 1792 | 1726 | 1-0 | 65 | https://lichess.org/1tnbrnVF |
| `C_amateur/amateur-4.pgn` | 1626 | 1620 | 0-1 | 87 | https://lichess.org/RKL1Xojv |
| `C_amateur/amateur-5.pgn` | 1642 | 1687 | 0-1 | 58 | https://lichess.org/8YNesM1C |

Note: amateur-1 is the owner's game against Lichess Maia bot — not a true human-vs-human game. Maia produces a different error distribution than a real 1500-rated opponent. Don't draw conclusions from this game's score in isolation; replace with a human-opponent game when available.

## Bucket D — Adversarial (real games only)

| File | Game | Source | Key pattern |
|------|------|--------|-------------|
| `D_synthetic/colle-ohanlon-1930.pgn` | Colle vs O'Hanlon, Nice 1930 | https://exeterchessclub.org.uk/content/greek-gift ; Wikipedia: https://en.wikipedia.org/wiki/Greek_gift_sacrifice | Greek Gift sacrifice (12.Bxh7+) |
| `D_synthetic/spassky-fischer-1972-g11.pgn` | Spassky vs Fischer, WCC 1972 Game 11 | Wikipedia: https://en.wikipedia.org/wiki/World_Chess_Championship_1972 (Game 11); also https://www.thechesswebsite.com/1972-world-chess-championships-spassky-vs-fischer-game-11/ | Poisoned Pawn (8...Qxb2), Spassky's 14.Nb1!! preparation |
| `D_synthetic/kramnik-kasparov-2000-g4.pgn` | Kramnik vs Kasparov, BrainGames WCh 2000 Game 4 | Lichess study: https://lichess.org/study/EUCOkjcs | Fortress endgame — drawn despite material deficit |
| `D_synthetic/samisch-nimzowitsch-1923.pgn` | Sämisch vs Nimzowitsch, Copenhagen 1923 | Wikipedia: https://en.wikipedia.org/wiki/Immortal_Zugzwang_Game | Zugzwang: 25...h6!! |
| `D_synthetic/levitsky-marshall-1912.pgn` | Levitsky vs Marshall, Breslau 1912 | Wikipedia: https://en.wikipedia.org/wiki/Frank_Marshall_(chess_player) | Quiet best move: 23...Qg3!! (the "gold coins" queen sacrifice) |

Each game has a corresponding `.assertions.json` file specifying must-flag/must-not-flag moves, required concepts, and forbidden claims.
