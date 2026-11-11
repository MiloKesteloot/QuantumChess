// Classical checkers (draughts) rules, in the shape the quantum engine expects.
// See shared/quantum.js for the interface. Nothing here knows about worlds.
//
// Squares are the 32 dark squares, indexed 0..31. Row 0 is Black's back row;
// Black moves first and moves "down" the board. Black is color 0, Red color 1.

const BLACK = 0, RED = 1;

export const rowOf = (sq) => sq >> 2;
export const colOf = (sq) => 2 * (sq & 3) + ((sq >> 2) % 2 === 0 ? 1 : 0);
export function sqAt(r, c) {
  if (r < 0 || r > 7 || c < 0 || c > 7 || ((r + c) & 1) === 0) return -1;
  return r * 4 + (c >> 1);
}

const DIRS = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
const STEP = [], JUMP = [];
for (let sq = 0; sq < 32; sq++) {
  const r = rowOf(sq), c = colOf(sq);
  STEP.push(DIRS.map(([dr, dc]) => sqAt(r + dr, c + dc)));
  JUMP.push(DIRS.map(([dr, dc]) => sqAt(r + 2 * dr, c + 2 * dc)));
}
const ALL_DIRS = [0, 1, 2, 3];
const FORWARD = [[2, 3], [0, 1]];
const kingRow = (color) => (color === BLACK ? 7 : 0);

// A square holds 0 or (id << 2) | (king << 1) | color. ids 1..12 Black, 13..24 Red.
export const makeCode = (id, color, king) => (id << 2) | (king ? 2 : 0) | color;
const isKing = (code) => (code >> 1) & 1;

export function initialBoard() {
  const b = new Array(32).fill(0);
  for (let i = 0; i < 12; i++) b[i] = makeCode(i + 1, BLACK, false);
  for (let i = 0; i < 12; i++) b[20 + i] = makeCode(13 + i, RED, false);
  return b;
}

// Every legal move for `color`. Capturing is optional and a multi-jump may stop
// after any hop. A man crowned mid-jump stops there.
export function moves(b, color) {
  const out = [];
  for (let sq = 0; sq < 32; sq++) {
    const p = b[sq];
    if (p && (p & 1) === color) collectJumps(b, sq, sq, p, [sq], new Set(), out);
  }
  for (let sq = 0; sq < 32; sq++) {
    const p = b[sq];
    if (!p || (p & 1) !== color) continue;
    for (const d of isKing(p) ? ALL_DIRS : FORWARD[color]) {
      const t = STEP[sq][d];
      if (t >= 0 && !b[t]) out.push(mk(p, [sq, t]));
    }
  }
  return out;
}

function mk(code, path) {
  return { key: fmtPath(path), piece: code >> 2, from: path[0], to: path[path.length - 1], seq: path.slice(1), path };
}

function collectJumps(b, origin, cur, p, path, captured, out) {
  const color = p & 1, king = isKing(p);
  for (const d of king ? ALL_DIRS : FORWARD[color]) {
    const over = STEP[cur][d], land = JUMP[cur][d];
    if (land < 0) continue;
    const q = b[over];
    if (!q || (q & 1) === color || captured.has(over)) continue;
    if (b[land] && land !== origin) continue; // the origin is vacated by the mover
    path.push(land);
    captured.add(over);
    out.push(mk(p, path.slice()));
    if (king || rowOf(land) !== kingRow(color)) collectJumps(b, origin, land, p, path, captured, out);
    path.pop();
    captured.delete(over);
  }
}

const isJump = (path) => Math.abs(rowOf(path[1]) - rowOf(path[0])) === 2;

export function apply(b, m) {
  const path = m.path;
  const nb = b.slice();
  let p = nb[path[0]];
  nb[path[0]] = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], z = path[i];
    if (Math.abs(rowOf(z) - rowOf(a)) === 2) nb[sqAt((rowOf(a) + rowOf(z)) / 2, (colOf(a) + colOf(z)) / 2)] = 0;
  }
  const end = path[path.length - 1];
  if (!isKing(p) && rowOf(end) === kingRow(p & 1)) p |= 2;
  nb[end] = p;
  return nb;
}

function fmtPath(path) {
  return path.map((s) => s + 1).join(isJump(path) ? 'x' : '-');
}
function parseKey(key) {
  return key.split(/[x-]/).map((s) => +s - 1);
}

// Material plus a little positional sense, from `color`'s view (for the AI).
function evaluate(b, color) {
  let score = 0;
  for (let sq = 0; sq < 32; sq++) {
    const p = b[sq];
    if (!p) continue;
    const r = rowOf(sq), c = colOf(sq);
    let v;
    if (isKing(p)) v = 165;
    else {
      const advance = (p & 1) === BLACK ? r : 7 - r;
      v = 100 + advance * 3;
      if (advance === 0) v += 4;
    }
    if (c >= 2 && c <= 5 && r >= 2 && r <= 5) v += 4;
    if (c === 0 || c === 7) v -= 2;
    score += (p & 1) === color ? v : -v;
  }
  return score;
}

const labelOf = (id) => (id <= 12 ? `B${id}` : `R${id - 12}`);

export default {
  id: 'checkers',
  name: 'Checkers',
  tagline: 'Jump a ghost to prove it was real.',
  colors: ['Black', 'Red'],
  rows: 8, cols: 8, squares: 32,
  coords: 'numbers',
  homeRow: [0, 7],
  placement: false,
  drawQuietPlies: 80,
  drawText: '40 moves each with no capture or man move',
  sqAt, rowOf, colOf,
  sqName: (sq) => String(sq + 1),
  initialBoard,
  boardKey: (b) => b.join(','),
  codeAt: (b, sq) => b[sq],
  idOf: (code) => code >> 2,
  colorOf: (code) => code & 1,
  kindOf: (code) => isKing(code),
  colorOfId: (id) => (id <= 12 ? BLACK : RED),
  labelOf,
  kindLabel: (kind) => (kind ? 'king' : ''),
  glyph: (color, kind) => (kind ? '♛' : ''),
  moves,
  canMove: (b, color) => moves(b, color).length > 0,
  apply,
  quiet: (b, m) => !isJump(m.path) && !!isKing(b[m.path[0]]),
  // Called for a world where `color` has no legal move.
  status: (b, color) => ({ winner: 1 - color, reason: 'nomoves' }),
  keyPath: parseKey,
  keyOrigin: (key) => parseKey(key)[0],
  fmtAlt: (key) => key,
  isPass: () => false,
  evaluate,
  ai: { splitsRoot: 40, splitsInner: 12 },
  notation: 'Squares are numbered 1–32. "B10 10-14 | 10-15" means B10 split to 14 and 15; "x" marks a jump and "&" separates the moves of different ghosts.',
};
