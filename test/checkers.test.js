import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Q from '../shared/quantum.js';
import C, { makeCode, sqAt as at } from '../shared/games/checkers.js';
import { assertWorldsAreClassicalGames } from './helpers.js';

const BLACK = 0, RED = 1;
function board(entries) {
  const b = new Array(32).fill(0);
  for (const [sq, id, king] of entries) b[sq] = makeCode(id, C.colorOfId(id), king);
  return b;
}
const S = (b, turn = BLACK) => Q.stateFromBoards('checkers', [b], turn);
const mv = (piece, ...alts) => ({ piece, alts });
const apply = (s, m) => {
  const r = Q.applyQuantumMove(s, m);
  assert.ok(r.ok, r.error);
  return r.state;
};
const alive = (s, id) => Q.summarize(s).pieces.get(id)?.alive ?? 0;

test('initial position has 7 legal moves for Black', () => {
  assert.equal(C.moves(C.initialBoard(), BLACK).length, 7);
});

test('split, then the opponent jumps one ghost: that ghost was real', () => {
  const start = board([[13, 1], [0, 2], [21, 13], [31, 14]]);
  let s = apply(S(start), mv(1, '14-17', '14-18'));
  assert.equal(s.worlds.length, 2);
  s = apply(s, mv(13, '22x13'));
  assert.equal(s.worlds.length, 1);
  assert.equal(alive(s, 1), 0, 'B1 was captured');
  assertWorldsAreClassicalGames(s, start, BLACK);
});

test('capturing is optional, so declining a jump collapses nothing', () => {
  const start = board([[13, 1], [0, 2], [20, 13], [31, 14]]);
  let s = apply(S(start), mv(1, '14-17', '14-18'));
  s = apply(s, mv(14, '32-28'));
  assert.equal(s.worlds.length, 2);
  assertWorldsAreClassicalGames(s, start, BLACK);
});

test('moving onto a ghost square proves the ghost is elsewhere', () => {
  const start = board([[13, 1], [0, 2], [20, 13], [31, 14]]);
  let s = apply(S(start), mv(1, '14-17', '14-18'));
  s = apply(s, mv(13, '21-17'));
  assert.equal(s.worlds.length, 1);
  assert.deepEqual([...Q.summarize(s).pieces.get(1).locs.keys()], [17]);
  assertWorldsAreClassicalGames(s, start, BLACK);
});

test('moving every ghost keeps the superposition; moving one ghost collapses it', () => {
  const start = board([[13, 1], [0, 2], [31, 14]]);
  let s = apply(S(start), mv(1, '14-17', '14-18'));
  s = apply(s, mv(14, '32-28'));
  assert.equal(apply(s, mv(1, '17-21', '18-22')).worlds.length, 2);
  assert.equal(apply(s, mv(1, '17-21')).worlds.length, 1);
});

test('no legal move in any world loses', () => {
  const start = board([[13, 1], [17, 13]]);
  const s = apply(S(start), mv(1, '14x23'));
  assert.deepEqual(s.result, { winner: BLACK, reason: 'nomoves' });
});

test('a king can jump in a loop back to its starting square', () => {
  const start = board([[at(2, 3), 1, true], [at(3, 4), 13], [at(5, 4), 14], [at(5, 2), 15], [at(3, 2), 16]]);
  const loop = C.moves(start, BLACK).find((m) => m.path.length === 5);
  assert.ok(loop, 'a 4-capture loop exists');
  assert.equal(loop.path[0], loop.path[4]);
  const s = apply(S(start), mv(1, loop.key));
  assert.equal(alive(s, 13), 0);
  assert.deepEqual(s.result, { winner: BLACK, reason: 'nomoves' });
});

test('a man that is crowned mid-jump stops there', () => {
  const start = board([[at(5, 0), 1], [at(6, 1), 13], [at(6, 3), 14], [at(0, 7), 15]]);
  const moves = C.moves(start, BLACK);
  assert.deepEqual(moves.map((m) => m.path), [[at(5, 0), at(7, 2)]]);
  const b = C.apply(start, moves[0]);
  assert.equal(C.kindOf(b[at(7, 2)]), 1);
});

test('a multi-jump may stop after any hop, and jumping is never forced', () => {
  const start = board([[at(1, 0), 1], [at(2, 1), 13], [at(4, 3), 14], [at(7, 0), 15], [at(0, 7), 2]]);
  const s = S(start);
  const one = apply(s, mv(1, `${at(1, 0) + 1}x${at(3, 2) + 1}`));
  assert.equal(alive(one, 14), 1, 'second red man survives');
  assert.ok(Q.applyQuantumMove(s, mv(1, `${at(1, 0) + 1}x${at(3, 2) + 1}x${at(5, 4) + 1}`)).ok);
  assert.ok(Q.applyQuantumMove(s, mv(2, `${at(0, 7) + 1}-${at(1, 6) + 1}`)).ok, 'quiet move with a jump available');
  const split = apply(s, mv(1, `${at(1, 0) + 1}x${at(3, 2) + 1}`, `${at(1, 0) + 1}x${at(3, 2) + 1}x${at(5, 4) + 1}`));
  assert.equal(split.worlds.length, 2);
});

test('both ghosts moving onto the same square merge the piece back to certain', () => {
  const start = board([[at(2, 3), 1], [at(0, 1), 2], [at(7, 6), 13]]);
  let s = apply(S(start), mv(1, `${at(2, 3) + 1}-${at(3, 2) + 1}`, `${at(2, 3) + 1}-${at(3, 4) + 1}`));
  s = apply(s, mv(13, `${at(7, 6) + 1}-${at(6, 5) + 1}`));
  s = apply(s, mv(1, `${at(3, 2) + 1}-${at(4, 3) + 1}`, `${at(3, 4) + 1}-${at(4, 3) + 1}`));
  assert.equal(s.worlds.length, 1, 'identical worlds are merged');
  assertWorldsAreClassicalGames(s, start, BLACK);
});

test('a piece can be in at most 4 places', () => {
  const start = board([[at(0, 3), 1, true], [at(0, 1), 2], [at(7, 6), 13], [at(7, 4), 14]]);
  const k = (a, b) => `${a + 1}-${b + 1}`;
  let s = apply(S(start), mv(1, k(at(0, 3), at(1, 2)), k(at(0, 3), at(1, 4))));
  s = apply(s, mv(14, k(at(7, 4), at(6, 3))));
  s = apply(s, mv(1, k(at(1, 2), at(2, 1)), k(at(1, 2), at(2, 3)), k(at(1, 4), at(2, 5)), k(at(1, 4), at(0, 5))));
  s = apply(s, mv(13, k(at(7, 6), at(6, 7))));
  const r = Q.applyQuantumMove(s, mv(1, k(at(2, 1), at(3, 0)), k(at(2, 1), at(3, 2)), k(at(2, 3), at(3, 4)), k(at(2, 5), at(3, 6)), k(at(0, 5), at(1, 6))));
  assert.equal(r.ok, false);
  assert.match(r.error, /at most 4 places/);
});

test('three moves from one place is rejected', () => {
  const start = board([[at(2, 3), 1, true], [at(7, 6), 13]]);
  const k = (a, b) => `${a + 1}-${b + 1}`;
  const r = Q.applyQuantumMove(S(start), mv(1, k(at(2, 3), at(1, 2)), k(at(2, 3), at(1, 4)), k(at(2, 3), at(3, 2))));
  assert.equal(r.ok, false);
  assert.match(r.error, /at most two/);
});

test('moving a piece that is captured in some worlds rules those worlds out', () => {
  const start = board([[at(3, 2), 1], [at(0, 1), 2], [at(5, 0), 13], [at(7, 6), 14]]);
  const k = (a, b, j) => `${a + 1}${j ? 'x' : '-'}${b + 1}`;
  let s = apply(S(start), mv(1, k(at(3, 2), at(4, 1)), k(at(3, 2), at(4, 3))));
  s = apply(s, mv(13, k(at(5, 0), at(3, 2), true), k(at(5, 0), at(4, 1))));
  assert.equal(s.worlds.length, 2);
  assert.equal(alive(s, 1), 1);
  s = apply(s, mv(1, k(at(4, 3), at(5, 4))));
  assert.equal(s.worlds.length, 1);
  assertWorldsAreClassicalGames(s, start, BLACK);
});

test('describeChange reports collapses and partial captures', () => {
  const start = board([[13, 1], [0, 2], [20, 13], [31, 14]]);
  const split = apply(S(start), mv(1, '14-17', '14-18'));
  const blocked = apply(split, mv(13, '21-17'));
  assert.deepEqual(Q.describeChange(split, blocked, 13), ['B1 collapses → 18']);
  const both = apply(split, mv(13, '21x14', '21-17'));
  assert.deepEqual(Q.describeChange(split, both, 13), ['B1 might be captured']);
  const r = board([[13, 1], [0, 2], [31, 14]]);
  let t = apply(S(r), mv(1, '14-17', '14-18'));
  t = apply(t, mv(14, '32-28'));
  const m = mv(1, '17-21');
  assert.deepEqual(Q.describeChange(t, apply(t, m), 1, m), ['B1 was not on 18']);
});

test('draw after 40 quiet king moves each in every world', () => {
  let s = S(board([[at(0, 1), 1, true], [at(7, 6), 13, true]]));
  const k = (a, b) => `${a + 1}-${b + 1}`;
  for (let i = 0; i < 20 && !s.result; i++) {
    s = apply(s, mv(1, k(at(0, 1), at(1, 0))));
    s = apply(s, mv(13, k(at(7, 6), at(6, 7))));
    s = apply(s, mv(1, k(at(1, 0), at(0, 1))));
    s = apply(s, mv(13, k(at(6, 7), at(7, 6))));
  }
  assert.deepEqual(s.result, { winner: null, reason: 'quiet' });
  assert.equal(s.ply, 80);
});
