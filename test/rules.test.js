import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../shared/rules.js';

// Every surviving world must be a normal game: from the start position, each
// ply is one legal classical move by the side to move, ending at that board.
function assertWorldsAreClassicalGames(state, startBoard = R.initialBoard(), startTurn = R.BLACK) {
  for (const w of state.worlds) {
    const moves = R.timeline(w);
    assert.equal(moves.length, state.ply, 'history length matches ply count');
    let b = startBoard;
    let turn = startTurn;
    for (const p of moves) {
      const legal = R.classicalMoves(b, turn).some((m) => R.samePath(m, p));
      assert.ok(legal, `illegal classical move ${R.fmtPath(p)} in a world history`);
      b = R.applyClassical(b, p);
      turn = 1 - turn;
    }
    assert.deepEqual(b, w.b, 'replayed history reaches the world board');
  }
}

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

function randomQuantumMove(state, rand) {
  const live = state.worlds.filter((x) => R.classicalMoves(x.b, state.turn).length);
  const w = live[Math.floor(rand() * live.length)];
  const moves = R.classicalMoves(w.b, state.turn);
  const first = moves[Math.floor(rand() * moves.length)];
  const piece = w.b[first[0]] >> 2;
  const paths = [first];
  const sum = R.summarize(state);
  for (const loc of sum.pieces.get(piece).locs.keys()) {
    const cands = R.candidatePaths(state, piece, loc).map((c) => c.path);
    // sometimes move other ghosts too, sometimes split
    if (loc !== first[0] && cands.length && rand() < 0.6) paths.push(cands[Math.floor(rand() * cands.length)]);
    if (loc === first[0] && rand() < 0.35) {
      const other = cands.filter((p) => !R.samePath(p, first));
      if (other.length) paths.push(other[Math.floor(rand() * other.length)]);
    }
  }
  return { piece, paths };
}

test('initial position has 7 legal moves for Black', () => {
  assert.equal(R.classicalMoves(R.initialBoard(), R.BLACK).length, 7);
});

test('fuzz: every surviving world is a legal classical game', () => {
  for (let seed = 1; seed <= 60; seed++) {
    const rand = rng(seed);
    let s = R.initialState();
    for (let i = 0; i < 150 && !s.result; i++) {
      let applied = false;
      for (let tries = 0; tries < 20 && !applied; tries++) {
        const r = R.applyQuantumMove(s, randomQuantumMove(s, rand));
        if (r.ok) {
          s = r.state;
          applied = true;
        }
      }
      if (!applied) {
        // fall back to a plain classical move, which always works
        const w = s.worlds.find((x) => R.classicalMoves(x.b, s.turn).length);
        const p = R.classicalMoves(w.b, s.turn)[0];
        const r = R.applyQuantumMove(s, { piece: w.b[p[0]] >> 2, paths: [p] });
        assert.ok(r.ok, r.error);
        s = r.state;
      }
      assert.ok(s.worlds.length >= 1 && s.worlds.length <= R.MAX_WORLDS);
    }
    assertWorldsAreClassicalGames(s);
    assert.deepEqual(R.replay(s.moves).worlds.map((w) => w.b), s.worlds.map((w) => w.b));
  }
});

// Small custom position: Black man B1 on 13 (row 3), Red attacker, spare pieces far away.
function board(entries) {
  const b = new Array(32).fill(0);
  for (const [sq, id, king] of entries) b[sq] = R.makeCode(id, R.colorOfId(id), king);
  return b;
}

test('split, then the opponent jumps one ghost: that ghost was real', () => {
  const start = board([[13, 1], [0, 2], [21, 13], [31, 14]]);
  let s = R.stateFromBoards([start], R.BLACK);
  let r = R.applyQuantumMove(s, { piece: 1, paths: [[13, 16], [13, 17]] });
  assert.ok(r.ok, r.error);
  s = r.state;
  assert.equal(s.worlds.length, 2);

  r = R.applyQuantumMove(s, { piece: 13, paths: [[21, 12]] });
  assert.ok(r.ok, r.error);
  assert.equal(r.state.worlds.length, 1);
  assert.equal(R.summarize(r.state).pieces.get(1).alive, 0, 'B1 was captured');
  assertWorldsAreClassicalGames(r.state, start, R.BLACK);
});

test('capturing is optional, so declining a jump collapses nothing', () => {
  const start = board([[13, 1], [0, 2], [20, 13], [31, 14]]);
  let s = R.stateFromBoards([start], R.BLACK);
  s = R.applyQuantumMove(s, { piece: 1, paths: [[13, 16], [13, 17]] }).state;
  // Red could jump B1 in the world where it's on 16, but doesn't have to.
  const r = R.applyQuantumMove(s, { piece: 14, paths: [[31, 27]] });
  assert.ok(r.ok, r.error);
  assert.equal(r.state.worlds.length, 2);
  assertWorldsAreClassicalGames(r.state, start, R.BLACK);
});

test('moving onto a ghost square proves the ghost is elsewhere', () => {
  // B1 splits to 16 | 17; Red's man on 20 steps onto 16, so B1 must be on 17.
  const start = board([[13, 1], [0, 2], [20, 13], [31, 14]]);
  let s = R.stateFromBoards([start], R.BLACK);
  s = R.applyQuantumMove(s, { piece: 1, paths: [[13, 16], [13, 17]] }).state;
  const r = R.applyQuantumMove(s, { piece: 13, paths: [[20, 16]] });
  assert.ok(r.ok, r.error);
  assert.equal(r.state.worlds.length, 1);
  assert.deepEqual([...R.summarize(r.state).pieces.get(1).locs.keys()], [17]);
  assertWorldsAreClassicalGames(r.state, start, R.BLACK);
});

test('moving every ghost keeps the superposition; moving one ghost collapses it', () => {
  const start = board([[13, 1], [0, 2], [31, 14]]);
  let s = R.stateFromBoards([start], R.BLACK);
  s = R.applyQuantumMove(s, { piece: 1, paths: [[13, 16], [13, 17]] }).state;
  s = R.applyQuantumMove(s, { piece: 14, paths: [[31, 27]] }).state;
  const both = R.applyQuantumMove(s, { piece: 1, paths: [[16, 20], [17, 21]] });
  assert.ok(both.ok, both.error);
  assert.equal(both.state.worlds.length, 2);
  const one = R.applyQuantumMove(s, { piece: 1, paths: [[16, 20]] });
  assert.ok(one.ok, one.error);
  assert.equal(one.state.worlds.length, 1);
});

test('no legal move in any world loses', () => {
  // Red's only piece is jumped.
  const start = board([[13, 1], [17, 13]]);
  const r = R.applyQuantumMove(R.stateFromBoards([start]), { piece: 1, paths: [[13, 22]] });
  assert.ok(r.ok, r.error);
  assert.deepEqual(r.state.result, { winner: R.BLACK, reason: 'nomoves' });
});

const at = (r, c) => R.sqAt(r, c);

test('a king can jump in a loop back to its starting square', () => {
  const start = board([[at(2, 3), 1, true], [at(3, 4), 13], [at(5, 4), 14], [at(5, 2), 15], [at(3, 2), 16]]);
  const loop = R.classicalMoves(start, R.BLACK).find((p) => p.length === 5);
  assert.ok(loop, 'a 4-capture loop exists');
  assert.equal(loop[0], loop[4]);
  const r = R.applyQuantumMove(R.stateFromBoards([start]), { piece: 1, paths: [loop] });
  assert.ok(r.ok, r.error);
  assert.equal(R.summarize(r.state).pieces.get(13).alive, 0);
  assert.deepEqual(r.state.result, { winner: R.BLACK, reason: 'nomoves' });
});

test('a man that is crowned mid-jump stops there', () => {
  // Black man jumps onto the back row; another jump would be available to a king.
  const start = board([[at(5, 0), 1], [at(6, 1), 13], [at(6, 3), 14], [at(0, 7), 15]]);
  const moves = R.classicalMoves(start, R.BLACK);
  assert.deepEqual(moves, [[at(5, 0), at(7, 2)]]);
  const b = R.applyClassical(start, moves[0]);
  assert.equal(R.isKing(b[at(7, 2)]), 1);
});

test('a multi-jump may stop after any hop, and jumping is never forced', () => {
  const start = board([[at(1, 0), 1], [at(2, 1), 13], [at(4, 3), 14], [at(7, 0), 15], [at(0, 7), 2]]);
  const s = R.stateFromBoards([start]);
  const one = R.applyQuantumMove(s, { piece: 1, paths: [[at(1, 0), at(3, 2)]] });
  assert.ok(one.ok, one.error);
  assert.equal(R.summarize(one.state).pieces.get(14).alive, 1, 'second red man survives');
  assert.ok(R.applyQuantumMove(s, { piece: 1, paths: [[at(1, 0), at(3, 2), at(5, 4)]] }).ok);
  assert.ok(R.applyQuantumMove(s, { piece: 2, paths: [[at(0, 7), at(1, 6)]] }).ok, 'quiet move with a jump available');
  // A split into "stop" and "continue" is two different worlds.
  const split = R.applyQuantumMove(s, { piece: 1, paths: [[at(1, 0), at(3, 2)], [at(1, 0), at(3, 2), at(5, 4)]] });
  assert.ok(split.ok, split.error);
  assert.equal(split.state.worlds.length, 2);
});

test('both ghosts moving onto the same square merge the piece back to certain', () => {
  const start = board([[at(2, 3), 1], [at(0, 1), 2], [at(7, 6), 13]]);
  let s = R.stateFromBoards([start]);
  s = R.applyQuantumMove(s, { piece: 1, paths: [[at(2, 3), at(3, 2)], [at(2, 3), at(3, 4)]] }).state;
  s = R.applyQuantumMove(s, { piece: 13, paths: [[at(7, 6), at(6, 5)]] }).state;
  const r = R.applyQuantumMove(s, { piece: 1, paths: [[at(3, 2), at(4, 3)], [at(3, 4), at(4, 3)]] });
  assert.ok(r.ok, r.error);
  assert.equal(r.state.worlds.length, 1, 'identical worlds are merged');
  assertWorldsAreClassicalGames(r.state, start, R.BLACK);
});

test('a piece can be in at most 4 places', () => {
  const start = board([[at(0, 3), 1, true], [at(0, 1), 2], [at(7, 6), 13], [at(7, 4), 14]]);
  let s = R.stateFromBoards([start]);
  const redMoves = [[14, [at(7, 4), at(6, 3)]], [13, [at(7, 6), at(6, 7)]], [14, [at(6, 3), at(5, 2)]]];
  s = R.applyQuantumMove(s, { piece: 1, paths: [[at(0, 3), at(1, 2)], [at(0, 3), at(1, 4)]] }).state;
  s = R.applyQuantumMove(s, { piece: redMoves[0][0], paths: [redMoves[0][1]] }).state;
  // Split both ghosts: 4 places is fine.
  let r = R.applyQuantumMove(s, {
    piece: 1,
    paths: [[at(1, 2), at(2, 1)], [at(1, 2), at(2, 3)], [at(1, 4), at(2, 5)], [at(1, 4), at(0, 5)]],
  });
  assert.ok(r.ok, r.error);
  s = R.applyQuantumMove(r.state, { piece: redMoves[1][0], paths: [redMoves[1][1]] }).state;
  // Splitting one of them again would make 5.
  r = R.applyQuantumMove(s, {
    piece: 1,
    paths: [[at(2, 1), at(3, 0)], [at(2, 1), at(3, 2)], [at(2, 3), at(3, 4)], [at(2, 5), at(3, 6)], [at(0, 5), at(1, 6)]],
  });
  assert.equal(r.ok, false);
  assert.match(r.error, /at most 4 places/);
});

test('moving a piece that is captured in some worlds rules those worlds out', () => {
  // Black B1 splits; in one world Red captures it. Then Black moves B1: the capture world dies.
  const start = board([[at(3, 2), 1], [at(0, 1), 2], [at(5, 0), 13], [at(7, 6), 14]]);
  let s = R.stateFromBoards([start]);
  s = R.applyQuantumMove(s, { piece: 1, paths: [[at(3, 2), at(4, 1)], [at(3, 2), at(4, 3)]] }).state;
  // World A (B1 on 4,1): Red must jump it. World B: Red plays a quiet move. Both are possible,
  // so a split by Red's 5,0 man covers both worlds: jump in A, step in B.
  const r1 = R.applyQuantumMove(s, { piece: 13, paths: [[at(5, 0), at(3, 2)], [at(5, 0), at(4, 1)]] });
  assert.ok(r1.ok, r1.error);
  assert.equal(r1.state.worlds.length, 2);
  assert.equal(R.summarize(r1.state).pieces.get(1).alive, 1);
  const r2 = R.applyQuantumMove(r1.state, { piece: 1, paths: [[at(4, 3), at(5, 4)]] });
  assert.ok(r2.ok, r2.error);
  assert.equal(r2.state.worlds.length, 1);
  assertWorldsAreClassicalGames(r2.state, start, R.BLACK);
});

test('describeChange reports collapses and partial captures', () => {
  const start = board([[13, 1], [0, 2], [20, 13], [31, 14]]);
  let s = R.stateFromBoards([start], R.BLACK);
  const split = R.applyQuantumMove(s, { piece: 1, paths: [[13, 16], [13, 17]] }).state;
  const blocked = R.applyQuantumMove(split, { piece: 13, paths: [[20, 16]] }).state;
  assert.deepEqual(R.describeChange(split, blocked, 13), ['B1 collapses → 18']);
  // Red's 20 man splits: jump B1 (if it's on 16) or step to 16 (if it isn't). B1 is then captured in 1 world.
  const both = R.applyQuantumMove(split, { piece: 13, paths: [[20, 13], [20, 16]] }).state;
  assert.deepEqual(R.describeChange(split, both, 13), ['B1 captured in 1 of 2 worlds']);
  // Moving only one ghost of B1 rules out the other.
  const r = board([[13, 1], [0, 2], [31, 14]]);
  let t = R.stateFromBoards([r], R.BLACK);
  t = R.applyQuantumMove(t, { piece: 1, paths: [[13, 16], [13, 17]] }).state;
  t = R.applyQuantumMove(t, { piece: 14, paths: [[31, 27]] }).state;
  const mv = { piece: 1, paths: [[16, 20]] };
  const after = R.applyQuantumMove(t, mv).state;
  assert.deepEqual(R.describeChange(t, after, 1, mv), ['B1 was not on 18']);
});

test('malformed and out-of-turn moves are rejected', () => {
  const s = R.initialState();
  assert.equal(R.applyQuantumMove(s, null).ok, false);
  assert.equal(R.applyQuantumMove(s, { piece: 99, paths: [[8, 12]] }).ok, false);
  assert.equal(R.applyQuantumMove(s, { piece: 13, paths: [[20, 16]] }).ok, false);
  assert.equal(R.applyQuantumMove(s, { piece: 9, paths: [[8, 12], [8, 12]] }).ok, false);
  assert.equal(R.applyQuantumMove(s, { piece: 9, paths: [[8, 'x']] }).ok, false);
});
