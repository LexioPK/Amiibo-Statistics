// API route serving the auto-generated Glicko-2 ranking system, which
// replaces the old final-placement "season" leaderboard as the source of
// truth for a season's standings. The underlying data is produced by
// `npm run generate` (scripts/generate.mjs), which fetches and parses
// individual tournament matches and computes Glicko-2 rating/RD per player.
import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function GET(req, { params }) {
    const season = params.season;
    const rankingsPath = path.join(process.cwd(), 'data', 'rankings', `season-${season}.json`);

    if (!fs.existsSync(rankingsPath)) {
        return NextResponse.json(
            {
                message: `No Glicko-2 ranking data available for season ${season} yet. Run "npm run generate" after adding a match_url for this season in data/tournaments.csv.`,
            },
            { status: 404 },
        );
    }

    const data = JSON.parse(fs.readFileSync(rankingsPath, 'utf8'));
    return NextResponse.json(data);
}
