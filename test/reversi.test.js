import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Q from '../shared/quantum.js';
import RV, { sqOf, count } from '../shared/games/reversi.js';
import { assertWorldsAreClassicalGames, reversiBoard as board } from './helpers.js';

const BLACK = 0, WHITE = 1;
const mv = (...alts) => ({ piece: 0, alts });
const apply = (s, m) => {
  const r = Q.applyQuantumMove(s, m);
  assert.ok(r.ok, r.error);
  return r.state;
};

test('the opening has four moves for Black, each flipping one disc', () => {
  const ms = RV.moves(RV.initialBoard(), BLACK);
  assert.deepEqual(ms.map((m) => m.key).sort(), ['c4', 'd3', 'e6', 'f5']);
  assert.ok(ms.every((m) => m.flips.length === 1));
  const b = RV.apply(RV.initialBoard(), ms.find((m) => m.key === 'd3'));
  assert.deepEqual(count(b), [4, 1]);
});

test('placing flips in every direction', () => {
  const b = board(['........', '........', '..ooo...', '..o.o...', '..ooo...', '........', '........', '........']);
  // Surround the hole with white; black discs beyond each white one make all 8 lines flip.
  const ring = board(['........', '.xxxxx..', '.xooox..', '.xo.ox..', '.xooox..', '.xxxxx..', '........', '........']);
  void b;
  const m = RV.moves(ring, BLACK).find((x) => x.key === 'd5');
  assert.ok(m);
  assert.equal(m.flips.length, 8);
  assert.deepEqual(count(RV.apply(ring, m)), [25, 0]);
});

test('you must pass when you cannot move but your opponent can; nobody moving ends the game', () => {
  const b = board(['........', '........', '..ooo...', '..oxo...', '..ooo...', '........', '........', '........']);
  assert.deepEqual(RV.moves(b, WHITE).map((m) => m.key), ['pass']);
  assert.ok(RV.moves(b, BLACK).length > 0);
  const full = board(['xxxxxxxx', 'xxxxxxxx', 'xxxxxxxx', 'xxxxxxxx', 'oooooooo', 'oooooooo', 'oooooooo', 'oooooooo']);
  assert.deepEqual(RV.moves(full, WHITE), []);
  assert.deepEqual(RV.moves(full, BLACK), []);
  // One empty corner that flips nothing for anyone is also the end.
  const corner = board(['.ooooooo', 'ooxooooo', 'oooooooo', 'oooooooo', 'oooooooo', 'oooooooo', 'oooooooo', 'oooooooo']);
  assert.deepEqual(RV.moves(corner, WHITE), []);
  assert.deepEqual(RV.moves(corner, BLACK), []);
});

test('a split placement makes two worlds with different flips', () => {
  const s = apply(Q.initialState('reversi'), mv('d3', 'f5'));
  assert.equal(s.worlds.length, 2);
  const sum = Q.summarize(s);
  assert.equal(sum.pieces.get(sqOf('d3') + 1).alive, 1);
  assert.equal(sum.pieces.get(sqOf('f5') + 1).alive, 1);
  assert.deepEqual(sum.pieces.get(sqOf('d4') + 1).colors, [1, 1], 'd4 is black in one world and white in the other');
  assertWorldsAreClassicalGames(s);
});

test('placing where the move flips nothing in some worlds rules those worlds out', () => {
  let s = apply(Q.initialState('reversi'), mv('d3', 'f5'));
  // White c3 outflanks d4 only in the world where d4 became black (black played d3).
  s = apply(s, mv('c3'));
  assert.equal(s.worlds.length, 1);
  assert.equal(Q.summarize(s).pieces.get(sqOf('d3') + 1).alive, 1, 'the d3 world survived');
  assertWorldsAreClassicalGames(s);
});

test('placing on a ghost disc proves it was not there', () => {
  let s = apply(Q.initialState('reversi'), mv('d3', 'f5'));
  // White d6 is legal only in the f5 world (d5 black, d4 still white). In the d3 world d4 is black.
  s = apply(s, mv('d6'));
  assert.equal(s.worlds.length, 1);
  assert.equal(Q.summarize(s).pieces.get(sqOf('f5') + 1).alive, 1, 'the f5 world survived');
  assertWorldsAreClassicalGames(s);
});

test('a pass can be combined with a placement across worlds', () => {
  const a = board(['........', '........', '..ooo...', '..oxo...', '..ooo...', '........', '........', '........']);
  const b = board(['........', '........', '..ooo...', '..ox....', '..ooo...', '........', '........', '........']);
  const s = Q.stateFromBoards('reversi', [a, b], WHITE);
  const cands = Q.candidates(s, 0, -1).map((c) => c.key).sort();
  assert.ok(cands.includes('pass') && cands.includes('e5'), cands.join(','));
  const r = apply(s, mv('e5', 'pass'));
  assert.equal(r.worlds.length, 2);
  assert.deepEqual(r.worlds.map((w) => Q.timeline(w)[0].key).sort(), ['e5', 'pass']);
  // Passing alone keeps only the world where you really had no move.
  assert.equal(apply(s, mv('pass')).worlds.length, 1);
});

test('the final result averages the disc count over timelines', () => {
  const a = board(['xxxxxxxx', 'xxxxxxxx', 'xxxxxxxx', 'xxxxxxxx', 'xxxxxxxx', 'xxxxxxxx', 'xxxxxxxx', 'xxxo.oxx']);
  const b = board(['xxxxxxxx', 'xxxxxxxx', 'xxxxxxxx', 'xxxxxxxx', 'xxxxxxxx', 'xxxxxxxx', 'oooooooo', 'xxxo.oxx']);
  const s = Q.stateFromBoards('reversi', [a, b], BLACK);
  const r = apply(s, mv('e1'));
  assert.equal(r.worlds.length, 2);
  const [ca, cb] = r.worlds.map((w) => count(w.b));
  assert.deepEqual(ca, [64, 0]);
  assert.equal(r.result.reason, 'count');
  assert.deepEqual(r.result.score, [(ca[0] + cb[0]) / 2, (ca[1] + cb[1]) / 2]);
  assert.equal(r.result.winner, BLACK);
});

test('finish() averages scores and picks the winner', () => {
  const res = RV.finish([{ score: [40, 24] }, { score: [20, 44] }, { score: [33, 31] }]);
  assert.deepEqual(res.score, [31, 33]);
  assert.equal(res.winner, WHITE);
  assert.equal(RV.finish([{ score: [32, 32] }]).winner, null);
});
