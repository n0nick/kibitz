# Benchmark Game Sources

Every PGN file in this directory was sourced from a verifiable external reference.
No moves were reconstructed from memory.

## Bucket A — Canonical

| File | Game | Source | Verification |
|------|------|--------|-------------|
| `A_canonical/opera-game.pgn` | Morphy vs Duke of Brunswick & Count Isouard, Paris 1858 | Wikipedia: https://en.wikipedia.org/wiki/Opera_Game | Moves match App.jsx DEMO_PGN exactly; also verified against Wikipedia article |
| `A_canonical/fischer-spassky-1972-g6.pgn` | Fischer vs Spassky, World Championship 1972, Game 6 | Wikipedia: https://en.wikipedia.org/wiki/World_Chess_Championship_1972 (Game 6 section) | Fetched and verified move-for-move against Wikipedia; 41 moves ending Qf4 1-0; note 40.Bc4+ is a discovered check |
| `A_canonical/kasparov-topalov-1999.pgn` | Kasparov vs Topalov, Wijk aan Zee 1999 | Wikipedia: https://en.wikipedia.org/wiki/Kasparov%27s_Immortal | Fetched and verified move-for-move against Wikipedia; 44 moves ending Qa7 1-0 |

## Bucket B — Titled-player annotated

All five games sourced from the ValdemarOrn/Chess GitHub repository:
https://github.com/ValdemarOrn/Chess/tree/master/Annotated%20Games

The annotated reference versions (in `references/B_titled/`) were fetched from:
- `https://raw.githubusercontent.com/ValdemarOrn/Chess/master/Annotated%20Games/russian_chess.pgn`
- `https://raw.githubusercontent.com/ValdemarOrn/Chess/master/Annotated%20Games/linares_2002.pgn`

| File | Game | Source file | Annotator |
|------|------|-------------|-----------|
| `B_titled/svidler-shirov.pgn` | Svidler vs Shirov (year unknown) | `russian_chess.pgn` | GM Peter Svidler (self-annotation) |
| `B_titled/sakaev-mrva-istanbul-2000.pgn` | Sakaev vs Mrva, Istanbul Olympiad 2000 | `russian_chess.pgn` | GM Konstantin Sakaev (self-annotation) |
| `B_titled/svidler-short-2000.pgn` | Svidler vs Short, KC Internet Grand Prix 2000 | `russian_chess.pgn` | GM Konstantin Sakaev |
| `B_titled/ivanchuk-adams-linares-2002.pgn` | Ivanchuk vs Adams, SuperGM Linares 2002 Rd 7 | `linares_2002.pgn` | Mark Hathaway |
| `B_titled/vallejo-ponomariov-linares-2002.pgn` | Vallejo Pons vs Ponomariov, SuperGM Linares 2002 Rd 5 | `linares_2002.pgn` | Mark Hathaway |

Note on annotator titles: Svidler and Sakaev hold the GM title. Mark Hathaway (Linares annotator) is not confirmed titled — his annotations are prose-heavy and substantive but the `[Annotator]` tag does not include a title prefix. If strict titled-player sourcing is required for Bucket B, consider replacing the two Linares games with additional Sakaev-annotated games from `russian_chess.pgn`.

## Bucket C — Amateur

**Not yet populated.** To populate:
1. Add 3 of your own Lichess games (mix of time controls):
   `curl "https://lichess.org/api/games/user/<your-username>?max=20&rated=true" -H "Accept: application/x-chess-pgn" > my_games.pgn`
2. Add 2 random 1500–1800 rated rapid games from Lichess:
   `curl "https://lichess.org/api/games/user/<any-public-1500-1800-user>?max=5&rated=true&perfType=rapid" -H "Accept: application/x-chess-pgn"`

No reference annotations needed for Bucket C (judged against Stockfish only).

## Bucket D — Adversarial (real games only)

| File | Game | Source | Key pattern |
|------|------|--------|-------------|
| `D_synthetic/colle-ohanlon-1930.pgn` | Colle vs O'Hanlon, Nice 1930 | https://exeterchessclub.org.uk/content/greek-gift ; Wikipedia: https://en.wikipedia.org/wiki/Greek_gift_sacrifice | Greek Gift sacrifice (12.Bxh7+) |
| `D_synthetic/spassky-fischer-1972-g11.pgn` | Spassky vs Fischer, WCC 1972 Game 11 | Wikipedia: https://en.wikipedia.org/wiki/World_Chess_Championship_1972 (Game 11); also https://www.thechesswebsite.com/1972-world-chess-championships-spassky-vs-fischer-game-11/ | Poisoned Pawn (8...Qxb2), Spassky's 14.Nb1!! preparation |
| `D_synthetic/kramnik-kasparov-2000-g4.pgn` | Kramnik vs Kasparov, BrainGames WCh 2000 Game 4 | Lichess study: https://lichess.org/study/EUCOkjcs | Fortress endgame — drawn despite material deficit |
| `D_synthetic/samisch-nimzowitsch-1923.pgn` | Sämisch vs Nimzowitsch, Copenhagen 1923 | Wikipedia: https://en.wikipedia.org/wiki/Immortal_Zugzwang_Game | Zugzwang: 25...h6!! |
| `D_synthetic/levitsky-marshall-1912.pgn` | Levitsky vs Marshall, Breslau 1912 | Wikipedia: https://en.wikipedia.org/wiki/Frank_Marshall_(chess_player) | Quiet best move: 23...Qg3!! (the "gold coins" queen sacrifice) |

Each game has a corresponding `.assertions.json` file specifying must-flag/must-not-flag moves, required concepts, and forbidden claims.
