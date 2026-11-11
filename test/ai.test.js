import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Q from '../shared/quantum.js';
import { GAME_IDS, gameOf } from '../shared/games/index.js';
import C, { makeCode, sqAt as at } from '../shared/games/checkers.js';
import { chooseMove, generateMoves, evaluate } from '../shared/ai.js';
import { assertWorldsAreClassicalGames, fen, reversiBoard } from './helpers.js';

const BLACK = 0;
function board(entries) {
  const b = new Array(32).fill(0);
  for (const [sq, id, king] of entries) b[sq] = makeCode(id, C.colorOfId(id), king);
  return b;
}
const seeded = (seed) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);

for (const id of GAME_IDS) {
  test(`${id}: every level returns a legal move from the start`, () => {
    for (const level of ['easy', 'medium', 'hard']) {
      const s = Q.initialState(id);
      const m = chooseMove(s, level, seeded(1));
      assert.ok(Q.applyQuantumMove(s, m).ok, `${id} ${level}: ${JSON.stringify(m)}`);
    }
  });

  test(`${id}: AI vs AI games finish with valid timelines and stay fast`, () => {
    const level = id === 'chess' ? 'easy' : 'medium';
    const rand = seeded(7);
    let s = Q.initialState(id);
    const t0 = Date.now();
    let slowest = 0;
    let splits = 0;
    for (let i = 0; i < (id === 'chess' ? 60 : 140) && !s.result; i++) {
      const t = Date.now();
      const m = chooseMove(s, level, rand);
      slowest = Math.max(slowest, Date.now() - t);
      if (m.alts.length > 1) splits++;
      const r = Q.applyQuantumMove(s, m);
      assert.ok(r.ok, r.error);
      s = r.state;
    }
    assertWorldsAreClassicalGames(s);
    assert.ok(slowest < 4000, `${id} ${level} took ${slowest}ms on one move`);
    console.log(`  ${id} ${level}: ${s.ply} plies, ${splits} splits, result ${JSON.stringify(s.result)}, worlds ${s.worlds.length}, slowest ${slowest}ms, total ${Date.now() - t0}ms`);
  });
}

test('checkers: the move list includes normal moves, and expand adds splits', () => {
  const moves = generateMoves(Q.initialState('checkers'));
  assert.ok(moves.every((m) => m.alts.length === 1));
  const m = chooseMove(Q.initialState('checkers'), 'easy', seeded(3));
  assert.ok(m.alts.length >= 1);
});

test('checkers medium takes a free piece', () => {
  const start = board([[at(2, 1), 1], [at(3, 2), 13], [at(7, 6), 14], [at(0, 7), 2]]);
  const m = chooseMove(Q.stateFromBoards('checkers', [start]), 'medium', seeded(2));
  assert.deepEqual(m, { piece: 1, alts: [`${at(2, 1) + 1}x${at(4, 3) + 1}`] });
});

test('checkers medium finds a win in one', () => {
  const start = board([[at(2, 1), 1], [at(3, 2), 13], [at(0, 7), 2]]);
  const s = Q.stateFromBoards('checkers', [start]);
  const m = chooseMove(s, 'medium', seeded(3));
  assert.equal(Q.applyQuantumMove(s, m).state.result?.winner, BLACK);
});

test('checkers medium does not hang a piece for nothing', () => {
  const start = board([[at(3, 2), 1], [at(0, 1), 2], [at(5, 4), 13], [at(6, 7), 14]]);
  const s = Q.stateFromBoards('checkers', [start]);
  const m = chooseMove(s, 'medium', seeded(4));
  const after = Q.applyQuantumMove(s, m).state;
  const replies = generateMoves(after);
  const worst = Math.min(...replies.map((r) => {
    const st = Q.applyQuantumMove(after, r);
    return st.ok ? evaluate(st.state, BLACK) : Infinity;
  }));
  assert.ok(worst > evaluate(s, BLACK) - 60, `AI move ${Q.fmtMove('checkers', m)} loses material`);
});

test('chess medium plays mate in one', () => {
  const { board: b } = fen('6k1/5ppp/8/8/8/8/8/R5K1 w - -');
  const s = Q.stateFromBoards('chess', [b], 0);
  const m = chooseMove(s, 'medium', seeded(5));
  assert.equal(Q.applyQuantumMove(s, m).state.result?.reason, 'checkmate', Q.fmtMove('chess', m));
});

test('chess medium takes a hanging queen', () => {
  const { board: b } = fen('4k3/8/8/3q4/8/8/8/3RK3 w - -');
  const s = Q.stateFromBoards('chess', [b], 0);
  const m = chooseMove(s, 'medium', seeded(6));
  assert.deepEqual(m.alts, ['d1d5'], Q.fmtMove('chess', m));
});

test('reversi medium grabs a corner', () => {
  // Black to move can take a1 (flipping b2 and c3 via d4), or various worse squares.
  const b = reversiBoard(['........', '........', '........', '...xo...', '...x....', '..o.o...', '.o......', '........']);
  const s = Q.stateFromBoards('reversi', [b], 0);
  const g = gameOf('reversi');
  assert.ok(g.moves(b, 0).some((m) => m.key === 'a1'));
  assert.ok(g.moves(b, 0).length > 1);
  const m = chooseMove(s, 'medium', seeded(8));
  assert.deepEqual(m.alts, ['a1'], Q.fmtMove('reversi', m));
});
