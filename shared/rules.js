// Quantum Checkers rules engine. Shared by the browser client and the server.
//
// Model: the game state is a set of "worlds". Each world is an ordinary
// checkers position together with the ordinary game history that produced it.
// A quantum move is applied to every world; any world in which the move is not
// a legal classical move is deleted (that deletion is the "collapse").
//
// Invariant (the whole point): every surviving world's history is a normal
// game of checkers in which each turn exactly one piece made one legal move.

export const BLACK = 0;
export const RED = 1;
export const MAX_WORLDS = 512;
export const MAX_LOCATIONS = 4;      // a single piece may be in at most this many places
export const DRAW_QUIET_PLIES = 80;  // 40 moves each with only king non-captures

// ---------------------------------------------------------------- geometry
// Squares are the 32 dark squares, indexed 0..31. Row 0 is Black's back row.
export const rowOf = (sq) => sq >> 2;
export const colOf = (sq) => 2 * (sq & 3) + ((sq >> 2) % 2 === 0 ? 1 : 0);
export function sqAt(r, c) {
  if (r < 0 || r > 7 || c < 0 || c > 7 || ((r + c) & 1) === 0) return -1;
  return r * 4 + (c >> 1);
}

const DIRS = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
const STEP = [];
const JUMP = [];
for (let sq = 0; sq < 32; sq++) {
  const r = rowOf(sq), c = colOf(sq);
  STEP.push(DIRS.map(([dr, dc]) => sqAt(r + dr, c + dc)));
  JUMP.push(DIRS.map(([dr, dc]) => sqAt(r + 2 * dr, c + 2 * dc)));
}
const ALL_DIRS = [0, 1, 2, 3];
const FORWARD = [[2, 3], [0, 1]]; // Black moves down the board, Red moves up
const kingRow = (color) => (color === BLACK ? 7 : 0);

// ---------------------------------------------------------------- pieces
// A square holds 0 (empty) or a code: (id << 2) | (king << 1) | color.
// ids 1..12 are Black, 13..24 are Red.
export const pieceIdOf = (code) => code >> 2;
export const colorOf = (code) => code & 1;
export const isKing = (code) => (code >> 1) & 1;
export const colorOfId = (id) => (id <= 12 ? BLACK : RED);
export const labelOf = (id) => (id <= 12 ? `B${id}` : `R${id - 12}`);
export const colorName = (color) => (color === BLACK ? 'Black' : 'Red');
const makeCode = (id, color, king) => (id << 2) | (king ? 2 : 0) | color;

export function initialBoard() {
  const b = new Array(32).fill(0);
  for (let i = 0; i < 12; i++) b[i] = makeCode(i + 1, BLACK, false);
  for (let i = 0; i < 12; i++) b[20 + i] = makeCode(13 + i, RED, false);
  return b;
}

// ---------------------------------------------------------------- classical checkers
// Returns every legal classical move for `color` as a path of squares
// [from, ..., to]. Captures are mandatory and jump sequences must be completed.
// A man that reaches the king row during a jump stops there (American rules).
export function classicalMoves(b, color) {
  const jumps = [];
  for (let sq = 0; sq < 32; sq++) {
    const p = b[sq];
    if (p && (p & 1) === color) collectJumps(b, sq, sq, p, [sq], new Set(), jumps);
  }
  if (jumps.length) return jumps;
  const moves = [];
  for (let sq = 0; sq < 32; sq++) {
    const p = b[sq];
    if (!p || (p & 1) !== color) continue;
    for (const d of isKing(p) ? ALL_DIRS : FORWARD[color]) {
      const t = STEP[sq][d];
      if (t >= 0 && !b[t]) moves.push([sq, t]);
    }
  }
  return moves;
}

function collectJumps(b, origin, cur, p, path, captured, out) {
  const color = p & 1;
  const king = isKing(p);
  let extended = false;
  for (const d of king ? ALL_DIRS : FORWARD[color]) {
    const over = STEP[cur][d];
    const land = JUMP[cur][d];
    if (land < 0) continue;
    const q = b[over];
    if (!q || (q & 1) === color || captured.has(over)) continue;
    if (b[land] && land !== origin) continue; // origin is vacated by the mover
    extended = true;
    path.push(land);
    captured.add(over);
    if (!king && rowOf(land) === kingRow(color)) out.push(path.slice());
    else collectJumps(b, origin, land, p, path, captured, out);
    path.pop();
    captured.delete(over);
  }
  if (!extended && path.length > 1) out.push(path.slice());
}

export const isJumpPath = (path) => Math.abs(rowOf(path[1]) - rowOf(path[0])) === 2;

// Applies a move that is already known to be legal.
export function applyClassical(b, path) {
  const nb = b.slice();
  let p = nb[path[0]];
  nb[path[0]] = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], z = path[i];
    if (Math.abs(rowOf(z) - rowOf(a)) === 2) {
      nb[sqAt((rowOf(a) + rowOf(z)) / 2, (colOf(a) + colOf(z)) / 2)] = 0;
    }
  }
  const end = path[path.length - 1];
  if (!isKing(p) && rowOf(end) === kingRow(p & 1)) p |= 2;
  nb[end] = p;
  return nb;
}

const pathKey = (p) => p.join('-');
export const samePath = (a, b) => a.length === b.length && a.every((s, i) => s === b[i]);

// ---------------------------------------------------------------- quantum state
export function initialState() {
  return makeState([{ b: initialBoard(), h: null, q: 0 }], BLACK, 0, []);
}

function makeState(worlds, turn, ply, moves, result = null) {
  return { worlds, turn, ply, moves, result };
}

// For tests / puzzles: build a state from explicit boards.
export function stateFromBoards(boards, turn = BLACK) {
  return makeState(boards.map((b) => ({ b: b.slice(), h: null, q: 0 })), turn, 0, []);
}
export { makeCode };

function findPiece(b, id) {
  for (let sq = 0; sq < 32; sq++) if (b[sq] && b[sq] >> 2 === id) return sq;
  return -1;
}

function validateShape(move) {
  if (!move || typeof move !== 'object') return 'Malformed move.';
  const { piece, paths } = move;
  if (!Number.isInteger(piece) || piece < 1 || piece > 24) return 'Malformed move: bad piece.';
  if (!Array.isArray(paths) || paths.length < 1 || paths.length > 2 * MAX_LOCATIONS) {
    return 'Malformed move: bad paths.';
  }
  const perOrigin = new Map();
  const seen = new Set();
  for (const p of paths) {
    if (!Array.isArray(p) || p.length < 2 || p.length > 12) return 'Malformed move: bad path.';
    if (!p.every((s) => Number.isInteger(s) && s >= 0 && s < 32)) return 'Malformed move: bad square.';
    const k = pathKey(p);
    if (seen.has(k)) return 'The same path is listed twice.';
    seen.add(k);
    perOrigin.set(p[0], (perOrigin.get(p[0]) || 0) + 1);
  }
  for (const n of perOrigin.values()) if (n > 2) return 'Each location can split into at most two moves.';
  return null;
}

// A quantum move: { piece, paths }. Each path is a classical move starting at
// one of the piece's possible locations. Two paths from the same location is a
// split. Locations with no path are asserted to be false (those worlds die).
//
// Returns { ok: true, state } or { ok: false, error }.
export function applyQuantumMove(state, move) {
  if (state.result) return { ok: false, error: 'The game is over.' };
  const shapeErr = validateShape(move);
  if (shapeErr) return { ok: false, error: shapeErr };
  const { piece, paths } = move;
  const color = state.turn;
  if (colorOfId(piece) !== color) return { ok: false, error: `It is ${colorName(color)}'s turn.` };

  const used = new Array(paths.length).fill(false);
  const next = [];
  const seen = new Set();
  for (const w of state.worlds) {
    const loc = findPiece(w.b, piece);
    if (loc < 0) continue; // piece is captured in this world: moving it is impossible here
    let legal = null;
    for (let i = 0; i < paths.length; i++) {
      const p = paths[i];
      if (p[0] !== loc) continue;
      legal ??= new Set(classicalMoves(w.b, color).map(pathKey));
      if (!legal.has(pathKey(p))) continue;
      used[i] = true;
      const nb = applyClassical(w.b, p);
      const key = nb.join(',');
      if (seen.has(key)) continue; // identical position reached two ways: keep one history
      seen.add(key);
      const quiet = !isJumpPath(p) && isKing(w.b[p[0]]);
      next.push({ b: nb, h: { p, prev: w.h }, q: quiet ? w.q + 1 : 0 });
    }
  }

  if (!next.length) return { ok: false, error: 'That move is impossible in every possible world.' };
  const dead = paths.filter((_, i) => !used[i]);
  if (dead.length) {
    return { ok: false, error: `${fmtPath(dead[0])} is not legal in any world.` };
  }
  if (next.length > MAX_WORLDS) {
    return { ok: false, error: `Too much superposition (${next.length} worlds, max ${MAX_WORLDS}).` };
  }
  const locs = new Set();
  for (const w of next) {
    const s = findPiece(w.b, piece);
    if (s >= 0) locs.add(s);
  }
  if (locs.size > MAX_LOCATIONS) {
    return { ok: false, error: `A piece can be in at most ${MAX_LOCATIONS} places at once.` };
  }

  const opp = 1 - color;
  let result = null;
  if (!next.some((w) => classicalMoves(w.b, opp).length > 0)) {
    result = { winner: color, reason: 'nomoves' };
  } else if (next.every((w) => w.q >= DRAW_QUIET_PLIES)) {
    result = { winner: null, reason: 'quiet' };
  }
  const moveCopy = { piece, paths: paths.map((p) => p.slice()) };
  return { ok: true, state: makeState(next, opp, state.ply + 1, [...state.moves, moveCopy], result) };
}

export function replay(moves) {
  let s = initialState();
  for (const m of moves) {
    const r = applyQuantumMove(s, m);
    if (!r.ok) throw new Error(`Replay failed at ply ${s.ply}: ${r.error}`);
    s = r.state;
  }
  return s;
}

// ---------------------------------------------------------------- views & helpers
// Legal classical paths for `piece` starting at `origin`, across all worlds
// where the piece is actually there. Each entry: { path, n } (n = world count).
export function candidatePaths(state, piece, origin) {
  const map = new Map();
  for (const w of state.worlds) {
    const c = w.b[origin];
    if (!c || c >> 2 !== piece) continue;
    for (const p of classicalMoves(w.b, state.turn)) {
      if (p[0] !== origin) continue;
      const k = pathKey(p);
      const e = map.get(k);
      if (e) e.n++;
      else map.set(k, { path: p, n: 1 });
    }
  }
  return [...map.values()];
}

// Per-square and per-piece world counts, for rendering.
export function summarize(state) {
  const squares = Array.from({ length: 32 }, () => new Map());
  const pieces = new Map();
  for (let id = 1; id <= 24; id++) pieces.set(id, { alive: 0, locs: new Map() });
  for (const w of state.worlds) {
    for (let sq = 0; sq < 32; sq++) {
      const c = w.b[sq];
      if (!c) continue;
      const id = c >> 2;
      const e = squares[sq].get(id) || { n: 0, k: 0 };
      e.n++;
      if (isKing(c)) e.k++;
      squares[sq].set(id, e);
      const p = pieces.get(id);
      p.alive++;
      p.locs.set(sq, (p.locs.get(sq) || 0) + 1);
    }
  }
  return { W: state.worlds.length, squares, pieces };
}

// The classical move list of one world, oldest first.
export function timeline(world) {
  const out = [];
  for (let h = world.h; h; h = h.prev) out.push(h.p);
  return out.reverse();
}

export function fmtPath(p) {
  return p.map((s) => s + 1).join(isJumpPath(p) ? 'x' : '-');
}

export function fmtMove(move) {
  const groups = new Map();
  for (const p of move.paths) {
    if (!groups.has(p[0])) groups.set(p[0], []);
    groups.get(p[0]).push(fmtPath(p));
  }
  return `${labelOf(move.piece)} ${[...groups.values()].map((g) => g.join(' | ')).join(' & ')}`;
}

// Human-readable list of what a move did to the *other* pieces.
export function describeChange(before, after, movingPiece) {
  const sb = summarize(before), sa = summarize(after);
  const out = [];
  const states = (sum, id) => {
    const p = sum.pieces.get(id);
    const s = new Set([...p.locs.keys()].map((x) => x + 1));
    if (p.alive < sum.W) s.add('x');
    return s;
  };
  const fmt = (s) => [...s].map((x) => (x === 'x' ? 'captured' : x)).join(' / ');
  for (let id = 1; id <= 24; id++) {
    if (id === movingPiece) continue;
    const s0 = states(sb, id), s1 = states(sa, id);
    if (s0.size === s1.size && [...s0].every((x) => s1.has(x))) continue;
    const label = labelOf(id);
    if (s1.size === 1 && s1.has('x')) out.push(`${label} captured`);
    else if (s1.has('x') && !s0.has('x')) {
      const dead = sa.W - sa.pieces.get(id).alive;
      out.push(`${label} captured in ${dead} of ${sa.W} worlds`);
    } else if ([...s1].every((x) => s0.has(x))) out.push(`${label} collapses → ${fmt(s1)}`);
    else out.push(`${label} now ${fmt(s1)}`);
  }
  return out;
}
