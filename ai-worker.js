// Runs the computer opponent off the main thread so the page stays responsive.
import { replay } from './shared/rules.js';
import { chooseMove } from './shared/ai.js';

self.onmessage = (e) => {
  const { id, moves, level } = e.data;
  try {
    const move = chooseMove(replay(moves), level);
    self.postMessage({ id, move });
  } catch (err) {
    self.postMessage({ id, error: String(err?.message || err) });
  }
};
