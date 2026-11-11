import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Q from '../shared/quantum.js';
import { GAME_IDS, gameOf } from '../shared/games/index.js';
import { assertWorldsAreClassicalGames, randomGame } from './helpers.js';

for (const id of GAME_IDS) {
  test(`${id} fuzz: every surviving world is a legal classical game and replay matches`, () => {
    const seeds = id === 'chess' ? 12 : 40;
    const plies = id === 'chess' ? 60 : 150;
    let biggest = 0;
    for (let seed = 1; seed <= seeds; seed++) {
      const { state, maxWorlds } = randomGame(id, seed, plies);
      biggest = Math.max(biggest, maxWorlds);
      assertWorldsAreClassicalGames(state);
      const again = Q.replay(id, state.moves);
      const g = gameOf(id);
      assert.deepEqual(again.worlds.map((w) => g.boardKey(w.b)), state.worlds.map((w) => g.boardKey(w.b)));
      assert.deepEqual(again.result, state.result);
    }
    assert.ok(biggest > 1, 'the fuzz actually created superposition');
  });

  test(`${id}: malformed and out-of-turn moves are rejected`, () => {
    const s = Q.initialState(id);
    assert.equal(Q.applyQuantumMove(s, null).ok, false);
    assert.equal(Q.applyQuantumMove(s, { piece: 99, alts: ['a1a2'] }).ok, false);
    assert.equal(Q.applyQuantumMove(s, { piece: 1, alts: [] }).ok, false);
    assert.equal(Q.applyQuantumMove(s, { piece: 1, alts: ['x', 'x'] }).ok, false);
    assert.equal(Q.applyQuantumMove(s, { piece: 1, alts: [5] }).ok, false);
    assert.equal(Q.applyQuantumMove(s, { piece: 1, alts: ['<script>'] }).ok, false);
    // The other side's piece (or a move that exists nowhere) is impossible in every world.
    const g = gameOf(id);
    const theirs = g.moves(s.worlds[0].b, 1)[0];
    if (theirs) assert.equal(Q.applyQuantumMove(s, { piece: theirs.piece, alts: [theirs.key] }).ok, false);
  });

  test(`${id}: the world cap is enforced`, () => {
    let s = Q.initialState(id);
    // Keep splitting until the engine refuses; it must refuse before exceeding the cap.
    for (let i = 0; i < 40 && !s.result; i++) {
      const all = Q.allCandidates(s);
      let split = null;
      for (const [piece, byOrigin] of all) {
        for (const [, list] of byOrigin) {
          const keys = list.map((c) => c.key).filter((k) => !gameOf(id).isPass(k));
          if (keys.length >= 2) split = { piece, alts: keys.slice(0, 2) };
        }
      }
      if (!split) break;
      const r = Q.applyQuantumMove(s, split);
      if (!r.ok) {
        assert.match(r.error, /Too much superposition|at most 4 places/);
        break;
      }
      s = r.state;
      assert.ok(s.worlds.length <= Q.MAX_WORLDS);
    }
  });
}

test('fmtMove groups alternatives by origin', () => {
  assert.equal(Q.fmtMove('checkers', { piece: 10, alts: ['10-14', '10-15'] }), 'B10 10-14 | 10-15');
  assert.equal(Q.fmtMove('chess', { piece: 7, alts: ['g1f3', 'g1h3'] }), '♘g1 g1-f3 | g1-h3');
  assert.equal(Q.fmtMove('chess', { piece: 13, alts: ['e7e8q'] }), '♙e2 e7-e8=Q');
  assert.equal(Q.fmtMove('reversi', { piece: 0, alts: ['d3', 'pass'] }), 'd3 & pass');
});
