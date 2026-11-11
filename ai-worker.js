// Runs the computer opponent off the main thread so the page stays responsive.
import { replay } from './shared/quantum.js';
import { chooseMove } from './shared/ai.js';

self.onmessage = (e) => {
  const { id, game, moves, level } = e.data;
  try {
    const move = chooseMove(replay(game, moves), level);
    self.postMessage({ id, move });
  } catch (err) {
    self.postMessage({ id, error: String(err?.message || err) });
  }
};
