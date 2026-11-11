// Classical chess rules, in the shape the quantum engine expects (see
// shared/quantum.js). Full rules: castling, en passant, promotion, check.
//
// Squares 0..63, sq = row * 8 + col. Row 0 is rank 8 (Black's back rank),
// row 7 is rank 1. White is color 0 and moves first.

const WHITE = 0, BLACK = 1;
const P = 0, N = 1, B = 2, R = 3, Q = 4, K = 5;
const FILES = 'abcdefgh';

export const rowOf = (sq) => sq >> 3;
export const colOf = (sq) => sq & 7;
export const sqAt = (r, c) => (r < 0 || r > 7 || c < 0 || c > 7 ? -1 : r * 8 + c);
export const sqName = (sq) => FILES[sq & 7] + (8 - (sq >> 3));
export function sqOf(name) {
  return (8 - +name[1]) * 8 + FILES.indexOf(name[0]);
}

// A square holds 0 or (id << 4) | (kind << 1) | color. ids 1..16 White, 17..32 Black.
export const makeCode = (id, color, kind) => (id << 4) | (kind << 1) | color;
const idOf = (c) => c >> 4;
const kindOf = (c) => (c >> 1) & 7;
const colorOf = (c) => c & 1;

const BACK = [R, N, B, Q, K, B, N, R];
// Initial square and kind of each piece id, for labels.
const START = [null];
for (let i = 0; i < 8; i++) START.push({ kind: BACK[i], sq: 56 + i, color: WHITE });
for (let i = 0; i < 8; i++) START.push({ kind: P, sq: 48 + i, color: WHITE });
for (let i = 0; i < 8; i++) START.push({ kind: BACK[i], sq: i, color: BLACK });
for (let i = 0; i < 8; i++) START.push({ kind: P, sq: 8 + i, color: BLACK });

const GLYPHS = ['♙♘♗♖♕♔', '♟♞♝♜♛♚'];
export const glyph = (color, kind) => GLYPHS[color][kind];
const labelOf = (id) => glyph(START[id].color, START[id].kind) + sqName(START[id].sq);

// Castling rights bits. ep: the square a pawn just jumped over, or -1.
const WK = 1, WQ = 2, BK = 4, BQ = 8;

export function initialBoard() {
  const s = new Array(64).fill(0);
  for (let id = 1; id <= 32; id++) s[START[id].sq] = makeCode(id, START[id].color, START[id].kind);
  return { s, c: WK | WQ | BK | BQ, ep: -1 };
}

const KNIGHT = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
const KING = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
const BISHOP = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
const ROOK = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const pawnDir = (color) => (color === WHITE ? -1 : 1);

// Is `sq` attacked by `by`?
export function attacked(s, sq, by) {
  const r = rowOf(sq), c = colOf(sq);
  const pr = r - pawnDir(by); // pawns of `by` attack from the row they come from
  for (const dc of [-1, 1]) {
    const t = sqAt(pr, c + dc);
    if (t >= 0 && s[t] && colorOf(s[t]) === by && kindOf(s[t]) === P) return true;
  }
  for (const [dr, dc] of KNIGHT) {
    const t = sqAt(r + dr, c + dc);
    if (t >= 0 && s[t] && colorOf(s[t]) === by && kindOf(s[t]) === N) return true;
  }
  for (const [dr, dc] of KING) {
    const t = sqAt(r + dr, c + dc);
    if (t >= 0 && s[t] && colorOf(s[t]) === by && kindOf(s[t]) === K) return true;
  }
  for (const [dirs, k1] of [[BISHOP, B], [ROOK, R]]) {
    for (const [dr, dc] of dirs) {
      let rr = r + dr, cc = c + dc;
      while (rr >= 0 && rr < 8 && cc >= 0 && cc < 8) {
        const p = s[rr * 8 + cc];
        if (p) {
          if (colorOf(p) === by && (kindOf(p) === k1 || kindOf(p) === Q)) return true;
          break;
        }
        rr += dr;
        cc += dc;
      }
    }
  }
  return false;
}

function kingSq(s, color) {
  for (let sq = 0; sq < 64; sq++) if (s[sq] && colorOf(s[sq]) === color && kindOf(s[sq]) === K) return sq;
  return -1;
}
export const inCheck = (b, color) => {
  const k = kingSq(b.s, color);
  return k >= 0 && attacked(b.s, k, 1 - color);
};

const PROMO = 'qrbn';
const PROMO_KIND = { q: Q, r: R, b: B, n: N };

function pseudoMoves(b, color) {
  const { s } = b;
  const out = [];
  const add = (from, to, extra = {}) => {
    const p = s[from];
    const m = { key: sqName(from) + sqName(to), piece: idOf(p), from, to, seq: [to], kind: kindOf(p), ...extra };
    if (extra.promo) m.key += extra.promo;
    out.push(m);
  };
  for (let from = 0; from < 64; from++) {
    const p = s[from];
    if (!p || colorOf(p) !== color) continue;
    const kind = kindOf(p), r = rowOf(from), c = colOf(from);
    if (kind === P) {
      const d = pawnDir(color);
      const last = color === WHITE ? 0 : 7;
      const start = color === WHITE ? 6 : 1;
      const push = (to, capture) => {
        if (rowOf(to) === last) for (const pr of PROMO) add(from, to, { promo: pr, capture });
        else add(from, to, { capture });
      };
      const one = sqAt(r + d, c);
      if (one >= 0 && !s[one]) {
        push(one, false);
        const two = sqAt(r + 2 * d, c);
        if (r === start && !s[two]) add(from, two, { double: true });
      }
      for (const dc of [-1, 1]) {
        const t = sqAt(r + d, c + dc);
        if (t < 0) continue;
        if (s[t] && colorOf(s[t]) !== color) push(t, true);
        else if (t === b.ep && !s[t]) add(from, t, { ep: true, capture: true });
      }
    } else if (kind === N || kind === K) {
      for (const [dr, dc] of kind === N ? KNIGHT : KING) {
        const t = sqAt(r + dr, c + dc);
        if (t >= 0 && (!s[t] || colorOf(s[t]) !== color)) add(from, t, { capture: !!s[t] });
      }
      if (kind === K) {
        const home = color === WHITE ? 60 : 4;
        const [ks, qs] = color === WHITE ? [WK, WQ] : [BK, BQ];
        const opp = 1 - color;
        if (from === home && !attacked(s, home, opp)) {
          if ((b.c & ks) && !s[home + 1] && !s[home + 2] && s[home + 3] && kindOf(s[home + 3]) === R && colorOf(s[home + 3]) === color &&
              !attacked(s, home + 1, opp) && !attacked(s, home + 2, opp)) {
            add(from, home + 2, { castle: 'O-O' });
          }
          if ((b.c & qs) && !s[home - 1] && !s[home - 2] && !s[home - 3] && s[home - 4] && kindOf(s[home - 4]) === R && colorOf(s[home - 4]) === color &&
              !attacked(s, home - 1, opp) && !attacked(s, home - 2, opp)) {
            add(from, home - 2, { castle: 'O-O-O' });
          }
        }
      }
    } else {
      const dirs = kind === B ? BISHOP : kind === R ? ROOK : [...BISHOP, ...ROOK];
      for (const [dr, dc] of dirs) {
        let rr = r + dr, cc = c + dc;
        while (rr >= 0 && rr < 8 && cc >= 0 && cc < 8) {
          const t = rr * 8 + cc;
          if (s[t]) {
            if (colorOf(s[t]) !== color) add(from, t, { capture: true });
            break;
          }
          add(from, t, {});
          rr += dr;
          cc += dc;
        }
      }
    }
  }
  return out;
}

// Only kings, or a king against a lone minor piece: nobody can ever mate.
function isDead(s) {
  let minors = 0;
  for (let sq = 0; sq < 64; sq++) {
    const p = s[sq];
    if (!p || kindOf(p) === K) continue;
    if (kindOf(p) === N || kindOf(p) === B) minors++;
    else return false;
  }
  return minors <= 1;
}

export function moves(b, color) {
  if (isDead(b.s)) return [];
  const out = [];
  for (const m of pseudoMoves(b, color)) {
    const nb = apply(b, m);
    if (!inCheck(nb, color)) out.push(m);
  }
  return out;
}

export function canMove(b, color) {
  if (isDead(b.s)) return false;
  for (const m of pseudoMoves(b, color)) if (!inCheck(apply(b, m), color)) return true;
  return false;
}

export function apply(b, m) {
  const s = b.s.slice();
  let p = s[m.from];
  const color = colorOf(p);
  s[m.from] = 0;
  if (m.ep) s[m.to - pawnDir(color) * 8] = 0;
  if (m.promo) p = makeCode(idOf(p), color, PROMO_KIND[m.promo]);
  s[m.to] = p;
  if (m.castle) {
    const rookFrom = m.castle === 'O-O' ? m.to + 1 : m.to - 2;
    const rookTo = m.castle === 'O-O' ? m.to - 1 : m.to + 1;
    s[rookTo] = s[rookFrom];
    s[rookFrom] = 0;
  }
  let c = b.c;
  for (const sq of [m.from, m.to]) {
    if (sq === 60) c &= ~(WK | WQ);
    else if (sq === 63) c &= ~WK;
    else if (sq === 56) c &= ~WQ;
    else if (sq === 4) c &= ~(BK | BQ);
    else if (sq === 7) c &= ~BK;
    else if (sq === 0) c &= ~BQ;
  }
  return { s, c, ep: m.double ? (m.from + m.to) / 2 : -1 };
}

function isCapture(b, m) {
  return !!b.s[m.to] || !!m.ep;
}

// ---------------------------------------------------------------- evaluation (AI)
const VALUE = [100, 320, 330, 500, 900, 0];
const CENTER = [0, 1, 2, 3, 3, 2, 1, 0];
function evaluate(b, color) {
  const { s } = b;
  let score = 0;
  for (let sq = 0; sq < 64; sq++) {
    const p = s[sq];
    if (!p) continue;
    const kind = kindOf(p), pc = colorOf(p), r = rowOf(sq), c = colOf(sq);
    let v = VALUE[kind];
    if (kind === P) v += (pc === WHITE ? 6 - r : r - 1) * 5 + CENTER[c];
    else if (kind === N || kind === B) v += (CENTER[r] + CENTER[c]) * 3;
    else if (kind === Q) v += CENTER[r] + CENTER[c];
    score += pc === color ? v : -v;
  }
  return score;
}

const KIND_NAMES = ['pawn', 'knight', 'bishop', 'rook', 'queen', 'king'];

// Keys: "e2e4", "e7e8q" (promotion), and for captures also "d1xh5": a *declared*
// capture, legal only in worlds where there really is a piece to take. The
// plain key is legal either way (a capture where the piece is, a quiet move
// where it isn't), so declaring the capture is how you prove a ghost was real.
function parseKey(key) {
  const x = key[2] === 'x';
  return { from: sqOf(key.slice(0, 2)), to: sqOf(key.slice(x ? 3 : 2, x ? 5 : 4)), promo: key[x ? 5 : 4], capture: x };
}
const keysOf = (m) => (m.capture ? [m.key, m.key.slice(0, 2) + 'x' + m.key.slice(2)] : [m.key]);

export default {
  id: 'chess',
  name: 'Chess',
  tagline: 'Checks and captures collapse the board.',
  colors: ['White', 'Black'],
  rows: 8, cols: 8, squares: 64,
  coords: 'algebraic',
  homeRow: [7, 0],
  placement: false,
  drawQuietPlies: 100,
  drawText: '50 moves each with no capture or pawn move',
  sqAt, rowOf, colOf, sqName,
  initialBoard,
  boardKey: (b) => `${b.s.join(',')}|${b.c}|${b.ep}`,
  codeAt: (b, sq) => b.s[sq],
  idOf, colorOf, kindOf,
  colorOfId: (id) => (id <= 16 ? WHITE : BLACK),
  labelOf,
  kindLabel: (kind) => KIND_NAMES[kind],
  glyph,
  moves, canMove, apply,
  quiet: (b, m) => m.kind !== P && !isCapture(b, m),
  status: (b, color) => (isDead(b.s) ? { winner: null, reason: 'material' }
    : inCheck(b, color) ? { winner: 1 - color, reason: 'checkmate' } : { winner: null, reason: 'stalemate' }),
  inCheck,
  kingKind: K,
  keysOf,
  keyPath: (key) => {
    const k = parseKey(key);
    return [k.from, k.to];
  },
  keyOrigin: (key) => parseKey(key).from,
  keyTarget: (key) => parseKey(key).to,
  isCaptureKey: (key) => key[2] === 'x',
  fmtAlt: (key) => {
    const k = parseKey(key);
    return `${sqName(k.from)}${k.capture ? 'x' : '-'}${sqName(k.to)}${k.promo ? '=' + k.promo.toUpperCase() : ''}`;
  },
  isPass: () => false,
  // Promotion choices for one destination are listed in this order in the UI.
  promoOrder: ['q', 'n', 'r', 'b'],
  evaluate,
  ai: { splitsRoot: 24, splitsInner: 6, skip: (m) => m.promo === 'r' || m.promo === 'b' },
  notation: 'Pieces are named by their starting square: ♘g1 is the knight that began on g1. "♘g1 g1-f3 | g1-h3" means it split to f3 and h3; "&" separates the moves of different ghosts.',
};
