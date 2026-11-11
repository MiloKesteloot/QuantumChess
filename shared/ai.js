// Computer opponent, for any game the quantum engine supports.
//
// Search: negamax with alpha-beta over quantum moves, iterative deepening under a
// time budget. A position is scored by the game's *expected* evaluation over all
// worlds (each world equally likely). Because the side to move can collapse worlds
// in its own favour, the search naturally learns when splitting is safe and when
// the opponent would get to "choose" which ghost is real.
import { applyQuantumMove, allCandidates, summarize } from './quantum.js';
import { gameOf } from './games/index.js';

export const LEVELS = {
  easy: { maxDepth: 1, timeMs: 150, noise: 70, blunder: 0.2 },
  medium: { maxDepth: 3, timeMs: 700, noise: 12, blunder: 0 },
  hard: { maxDepth: 6, timeMs: 1800, noise: 0, blunder: 0 },
};

const WIN = 100000;
const MAX_AI_WORLDS = 48; // keep the search tractable: don't create more superposition than this
const MAX_COMBOS = 12;    // cap on "move every ghost" combinations per piece
const SPLIT_POOL = 8;     // splits are built from the best few single moves

export function evaluate(state, color) {
  if (state.result) {
    if (state.result.winner === null) return 0;
    return state.result.winner === color ? WIN : -WIN;
  }
  const g = gameOf(state.game);
  let total = 0;
  for (const w of state.worlds) total += g.evaluate(w.b, color);
  return total / state.worlds.length;
}

// Single-alternative moves and "move every ghost" combinations for the side to move.
export function generateMoves(state) {
  const g = gameOf(state.game);
  const skip = g.ai?.skip || (() => false);
  const moves = [];
  for (const [piece, byOrigin] of allCandidates(state)) {
    const origins = [...byOrigin.keys()];
    const cands = origins.map((o) => byOrigin.get(o).filter((c) => !skip(c.m)));
    origins.forEach((_, i) => {
      for (const c of cands[i]) moves.push({ piece, alts: [c.key], from: c.m.from, single: true });
    });
    // A split piece: move every ghost, one move each, keeping the superposition.
    if (origins.length > 1 && cands.every((c) => c.length)) {
      let combos = [[]];
      for (const c of cands) {
        const next = [];
        for (const prefix of combos) for (const x of c) next.push([...prefix, x.key]);
        combos = next.slice(0, MAX_COMBOS);
      }
      for (const alts of combos) moves.push({ piece, alts });
    }
  }
  return moves;
}

// Applies each candidate, drops the illegal / too-expensive ones, and adds up to
// `splits` split moves built from pairs of the best-looking single moves.
function expand(state, splits) {
  const g = gameOf(state.game);
  const color = state.turn;
  const limit = Math.max(MAX_AI_WORLDS, state.worlds.length);
  const out = [];
  const tryMove = (move) => {
    const r = applyQuantumMove(state, move);
    if (!r.ok || r.state.worlds.length > limit) return null;
    const ch = { move, state: r.state, order: evaluate(r.state, color) };
    out.push(ch);
    return ch;
  };
  const singles = [];
  for (const m of generateMoves(state)) {
    const ch = tryMove(m);
    if (ch && m.single) singles.push(ch);
  }
  if (splits > 0 && singles.length > 1) {
    singles.sort((a, b) => b.order - a.order);
    const pool = singles.slice(0, SPLIT_POOL);
    let made = 0;
    for (let i = 0; i < pool.length && made < splits; i++) {
      for (let j = i + 1; j < pool.length && made < splits; j++) {
        const a = pool[i].move, b = pool[j].move;
        if (a.piece !== b.piece || a.from !== b.from) continue;
        if (tryMove({ piece: a.piece, alts: [a.alts[0], b.alts[0]] })) made++;
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------- search
class Timeout extends Error {}

function negamax(state, depth, alpha, beta, ctx, ply) {
  if ((++ctx.nodes & 31) === 0 && Date.now() > ctx.deadline) throw new Timeout();
  const color = state.turn;
  if (state.result || depth === 0) {
    const v = evaluate(state, color);
    return v === WIN ? v - ply : v === -WIN ? v + ply : v; // prefer quicker wins, slower losses
  }
  const children = expand(state, state.worlds.length <= 16 ? ctx.splitsInner : 0);
  if (!children.length) return -WIN + ply;
  children.sort((a, b) => b.order - a.order); // best-looking first, so alpha-beta prunes more
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
  const g = gameOf(state.game);
  const ctx = { nodes: 0, deadline: Date.now() + cfg.timeMs, splitsInner: g.ai?.splitsInner ?? 6 };
  const root = expand(state, g.ai?.splitsRoot ?? 20);
  if (!root.length) return null;
  if (root.length === 1) return strip(root[0].move);
  if (cfg.blunder && random() < cfg.blunder) return strip(root[Math.floor(random() * root.length)].move);

  for (const ch of root) ch.score = ch.order; // depth-1 scores as a fallback
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
  return strip(pool[Math.floor(random() * pool.length)].move);
}

const strip = (m) => ({ piece: m.piece, alts: m.alts });
