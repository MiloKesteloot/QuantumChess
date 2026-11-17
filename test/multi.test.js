// Two-piece moves: a move names two pieces, and in each world exactly one of them moves.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Q from '../shared/quantum.js';
import { gameOf } from '../shared/games/index.js';
import { Room } from '../shared/room.js';
import { chooseMove } from '../shared/ai.js';
import { assertWorldsAreClassicalGames, randomGame } from './helpers.js';

const CH = gameOf('chess');
const E2 = 13, G1 = 7, A7 = 25; // chess piece ids: e2 pawn, g1 knight, a7 pawn
const MULTI = { multi: true };
const two = { piece: E2, alts: ['e2e4'], also: { piece: G1, alts: ['g1f3'] } };

function apply(s, m) {
  const r = Q.applyQuantumMove(s, m);
  assert.ok(r.ok, r.error);
  return r.state;
}
const where = (b, id) => b.s.findIndex((c) => c && CH.idOf(c) === id);

test('two-piece moves are off by default and rejected', () => {
  const s = Q.initialState('chess');
  assert.equal(s.opts.multi, false);
  const r = Q.applyQuantumMove(s, two);
  assert.equal(r.ok, false);
  assert.match(r.error, /turned off/);
});

test('placement games never allow them', () => {
  assert.equal(Q.initialState('reversi', MULTI).opts.multi, false);
});

test('a two-piece move makes one world per piece, each a normal game', () => {
  const s = apply(Q.initialState('chess', MULTI), two);
  assert.equal(s.worlds.length, 2);
  const moved = s.worlds.map((w) => [CH.sqName(where(w.b, E2)), CH.sqName(where(w.b, G1))]).sort();
  assert.deepEqual(moved, [['e2', 'f3'], ['e4', 'g1']]);
  assertWorldsAreClassicalGames(s);
  assert.equal(Q.fmtMove('chess', s.moves[0]), '♙e2 e2-e4 | ♘g1 g1-f3');
  assert.deepEqual(Q.replay('chess', s.moves, MULTI).worlds.length, 2);
  assert.throws(() => Q.replay('chess', s.moves), /turned off/);
});

test('one split per move: a two-piece move cannot also split, and needs two pieces', () => {
  const s = Q.initialState('chess', MULTI);
  const split = Q.applyQuantumMove(s, { piece: E2, alts: ['e2e3', 'e2e4'], also: { piece: G1, alts: ['g1f3'] } });
  assert.equal(split.ok, false);
  assert.match(split.error, /one split per move/);
  assert.equal(Q.applyQuantumMove(s, { piece: E2, alts: ['e2e3'], also: { piece: E2, alts: ['e2e4'] } }).ok, false);
  const illegal = Q.applyQuantumMove(s, { piece: E2, alts: ['e2e4'], also: { piece: G1, alts: ['g1e2'] } });
  assert.equal(illegal.ok, false);
});

test('a later move proves which piece really moved', () => {
  let s = apply(Q.initialState('chess', MULTI), two);
  s = apply(s, { piece: A7, alts: ['a7a6'] });
  // Ng1-h3 is only possible where the knight stayed home, i.e. where the pawn moved.
  const before = s;
  s = apply(s, { piece: G1, alts: ['g1h3'] });
  assert.equal(s.worlds.length, 1);
  assert.equal(CH.sqName(where(s.worlds[0].b, E2)), 'e4');
  const fx = Q.describeChange(before, s, G1, s.moves[2]);
  assert.ok(fx.includes('♘g1 was not on f3'), fx.join(' / '));
  assert.ok(fx.includes('♙e2 collapses → e4'), fx.join(' / '));
});

test('describeChange names ghosts of either piece that a two-piece move rules out', () => {
  // Split the knight first, then a two-piece move whose knight half only exists from f3.
  let s = Q.initialState('chess', MULTI);
  s = apply(s, { piece: G1, alts: ['g1f3', 'g1h3'] });
  s = apply(s, { piece: A7, alts: ['a7a6'] });
  const before = s;
  // Knight f3-d4 (only where it is on f3) or pawn e2-e4 (in both worlds): every world survives.
  s = apply(s, { piece: G1, alts: ['f3d4'], also: { piece: E2, alts: ['e2e4'] } });
  assert.equal(s.worlds.length, 3);
  assert.deepEqual(Q.describeChange(before, s, G1, s.moves[2]), []);
  assertWorldsAreClassicalGames(s);

  // Knight f3-d4 or pawn h2-h3: where the knight is on h3, neither is possible.
  const H2 = 16;
  const after = apply(before, { piece: G1, alts: ['f3d4'], also: { piece: H2, alts: ['h2h3'] } });
  assert.equal(after.worlds.length, 2);
  assert.deepEqual(Q.describeChange(before, after, G1, after.moves[2]), ['♘g1 was not on h3']);
});

test('fuzz with two-piece moves: every world stays a legal classical game', () => {
  for (const id of ['chess', 'checkers']) {
    for (let seed = 1; seed <= 8; seed++) {
      const { state } = randomGame(id, seed, id === 'chess' ? 50 : 120, MULTI);
      assert.ok(state.moves.some((m) => m.also), `${id} seed ${seed} played a two-piece move`);
      assertWorldsAreClassicalGames(state);
      const again = Q.replay(id, state.moves, MULTI);
      assert.equal(again.worlds.length, state.worlds.length);
    }
  }
});

test('rooms keep the option, share it, and enforce it', () => {
  const client = () => {
    const c = { token: null, inbox: [], send: (m) => c.inbox.push(m), isOpen: () => true };
    c.last = (t) => [...c.inbox].reverse().find((m) => m.t === t);
    return c;
  };
  const room = new Room('ABCDE', { game: 'chess', opts: MULTI });
  const host = client(), guest = client();
  room.join(host, room.claimSeat(0));
  room.handle(guest, { t: 'join' });
  assert.deepEqual(guest.last('state').opts, { multi: true });
  room.handle(host, { t: 'move', ply: 0, move: two });
  assert.equal(room.state.worlds.length, 2);
  const restored = new Room('ABCDE', { saved: room.serialize() });
  assert.equal(restored.state.worlds.length, 2);
  assert.equal(restored.opts.multi, true);

  const plain = new Room('FGHJK', { game: 'chess' });
  const h2 = client();
  plain.join(h2, plain.claimSeat(0));
  plain.handle(h2, { t: 'move', ply: 0, move: two });
  assert.match(h2.last('error').msg, /turned off/);
});

test('the AI plays legal moves with two-piece moves on, and only then uses them', () => {
  const seeded = (seed) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  for (const id of ['checkers', 'chess']) {
    const rand = seeded(5);
    let s = Q.initialState(id, MULTI);
    for (let i = 0; i < 16 && !s.result; i++) s = apply(s, chooseMove(s, 'easy', rand));
    assertWorldsAreClassicalGames(s);
    let p = Q.initialState(id);
    for (let i = 0; i < 8 && !p.result; i++) {
      const m = chooseMove(p, 'easy', rand);
      assert.equal(m.also, undefined);
      p = apply(p, m);
    }
  }
});
