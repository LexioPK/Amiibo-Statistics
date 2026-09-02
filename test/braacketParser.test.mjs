import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBraacketMatches } from '../scripts/braacketParser.mjs';

// This fixture mirrors the general shape of a braacket match-table embed:
// one row per completed set, with participant links and a "X - Y" score
// cell. Live markup may differ slightly (see scripts/braacketParser.mjs).
const FIXTURE_HTML = `
<html><body>
<table class="table">
  <tbody>
    <tr>
      <td class="participant"><a href="/p/1">Ganondorf</a></td>
      <td>2 - 0</td>
      <td class="participant"><a href="/p/2">Zelda</a></td>
    </tr>
    <tr>
      <td class="participant"><a href="/p/3">Incineroar</a></td>
      <td>2 - 1</td>
      <td class="participant"><a href="/p/1">Ganondorf</a></td>
    </tr>
  </tbody>
</table>
</body></html>
`;

test('parses individual set results with player names and scores from a match table', () => {
  const matches = parseBraacketMatches(FIXTURE_HTML);
  assert.equal(matches.length, 2);
  assert.deepEqual(matches[0], { player1: 'Ganondorf', player2: 'Zelda', score1: 2, score2: 0 });
  assert.deepEqual(matches[1], { player1: 'Incineroar', player2: 'Ganondorf', score1: 2, score2: 1 });
});

test('returns an empty list for a page with no recognizable match rows', () => {
  const matches = parseBraacketMatches('<html><body><p>No matches here</p></body></html>');
  assert.deepEqual(matches, []);
});
