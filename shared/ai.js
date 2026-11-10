// Computer opponent for Quantum Checkers.
//
// Search: negamax with alpha-beta over quantum moves, iterative deepening under a
// time budget. A position is scored by its *expected* material over all worlds
// (each world equally likely). Because the side to move can collapse worlds in its
// own favour, the search naturally learns when splitting is safe and when the
// opponent would get to "choose" which ghost is real.
import { applyQuantumMove, candidatePaths, summarize, rowOf, colOf, isKing, colorOfId, samePath, BLACK } from './rules.js';

export const LEVELS = {
  easy: { maxDepth: 1, timeMs: 150, noise: 70, blunder: 0.2 },
  medium: { maxDepth: 3, timeMs: 700, noise: 12, blunder: 0 },
  hard: { maxDepth: 6, timeMs: 1800, noise: 0, blunder: 0 },
};

const WIN = 100000;
const MAX_AI_WORLDS = 64; // keep the search tractable: don't create more superposition than this
const MAX_COMBOS = 12;    // cap on "move every ghost" combinations per piece

// ---------------------------------------------------------------- evaluation
// Material plus a little positional sense, averaged over worlds, from `color`'s view.
function evalBoard(b, color) {
  let score = 0;
  for (let sq = 0; sq < 32; sq++) {
    const p = b[sq];
    if (!p) continue;
    const mine = (p & 1) === color;
    const r = rowOf(sq), c = colOf(sq);
    let v;
    if (isKing(p)) v = 165;
    else {
      const advance = (p & 1) === BLACK ? r : 7 - r; // 0..7 toward promotion
      v = 100 + advance * 3;
      if (advance === 0) v += 4; // back-row guard
    }
    if (c >= 2 && c <= 5 && r >= 2 && r <= 5) v += 4; // centre
    if (c === 0 || c === 7) v -= 2; // edges are a bit passive
    score += mine ? v : -v;
  }
  return score;
}

export function evaluate(state, color) {
  if (state.result) {
    if (state.result.winner === null) return 0;
    return state.result.winner === color ? WIN : -WIN;
  }
  let total = 0;
  for (const w of state.worlds) total += evalBoard(w.b, color);
  return total / state.worlds.length;
}

// ---------------------------------------------------------------- move generation
// Every quantum move worth considering for the side to move.
export function generateMoves(state, { allowSplits = true } = {}) {
  const color = state.turn;
  const sum = summarize(state);
  const moves = [];
  for (const [id, info] of sum.pieces) {
    if (colorOfId(id) !== color || info.alive === 0) continue;
    const locs = [...info.locs.keys()];
    const cands = locs.map((l) => candidatePaths(state, id, l).map((c) => c.path));

    // Move one ghost (if the piece is split, this collapses it onto that ghost).
    locs.forEach((_, i) => {
      for (const p of cands[i]) moves.push({ piece: id, paths: [p] });
    });

    // Move every ghost, one path each, keeping the superposition.
    if (locs.length > 1 && cands.every((c) => c.length)) {
      let combos = [[]];
      for (const c of cands) {
        const next = [];
        for (const prefix of combos) for (const p of c) next.push([...prefix, p]);
        combos = next.slice(0, MAX_COMBOS);
      }
      for (const paths of combos) moves.push({ piece: id, paths });
    }

    // Split a piece that is in one place into two.
    if (allowSplits && locs.length === 1 && info.alive === sum.W && cands[0].length >= 2) {
      const c = cands[0];
      for (let i = 0; i < c.length; i++) {
        for (let j = i + 1; j < c.length; j++) moves.push({ piece: id, paths: [c[i], c[j]] });
      }
    }
  }
  return moves;
}

// Applies each candidate and drops the illegal / too-expensive ones.
function expand(state, allowSplits) {
  const out = [];
  for (const m of generateMoves(state, { allowSplits })) {
    const r = applyQuantumMove(state, m);
    if (!r.ok) continue;
    if (r.state.worlds.length > MAX_AI_WORLDS && r.state.worlds.length > state.worlds.length) continue;
    out.push({ move: m, state: r.state });
  }
  return out;
}

// ---------------------------------------------------------------- search
class Timeout extends Error {}

function negamax(state, depth, alpha, beta, ctx, ply) {
  if ((++ctx.nodes & 63) === 0 && Date.now() > ctx.deadline) throw new Timeout();
  const color = state.turn;
  if (state.result || depth === 0) {
    const v = evaluate(state, color);
    // Prefer quicker wins and slower losses.
    return v === WIN ? v - ply : v === -WIN ? v + ply : v;
  }
  const children = expand(state, state.worlds.length <= 16);
  if (!children.length) return -WIN + ply;
  // Order: best-looking first, so alpha-beta prunes more.
  for (const ch of children) ch.order = -evaluate(ch.state, ch.state.turn);
  children.sort((a, b) => b.order - a.order);
  let best = -Infinity;
  for (const ch of children) {
    const v = -negamax(ch.state, depth - 1, -beta, -alpha, ctx, ply + 1);
    if (v > best) best = v;
    if (v > alpha) alpha = v;
    if (alpha >= beta) break;
  }
  return best;
}

// Picks a move for the side to move. `random` is injectable for tests.
export function chooseMove(state, level = 'medium', random = Math.random) {
  const cfg = LEVELS[level] || LEVELS.medium;
  const color = state.turn;
  const root = expand(state, true);
  if (!root.length) return null;
  if (root.length === 1) return root[0].move;
  if (cfg.blunder && random() < cfg.blunder) return root[Math.floor(random() * root.length)].move;

  const ctx = { nodes: 0, deadline: Date.now() + cfg.timeMs };
  for (const ch of root) ch.score = evaluate(ch.state, color); // depth-1 scores as a fallback
  for (let depth = 2; depth <= cfg.maxDepth; depth++) {
    try {
      root.sort((a, b) => b.score - a.score);
      const scores = [];
      let alpha = -Infinity;
      for (const ch of root) {
        // Search with a window widened by the noise margin, so every move that could
        // end up in the "near-best" pool gets an exact score rather than a bound.
        const floor = alpha - cfg.noise - 1;
        const v = -negamax(ch.state, depth - 1, -Infinity, -floor, ctx, 1);
        scores.push(v);
        if (v > alpha) alpha = v;
      }
      root.forEach((ch, i) => (ch.score = scores[i]));
    } catch (e) {
      if (e instanceof Timeout) break; // keep the last fully searched depth
      throw e;
    }
  }

  // Choose among the near-best moves (noise makes easier levels less predictable).
  const best = Math.max(...root.map((c) => c.score));
  const pool = root.filter((c) => c.score >= best - cfg.noise - 1e-9);
  return pool[Math.floor(random() * pool.length)].move;
}

export function sameQuantumMove(a, b) {
  return a.piece === b.piece && a.paths.length === b.paths.length && a.paths.every((p, i) => samePath(p, b.paths[i]));
}
