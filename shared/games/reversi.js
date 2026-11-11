// Classical Reversi (Othello) rules, in the shape the quantum engine expects
// (see shared/quantum.js).
//
// Squares 0..63, sq = row * 8 + col, row 0 at the top (rank 8). Black is
// color 0 and moves first. A disc never moves, so a "piece" is identified by
// its square (id = sq + 1); what varies between worlds is whether it exists
// and which color it currently is.

const BLACK = 0, WHITE = 1;
const FILES = 'abcdefgh';

export const rowOf = (sq) => sq >> 3;
export const colOf = (sq) => sq & 7;
export const sqAt = (r, c) => (r < 0 || r > 7 || c < 0 || c > 7 ? -1 : r * 8 + c);
export const sqName = (sq) => FILES[sq & 7] + (8 - (sq >> 3));
export const sqOf = (name) => (8 - +name[1]) * 8 + FILES.indexOf(name[0]);

// A square holds 0, 1 (black) or 2 (white).
export function initialBoard() {
  const b = new Array(64).fill(0);
  b[sqOf('d5')] = 1;
  b[sqOf('e4')] = 1;
  b[sqOf('d4')] = 2;
  b[sqOf('e5')] = 2;
  return b;
}

const DIRS = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];

// Discs flipped by `color` placing on `sq`, or [] if the placement is illegal.
export function flips(b, sq, color) {
  if (b[sq]) return [];
  const me = color + 1, them = 2 - color;
  const out = [];
  const r = rowOf(sq), c = colOf(sq);
  for (const [dr, dc] of DIRS) {
    let rr = r + dr, cc = c + dc;
    const line = [];
    while (rr >= 0 && rr < 8 && cc >= 0 && cc < 8 && b[rr * 8 + cc] === them) {
      line.push(rr * 8 + cc);
      rr += dr;
      cc += dc;
    }
    if (line.length && rr >= 0 && rr < 8 && cc >= 0 && cc < 8 && b[rr * 8 + cc] === me) out.push(...line);
  }
  return out;
}

function placements(b, color) {
  const out = [];
  for (let sq = 0; sq < 64; sq++) {
    if (b[sq]) continue;
    const f = flips(b, sq, color);
    if (f.length) out.push({ key: sqName(sq), piece: 0, from: -1, to: sq, seq: [sq], flips: f, color });
  }
  return out;
}
function hasPlacement(b, color) {
  for (let sq = 0; sq < 64; sq++) if (!b[sq] && flips(b, sq, color).length) return true;
  return false;
}

const PASS = { key: 'pass', piece: 0, from: -1, to: -1, seq: [], pass: true };

// If you cannot place a disc you must pass, unless nobody can move (game over).
export function moves(b, color) {
  const p = placements(b, color);
  if (p.length) return p;
  return hasPlacement(b, 1 - color) ? [PASS] : [];
}
export function canMove(b, color) {
  return hasPlacement(b, color) || hasPlacement(b, 1 - color);
}

export function apply(b, m) {
  const nb = b.slice();
  if (m.pass) return nb;
  nb[m.to] = m.color + 1;
  for (const sq of m.flips) nb[sq] = m.color + 1;
  return nb;
}

export function count(b) {
  let black = 0, white = 0;
  for (const v of b) {
    if (v === 1) black++;
    else if (v === 2) white++;
  }
  return [black, white];
}

function status(b) {
  const [black, white] = count(b);
  return { winner: black === white ? null : black > white ? BLACK : WHITE, reason: 'count', score: [black, white] };
}

// Game over in every world: the final score is the average over timelines.
function finish(statuses) {
  let black = 0, white = 0;
  for (const s of statuses) {
    black += s.score[0];
    white += s.score[1];
  }
  black = Math.round((10 * black) / statuses.length) / 10;
  white = Math.round((10 * white) / statuses.length) / 10;
  return { winner: black === white ? null : black > white ? BLACK : WHITE, reason: 'count', score: [black, white] };
}

// Classic positional weights: corners are gold, the squares next to them are poison.
const W = [
  120, -20, 20, 5, 5, 20, -20, 120,
  -20, -40, -5, -5, -5, -5, -40, -20,
  20, -5, 15, 3, 3, 15, -5, 20,
  5, -5, 3, 3, 3, 3, -5, 5,
  5, -5, 3, 3, 3, 3, -5, 5,
  20, -5, 15, 3, 3, 15, -5, 20,
  -20, -40, -5, -5, -5, -5, -40, -20,
  120, -20, 20, 5, 5, 20, -20, 120,
];
function evaluate(b, color) {
  const me = color + 1;
  let score = 0, discs = 0, mine = 0;
  for (let sq = 0; sq < 64; sq++) {
    const v = b[sq];
    if (!v) continue;
    discs++;
    if (v === me) {
      score += W[sq];
      mine++;
    } else score -= W[sq];
  }
  // Early on, fewer discs is often better (mobility); late, discs are everything.
  const late = discs > 50;
  return score + (late ? 12 : -2) * (2 * mine - discs);
}

export default {
  id: 'reversi',
  name: 'Reversi',
  tagline: 'Every placement is a measurement.',
  colors: ['Black', 'White'],
  rows: 8, cols: 8, squares: 64,
  coords: 'algebraic',
  homeRow: null,
  placement: true,
  drawQuietPlies: null,
  sqAt, rowOf, colOf, sqName,
  initialBoard,
  boardKey: (b) => b.join(''),
  codeAt: (b, sq) => (b[sq] ? ((sq + 1) << 1) | (b[sq] - 1) : 0),
  idOf: (code) => code >> 1,
  colorOf: (code) => code & 1,
  kindOf: () => 0,
  colorOfId: () => null, // a disc's color depends on the world
  labelOf: (id) => (id ? sqName(id - 1) : 'disc'),
  kindLabel: () => '',
  glyph: () => '',
  moves, canMove, apply,
  quiet: () => false,
  status, finish,
  keyPath: (key) => (key === 'pass' ? [] : [sqOf(key)]),
  keyOrigin: () => -1,
  fmtAlt: (key) => key,
  isPass: (key) => key === 'pass',
  absentWord: 'empty',
  evaluate,
  ai: { splitsRoot: 20, splitsInner: 6 },
  notation: '"d3 | e6" means a disc was placed on both d3 and e6 (in different worlds). Discs are named by their square.',
};
