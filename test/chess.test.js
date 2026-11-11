import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Q from '../shared/quantum.js';
import CH, { sqOf, sqName } from '../shared/games/chess.js';
import { assertWorldsAreClassicalGames, fen } from './helpers.js';

const WHITE = 0, BLACK = 1;

function perft(b, color, depth) {
  const ms = CH.moves(b, color);
  if (depth === 1) return ms.length;
  let n = 0;
  for (const m of ms) n += perft(CH.apply(b, m), 1 - color, depth - 1);
  return n;
}

const S = (b, turn = WHITE) => Q.stateFromBoards('chess', [b], turn);
const mv = (piece, ...alts) => ({ piece, alts });
const apply = (s, m) => {
  const r = Q.applyQuantumMove(s, m);
  assert.ok(r.ok, r.error);
  return r.state;
};
const pieceAt = (b, name) => CH.idOf(b.s[sqOf(name)]);
const where = (s, id) => [...(Q.summarize(s).pieces.get(id)?.locs.keys() || [])].map(sqName).sort();

test('perft: initial position (20 / 400 / 8902)', () => {
  const b = CH.initialBoard();
  assert.equal(perft(b, WHITE, 1), 20);
  assert.equal(perft(b, WHITE, 2), 400);
  assert.equal(perft(b, WHITE, 3), 8902);
});

test('perft: "kiwipete" exercises castling, en passant, promotion and checks (48 / 2039)', () => {
  const { board, turn } = fen('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq -');
  assert.equal(perft(board, turn, 1), 48);
  assert.equal(perft(board, turn, 2), 2039);
});

test('perft: endgame with en passant pins and promotions (14 / 191 / 2812)', () => {
  const { board, turn } = fen('8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - -');
  assert.equal(perft(board, turn, 1), 14);
  assert.equal(perft(board, turn, 2), 191);
  assert.equal(perft(board, turn, 3), 2812);
});

test('perft: promotions and discovered checks (6 / 264 / 9467)', () => {
  const { board, turn } = fen('r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq -');
  assert.equal(perft(board, turn, 1), 6);
  assert.equal(perft(board, turn, 2), 264);
  assert.equal(perft(board, turn, 3), 9467);
});

test('castling moves the rook and removes the rights; en passant removes the pawn', () => {
  const { board } = fen('r3k2r/8/8/8/8/8/8/R3K2R w KQkq -');
  const oo = CH.moves(board, WHITE).find((m) => m.key === 'e1g1');
  assert.ok(oo && oo.castle === 'O-O');
  const after = CH.apply(board, oo);
  assert.equal(CH.kindOf(after.s[sqOf('f1')]), 3, 'rook on f1');
  assert.equal(after.s[sqOf('h1')], 0);
  assert.equal(after.c & 3, 0, 'white rights gone');

  const ep = fen('4k3/8/8/3pP3/8/8/8/4K3 w - d6');
  const cap = CH.moves(ep.board, WHITE).find((m) => m.key === 'e5d6');
  assert.ok(cap && cap.ep);
  const b2 = CH.apply(ep.board, cap);
  assert.equal(b2.s[sqOf('d5')], 0, 'captured pawn removed');
  assert.equal(CH.quiet(ep.board, cap), false);
});

test("fool's mate is checkmate: no legal move in any world, in check", () => {
  let s = Q.initialState('chess');
  s = apply(s, mv(pieceAt(s.worlds[0].b, 'f2'), 'f2f3'));
  s = apply(s, mv(pieceAt(s.worlds[0].b, 'e7'), 'e7e5'));
  s = apply(s, mv(pieceAt(s.worlds[0].b, 'g2'), 'g2g4'));
  s = apply(s, mv(pieceAt(s.worlds[0].b, 'd8'), 'd8h4'));
  assert.deepEqual(s.result, { winner: BLACK, reason: 'checkmate' });
});

test('stalemate is a draw', () => {
  const { board } = fen('7k/5Q2/8/8/8/8/8/K7 w - -');
  const s = apply(S(board), mv(pieceAt(board, 'f7'), 'f7g6'));
  assert.deepEqual(s.result, { winner: null, reason: 'stalemate' });
});

test('checkmate in one world and stalemate in another counts as checkmate', () => {
  // The same queen move (c7-g7) mates in world A and stalemates in world B.
  const a = fen('7k/2Q5/8/8/8/8/1B6/K7 w - -').board; // Kh8: Qg7# (g7 guarded by Bb2)
  const b = fen('8/2Q5/8/7k/8/6K1/8/8 w - -').board;  // Kh5, Kg3: after Qg7 black has no move and no check
  assert.equal(pieceAt(a, 'c7'), pieceAt(b, 'c7'));
  const mixed = apply(Q.stateFromBoards('chess', [a, b], WHITE), mv(pieceAt(a, 'c7'), 'c7g7'));
  assert.deepEqual(mixed.result, { winner: WHITE, reason: 'checkmate' });
  const onlyB = apply(S(b), mv(pieceAt(b, 'c7'), 'c7g7'));
  assert.deepEqual(onlyB.result, { winner: null, reason: 'stalemate' });
});

test('a plain move onto a ghost works either way; a declared capture proves the ghost was there', () => {
  // White knight splits g1 -> f3 | h3; the black queen comes to h4.
  let s = Q.initialState('chess');
  const n = pieceAt(s.worlds[0].b, 'g1');
  s = apply(s, mv(n, 'g1f3', 'g1h3'));
  s = apply(s, mv(pieceAt(s.worlds[0].b, 'e7'), 'e7e6'));
  s = apply(s, mv(pieceAt(s.worlds[0].b, 'a2'), 'a2a3'));
  const q = pieceAt(s.worlds[0].b, 'd8');
  s = apply(s, mv(q, 'd8h4'));
  s = apply(s, mv(pieceAt(s.worlds[0].b, 'a3'), 'a3a4'));
  assert.equal(s.worlds.length, 2);

  const plain = apply(s, mv(q, 'h4h3'));
  assert.equal(plain.worlds.length, 2, 'legal in both worlds: a capture in one, a quiet move in the other');
  assert.equal(Q.summarize(plain).pieces.get(n).alive, 1, 'the knight survives in the f3 world');
  assert.deepEqual(Q.describeChange(s, plain, q), [`${CH.labelOf(n)} captured in 1 of 2 worlds`]);

  const declared = apply(s, mv(q, 'h4xh3'));
  assert.equal(declared.worlds.length, 1, 'only the world where the knight was on h3');
  assert.equal(Q.summarize(declared).pieces.get(n)?.alive ?? 0, 0);
  assertWorldsAreClassicalGames(declared);

  // A declared capture of an empty square is not legal anywhere.
  assert.equal(Q.applyQuantumMove(s, mv(q, 'h4xg5')).ok, false);
  assert.equal(Q.fmtMove('chess', { piece: q, alts: ['h4xh3'] }), '♛d8 h4xh3');
});

test('sliding through a ghost proves it was not there', () => {
  // Black knight splits g8 -> f6 | h6. White's bishop then slides c4-f7... blocked by nothing;
  // use the queen: d1-h5 passes through f3? No: put the ghost on the path. White Bf1-c4 first,
  // then black knight to f6/h6 is not on c4's lines. Simplest: white pawn e2-e4, black Ng8 -> f6 | h6,
  // white Qd1-f3 (clear), black a7a6, white Qf3xf6 declared? That's a capture. For sliding-through:
  // white rook h1-h3 passes h2 (pawn) — no. Use the black ghosts on the white queen's diagonal:
  // 1.e4  Ng8 -> e7 | h6   2.Qh5: d1-h5 passes e2,f3,g4 (all clear); then 2...a6 3.Qh5xe... no.
  // Direct construction instead:
  const a = fen('4k3/8/8/8/8/8/8/R3K3 w - -').board;
  const b = fen('4k3/8/8/8/8/8/8/R3K3 w - -').board;
  // Give black a knight ghost on c1 in world B only (same id), so the rook's path a1-d1 is blocked there.
  const bb = { ...b, s: b.s.slice() };
  bb.s[sqOf('c1')] = a.s[sqOf('e8')] + 0; // reuse the king code? No — build a proper knight code:
  bb.s[sqOf('c1')] = (19 << 4) | (1 << 1) | BLACK;
  const aa = { ...a, s: a.s.slice() };
  aa.s[sqOf('b8')] = (19 << 4) | (1 << 1) | BLACK; // the same knight, elsewhere, in world A
  const s = Q.stateFromBoards('chess', [aa, bb], WHITE);
  const rook = pieceAt(aa, 'a1');
  const r = apply(s, mv(rook, 'a1d1'));
  assert.equal(r.worlds.length, 1);
  assert.deepEqual(where(r, 19), ['b8'], 'the knight must have been on b8');
  const stop = apply(s, mv(rook, 'a1b1'));
  assert.equal(stop.worlds.length, 2, 'a move that stops short is legal in both worlds');
});

test('a move that ignores a check in some worlds rules those worlds out', () => {
  const a = fen('rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq -').board;
  const b = fen('rnb1kbnr/pppp1ppp/8/4p2q/6P1/5P2/PPPPP2P/RNBQKBNR w KQkq -').board;
  const s = Q.stateFromBoards('chess', [a, b], WHITE);
  const r = apply(s, mv(pieceAt(a, 'b1'), 'b1c3'));
  assert.equal(r.worlds.length, 1);
  assert.deepEqual(where(r, pieceAt(a, 'h4')), ['h5']);
  assert.equal(r.result, null, 'a world where you were mated just dies when you move elsewhere');
  const sum = Q.summarize(s);
  assert.equal(sum.checks.get(sqOf('e1')), 1, 'the king is in check in 1 of 2 worlds');
});

test('promotion alternatives are distinct moves', () => {
  const { board } = fen('8/P6k/8/8/8/8/8/K7 w - -');
  const keys = CH.moves(board, WHITE).filter((m) => m.from === sqOf('a7')).map((m) => m.key).sort();
  assert.deepEqual(keys, ['a7a8b', 'a7a8n', 'a7a8q', 'a7a8r']);
  const s = apply(S(board), mv(pieceAt(board, 'a7'), 'a7a8q', 'a7a8n'));
  assert.equal(s.worlds.length, 2);
  const e = Q.summarize(s).squares[sqOf('a8')].get(pieceAt(board, 'a7'));
  assert.equal(e.vars.size, 2, 'queen in one world, knight in the other');
  assert.equal(CH.fmtAlt('a7a8q'), 'a7-a8=Q');
  assert.equal(CH.fmtAlt('b7xa8n'), 'b7xa8=N');
});

test('insufficient material is a draw', () => {
  const dead = fen('7k/8/8/8/8/8/8/K6B w - -').board;
  assert.equal(CH.moves(dead, WHITE).length, 0);
  assert.deepEqual(CH.status(dead, WHITE), { winner: null, reason: 'material' });
  assert.ok(CH.moves(fen('7k/8/8/8/8/8/8/KQ5B b - -').board, BLACK).length > 0);
});
