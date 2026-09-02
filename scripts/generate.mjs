// Generates the auto-updating Glicko-2 ranking data that replaces the old
// final-placement "season" leaderboard.
//
// For every tournament listed in data/tournaments.csv that has a
// `match_url`, this fetches the braacket match page, parses the individual
// set results, and feeds them into the Glicko-2 ranking engine in
// chronological (season, then row order) sequence. Output is written to
// data/rankings/season-<season>.json (one per season that has real match
// data) and data/rankings/latest.json (current overall ratings).
//
// Seasons in data/tournaments.csv without a match_url are skipped rather
// than approximated from final placement: the whole point of this system is
// to rate individual matches, and fabricating pairwise results from a
// standings list would mean inventing results that never happened. Add a
// match_url for a season once one is available and re-run `npm run
// generate` to fold it into the ratings.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsv } from './csv.mjs';
import { parseBraacketMatches } from './braacketParser.mjs';
import { runRankingEngine } from '../lib/ranking-engine.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const TOURNAMENTS_CSV = path.join(ROOT, 'data', 'tournaments.csv');
const OUTPUT_DIR = path.join(ROOT, 'data', 'rankings');

async function fetchMatches(matchUrl) {
  const response = await fetch(matchUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${matchUrl}: ${response.status} ${response.statusText}`);
  }
  const html = await response.text();
  return parseBraacketMatches(html);
}

export async function generateRankings({ tournamentsCsvPath = TOURNAMENTS_CSV, outputDir = OUTPUT_DIR } = {}) {
  const csvText = fs.readFileSync(tournamentsCsvPath, 'utf8');
  const rows = parseCsv(csvText);

  const skipped = [];
  const periods = [];

  for (const row of rows) {
    const season = row.season;
    const matchUrl = row.match_url?.trim();
    if (!matchUrl) {
      skipped.push({ season, tournament: row.tournament_name, reason: 'no match_url provided' });
      continue;
    }
    try {
      // eslint-disable-next-line no-await-in-loop
      const matches = await fetchMatches(matchUrl);
      if (matches.length === 0) {
        skipped.push({ season, tournament: row.tournament_name, reason: 'no matches parsed from page' });
        continue;
      }
      periods.push({ season, tournament: row.tournament_name, matches });
    } catch (err) {
      skipped.push({ season, tournament: row.tournament_name, reason: err.message });
    }
  }

  // Ensure chronological processing: group by season (in the order seasons
  // first appear), preserving each tournament's original row order within a
  // season.
  periods.sort((a, b) => Number(a.season) - Number(b.season));

  const { seasonSnapshots, finalRatings } = runRankingEngine(periods);

  fs.mkdirSync(outputDir, { recursive: true });

  for (const [season, rows2] of seasonSnapshots) {
    const outPath = path.join(outputDir, `season-${season}.json`);
    fs.writeFileSync(outPath, JSON.stringify({ season, rankings: rows2 }, null, 2));
  }

  fs.writeFileSync(
    path.join(outputDir, 'latest.json'),
    JSON.stringify({ generatedAt: new Date().toISOString(), rankings: finalRatings }, null, 2),
  );

  fs.writeFileSync(
    path.join(outputDir, 'manifest.json'),
    JSON.stringify(
      {
        seasonsWithRankings: [...seasonSnapshots.keys()],
        skipped,
      },
      null,
      2,
    ),
  );

  return { seasonSnapshots, finalRatings, skipped };
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  generateRankings()
    .then(({ seasonSnapshots, skipped }) => {
      console.log(`Generated Glicko-2 rankings for seasons: ${[...seasonSnapshots.keys()].join(', ') || 'none'}`);
      if (skipped.length > 0) {
        console.log('Skipped (no usable match data):');
        for (const s of skipped) console.log(`  - Season ${s.season} (${s.tournament}): ${s.reason}`);
      }
    })
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    });
}
