# Amiibo-Statistics
It's a way to take data from braacket and have it compare more statistics

## Glicko-2 ranking system

The old final-placement "season" leaderboard is being replaced by an
auto-updating [Glicko-2](http://www.glicko.net/glicko/glicko2.pdf) rating
system, computed from individual tournament matches rather than final
standings:

- Every new competitor starts at rating 1500 with high uncertainty
  (RD 350), and RD drops as they play more matches.
- Beating a higher-rated opponent gains more rating than beating a
  lower-rated one, and vice versa for losses.
- Match score counts: a 2-0 sweep moves ratings more than a 2-1 win over
  the same opponent, since each individual game is its own observation.
- Players who join in a later season start fresh at that point; they are
  never penalized for tournaments held before they competed, and only
  appear in the leaderboard for seasons they actually played in.
- A player who stops competing has their RD grow (more uncertain) over
  time instead of having their rating punished directly.
- Final rank is by rating first, RD as a tiebreaker for close ratings.

### Generating rankings

```
npm install
npm run generate
```

This reads `data/tournaments.csv`, fetches each listed `match_url` from
braacket, parses the individual set results, and writes:

- `data/rankings/season-<season>.json` — that season's leaderboard
  (only players who competed that season).
- `data/rankings/latest.json` — current overall ratings for every player.
- `data/rankings/manifest.json` — which seasons produced rankings, and why
  any others were skipped.

Seasons in `data/tournaments.csv` without a `match_url` are skipped rather
than approximated from final standings, since fabricating pairwise results
from a placement list would mean inventing matches that never happened.
Add a `match_url` for a season once individual match data is available and
re-run `npm run generate`.

### Tests

```
npm test
```

Runs the Node.js built-in test runner over `test/*.test.mjs`, covering the
Glicko-2 math, the season-by-season ranking engine, and the braacket match
page parser.

