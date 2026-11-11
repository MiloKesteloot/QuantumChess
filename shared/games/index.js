// The games that can be played with the quantum engine, in lobby order.
import checkers from './checkers.js';
import chess from './chess.js';
import reversi from './reversi.js';

export const GAMES = { checkers, chess, reversi };
export const GAME_IDS = ['checkers', 'chess', 'reversi'];

export function gameOf(id) {
  const g = GAMES[id];
  if (!g) throw new Error(`Unknown game: ${id}`);
  return g;
}
