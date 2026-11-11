import assert from 'node:assert/strict';
import * as Q from '../shared/quantum.js';
import { gameOf } from '../shared/games/index.js';
import { makeCode as chessCode, sqOf } from '../shared/games/chess.js';

// Chess board from a FEN. Piece ids are assigned in reading order (white 1.., black 17..).
export function fen(str) {
  const [placement, side, castling, ep] = str.split(' ');
  const s = new Array(64).fill(0);
  const next = [1, 17];
  const KIND = { p: 0, n: 1, b: 2, r: 3, q: 4, k: 5 };
  let sq = 0;
  for (const ch of placement) {
    if (ch === '/') continue;
    if (/\d/.test(ch)) sq += +ch;
    else {
      const color = ch === ch.toUpperCase() ? 0 : 1;
      s[sq++] = chessCode(next[color]++, color, KIND[ch.toLowerCase()]);
    }
  }
  let c = 0;
  if (castling.includes('K')) c |= 1;
  if (castling.includes('Q')) c |= 2;
  if (castling.includes('k')) c |= 4;
  if (castling.includes('q')) c |= 8;
  return { board: { s, c, ep: ep && ep !== '-' ? sqOf(ep) : -1 }, turn: side === 'w' ? 0 : 1 };
}

// Reversi board from rows of text, '.' empty, 'x' black, 'o' white; row 0 = rank 8.
export function reversiBoard(rows) {
  const b = new Array(64).fill(0);
  rows.forEach((row, r) => [...row].forEach((ch, c) => (b[r * 8 + c] = ch === 'x' ? 1 : ch === 'o' ? 2 : 0)));
  return b;
}

// Every surviving world must be a normal game: from the start position, each
// ply is one legal classical move by the side to move, ending at that board.
export function assertWorldsAreClassicalGames(state, startBoard = null, startTurn = 0) {
  const g = gameOf(state.game);
  for (const w of state.worlds) {
    const moves = Q.timeline(w);
    assert.equal(moves.length, state.ply, 'history length matches ply count');
    let b = startBoard || g.initialBoard();
    let turn = startTurn;
    for (const m of moves) {
      assert.ok(g.moves(b, turn).some((x) => x.key === m.key), `illegal classical move ${m.key} in a world history`);
      b = g.apply(b, m);
      turn = 1 - turn;
    }
    assert.equal(g.boardKey(b), g.boardKey(w.b), 'replayed history reaches the world board');
  }
}

export function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

const pick = (xs, rand) => xs[Math.floor(rand() * xs.length)];

// A random quantum move: one classical move, sometimes with the piece's other
// ghosts moved too, sometimes a split.
export function randomQuantumMove(state, rand) {
  const g = gameOf(state.game);
  const all = Q.allCandidates(state);
  const pieces = [...all.keys()];
  if (!pieces.length) return null;
  const piece = pick(pieces, rand);
  const byOrigin = all.get(piece);
  const origins = [...byOrigin.keys()];
  const first = pick(origins, rand);
  const alts = [pick(byOrigin.get(first), rand).m.key];
  for (const o of origins) {
    const keys = byOrigin.get(o).map((c) => c.m.key).filter((k) => !alts.includes(k));
    if (o !== first && keys.length && rand() < 0.6) alts.push(pick(keys, rand));
    if (o === first && keys.length && rand() < 0.35) alts.push(pick(keys.filter((k) => !g.isPass(k)), rand) || keys[0]);
  }
  return { piece, alts: [...new Set(alts)] };
}

// Plays random quantum moves (falling back to a plain classical move) for up to `plies`.
export function randomGame(gameId, seed, plies) {
  const rand = rng(seed);
  let s = Q.initialState(gameId);
  let maxWorlds = 1;
  for (let i = 0; i < plies && !s.result; i++) {
    let applied = false;
    for (let tries = 0; tries < 20 && !applied; tries++) {
      const m = randomQuantumMove(s, rand);
      const r = m && Q.applyQuantumMove(s, m);
      if (r && r.ok) {
        s = r.state;
        applied = true;
      }
    }
    if (!applied) {
      const g = gameOf(gameId);
      const w = s.worlds.find((x) => g.moves(x.b, s.turn).length);
      const m = g.moves(w.b, s.turn)[0];
      const r = Q.applyQuantumMove(s, { piece: m.piece, alts: [m.key] });
      assert.ok(r.ok, r.error);
      s = r.state;
    }
    maxWorlds = Math.max(maxWorlds, s.worlds.length);
    assert.ok(s.worlds.length >= 1 && s.worlds.length <= Q.MAX_WORLDS);
  }
  return { state: s, maxWorlds };
}
