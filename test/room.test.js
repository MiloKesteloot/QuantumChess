import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Room, randomCode, normalizeCode } from '../shared/room.js';
import { BLACK, RED } from '../shared/rules.js';

function fakeClient() {
  const c = { token: null, open: true, inbox: [], send: (m) => c.inbox.push(m), isOpen: () => c.open };
  c.last = (t) => [...c.inbox].reverse().find((m) => m.t === t);
  return c;
}

function setup() {
  const room = new Room('ABCDE');
  const host = fakeClient();
  room.join(host, room.claimSeat('black'));
  const guest = fakeClient();
  room.handle(guest, { t: 'join' });
  return { room, host, guest };
}

test('creator gets the chosen seat, first guest gets the other, third is a spectator', () => {
  const { room, host, guest } = setup();
  assert.equal(host.last('state').you, BLACK);
  assert.equal(guest.last('state').you, RED);
  const spec = fakeClient();
  room.handle(spec, { t: 'join' });
  assert.equal(spec.last('state').you, null);
  room.handle(spec, { t: 'resign' });
  assert.equal(spec.last('error').msg, 'Spectators cannot act.');
});

test('moves are validated: turn order, legality, stale ply', () => {
  const { room, host, guest } = setup();
  room.handle(guest, { t: 'move', ply: 0, move: { piece: 22, paths: [[21, 17]] } });
  assert.equal(guest.last('error').msg, 'Not your turn.');
  room.handle(host, { t: 'move', ply: 0, move: { piece: 9, paths: [[8, 20]] } });
  assert.ok(host.last('error'));
  room.handle(host, { t: 'move', ply: 0, move: { piece: 10, paths: [[9, 13], [9, 14]] } });
  assert.equal(guest.last('state').moves.length, 1);
  const before = guest.inbox.length;
  room.handle(guest, { t: 'move', ply: 0, move: { piece: 14, paths: [[21, 17]] } }); // stale ply
  assert.equal(room.state.ply, 1);
  assert.ok(guest.inbox.length > before, 'stale client is resynced');
});

test('reconnecting with a token keeps the seat', () => {
  const { room, guest } = setup();
  guest.open = false;
  room.leave(guest);
  const again = fakeClient();
  room.handle(again, { t: 'join', token: guest.token });
  assert.equal(again.last('state').you, RED);
});

test('a second tab with the same token takes the open seat instead', () => {
  const room = new Room('ABCDE');
  const host = fakeClient();
  const token = room.claimSeat('black');
  room.join(host, token);
  const tab2 = fakeClient();
  room.handle(tab2, { t: 'join', token });
  assert.equal(tab2.last('state').you, RED);
});

test('resign, draw and rematch with color swap', () => {
  const { room, host, guest } = setup();
  room.handle(host, { t: 'offerDraw' });
  room.handle(guest, { t: 'answerDraw', accept: false });
  assert.equal(room.drawOffer, null);
  room.handle(guest, { t: 'resign' });
  assert.deepEqual(host.last('state').result, { winner: BLACK, reason: 'resign' });
  room.handle(host, { t: 'rematch' });
  room.handle(guest, { t: 'rematch' });
  assert.equal(host.last('state').you, RED);
  assert.equal(guest.last('state').you, BLACK);
  assert.equal(host.last('state').result, null);
});

test('a hosted room survives serialize and restore', () => {
  const { room, host } = setup();
  room.handle(host, { t: 'move', ply: 0, move: { piece: 10, paths: [[9, 13], [9, 14]] } });
  const restored = new Room('ABCDE', { saved: JSON.parse(JSON.stringify(room.serialize())) });
  assert.equal(restored.state.worlds.length, 2);
  assert.deepEqual(restored.tokens, room.tokens);
});

test('codes', () => {
  assert.match(randomCode(), /^[A-Z2-9]{5}$/);
  assert.equal(normalizeCode(' ab-cd e '), 'ABCDE');
});
