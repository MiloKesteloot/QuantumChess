// An online game room. In peer-to-peer play this runs inside the host's
// browser: the host's own UI and every guest connection are "clients".
// Guests are untrusted, so every action is validated here with the rules engine.
//
// A client is any object with: send(msg), isOpen(), and a `token` property
// that the room sets when the client joins.
import { initialState, applyQuantumMove, replay } from './quantum.js';

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function randomCode(n = 5) {
  const a = new Uint32Array(n);
  globalThis.crypto.getRandomValues(a);
  return [...a].map((x) => ALPHABET[x % ALPHABET.length]).join('');
}

export function randomToken() {
  const a = new Uint8Array(16);
  globalThis.crypto.getRandomValues(a);
  return [...a].map((x) => x.toString(16).padStart(2, '0')).join('');
}

export function normalizeCode(code) {
  return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
}

export class Room {
  constructor(code, { game = 'checkers', saved = null, onChange = () => {} } = {}) {
    this.code = code;
    this.clients = new Set();
    this.onChange = onChange;
    this.tokens = [null, null]; // tokens[color] identifies the player in that seat
    this.game = saved ? saved.game : game;
    this.state = initialState(this.game);
    this.result = null; // resign / agreed draw; engine results live in state.result
    this.drawOffer = null;
    this.rematch = [false, false];
    if (saved) {
      this.tokens = saved.tokens;
      this.state = replay(this.game, saved.moves);
      this.result = saved.result;
      this.drawOffer = saved.drawOffer;
      this.rematch = saved.rematch;
    }
  }

  serialize() {
    return {
      code: this.code,
      game: this.game,
      tokens: this.tokens,
      moves: this.state.moves,
      result: this.result,
      drawOffer: this.drawOffer,
      rematch: this.rematch,
    };
  }

  // The creator takes a seat before anyone connects. color: 0 | 1 | 'random'.
  claimSeat(color) {
    const seat = color === 0 || color === 1 ? color : randomToken().charCodeAt(0) % 2;
    const token = randomToken();
    this.tokens[seat] = token;
    return token;
  }

  seatOf(token) {
    return token ? this.tokens.indexOf(token) : -1;
  }

  join(client, token) {
    let t = typeof token === 'string' && this.seatOf(token) >= 0 ? token : null;
    // A second tab of the same browser presents the same token while the first
    // is still connected. If the other seat is open, seat it there instead.
    if (t && this.tokens.includes(null) &&
        [...this.clients].some((c) => c !== client && c.token === t && c.isOpen())) {
      t = null;
    }
    if (!t) {
      t = randomToken();
      const free = this.tokens.indexOf(null);
      if (free >= 0) this.tokens[free] = t; // otherwise: spectator
    }
    client.token = t;
    this.clients.add(client);
    client.send({ t: 'joined', room: this.code, token: t });
    this.changed();
  }

  leave(client) {
    if (this.clients.delete(client)) this.broadcast();
  }

  handle(client, msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'join') return this.join(client, msg.token);
    if (!this.clients.has(client)) return;
    const seat = this.seatOf(client.token);
    const err = (m) => client.send({ t: 'error', msg: m });
    if (seat < 0) return err('Spectators cannot act.');
    const over = this.result || this.state.result;

    switch (msg.t) {
      case 'move': {
        if (over) return err('The game is over.');
        if (this.state.turn !== seat) return err('Not your turn.');
        if (msg.ply !== this.state.ply) return this.broadcast(); // stale client: resync
        const r = applyQuantumMove(this.state, msg.move);
        if (!r.ok) return err(r.error);
        this.state = r.state;
        this.drawOffer = null;
        break;
      }
      case 'resign':
        if (over) return;
        this.result = { winner: 1 - seat, reason: 'resign' };
        break;
      case 'offerDraw':
        if (over) return;
        this.drawOffer = seat;
        break;
      case 'answerDraw':
        if (over || this.drawOffer !== 1 - seat) return;
        if (msg.accept) this.result = { winner: null, reason: 'agreement' };
        this.drawOffer = null;
        break;
      case 'rematch':
        if (!over) return;
        this.rematch[seat] = true;
        if (this.rematch[0] && this.rematch[1]) {
          this.tokens.reverse(); // swap colors
          this.state = initialState(this.game);
          this.result = null;
          this.drawOffer = null;
          this.rematch = [false, false];
        }
        break;
      default:
        return;
    }
    this.changed();
  }

  changed() {
    this.onChange(this);
    this.broadcast();
  }

  broadcast() {
    const online = [0, 1].map((c) => [...this.clients].some((cl) => cl.isOpen() && this.seatOf(cl.token) === c));
    for (const cl of this.clients) {
      if (!cl.isOpen()) continue;
      const seat = this.seatOf(cl.token);
      cl.send({
        t: 'state',
        room: this.code,
        game: this.game,
        you: seat >= 0 ? seat : null,
        moves: this.state.moves,
        result: this.result || this.state.result,
        drawOffer: this.drawOffer,
        online,
        seated: this.tokens.map(Boolean),
        rematch: this.rematch,
      });
    }
  }
}
