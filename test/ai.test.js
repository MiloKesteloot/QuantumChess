import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../shared/rules.js';
import { chooseMove, generateMoves, evaluate } from '../shared/ai.js';

function board(entries) {
  const b = new Array(32).fill(0);
  for (const [sq, id, king] of entries) b[sq] = R.makeCode(id, R.colorOfId(id), king);
  return b;
}
const at = (r, c) => R.sqAt(r, c);
const seeded = (seed) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);

test('the move list includes normal moves and splits from the start position', () => {
  const moves = generateMoves(R.initialState());
  assert.ok(moves.some((m) => m.paths.length === 1));
  assert.ok(moves.some((m) => m.paths.length === 2));
});

test('every level returns a legal move', () => {
  for (const level of ['easy', 'medium', 'hard']) {
    const s = R.initialState();
    const m = chooseMove(s, level, seeded(1));
    assert.ok(R.applyQuantumMove(s, m).ok, level);
  }
});

test('medium takes a free piece', () => {
  // Black can jump Red's lone man; nothing can recapture.
  const start = board([[at(2, 1), 1], [at(3, 2), 13], [at(7, 6), 14], [at(0, 7), 2]]);
  const m = chooseMove(R.stateFromBoards([start]), 'medium', seeded(2));
  assert.deepEqual(m.paths, [[at(2, 1), at(4, 3)]]);
});

test('medium finds a win in one', () => {
  const start = board([[at(2, 1), 1], [at(3, 2), 13], [at(0, 7), 2]]);
  const s = R.stateFromBoards([start]);
  const m = chooseMove(s, 'medium', seeded(3));
  assert.equal(R.applyQuantumMove(s, m).state.result?.winner, R.BLACK);
});

test('medium does not hang a piece for nothing', () => {
  // Black man on (3,2) could step to (4,3) where Red's (5,4) man would jump it.
  const start = board([[at(3, 2), 1], [at(0, 1), 2], [at(5, 4), 13], [at(6, 7), 14]]);
  const s = R.stateFromBoards([start]);
  const m = chooseMove(s, 'medium', seeded(4));
  const after = R.applyQuantumMove(s, m).state;
  // Whatever it plays, Red should not be able to win material immediately in every world.
  const replies = generateMoves(after);
  const worst = Math.min(...replies.map((r) => {
    const st = R.applyQuantumMove(after, r);
    return st.ok ? evaluate(st.state, R.BLACK) : Infinity;
  }));
  assert.ok(worst > evaluate(s, R.BLACK) - 60, `AI move ${R.fmtMove(m)} loses material`);
});

test('AI vs AI games finish with valid timelines and stay fast', () => {
  for (const [seed, level] of [[11, 'easy'], [12, 'easy'], [13, 'medium']]) {
    const rand = seeded(seed);
    let s = R.initialState();
    const t0 = Date.now();
    let slowest = 0;
    for (let i = 0; i < 120 && !s.result; i++) {
      const t = Date.now();
      const m = chooseMove(s, level, rand);
      slowest = Math.max(slowest, Date.now() - t);
      const r = R.applyQuantumMove(s, m);
      assert.ok(r.ok, r.error);
      s = r.state;
    }
    // Every surviving world replays as a legal classical game.
    for (const w of s.worlds) {
      let b = R.initialBoard();
      let turn = R.BLACK;
      for (const p of R.timeline(w)) {
        assert.ok(R.classicalMoves(b, turn).some((x) => R.samePath(x, p)));
        b = R.applyClassical(b, p);
        turn = 1 - turn;
      }
      assert.deepEqual(b, w.b);
    }
    assert.ok(slowest < 4000, `${level} took ${slowest}ms on one move`);
    console.log(`  ${level} seed ${seed}: ${s.ply} plies, result ${JSON.stringify(s.result)}, max worlds seen ok, slowest move ${slowest}ms, total ${Date.now() - t0}ms`);
  }
});
