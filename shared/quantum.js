// The quantum engine, shared by the browser client, the AI worker and the tests.
//
// Model: the game state is a set of "worlds". Each world is an ordinary
// position of the underlying game (checkers, chess, reversi…) together with
// the ordinary move history that produced it. A quantum move is applied to
// every world; any world in which the move is not a legal classical move is
// deleted (that deletion is the "collapse").
//
// Invariant (the whole point): every surviving world's history is a normal
// game in which each turn the side to move made exactly one legal move.
//
// A game module provides the classical rules through this interface:
//   id, name, colors[2], rows, cols, squares, sqAt(r,c), rowOf, colOf, sqName
//   homeRow[2] | null, placement (true if pieces are placed, not moved)
//   initialBoard(), boardKey(b), codeAt(b, sq) -> 0 | code
//   idOf(code), colorOf(code), kindOf(code), colorOfId(id) | null, labelOf(id)
//   moves(b, color) -> [{ key, piece, from, to, seq, ... }]   (key identifies the move on that board)
//   canMove(b, color), apply(b, move) -> new board, quiet(b, move), drawQuietPlies | null
//   status(b, color) -> result for a world where `color` has no legal move
//   finish?(statuses, worlds, mover) -> overall result when every world is over
//   keyPath(key, piece), keyOrigin(key, piece), fmtAlt(key), isPass(key)
import { gameOf } from './games/index.js';

export const MAX_WORLDS = 512;
export const MAX_LOCATIONS = 4; // a single piece may be in at most this many places

// Game options, fixed when a game starts:
//   multi: a move may name a second piece ("two-piece move"): in each world
//          exactly one of the two pieces makes its move.
export function normalizeOpts(gameId, opts) {
  return { multi: !!opts?.multi && !gameOf(gameId).placement };
}
export const sameOpts = (a, b) => !!a?.multi === !!b?.multi;

export function initialState(gameId, opts = null) {
  const g = gameOf(gameId);
  return {
    game: gameId, opts: normalizeOpts(gameId, opts),
    worlds: [{ b: g.initialBoard(), h: null, q: 0 }], turn: 0, ply: 0, moves: [], result: null,
  };
}

// For tests and puzzles: a state built from explicit boards.
export function stateFromBoards(gameId, boards, turn = 0, opts = null) {
  return { game: gameId, opts: normalizeOpts(gameId, opts), worlds: boards.map((b) => ({ b, h: null, q: 0 })), turn, ply: 0, moves: [], result: null };
}

// The parts of a quantum move: [{ piece, alts }], one or two of them.
export const partsOf = (move) => (move.also ? [{ piece: move.piece, alts: move.alts }, move.also] : [{ piece: move.piece, alts: move.alts }]);

const KEY_RE = /^[A-Za-z0-9=x-]{1,40}$/;

// Legal classical moves of one board, memoized per board object. Boards are
// never mutated, so this is safe, and it saves the AI from regenerating the
// same move lists for every quantum alternative it tries.
const cache = new WeakMap();
export function legalMoves(g, b, color) {
  let e = cache.get(b);
  if (!e) cache.set(b, (e = [null, null]));
  return e[color] || (e[color] = g.moves(b, color));
}
function canMove(g, b, color) {
  const e = cache.get(b);
  if (e && e[color]) return e[color].length > 0;
  return g.canMove(b, color);
}

function validateShape(move, opts) {
  if (!move || typeof move !== 'object') return 'Malformed move.';
  const err = validatePart(move);
  if (err) return err;
  if (move.also === undefined || move.also === null) return null;
  if (!opts?.multi) return 'Two-piece moves are turned off in this game.';
  const err2 = validatePart(move.also);
  if (err2) return err2;
  if (move.also.piece === move.piece || !move.piece) return 'A two-piece move needs two different pieces.';
  return null;
}

function validatePart(part) {
  if (!part || typeof part !== 'object') return 'Malformed move.';
  const { piece, alts } = part;
  if (!Number.isInteger(piece) || piece < 0 || piece > 64) return 'Malformed move: bad piece.';
  if (!Array.isArray(alts) || alts.length < 1 || alts.length > 2 * MAX_LOCATIONS + 1) return 'Malformed move: bad alternatives.';
  const seen = new Set();
  for (const k of alts) {
    if (typeof k !== 'string' || !KEY_RE.test(k)) return 'Malformed move: bad alternative.';
    if (seen.has(k)) return 'The same move is listed twice.';
    seen.add(k);
  }
  return null;
}

function locationsOf(g, worlds, piece) {
  const locs = new Set();
  if (!piece) return locs;
  for (const w of worlds) {
    for (let sq = 0; sq < g.squares; sq++) {
      const c = g.codeAt(w.b, sq);
      if (c && g.idOf(c) === piece) {
        locs.add(sq);
        break;
      }
    }
  }
  return locs;
}

// A quantum move: { piece, alts, also? }. Each alternative is the key of a
// classical move of that piece. In every world, the piece takes all the
// alternatives that are legal there (two from the same place is a split).
// Worlds where none is legal are ruled out.
//
// With two-piece moves on, `also: { piece, alts }` names a second piece. Each
// world then branches into every legal alternative of either piece, so in each
// resulting world exactly one of the two pieces moved. A two-piece move may not
// also split a piece: one split per move at most.
// Returns { ok: true, state } or { ok: false, error }.
export function applyQuantumMove(state, move) {
  if (state.result) return { ok: false, error: 'The game is over.' };
  const shapeErr = validateShape(move, state.opts);
  if (shapeErr) return { ok: false, error: shapeErr };
  const g = gameOf(state.game);
  const parts = partsOf(move);
  const altsOf = new Map(parts.map((p) => [p.piece, new Set(p.alts)]));
  const color = state.turn;

  const used = new Set();
  const perOrigin = new Map(); // "piece:origin" -> keys taken from there
  const next = [];
  const seen = new Set();
  const keysOf = g.keysOf || ((m) => [m.key]);
  for (const w of state.worlds) {
    for (const m of legalMoves(g, w.b, color)) {
      const alts = altsOf.get(m.piece);
      if (!alts) continue;
      const hits = keysOf(m).filter((k) => alts.has(k));
      if (!hits.length) continue;
      for (const k of hits) {
        used.add(`${m.piece}:${k}`);
        if (g.isPass(k)) continue;
        const o = `${m.piece}:${m.from}`;
        const set = perOrigin.get(o) || new Set();
        set.add(k);
        perOrigin.set(o, set);
      }
      const nb = g.apply(w.b, m);
      const key = g.boardKey(nb);
      if (seen.has(key)) continue; // the same position reached two ways: keep one history
      seen.add(key);
      next.push({ b: nb, h: { m, prev: w.h }, q: g.quiet(w.b, m) ? w.q + 1 : 0 });
    }
  }

  if (!next.length) return { ok: false, error: 'That move is impossible in every possible world.' };
  for (const p of parts) {
    for (const k of p.alts) {
      if (!used.has(`${p.piece}:${k}`)) {
        return { ok: false, error: `${parts.length > 1 ? g.labelOf(p.piece) + ' ' : ''}${g.fmtAlt(k)} is not legal in any world.` };
      }
    }
  }
  const maxPerOrigin = parts.length > 1 ? 1 : 2;
  for (const set of perOrigin.values()) {
    if (set.size > maxPerOrigin) {
      return {
        ok: false,
        error: parts.length > 1
          ? 'A two-piece move cannot also split a piece: one split per move.'
          : 'A piece can split into at most two moves from one place.',
      };
    }
  }
  if (next.length > MAX_WORLDS) {
    return { ok: false, error: `Too much superposition (${next.length} worlds, max ${MAX_WORLDS}).` };
  }
  for (const p of parts) {
    if (locationsOf(g, next, p.piece).size > MAX_LOCATIONS) {
      return { ok: false, error: `A piece can be in at most ${MAX_LOCATIONS} places at once.` };
    }
  }

  const opp = 1 - color;
  let result = null;
  const statuses = [];
  for (const w of next) {
    if (canMove(g, w.b, opp)) {
      statuses.length = 0;
      break;
    }
    statuses.push(g.status(w.b, opp));
  }
  if (statuses.length) {
    // The side to move has no legal move in any world.
    if (g.finish) result = g.finish(statuses, next, color);
    else {
      const loss = statuses.find((s) => s.winner === color);
      result = loss ? { winner: color, reason: loss.reason } : { winner: null, reason: statuses[0].reason };
    }
  } else if (g.drawQuietPlies && next.every((w) => w.q >= g.drawQuietPlies)) {
    result = { winner: null, reason: 'quiet' };
  }
  const moveCopy = { piece: move.piece, alts: [...move.alts] };
  if (move.also) moveCopy.also = { piece: move.also.piece, alts: [...move.also.alts] };
  return {
    ok: true,
    state: { game: state.game, opts: state.opts, worlds: next, turn: opp, ply: state.ply + 1, moves: [...state.moves, moveCopy], result },
  };
}

export function replay(gameId, moves, opts = null) {
  let s = initialState(gameId, opts);
  for (const m of moves) {
    const r = applyQuantumMove(s, m);
    if (!r.ok) throw new Error(`Replay failed at ply ${s.ply}: ${r.error}`);
    s = r.state;
  }
  return s;
}

// ---------------------------------------------------------------- views & helpers
// Legal classical moves of `piece` starting from `origin` (−1 for placements),
// across all worlds where the piece is there. Each entry: { m, n } (n = world count).
export function candidates(state, piece, origin) {
  return allCandidates(state).get(piece)?.get(origin) || [];
}

// Every legal classical move for the side to move, in one pass over the worlds:
// Map piece -> Map origin -> [{ key, m, n }]. A move that answers to several
// keys (a chess capture, declared or not) gets one entry per key.
export function allCandidates(state) {
  const g = gameOf(state.game);
  const keysOf = g.keysOf || ((m) => [m.key]);
  const out = new Map();
  for (const w of state.worlds) {
    for (const m of legalMoves(g, w.b, state.turn)) {
      let byOrigin = out.get(m.piece);
      if (!byOrigin) out.set(m.piece, (byOrigin = new Map()));
      let list = byOrigin.get(m.from);
      if (!list) byOrigin.set(m.from, (list = []));
      for (const key of keysOf(m)) {
        const e = list.find((x) => x.key === key);
        if (e) e.n++;
        else list.push({ key, m, n: 1 });
      }
    }
  }
  return out;
}

// Per-square and per-piece world counts, for rendering.
//   squares[sq]: Map id -> { n, vars: Map<color*8+kind, count> }
//   pieces: Map id -> { alive, locs: Map<sq, count>, colors: [n0, n1] }
//   checks: Map<sq, count> of worlds where the side to move is in check there (chess)
export function summarize(state) {
  const g = gameOf(state.game);
  const squares = Array.from({ length: g.squares }, () => new Map());
  const pieces = new Map();
  const checks = new Map();
  for (const w of state.worlds) {
    for (let sq = 0; sq < g.squares; sq++) {
      const c = g.codeAt(w.b, sq);
      if (!c) continue;
      const id = g.idOf(c), color = g.colorOf(c), kind = g.kindOf(c);
      let e = squares[sq].get(id);
      if (!e) squares[sq].set(id, (e = { n: 0, vars: new Map() }));
      e.n++;
      const vk = color * 8 + kind;
      e.vars.set(vk, (e.vars.get(vk) || 0) + 1);
      let p = pieces.get(id);
      if (!p) pieces.set(id, (p = { alive: 0, locs: new Map(), colors: [0, 0] }));
      p.alive++;
      p.colors[color]++;
      p.locs.set(sq, (p.locs.get(sq) || 0) + 1);
      if (g.inCheck && kind === g.kingKind && color === state.turn && !state.result && g.inCheck(w.b, color)) {
        checks.set(sq, (checks.get(sq) || 0) + 1);
      }
    }
  }
  return { W: state.worlds.length, squares, pieces, checks };
}

// The classical move list of one world, oldest first.
export function timeline(world) {
  const out = [];
  for (let h = world.h; h; h = h.prev) out.push(h.m);
  return out.reverse();
}

// A two-piece move reads "♕d1 d1-d4 | ♖a1 a1-a3": one or the other happened.
export function fmtMove(gameId, move) {
  const g = gameOf(gameId);
  return partsOf(move).map(({ piece, alts }) => {
    const groups = new Map();
    for (const k of alts) {
      const o = g.isPass(k) ? 'pass' : g.keyOrigin(k, piece);
      if (!groups.has(o)) groups.set(o, []);
      groups.get(o).push(g.fmtAlt(k));
    }
    const body = [...groups.values()].map((x) => x.join(' | ')).join(' & ');
    return piece ? `${g.labelOf(piece)} ${body}` : body;
  }).join(' | ');
}

// Human-readable list of what a move did to the *other* pieces. If `move` is
// given, also says which of the moving piece's own ghosts were ruled out.
export function describeChange(before, after, movingPiece, move = null) {
  const g = gameOf(before.game);
  const sb = summarize(before), sa = summarize(after);
  const out = [];
  const absent = g.absentWord || 'captured';
  const moving = new Set(move ? partsOf(move).map((p) => p.piece) : [movingPiece]);
  if (move?.also) {
    // Two pieces moved, one per world. A ghost of either piece was ruled out
    // when none of the worlds it was in survived the move.
    const kept = new Set(after.worlds.map((w) => w.h?.prev));
    const sk = summarize({ game: before.game, worlds: before.worlds.filter((w) => kept.has(w.h)) });
    for (const id of moving) {
      const mb = sb.pieces.get(id), mk = sk.pieces.get(id);
      if (!mb || !mk) continue;
      const ruled = [...mb.locs.keys()].filter((x) => !mk.locs.has(x)).map(g.sqName);
      if (ruled.length) out.push(`${g.labelOf(id)} was not on ${ruled.join(' or ')}`);
      if (mb.alive < sb.W && mk.alive === sk.W) out.push(`${g.labelOf(id)} was not ${absent}`);
    }
  } else if (move && movingPiece) {
    const origins = new Set(move.alts.filter((k) => !g.isPass(k)).map((k) => g.keyOrigin(k, movingPiece)));
    const mp = sb.pieces.get(movingPiece);
    if (mp) {
      const ruled = [...mp.locs.keys()].filter((s) => !origins.has(s)).map(g.sqName);
      if (ruled.length) out.push(`${g.labelOf(movingPiece)} was not on ${ruled.join(' or ')}`);
      if (mp.alive < sb.W) out.push(`${g.labelOf(movingPiece)} was not ${absent}`);
    }
  }
  const states = (sum, id) => {
    const p = sum.pieces.get(id);
    const s = new Set();
    if (!p) return s;
    if (g.placement) {
      for (const c of [0, 1]) if (p.colors[c]) s.add(g.colors[c]);
    } else {
      for (const x of p.locs.keys()) s.add(g.sqName(x));
    }
    if (p.alive < sum.W) s.add('\0');
    return s;
  };
  const fmt = (s) => [...s].map((x) => (x === '\0' ? absent : x)).join(' / ');
  const ids = new Set([...sb.pieces.keys(), ...sa.pieces.keys()]);
  for (const id of [...ids].sort((a, b) => a - b)) {
    if (moving.has(id)) continue;
    const s0 = states(sb, id), s1 = states(sa, id);
    if (s0.size === s1.size && [...s0].every((x) => s1.has(x))) continue;
    // One certain state to another certain state (a reversi flip in every world) is not quantum news.
    if (s0.size === 1 && s1.size === 1 && !s1.has('\0')) continue;
    const label = g.labelOf(id);
    if (!s1.size || (s1.size === 1 && s1.has('\0'))) out.push(`${label} ${absent}`);
    else if (s1.has('\0') && !s0.has('\0')) out.push(`${label} might be ${absent}`);
    else if ([...s1].every((x) => s0.has(x))) out.push(`${label} collapses → ${fmt(s1)}`);
    else if (s0.size) out.push(`${label} now ${fmt(s1)}`);
  }
  return out;
}
