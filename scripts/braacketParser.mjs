// Best-effort parser for braacket.com tournament "match" table pages
// (the `?mode=table` embed used in data/tournaments.csv).
//
// NOTE: this sandbox has no network access to braacket.com, so the
// selectors below are based on braacket's documented embed markup rather
// than a live page capture. If braacket's markup differs, adjust the
// selectors here - the rest of the ranking pipeline (lib/glicko2.mjs,
// lib/ranking-engine.mjs) is independent of this parsing logic and is
// covered by its own tests.
import * as cheerio from 'cheerio';

const SCORE_PATTERN = /(\d+)\s*[-:]\s*(\d+)/;

/**
 * Parses a braacket match-table HTML page into an ordered list of matches.
 *
 * @param {string} html
 * @returns {Array<{player1:string, player2:string, score1:number, score2:number}>}
 */
export function parseBraacketMatches(html) {
  const $ = cheerio.load(html);
  const matches = [];

  $('table tbody tr, table.table tr').each((_, row) => {
    const $row = $(row);
    const cells = $row.find('td');
    if (cells.length === 0) return;

    const participants = [];
    cells.each((__, cell) => {
      const $cell = $(cell);
      const link = $cell.find('a').first();
      const text = (link.text() || $cell.text() || '').trim();
      if ($cell.attr('class')?.includes('participant') || link.length > 0) {
        if (text) participants.push(text);
      }
    });

    let score1;
    let score2;
    cells.each((__, cell) => {
      const text = $(cell).text().trim();
      const match = SCORE_PATTERN.exec(text);
      if (match) {
        score1 = Number(match[1]);
        score2 = Number(match[2]);
      }
    });

    if (participants.length >= 2 && score1 !== undefined && score2 !== undefined) {
      matches.push({
        player1: participants[0],
        player2: participants[1],
        score1,
        score2,
      });
    }
  });

  return matches;
}
