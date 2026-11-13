import * as Q from './shared/quantum.js';
import { GAMES, GAME_IDS, gameOf } from './shared/games/index.js';
import { Room, randomCode, normalizeCode } from './shared/room.js';
import { setupHelp, miniBoard } from './help.js';

const $ = (s) => document.querySelector(s);
const boardEl = $('#board');
const PATH_COLORS = ['#1f5fff', '#ff3d9a', '#ffb400', '#00a95c', '#8a4fff', '#ff6c2f', '#00b3a4', '#17141f'];

function loadPref(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}
function savePref(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

const params = new URLSearchParams(location.search);
const firstGame = GAME_IDS.includes(params.get('game')) ? params.get('game') : loadPref('qg-game', 'checkers');

const ui = {
  gameId: GAME_IDS.includes(firstGame) ? firstGame : 'checkers',
  mode: null, // 'local' | 'online' | 'ai'
  game: null, // engine state
  sum: null,
  history: [], // local undo stack
  bottom: 0, // the color at the bottom of the board: you, or whoever moves first
  menuPage: 'home',
  plan: null, // { piece, active, alts: [{ from, seq, key, choices, promo, declared }], cur, cache }
  previewing: false,
  preview: null, // { ok, state?, error?, effects? }
  me: null, // online seat (0/1) or null for spectator
  room: null,
  roomInfo: null,
  pending: false,
  connected: false,
  isHost: false,
  aiColor: null,
  aiLevel: 'medium',
  aiThinking: false,
  aiReq: 0,
  autoPass: -1,
  notes: [], // per ply: { worlds: [before, after], effects: [...] } for the move log
};
let G = gameOf(ui.gameId); // the current game's rules module
ui.game = Q.initialState(ui.gameId);

// Boards are stored with row 0 at the top; turn them round when the bottom player's home row is row 0.
const flipped = () => !!G.homeRow && G.homeRow[ui.bottom] === 0;

function setGameId(id) {
  ui.gameId = id;
  G = gameOf(id);
  document.body.dataset.game = id;
  savePref('qg-game', id);
}

// ================================================================ helpers
const sameMove = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const seqStarts = (seq, prefix) => prefix.every((s, i) => seq[i] === s);
const seqEq = (a, b) => a.length === b.length && seqStarts(a, b);
const uniq = (xs) => [...new Set(xs)];
const colorName = (c) => G.colors[c];
const cls = (c) => `c${c}`;
const pieceNoun = (n) => (G.placement ? 'disc' : 'piece') + (n === 1 ? '' : 's');

function result() {
  return ui.mode === 'online' ? ui.roomInfo?.result ?? null : ui.game.result;
}
function canAct() {
  if (result() || ui.pending) return false;
  if (ui.mode === 'local') return true;
  if (ui.mode === 'ai') return ui.game.turn !== ui.aiColor && !ui.aiThinking;
  return ui.mode === 'online' && ui.me === ui.game.turn && ui.connected;
}

function resultText(res) {
  if (!res) return '';
  const W = ui.game.worlds.length;
  if (res.winner === null) {
    switch (res.reason) {
      case 'agreement': return 'Draw by agreement';
      case 'quiet': return `Draw: ${G.drawText}`;
      case 'stalemate': return 'Draw by stalemate';
      case 'material': return 'Draw: neither side can checkmate';
      case 'count': return `Draw: ${res.score[0]} discs each${W > 1 ? ' on average' : ''}`;
      default: return 'Draw';
    }
  }
  const w = colorName(res.winner), l = colorName(1 - res.winner);
  switch (res.reason) {
    case 'resign': return `${w} wins — ${l} resigned`;
    case 'checkmate': return `${w} wins by checkmate`;
    case 'count': return `${w} wins ${res.score[res.winner]}–${res.score[1 - res.winner]}${W > 1 ? ` (average discs over ${W} timelines)` : ''}`;
    default: return `${w} wins — ${l} has no legal move in any world`;
  }
}

let toastTimer = null;
function toast(html, ms = 4500) {
  const t = $('#toast');
  t.innerHTML = html;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), ms);
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// ================================================================ board rendering
function displayRC(sq) {
  const r = G.rowOf(sq), c = G.colOf(sq);
  return flipped() ? [7 - r, 7 - c] : [r, c];
}

// Majority color / kind of a piece on one square, and whether they vary between worlds.
function variant(e) {
  let best = null, bestN = -1;
  const byColor = [0, 0];
  const kinds = new Set();
  for (const [vk, n] of e.vars) {
    byColor[vk >> 3] += n;
    kinds.add(vk & 7);
    if (n > bestN) {
      bestN = n;
      best = vk;
    }
  }
  return { color: best >> 3, kind: best & 7, mixedColor: byColor[0] > 0 && byColor[1] > 0, partialKind: kinds.size > 1 };
}

function buildBoard(el, state, sum) {
  el.innerHTML = '';
  const flip = flipped();
  const frag = document.createDocumentFragment();
  for (let vr = 0; vr < 8; vr++) {
    for (let vc = 0; vc < 8; vc++) {
      const r = flip ? 7 - vr : vr, c = flip ? 7 - vc : vc;
      const sq = G.sqAt(r, c);
      const cell = document.createElement('div');
      cell.className = 'cell ' + ((r + c) % 2 ? 'dark' : 'light');
      if (sq >= 0) {
        cell.dataset.sq = sq;
        if (G.coords === 'numbers') {
          const n = document.createElement('span');
          n.className = 'num';
          n.textContent = G.sqName(sq);
          cell.append(n);
        } else {
          if (vc === 0) cell.append(Object.assign(document.createElement('span'), { className: 'num rank', textContent: G.sqName(sq)[1] }));
          if (vr === 7) cell.append(Object.assign(document.createElement('span'), { className: 'num file', textContent: G.sqName(sq)[0] }));
        }
        const entries = [...sum.squares[sq]].sort((a, b) => b[1].n - a[1].n);
        // Up to 4 different pieces fit on a square; beyond that, show 3 and a "+N" badge.
        const shown = entries.length > 4 ? entries.slice(0, 3) : entries;
        shown.forEach(([id, e], i) => cell.append(pieceEl(id, e, sum, entries.length > 1 ? i : -1, sq)));
        if (entries.length > 4) {
          const more = document.createElement('div');
          more.className = 'more';
          more.textContent = `+${entries.length - 3}`;
          more.title = `Might also be here: ${entries.slice(3).map(([id]) => G.labelOf(id)).join(', ')}`;
          cell.append(more);
        }
        if (sum.checks.has(sq)) cell.classList.add('check');
      }
      frag.append(cell);
    }
  }
  el.append(frag);
}

// One piece on one square. A piece that is not certainly here (it may be on
// another square, or captured) is drawn as a see-through ghost.
function pieceEl(id, e, sum, slot, sq) {
  const d = document.createElement('div');
  const p = sum.pieces.get(id);
  const v = variant(e);
  const ghost = e.n < sum.W;
  d.className = `piece ${G.id} ${cls(v.color)} k${v.kind}`;
  if (ghost) d.classList.add('ghost');
  if (v.mixedColor) d.classList.add('mixed');
  if (slot >= 0) d.classList.add('mini', `slot${Math.min(slot, 3)}`);
  d.dataset.id = id;
  let title = G.labelOf(id);
  if (G.kindLabel(v.kind) && !v.partialKind) title += ` (${G.kindLabel(v.kind)})`;
  if (p.locs.size > 1) title += `: might be here, or on ${[...p.locs.keys()].filter((s) => s !== sq).map(G.sqName).join(' or ')}`;
  else if (ghost) title += `: might be here, or ${G.absentWord || 'captured'}`;
  if (v.mixedColor) title += `: ${colorName(0).toLowerCase()} or ${colorName(1).toLowerCase()}`;
  if (v.partialKind) {
    title += `; might be a ${G.kindLabel(v.kind) || 'plain piece'}`;
    d.append(Object.assign(document.createElement('span'), { className: 'badge', textContent: '?' }));
  }
  d.title = title;
  return d;
}

function center(sq) {
  const [r, c] = displayRC(sq);
  return [c + 0.5, r + 0.5];
}

// Pairs of squares to join with a line: the places one piece might be.
function ghostLinks(sum) {
  const out = [];
  for (const [id, p] of sum.pieces) {
    if (p.locs.size < 2) continue;
    const sqs = [...p.locs.keys()].sort((a, b) => G.colOf(a) - G.colOf(b) || G.rowOf(a) - G.rowOf(b));
    for (let i = 1; i < sqs.length; i++) out.push({ id, a: sqs[i - 1], b: sqs[i] });
  }
  return out;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
function svgEl(tag, attrs) {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

// lines: [{ path, color, opacity }]      arrows for planned moves
// dots:  [{ sq, color, ring }]           squares the piece can go to (a ring where something stands)
// rings: [{ sq, color }]                 planned placements
// links: [{ id, a, b }]                  joins the ghosts of one piece
function drawOverlay(el, lines, dots = [], rings = [], links = []) {
  const svg = svgEl('svg', { viewBox: '0 0 8 8', class: 'overlay' });
  const defs = svgEl('defs', {});
  svg.append(defs);
  for (const l of links) {
    const [x1, y1] = center(l.a), [x2, y2] = center(l.b);
    const len = Math.hypot(x2 - x1, y2 - y1);
    const t = Math.min(0.4, len / 2 - 0.05) / len; // stop short of the pieces themselves
    const line = svgEl('line', {
      class: 'link', x1: x1 + (x2 - x1) * t, y1: y1 + (y2 - y1) * t, x2: x2 - (x2 - x1) * t, y2: y2 - (y2 - y1) * t,
    });
    line.dataset.id = l.id;
    svg.append(line);
  }
  lines.forEach((l, i) => {
    if (l.path.length < 2) return;
    const mid = `m${i}-${Math.random().toString(36).slice(2, 7)}`;
    const marker = svgEl('marker', { id: mid, viewBox: '0 0 10 10', refX: 6, refY: 5, markerWidth: 3.6, markerHeight: 3.6, orient: 'auto-start-reverse' });
    marker.append(svgEl('path', { d: 'M0,0 L10,5 L0,10 z', fill: l.color }));
    defs.append(marker);
    svg.append(svgEl('polyline', {
      points: l.path.map((s) => center(s).join(',')).join(' '), fill: 'none', stroke: l.color, 'stroke-width': 0.11,
      'stroke-linecap': 'round', 'stroke-linejoin': 'round', opacity: l.opacity ?? 0.9, 'marker-end': `url(#${mid})`,
    }));
  });
  for (const d of dots) {
    const [x, y] = center(d.sq);
    svg.append(d.ring
      ? svgEl('circle', { cx: x, cy: y, r: 0.43, fill: 'none', stroke: d.color, 'stroke-width': 0.08, opacity: 0.9 })
      : svgEl('circle', { cx: x, cy: y, r: 0.15, fill: d.color, opacity: 0.9, stroke: '#17141f', 'stroke-width': 0.035 }));
  }
  for (const d of rings) {
    const [x, y] = center(d.sq);
    svg.append(svgEl('circle', { cx: x, cy: y, r: 0.36, fill: 'none', stroke: d.color, 'stroke-width': 0.08, opacity: 0.95 }));
  }
  el.append(svg);
}

// ================================================================ planning
function planCands(origin) {
  const p = ui.plan;
  if (!p.cache.has(origin)) p.cache.set(origin, Q.candidates(ui.game, p.piece, origin));
  return p.cache.get(origin);
}
// Candidate entries whose click sequence matches the alternative exactly.
function matchesOf(alt) {
  return planCands(alt.from).filter((c) => seqEq(c.m.seq, alt.seq));
}
// Picks the key of an alternative from its matches and the player's choices
// (promotion piece, declared capture).
function resolve(alt) {
  const matches = matchesOf(alt);
  alt.choices = matches;
  if (!matches.length) {
    alt.key = null;
    return;
  }
  const captureKeys = matches.filter((c) => G.isCaptureKey?.(c.key));
  if (alt.declared === undefined) {
    // A certain enemy piece on the target: just call it a capture. A ghost: plain move by default.
    const target = alt.seq[alt.seq.length - 1];
    const certainEnemy = [...ui.sum.squares[target]].some(([id, e]) => e.n === ui.sum.W && ownerOf(id) !== ui.game.turn);
    alt.declared = captureKeys.length > 0 && certainEnemy;
  }
  if (alt.promo === undefined && matches.some((c) => c.m.promo)) alt.promo = G.promoOrder[0];
  const pick = matches.find((c) => (!!G.isCaptureKey?.(c.key)) === (alt.declared && captureKeys.length > 0) && (c.m.promo || null) === (alt.promo || null))
    || matches.find((c) => (c.m.promo || null) === (alt.promo || null)) || matches[0];
  alt.key = pick.key;
}
const isComplete = (alt) => alt.key !== null;
function ownerOf(id) {
  const fixed = G.colorOfId(id);
  if (fixed !== null) return fixed;
  const p = ui.sum.pieces.get(id);
  return p ? (p.colors[0] >= p.colors[1] ? 0 : 1) : null;
}
function extSteps() {
  const p = ui.plan;
  if (!p || p.cur < 0) return [];
  const a = p.alts[p.cur];
  return uniq(planCands(a.from).filter((c) => c.m.seq.length > a.seq.length && seqStarts(c.m.seq, a.seq)).map((c) => c.m.seq[a.seq.length]));
}
function firstSteps() {
  const p = ui.plan;
  if (!p || p.active == null) return [];
  if (p.cur >= 0 && !isComplete(p.alts[p.cur])) return [];
  const mine = p.alts.filter((x) => x.from === p.active && x.seq.length);
  if (mine.length >= 2) return [];
  const used = mine.map((x) => x.seq[0]);
  return uniq(planCands(p.active).filter((c) => c.m.seq.length).map((c) => c.m.seq[0])).filter((s) => !used.includes(s));
}
const hasPassOption = () => !!ui.plan && planCands(ui.plan.active).some((c) => G.isPass(c.key));
const pieceInfo = (id) => ui.sum.pieces.get(id);
function newPlan(piece, origin) {
  ui.plan = { piece, alts: [], active: origin, cur: -1, cache: new Map() };
}
function clearPlan() {
  ui.plan = null;
  ui.preview = null;
}
function addStep(sq) {
  const p = ui.plan;
  const a = { from: p.active, seq: [sq], key: null };
  p.alts.push(a);
  p.cur = p.alts.length - 1;
  resolve(a);
}
function quantumMove() {
  const p = ui.plan;
  return { piece: p.piece, alts: p.alts.map((a) => a.key) };
}

function computePreview() {
  const p = ui.plan;
  ui.preview = null;
  if (!p || !p.alts.length) return;
  if (!p.alts.every(isComplete)) {
    ui.preview = { ok: false, incomplete: true, error: 'Finish the jump: click the next landing square.' };
    return;
  }
  const r = Q.applyQuantumMove(ui.game, quantumMove());
  if (!r.ok) {
    ui.preview = r;
    return;
  }
  r.effects = Q.describeChange(ui.game, r.state, p.piece, quantumMove());
  ui.preview = r;
}

function afterPlanChange() {
  computePreview();
  render();
}

// Backspace: take back the last planned step (or the last planned alternative).
function undoPlanStep() {
  const p = ui.plan;
  if (!p || !p.alts.length) return;
  const i = p.cur >= 0 ? p.cur : p.alts.length - 1;
  const a = p.alts[i];
  if (a.seq.length > 1) {
    a.seq.pop();
    delete a.declared;
    delete a.promo;
    resolve(a);
    p.cur = i;
  } else {
    p.alts.splice(i, 1);
    p.cur = -1;
  }
  afterPlanChange();
}

function onBoardClick(ev) {
  if (ui.previewing) return;
  const cell = ev.target.closest('.cell[data-sq]');
  if (!cell) return;
  const sq = +cell.dataset.sq;
  const ghost = ev.target.closest('.piece');
  const gid = ghost ? +ghost.dataset.id : null;
  if (!canAct()) {
    if (gid !== null) showGhostInfo(gid, sq); // tapping still explains ghosts (touch screens have no hover)
    return;
  }
  const p = ui.plan;

  if (p) {
    if (extSteps().includes(sq)) {
      const a = p.alts[p.cur];
      a.seq.push(sq);
      delete a.declared;
      delete a.promo;
      resolve(a);
      return afterPlanChange();
    }
    if (firstSteps().includes(sq)) {
      addStep(sq);
      return afterPlanChange();
    }
    // Clicking a planned destination a second time plays the move.
    if (p.alts.some((x) => x.seq.length && x.seq[x.seq.length - 1] === sq)) {
      if (ui.preview?.ok) return commit();
      if (ui.preview?.error) toast(esc(ui.preview.error), 3000);
      return render();
    }
    if (!G.placement && pieceInfo(p.piece).locs.has(sq) && (gid === null || gid === p.piece)) {
      p.active = sq;
      p.cur = -1;
      return render();
    }
  }

  if (G.placement) {
    // No piece to select: a click on a legal square starts (or extends) the placement.
    if (!p) newPlan(0, -1);
    if (firstSteps().includes(sq)) {
      addStep(sq);
      return afterPlanChange();
    }
    if (!ui.plan.alts.length) clearPlan();
    render();
    if (gid !== null) showGhostInfo(gid, sq);
    return;
  }

  const mine = [...ui.sum.squares[sq].keys()].filter((id) => ownerOf(id) === ui.game.turn);
  let pick = gid !== null && mine.includes(gid) ? gid : null;
  if (pick === null && mine.length) {
    const i = p ? mine.indexOf(p.piece) : -1;
    pick = mine[(i + 1) % mine.length];
  }
  if (pick !== null) {
    if (!p || p.piece !== pick) newPlan(pick, sq);
    else {
      p.active = sq;
      p.cur = -1;
    }
    computePreview();
    if (!planCands(sq).length) toast(`${esc(G.labelOf(pick))} can't move from ${G.sqName(sq)} in any world.`, 3000);
    render();
    if (gid !== null) showGhostInfo(gid, sq);
    return;
  }
  if (p && !p.alts.length) clearPlan();
  render();
  if (gid !== null) showGhostInfo(gid, sq);
}

// "If this ghost is the real one, what else must be true?" Shows entanglement.
function showGhostInfo(id, sq) {
  const hint = $('#hint');
  if (!hint) return;
  const info = ui.sum.pieces.get(id);
  if (!info || (info.locs.size <= 1 && info.alive === ui.sum.W && !(info.colors[0] && info.colors[1]))) {
    hint.textContent = '';
    return;
  }
  const e = ui.sum.squares[sq].get(id);
  const v = e ? variant(e) : null;
  const worlds = ui.game.worlds.filter((w) => {
    const c = G.codeAt(w.b, sq);
    return c && G.idOf(c) === id && (!v?.mixedColor || G.colorOf(c) === v.color);
  });
  if (!worlds.length) return;
  const effects = Q.describeChange(ui.game, { game: ui.game.game, worlds }, id);
  const what = G.placement ? `${G.labelOf(id)} is really ${colorName(v.color)}` : `${G.labelOf(id)} is really on ${G.sqName(sq)}`;
  hint.textContent = `If ${what}: ` + (effects.length ? effects.join(' · ') : 'nothing else on the board changes.');
}

function commit() {
  const p = ui.plan;
  if (!p || !ui.preview?.ok) return;
  const move = quantumMove();
  if (ui.mode === 'online') {
    ui.pending = true;
    sendNet({ t: 'move', move, ply: ui.game.ply });
    clearPlan();
    render();
    return;
  }
  const before = ui.game;
  const after = ui.preview.state;
  ui.history.push(before);
  announce(before, after); // records the log note, so it must run before rendering
  setGame(after);
  maybeAiMove();
}

function setGame(state) {
  ui.game = state;
  clearPlan();
  render();
}

function announce(before, after) {
  const move = after.moves[after.moves.length - 1];
  if (!move) return;
  const effects = Q.describeChange(before, after, move.piece, move);
  ui.notes[after.ply - 1] = { worlds: [before.worlds.length, after.worlds.length], effects };
  const mover = colorName(before.turn);
  let html = `<b>${mover}</b> played <b>${esc(Q.fmtMove(ui.gameId, move))}</b>`;
    if (effects.length) html += `<ul>${effects.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>`;
  toast(html, effects.length ? 6000 : 3000);
}

// Reversi: when every world only lets you pass, pass automatically.
function maybeAutoPass() {
  if (!G.placement || !canAct() || ui.plan || ui.autoPass === ui.game.ply) return;
  const cands = Q.candidates(ui.game, 0, -1);
  if (cands.length !== 1 || !G.isPass(cands[0].key)) return;
  ui.autoPass = ui.game.ply;
  toast('You have no legal move in any world, so you pass.', 3000);
  setTimeout(() => {
    if (ui.autoPass !== ui.game.ply || !canAct()) return;
    newPlan(0, -1);
    ui.plan.alts.push({ from: -1, seq: [], key: 'pass' });
    computePreview();
    commit();
  }, 1200);
}

// ================================================================ main render
function render() {
  $('#hint').textContent = '';
  ui.sum = Q.summarize(ui.game);
  const showing = ui.previewing && ui.preview?.ok ? ui.preview.state : ui.game;
  const sum = showing === ui.game ? ui.sum : Q.summarize(showing);
  buildBoard(boardEl, showing, sum);

  const lines = [], dots = [], rings = [];
  const p = ui.plan;
  const acting = canAct();
  const altPath = (a) => (a.from >= 0 ? [a.from, ...a.seq] : a.seq);
  const cellAt = (sq) => boardEl.querySelector(`.cell[data-sq="${sq}"]`);
  const occupied = (sq) => ui.sum.squares[sq].size > 0;
  if (!ui.previewing) {
    const last = ui.game.moves[ui.game.moves.length - 1];
    if (last) {
      for (const k of last.alts) for (const sq of G.keyPath(k, last.piece)) cellAt(sq)?.classList.add('last');
    }
    if (acting && !G.placement) {
      for (const el of boardEl.querySelectorAll('.piece')) {
        if (ownerOf(+el.dataset.id) === ui.game.turn) el.classList.add('movable');
      }
    }
    if (acting && G.placement && !p) {
      // Show every square where a disc could go, sized by the share of worlds that allow it.
      for (const c of Q.candidates(ui.game, 0, -1)) {
        if (c.m.to >= 0) dots.push({ sq: c.m.to, color: PATH_COLORS[0], ring: occupied(c.m.to) });
      }
      for (const d of dots) cellAt(d.sq)?.classList.add('target');
    }
    if (p) {
      for (const el of boardEl.querySelectorAll(`.piece[data-id="${p.piece}"]`)) {
        el.classList.add('selected');
        const cell = el.closest('.cell');
        cell.classList.add(+cell.dataset.sq === p.active ? 'sel' : 'sel-other');
      }
      p.alts.forEach((a, i) => {
        const path = altPath(a);
        if (path.length >= 2) lines.push({ path, color: PATH_COLORS[i % PATH_COLORS.length] });
        else if (path.length === 1) rings.push({ sq: path[0], color: PATH_COLORS[i % PATH_COLORS.length] });
      });
      const nextColor = PATH_COLORS[p.alts.length % PATH_COLORS.length];
      for (const sq of extSteps()) dots.push({ sq, color: PATH_COLORS[p.cur % PATH_COLORS.length], ring: occupied(sq) });
      for (const sq of firstSteps()) dots.push({ sq, color: nextColor, ring: occupied(sq) });
      for (const d of dots) cellAt(d.sq)?.classList.add('target');
      // Planned destinations are clickable again to play the move.
      for (const a of p.alts) {
        if (a.seq.length) cellAt(a.seq[a.seq.length - 1])?.classList.add('target', 'planned');
      }
    }
  } else if (ui.preview?.ok) {
    ui.plan.alts.forEach((a, i) => {
      const path = altPath(a);
      if (path.length >= 2) lines.push({ path, color: PATH_COLORS[i % PATH_COLORS.length], opacity: 0.5 });
    });
  }
  drawOverlay(boardEl, lines, dots, rings, ghostLinks(sum));
  if (p && !ui.previewing) for (const l of boardEl.querySelectorAll(`.link[data-id="${p.piece}"]`)) l.classList.add('on');

  renderStrips();
  renderStatus();
  renderRoom();
  renderPlan();
  renderLog();
  renderControls();
  renderActionBar();
  maybeAutoPass();
}

function stripHTML(color) {
  const sum = ui.sum;
  let certain = 0, maybe = 0;
  for (const [, info] of sum.pieces) {
    if (info.colors[color] === sum.W) certain++;
    else if (info.colors[color] > 0) maybe++;
  }
  const res = result();
  let conn = '';
  if (ui.mode === 'online' && ui.roomInfo) {
    const on = ui.roomInfo.online[color];
    const seated = ui.roomInfo.seated[color];
    conn = `<span class="${on ? 'dot-on' : 'dot-off'}" title="${on ? 'connected' : seated ? 'disconnected' : 'waiting for player'}"></span>`;
  }
  const you = ui.mode === 'online' && ui.me === color ? ' (you)'
    : ui.mode === 'ai' ? (color === ui.aiColor ? ` (computer, ${ui.aiLevel})` : ' (you)') : '';
  const turn = !res && ui.game.turn === color ? '<span class="turn">to move</span>' : '';
  return `<span class="chip ${cls(color)}"></span>${conn}
    <span class="who">${colorName(color)}${you}</span>
    <span>${certain} ${pieceNoun(certain)}${maybe ? ` + ${maybe} uncertain` : ''}</span>${turn}`;
}
function renderStrips() {
  $('#stripTop').innerHTML = stripHTML(1 - ui.bottom);
  $('#stripBottom').innerHTML = stripHTML(ui.bottom);
}

function renderStatus() {
  const res = result();
  const W = ui.game.worlds.length;
  let turnline;
  if (res) turnline = 'Game over';
  else if (ui.mode === 'online' && ui.me === null) turnline = `Spectating · ${colorName(ui.game.turn)} to move`;
  else if (ui.mode === 'online') turnline = ui.me === ui.game.turn ? 'Your move' : `Waiting for ${colorName(ui.game.turn)}…`;
  else if (ui.mode === 'ai') turnline = ui.game.turn === ui.aiColor ? 'Computer is thinking…' : 'Your move';
  else turnline = `${colorName(ui.game.turn)} to move`;
  const chip = `<span class="strip"><span class="chip ${cls(ui.game.turn)}"></span></span>`;
  $('#status').innerHTML = `
    <div class="turnline">${res ? '' : chip}${turnline}</div>
    <div class="meta">
      <span class="pill">Move <b>${Math.floor(ui.game.ply / 2) + 1}</b></span>
      <span class="pill ${W > 1 ? 'quantum' : ''}" title="Every way the game could really have gone so far. Splitting adds worlds; a move that proves something removes them.">${W > 1 ? `<b>${W}</b> possible worlds` : 'No superposition'}</span>
      <button class="btn small" id="tlOpen">${W > 1 ? 'See the worlds' : 'Replay'}</button>
    </div>
    ${res ? `<div class="result"><strong>${esc(resultText(res))}</strong>
      ${W > 1 ? `${W} worlds survive, and every one of them is a normal game of ${G.name.toLowerCase()}.` : 'One world survives: the game that really happened.'}
      <div><button class="btn small" id="tlOpen2">${W > 1 ? 'Replay them' : 'Replay the real game'}</button></div></div>` : ''}
    ${ui.mode === 'online' && !ui.connected
      ? '<p class="error">Lost connection to the host. Reconnecting automatically when their game is open again…</p>' : ''}`;
  $('#tlOpen').onclick = openTimeline;
  const b2 = $('#tlOpen2');
  if (b2) b2.onclick = openTimeline;
}

function renderRoom() {
  const el = $('#roomPanel'), invite = $('#invite');
  if (ui.mode !== 'online' || !ui.roomInfo) {
    el.hidden = true;
    invite.hidden = true;
    return;
  }
  el.hidden = false;
  const info = ui.roomInfo;
  const waiting = !info.seated[0] || !info.seated[1];
  const link = `${location.origin}${location.pathname}?room=${info.room}`;
  let draw = '';
  if (!info.result && info.drawOffer !== null && ui.me !== null) {
    draw = info.drawOffer === ui.me
      ? '<p class="muted">Draw offered, waiting for a reply…</p>'
      : `<p><b>${colorName(info.drawOffer)} offers a draw.</b></p>
         <div class="row"><button class="btn small" id="drawYes">Accept</button><button class="btn small" id="drawNo">Decline</button></div>`;
  }
  let rematch = '';
  if (info.result && ui.me !== null) {
    rematch = info.rematch[ui.me]
      ? '<p class="muted">Rematch requested, waiting for opponent…</p>'
      : info.rematch[1 - ui.me] ? '<p><b>Opponent wants a rematch.</b></p>' : '';
  }
  const copyLabel = ui.copied ? 'Link copied ✓' : 'Copy invite link';
  el.innerHTML = `
    <h3>Online game · ${G.name}</h3>
    <div class="row"><span class="code">${info.room}</span>
      <button class="btn small" data-copy>${copyLabel}</button></div>
    ${waiting ? '<p class="muted">Waiting for your opponent to open the link.</p>' : ''}
    ${ui.me === null ? '<p class="muted">Both seats are taken, so you are watching.</p>' : ''}
    ${ui.isHost ? '<p class="muted">Your browser is hosting this game. Keep this tab open, or the game pauses until you come back.</p>' : ''}
    ${draw}${rematch}`;

  // Until the second player arrives, the invite link is the only thing that matters: put it over the board.
  invite.hidden = !waiting;
  if (waiting) {
    invite.innerHTML = `<div class="invite-card">
      <h2>Invite your opponent</h2>
      <p>Send this link to a friend. The game starts as soon as they open it.</p>
      <input class="invite-link" readonly value="${esc(link)}" aria-label="Invite link">
      <button class="btn primary big" data-copy>${copyLabel}</button>
      <p class="muted">Or give them the code <b class="code">${info.room}</b>${ui.me !== null ? ` · You play ${colorName(ui.me).toLowerCase()}` : ''}</p>
    </div>`;
    invite.querySelector('.invite-link').onclick = (e) => e.target.select();
  }
  for (const b of document.querySelectorAll('[data-copy]')) {
    b.onclick = async () => {
      try {
        await navigator.clipboard.writeText(link);
        ui.copied = true;
        renderRoom();
        setTimeout(() => {
          ui.copied = false;
          if (ui.mode === 'online') renderRoom();
        }, 2500);
      } catch {
        prompt('Copy this link:', link);
      }
    };
  }
  const yes = $('#drawYes'), no = $('#drawNo');
  if (yes) yes.onclick = () => sendNet({ t: 'answerDraw', accept: true });
  if (no) no.onclick = () => sendNet({ t: 'answerDraw', accept: false });
}

const PROMO_KIND = { q: 4, r: 3, b: 2, n: 1 };
const altLabel = (a) => (a.key ? G.fmtAlt(a.key) : `${a.from >= 0 ? G.sqName(a.from) + '-' : ''}${a.seq.map(G.sqName).join('-')} …`);

// Choices attached to one alternative: promotion piece, declared capture.
function choicesHTML(a, i) {
  if (!a.choices || a.choices.length < 2) return '';
  let html = '';
  if (a.choices.some((c) => c.m.promo)) {
    html += `<div class="choice"><span>Promote to</span>${G.promoOrder.map((pr) =>
      `<button class="btn tiny ${a.promo === pr ? 'on' : ''}" data-promo="${pr}" data-alt="${i}" title="${G.kindLabel(PROMO_KIND[pr])}"><span class="pc ${cls(ui.game.turn)} k${PROMO_KIND[pr]}"></span></button>`).join('')}</div>`;
  }
  const plain = a.choices.some((c) => !G.isCaptureKey?.(c.key)), declared = a.choices.some((c) => G.isCaptureKey?.(c.key));
  if (plain && declared) {
    const target = a.seq[a.seq.length - 1];
    const victims = [...ui.sum.squares[target]].filter(([id]) => ownerOf(id) !== ui.game.turn).map(([id]) => G.labelOf(id));
    if (victims.length) {
      html += `<label class="choice"><input type="checkbox" data-declare="${i}" ${a.declared ? 'checked' : ''}>
        <span>Declare the capture: this insists ${esc(victims.join(' / '))} is really there</span></label>`;
    }
  }
  return html;
}

function renderPlan() {
  const el = $('#planPanel');
  const p = ui.plan;
  let body;
  if (result()) body = '<p class="hint">The game is over.</p>';
  else if (!canAct()) {
    body = ui.pending ? '<p class="hint">Sending move…</p>' : (ui.mode === 'ai' ? '<p class="hint">The computer is thinking…</p>' : '<p class="hint">Waiting for the other player.</p>');
  } else if (!p) {
    body = G.placement
      ? `<p class="hint">Click a square, then <b>click it again</b> to place a disc there.</p>
         <p class="hint"><b class="q">Split:</b> pick a second square before confirming, and the disc goes on both.</p>`
      : `<p class="hint">Click a piece, click where it should go, then <b>click that square again</b> to play.</p>
         <p class="hint"><b class="q">Split:</b> pick a second square before confirming, and the piece goes to both.</p>`;
  } else {
    const W = ui.sum.W;
    let html = `<h3>${G.placement ? 'Placing a disc' : `Moving ${esc(G.labelOf(p.piece))}`}</h3>`;
    const info = G.placement ? null : pieceInfo(p.piece);
    const locs = G.placement ? [[-1, W]] : [...info.locs.entries()].sort((a, b) => b[1] - a[1]);
    for (const [sq] of locs) {
      const mine = p.alts.map((x, i) => [x, i]).filter(([x]) => x.from === sq);
      const rows = mine.map(([x, i]) => `<div class="pathrow"><span class="sw" style="background:${PATH_COLORS[i % PATH_COLORS.length]}"></span>
          ${esc(G.isPass(x.key || '') ? 'Pass (where no move exists)' : altLabel(x))}
          <button class="x" data-rm="${i}" aria-label="Remove">✕</button></div>${choicesHTML(x, i)}`).join('');
      const ruled = !mine.length && p.alts.length
        ? `<div class="ruled">Not moved from here, so this ghost disappears</div>` : '';
      const none = !planCands(sq).length ? '<div class="ruled">No legal move from here</div>' : '';
      html += `<div class="loc ${sq === p.active ? 'active' : ''}" data-loc="${sq}">
        <div class="head">${sq >= 0 ? `From ${G.sqName(sq)}` : 'New disc'}</div>
        ${rows || none ? `<div class="paths">${rows}${none}</div>` : ''}${ruled}</div>`;
    }
    if (info && info.alive < W && p.alts.length) {
      html += `<div class="ruled">${esc(G.labelOf(p.piece))} might have been captured; moving it proves it wasn't.</div>`;
    }
    if (hasPassOption()) {
      const passing = p.alts.some((a) => G.isPass(a.key || ''));
      html += `<label class="choice"><input type="checkbox" id="passToggle" ${passing ? 'checked' : ''}>
        <span>Pass in the worlds where you have no legal placement</span></label>`;
    }
    const pv = ui.preview;
    if (pv && !pv.ok) html += `<p class="err">${esc(pv.error)}</p>`;
    if (pv?.ok) {
      const W2 = pv.state.worlds.length;
      const split = p.alts.some((x, i) => p.alts.findIndex((y) => y.from === x.from) !== i);
      if (W2 !== W) html += `<p class="summary">${split && W2 > W ? 'Splits' : 'Collapses'} the board: <b>${W}</b> → <b>${W2}</b> possible world${W2 === 1 ? '' : 's'}</p>`;
      if (pv.effects.length) html += `<ul class="effects">${pv.effects.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>`;
      if (pv.state.result) html += `<p class="summary"><b>${esc(resultText(pv.state.result))}</b></p>`;
      const ends = uniq(p.alts.filter((x) => x.seq.length).map((x) => G.sqName(x.seq[x.seq.length - 1])));
      if (ends.length) html += `<p class="hint">Click ${ends.join(' or ')} again (or press Enter) to play it.</p>`;
    }
    html += `<div class="actions">
      <button class="btn primary" id="commitBtn" ${pv?.ok ? '' : 'disabled'}>Play move</button>
      <button class="btn" id="previewBtn" ${pv?.ok ? '' : 'disabled'} title="Hold to see the board after this move">Hold to preview</button>
      <button class="btn subtle" id="clearBtn">Cancel</button></div>`;
    body = html;
  }
  el.innerHTML = body;
  wirePlanControls(el);
}

function wirePlanControls(el) {
  for (const b of el.querySelectorAll('[data-rm]')) {
    b.onclick = (e) => {
      e.stopPropagation();
      ui.plan.alts.splice(+b.dataset.rm, 1);
      ui.plan.cur = -1;
      afterPlanChange();
    };
  }
  for (const d of el.querySelectorAll('[data-loc]')) {
    d.onclick = () => {
      ui.plan.active = +d.dataset.loc;
      ui.plan.cur = -1;
      render();
    };
  }
  for (const b of el.querySelectorAll('[data-promo]')) {
    b.onclick = (e) => {
      e.stopPropagation();
      const a = ui.plan.alts[+b.dataset.alt];
      a.promo = b.dataset.promo;
      resolve(a);
      afterPlanChange();
    };
  }
  for (const c of el.querySelectorAll('[data-declare]')) {
    c.onchange = () => {
      const a = ui.plan.alts[+c.dataset.declare];
      a.declared = c.checked;
      resolve(a);
      afterPlanChange();
    };
    c.onclick = (e) => e.stopPropagation();
  }
  const pass = el.querySelector('#passToggle');
  if (pass) {
    pass.onchange = () => {
      const p = ui.plan;
      const i = p.alts.findIndex((a) => G.isPass(a.key || ''));
      if (pass.checked && i < 0) p.alts.push({ from: p.active, seq: [], key: 'pass' });
      else if (!pass.checked && i >= 0) p.alts.splice(i, 1);
      p.cur = -1;
      afterPlanChange();
    };
  }
  const c = el.querySelector('#commitBtn');
  if (c) c.onclick = commit;
  const cl = el.querySelector('#clearBtn');
  if (cl) cl.onclick = () => (clearPlan(), render());
  const pb = el.querySelector('#previewBtn');
  if (pb) {
    const on = (e) => {
      e.preventDefault();
      if (!ui.previewing) {
        ui.previewing = true;
        render();
      }
    };
    const off = () => {
      if (ui.previewing) {
        ui.previewing = false;
        render();
      }
    };
    pb.addEventListener('pointerdown', on);
    pb.addEventListener('pointerleave', off);
    window.addEventListener('pointerup', off, { once: true });
  }
}

// Bottom bar on phones: what the planned move does, and a big button to play it.
function renderActionBar() {
  const bar = $('#actionBar');
  const p = ui.plan;
  const show = !!p && ui.mode !== null && canAct() && !result();
  bar.hidden = !show;
  document.body.classList.toggle('has-bar', show);
  if (!show) return;
  const pv = ui.preview;
  const label = G.placement ? 'New disc' : G.labelOf(p.piece);
  let line, extra = '';
  if (!p.alts.length) {
    line = `<b>${esc(label)}</b> selected · tap where it should go`;
  } else if (pv?.ok) {
    const W = ui.sum.W, W2 = pv.state.worlds.length;
    line = `<b>${esc(Q.fmtMove(ui.gameId, quantumMove()))}</b>${W !== W2 ? ` · ${W} → ${W2} worlds` : ''}`;
    if (pv.effects.length) extra = `<div class="ab-effects">${esc(pv.effects.join(' · '))}</div>`;
  } else {
    line = `<b>${esc(label)}</b>`;
    if (pv?.error) extra = `<div class="ab-err">${esc(pv.error)}</div>`;
  }
  const choices = p.alts.map((a, i) => choicesHTML(a, i)).join('');
  bar.innerHTML = `<div class="ab-line">${line}</div>${extra}${choices ? `<div class="ab-choices">${choices}</div>` : ''}
    <div class="ab-buttons">
      <button class="btn primary" data-ab="play" ${pv?.ok ? '' : 'disabled'}>Play move</button>
      ${p.alts.length ? '<button class="btn" data-ab="undo">Undo step</button>' : ''}
      <button class="btn subtle" data-ab="clear">Cancel</button>
    </div>`;
  bar.querySelector('[data-ab="play"]').onclick = commit;
  const undo = bar.querySelector('[data-ab="undo"]');
  if (undo) undo.onclick = undoPlanStep;
  bar.querySelector('[data-ab="clear"]').onclick = () => (clearPlan(), render());
  wirePlanControls(bar);
}

function renderLog() {
  const el = $('#log');
  const moves = ui.game.moves;
  if (!moves.length) {
    el.innerHTML = '<li class="empty">No moves yet.</li>';
    return;
  }
  el.innerHTML = moves.map((m, i) => {
    const n = ui.notes[i];
    let extra = '';
    if (n && (n.effects.length || n.worlds[1] > n.worlds[0])) {
      extra = `<div class="note">${[n.worlds[1] > n.worlds[0] ? 'split' : '', ...n.effects].filter(Boolean).map(esc).join(' · ')}</div>`;
    }
    return `<li class="${cls(i % 2)}">${esc(Q.fmtMove(ui.gameId, m))}${extra}</li>`;
  }).join('');
  el.scrollTop = el.scrollHeight;
}

// Rebuilds a game from its move list, recording what each move collapsed.
function replayWithNotes(moves) {
  let st = Q.initialState(ui.gameId);
  const notes = [];
  for (const m of moves) {
    const r = Q.applyQuantumMove(st, m);
    if (!r.ok) throw new Error(r.error);
    notes.push({ worlds: [st.worlds.length, r.state.worlds.length], effects: Q.describeChange(st, r.state, m.piece, m) });
    st = r.state;
  }
  ui.notes = notes;
  return st;
}

function renderControls() {
  const el = $('#controls');
  const res = result();
  const btns = [];
  if (ui.mode === 'local' || ui.mode === 'ai') {
    btns.push(`<button class="btn" id="undoBtn" ${ui.history.length ? '' : 'disabled'}>Undo</button>`);
    btns.push('<button class="btn" id="newBtn">New game</button>');
  } else if (ui.me !== null) {
    if (!res) {
      btns.push(`<button class="btn" id="drawBtn" ${ui.roomInfo?.drawOffer !== null ? 'disabled' : ''}>Offer draw</button>`);
      btns.push('<button class="btn danger" id="resignBtn">Resign</button>');
    } else {
      btns.push(`<button class="btn primary" id="rematchBtn" ${ui.roomInfo?.rematch[ui.me] ? 'disabled' : ''}>Rematch</button>`);
    }
  }
  if (G.homeRow) btns.push('<button class="btn" id="flipBtn">Flip board</button>');
  btns.push('<button class="btn subtle" id="menuBtn">Main menu</button>');
  el.innerHTML = btns.join('');
  const on = (id, fn) => {
    const b = $(id);
    if (b) b.onclick = fn;
  };
  on('#undoBtn', () => {
    if (!ui.history.length) return;
    cancelAi();
    let prev = ui.history.pop();
    // Against the computer, undo back to your own turn.
    while (ui.mode === 'ai' && prev.turn === ui.aiColor && ui.history.length) prev = ui.history.pop();
    setGame(prev);
    maybeAiMove();
  });
  on('#newBtn', () => {
    if (ui.game.ply && !confirm('Start a new game?')) return;
    cancelAi();
    ui.history = [];
    ui.notes = [];
    setGame(Q.initialState(ui.gameId));
    maybeAiMove();
  });
  on('#drawBtn', () => sendNet({ t: 'offerDraw' }));
  on('#resignBtn', () => confirm('Resign this game?') && sendNet({ t: 'resign' }));
  on('#rematchBtn', () => sendNet({ t: 'rematch' }));
  on('#flipBtn', () => {
    ui.bottom = 1 - ui.bottom;
    render();
  });
  on('#menuBtn', () => {
    if (ui.mode === 'local' && ui.game.ply && !result() && !confirm('Leave this game?')) return;
    showLobby('home');
  });
}

// ================================================================ timelines
const tl = { boards: [], moves: [], step: 0 };

function openTimeline() {
  const worlds = ui.game.worlds;
  const sel = $('#tlSelect');
  const n = Math.min(worlds.length, 200);
  sel.innerHTML = Array.from({ length: n }, (_, i) => `<option value="${i}">World ${i + 1} of ${worlds.length}</option>`).join('');
  sel.parentElement.hidden = worlds.length < 2;
  const name = G.name.toLowerCase();
  $('#tlIntro').textContent = worlds.length > 1
    ? `There are ${worlds.length} ways this game could really have gone. Each is an ordinary game of ${name}, one legal move per turn. Pick one and step through it.`
    : `Nothing is in superposition, so this is the game that really happened: an ordinary game of ${name}, one legal move per turn.`;
  loadTimeline(0);
  $('#timelineDlg').showModal();
}

function loadTimeline(i) {
  const moves = Q.timeline(ui.game.worlds[i]);
  const boards = [G.initialBoard()];
  for (const m of moves) boards.push(G.apply(boards[boards.length - 1], m));
  tl.boards = boards;
  tl.moves = moves;
  tl.step = boards.length - 1;
  renderTimeline();
}

function renderTimeline() {
  const el = $('#tlBoard');
  const st = Q.stateFromBoards(ui.gameId, [tl.boards[tl.step]], tl.step % 2);
  buildBoard(el, st, Q.summarize(st));
  const m = tl.moves[tl.step - 1];
  const path = m ? (m.from >= 0 ? [m.from, ...m.seq] : m.seq) : [];
  drawOverlay(el, path.length >= 2 ? [{ path, color: PATH_COLORS[0] }] : [], [], path.length === 1 ? [{ sq: path[0], color: PATH_COLORS[0] }] : []);
  $('#tlLabel').textContent = tl.step === 0
    ? 'Start position'
    : `${tl.step} of ${tl.moves.length}: ${colorName((tl.step - 1) % 2)} ${G.fmtClassical ? G.fmtClassical(m) : G.fmtAlt(m.key)}`;
}

$('#tlSelect').onchange = (e) => loadTimeline(+e.target.value);
$('#tlFirst').onclick = () => ((tl.step = 0), renderTimeline());
$('#tlPrev').onclick = () => ((tl.step = Math.max(0, tl.step - 1)), renderTimeline());
$('#tlNext').onclick = () => ((tl.step = Math.min(tl.boards.length - 1, tl.step + 1)), renderTimeline());
$('#tlLast').onclick = () => ((tl.step = tl.boards.length - 1), renderTimeline());

// ================================================================ networking (peer-to-peer)
// The game creator's browser hosts the Room (shared/room.js). Guests connect to
// it directly over WebRTC using PeerJS; PeerJS's free public server is only used
// to introduce the two browsers. The host validates every guest action, and each
// guest re-checks the host's move list by replaying it with the rules engine.
const PEER_PREFIX = 'quantum-games-v3-'; // bump when rules change, so old and new clients don't meet
const HEARTBEAT_MS = 4000;
const TIMEOUT_MS = 15000;

const net = {
  peer: null,
  room: null, // host only
  hostClient: null,
  guests: new Set(),
  conn: null, // guest's connection to the host
  lastHeard: 0,
  timers: [],
  wanted: false,
};

const tokenKey = (room) => `qg-token-${room}`;
const hostKey = (room) => `qg-host-${room}`;
// Seat tokens: per-tab first (so two tabs can be two players), then per-browser.
function getToken(room) {
  try {
    const t = sessionStorage.getItem(tokenKey(room));
    if (t) return t;
  } catch {}
  return loadPref(tokenKey(room), null);
}
function setToken(room, token) {
  try {
    sessionStorage.setItem(tokenKey(room), token);
  } catch {}
  savePref(tokenKey(room), token);
}

function later(fn, ms) {
  net.timers.push(setTimeout(fn, ms));
}

function teardownNet() {
  net.wanted = false;
  net.timers.forEach(clearTimeout);
  net.timers = [];
  const { peer, conn } = net;
  Object.assign(net, { peer: null, room: null, hostClient: null, conn: null });
  net.guests.clear();
  try {
    conn?.close();
  } catch {}
  try {
    peer?.destroy();
  } catch {}
}

function makePeer(id) {
  if (typeof window.Peer !== 'function') {
    throw new Error("Couldn't load the networking library. Check your connection and reload.");
  }
  return id ? new window.Peer(id, { debug: 1 }) : new window.Peer({ debug: 1 });
}

// The "connecting" page, shown while an online game is being created or joined.
function lobbyStatus(text) {
  $('#lobbyStatus').textContent = text;
  if (text) showPage('connect');
}

function lobbyError(message) {
  for (const el of document.querySelectorAll('.lobby-error')) el.textContent = message;
}

function failToLobby(message) {
  showLobby();
  lobbyError(message);
}

const NETWORK_ERRORS = ['network', 'server-error', 'socket-error', 'socket-closed', 'disconnected', 'webrtc'];

// ---------- hosting
function startHosting(code, { color = 'random', fresh = false } = {}) {
  teardownNet();
  net.wanted = true;
  ui.room = code;
  const saved = fresh ? null : loadPref(hostKey(code), null);
  let peer;
  try {
    peer = makePeer(PEER_PREFIX + code);
  } catch (e) {
    return failToLobby(e.message);
  }
  net.peer = peer;
  lobbyStatus(fresh ? 'Creating game…' : `Reopening game ${code}…`);

  peer.on('open', () => {
    if (net.peer !== peer) return;
    if (!net.room) {
      let room;
      try {
        room = new Room(code, {
          game: ui.gameId,
          saved,
          onChange: (r) => savePref(hostKey(code), { ...r.serialize(), hostToken: net.hostClient?.token }),
        });
      } catch {
        return failToLobby(`Couldn't restore game ${code}.`);
      }
      net.room = room;
      const token = saved ? saved.hostToken : room.claimSeat(color);
      const self = { token: null, send: (m) => queueMicrotask(() => onNet(m)), isOpen: () => true };
      net.hostClient = self;
      ui.isHost = true;
      ui.connected = true;
      room.join(self, token);
      startHostHeartbeat();
    }
  });
  peer.on('connection', attachGuest);
  peer.on('disconnected', () => {
    // Lost the introduction server; existing games keep working. Re-register so new guests can join.
    later(() => net.peer === peer && !peer.destroyed && peer.reconnect(), 2000);
  });
  peer.on('error', (err) => {
    if (net.peer !== peer) return;
    if (err.type === 'unavailable-id') {
      if (fresh && !net.room) return startHosting(randomCode(), { color, fresh: true }); // code collision
      // Another tab (or our own previous session, not yet expired) holds this game: join it as a guest.
      return startGuest(code, { canHost: !!saved });
    }
    if (NETWORK_ERRORS.includes(err.type)) {
      if (!net.room) later(() => net.peer === peer && startHosting(code, { color, fresh }), 3000);
      return;
    }
    console.error(err);
    if (!net.room) failToLobby(`Couldn't start the game (${err.type}).`);
  });
}

function attachGuest(conn) {
  const client = {
    token: null,
    lastSeen: Date.now(),
    send: (m) => {
      if (conn.open) conn.send(m);
    },
    isOpen: () => conn.open,
    conn,
  };
  net.guests.add(client);
  conn.on('data', (msg) => {
    client.lastSeen = Date.now();
    if (msg && msg.t === 'ping') return client.send({ t: 'pong' });
    net.room?.handle(client, msg);
  });
  const gone = () => {
    net.guests.delete(client);
    net.room?.leave(client);
  };
  conn.on('close', gone);
  conn.on('error', gone);
}

function startHostHeartbeat() {
  const tick = () => {
    if (!net.room) return;
    const now = Date.now();
    for (const g of [...net.guests]) {
      if (now - g.lastSeen > TIMEOUT_MS) {
        try {
          g.conn.close();
        } catch {}
        net.guests.delete(g);
        net.room.leave(g);
      }
    }
    later(tick, HEARTBEAT_MS);
  };
  later(tick, HEARTBEAT_MS);
}

// ---------- joining
function startGuest(code, { canHost = false } = {}) {
  teardownNet();
  net.wanted = true;
  ui.room = code;
  ui.isHost = false;
  let peer;
  try {
    peer = makePeer();
  } catch (e) {
    return failToLobby(e.message);
  }
  net.peer = peer;
  if (!ui.roomInfo) lobbyStatus(`Connecting to game ${code}…`);

  const connect = () => {
    if (net.peer !== peer || peer.destroyed) return;
    if (peer.disconnected) {
      peer.reconnect();
      return;
    }
    const conn = peer.connect(PEER_PREFIX + code, { reliable: true, serialization: 'json' });
    net.conn = conn;
    conn.on('open', () => {
      if (net.conn !== conn) return;
      ui.connected = true;
      net.lastHeard = Date.now();
      conn.send({ t: 'join', token: getToken(code) });
      const beat = () => {
        if (net.conn !== conn || !conn.open) return;
        if (Date.now() - net.lastHeard > TIMEOUT_MS) {
          conn.close();
          return lost();
        }
        conn.send({ t: 'ping' });
        later(beat, HEARTBEAT_MS);
      };
      later(beat, HEARTBEAT_MS);
    });
    conn.on('data', (msg) => {
      net.lastHeard = Date.now();
      if (msg && msg.t !== 'pong') onNet(msg);
    });
    let handled = false;
    const lost = () => {
      if (handled || net.conn !== conn) return;
      handled = true;
      net.conn = null;
      ui.connected = false;
      ui.pending = false;
      if (ui.mode === 'online') render();
      later(connect, 2000);
    };
    conn.on('close', lost);
    conn.on('error', lost);
  };

  peer.on('open', connect);
  peer.on('disconnected', () => later(() => net.peer === peer && !peer.destroyed && peer.reconnect(), 2000));
  peer.on('error', (err) => {
    if (net.peer !== peer) return;
    if (err.type === 'peer-unavailable') {
      // Nobody is hosting this code right now.
      if (canHost) return later(() => net.peer === peer && startHosting(code), 1500);
      if (ui.mode === 'online') {
        ui.connected = false;
        render();
      } else {
        lobbyStatus(`Looking for game ${code}… The person who created it needs to have it open. Retrying.`);
      }
      net.conn = null;
      return later(connect, 3000);
    }
    if (NETWORK_ERRORS.includes(err.type)) return later(() => net.peer === peer && startGuest(code, { canHost }), 3000);
    console.error(err);
    failToLobby(`Couldn't connect (${err.type}).`);
  });
}

function sendNet(msg) {
  if (net.room && net.hostClient) {
    net.room.handle(net.hostClient, msg);
  } else if (net.conn?.open) {
    net.conn.send(msg);
  } else {
    ui.pending = false;
    toast('Not connected. Reconnecting…', 2000);
    render();
  }
}

function onNet(msg) {
  if (!msg || typeof msg !== 'object') return;
  if (msg.t === 'joined') {
    ui.room = msg.room;
    setToken(msg.room, msg.token);
    history.replaceState(null, '', `${location.pathname}?room=${msg.room}`);
  } else if (msg.t === 'state') {
    syncOnline(msg);
  } else if (msg.t === 'error') {
    ui.pending = false;
    toast(esc(msg.msg), 3000);
    if (ui.mode === 'online') render();
  }
}

function syncOnline(msg) {
  if (!Array.isArray(msg.moves) || !GAMES[msg.game]) return;
  const first = !ui.roomInfo;
  const prevMe = ui.me;
  ui.roomInfo = msg;
  ui.me = msg.you === 0 || msg.you === 1 ? msg.you : null;
  if (msg.game !== ui.gameId) {
    setGameId(msg.game); // the host decides which game this room plays
    ui.game = Q.initialState(ui.gameId);
    ui.notes = [];
  }
  if (ui.mode !== 'online') enterGame('online');
  if (first || prevMe !== ui.me) ui.bottom = ui.me ?? 0; // you sit at the bottom; spectators see the first player there

  const cur = ui.game.moves;
  let st = ui.game;
  const extends_ = msg.moves.length >= cur.length && cur.every((m, i) => sameMove(m, msg.moves[i]));
  try {
    if (extends_) {
      for (let i = cur.length; i < msg.moves.length; i++) {
        const r = Q.applyQuantumMove(st, msg.moves[i]);
        if (!r.ok) throw new Error(r.error);
        ui.notes[i] = {
          worlds: [st.worlds.length, r.state.worlds.length],
          effects: Q.describeChange(st, r.state, msg.moves[i].piece, msg.moves[i]),
        };
        st = r.state;
      }
    } else {
      st = replayWithNotes(msg.moves);
    }
  } catch (e) {
    console.error(e);
    toast('Received an illegal move list from the host. Ignoring it.', 4000);
    return;
  }
  ui.pending = false;
  if (st !== ui.game) {
    const before = ui.game;
    ui.game = st;
    clearPlan();
    if (extends_ && msg.moves.length === cur.length + 1) announce(before, st);
    else if (!msg.moves.length && cur.length) toast('New game started. Colors swapped.', 3000);
  }
  render();
}

// ================================================================ lobby / modes
function showPage(name) {
  for (const id of ['home', 'setup', 'connect', 'game']) $(`#${id}`).hidden = id !== name;
  scrollTo(0, 0);
}

function enterGame(mode) {
  ui.mode = mode;
  ui.autoPass = -1;
  document.title = `Quantum ${G.name}`;
  showPage('game');
}

// Leaves any game and shows a menu page: 'home' (pick a game) or 'setup' (pick how to play it).
function showLobby(page = ui.menuPage) {
  teardownNet();
  cancelAi();
  Object.assign(ui, {
    mode: null, game: Q.initialState(ui.gameId), history: [], plan: null, preview: null, isHost: false, notes: [],
    me: null, room: null, roomInfo: null, pending: false, connected: false, bottom: 0, copied: false, menuPage: page,
  });
  history.replaceState(null, '', page === 'setup' ? `${location.pathname}?game=${ui.gameId}` : location.pathname);
  document.title = page === 'setup' ? `Quantum ${G.name}` : 'Quantum Games';
  lobbyError('');
  $('#lobbyStatus').textContent = '';
  renderLobby();
  showPage(page);
}

// A corner of each game with one piece in two places, for the game picker.
const LOBBY_DIAGRAMS = {
  checkers: { rows: [2, 4], cols: [1, 4], pieces: [[2, 1, 0], [3, 2, 0, { ghost: 'a' }], [3, 4, 0, { ghost: 'a' }], [4, 1, 1], [4, 3, 1]] },
  chess: { rows: [5, 7], cols: [3, 6], pieces: [[5, 3, 0, { kind: 1, ghost: 'a' }], [5, 5, 0, { kind: 1, ghost: 'a' }], [7, 5, 0, { kind: 5 }], [6, 4, 0, { kind: 0 }], [6, 5, 0, { kind: 0 }], [5, 6, 1, { kind: 2 }]] },
  reversi: { rows: [3, 5], cols: [2, 5], pieces: [[3, 3, 0], [4, 3, 1, { mixed: true }], [4, 4, 0], [3, 4, 1], [5, 2, 0, { ghost: true }], [5, 5, 0, { ghost: true }]] },
};

const radioValue = (name) => document.querySelector(`input[name="${name}"]:checked`)?.value;
function setRadio(name, value) {
  const el = document.querySelector(`input[name="${name}"][value="${value}"]`);
  if (el) el.checked = true;
}

function renderLobby() {
  for (const tile of document.querySelectorAll('.tile[data-game]')) {
    if (tile.dataset.built) continue;
    tile.dataset.built = '1';
    tile.querySelector('.tile-diagram').append(miniBoard(gameOf(tile.dataset.game), LOBBY_DIAGRAMS[tile.dataset.game]));
    // The two ghosts fade in and out in turn: which one is real?
    tile.querySelectorAll('.piece.ghost').forEach((g, i) => (g.style.animationDelay = `${-1.6 * i}s`));
  }
  $('#setupName').textContent = G.name;
  $('#setupDiagram').replaceChildren(miniBoard(G, LOBBY_DIAGRAMS[ui.gameId]));
  for (const el of document.querySelectorAll('[data-color-name]')) el.textContent = G.colors[+el.dataset.colorName];
  $('#firstNote').textContent = `${G.colors[0]} moves first.`;
}

for (const tile of document.querySelectorAll('.tile[data-game]')) {
  tile.onclick = () => {
    setGameId(tile.dataset.game);
    history.pushState(null, '', location.pathname); // so the browser's Back button returns to the game picker
    showLobby('setup');
  };
}

// ================================================================ vs computer
let aiWorker = null;
let aiWorkerFailed = false;
const aiWaiters = new Map();

function cancelAi() {
  ui.aiReq = (ui.aiReq || 0) + 1; // any in-flight answer is now stale
  ui.aiThinking = false;
}

function askAi(game, moves, level) {
  const id = ++ui.aiReq;
  if (!aiWorker && !aiWorkerFailed) {
    try {
      aiWorker = new Worker(new URL('./ai-worker.js', import.meta.url), { type: 'module' });
      aiWorker.onmessage = (e) => {
        const w = aiWaiters.get(e.data.id);
        if (!w) return;
        aiWaiters.delete(e.data.id);
        e.data.error ? w.reject(new Error(e.data.error)) : w.resolve(e.data.move);
      };
      aiWorker.onerror = () => {
        aiWorkerFailed = true;
        aiWorker = null;
        for (const w of aiWaiters.values()) w.fallback();
        aiWaiters.clear();
      };
    } catch {
      aiWorkerFailed = true;
    }
  }
  // Fallback: think on the main thread (the page pauses briefly while it does).
  const onMainThread = () => import('./shared/ai.js').then(({ chooseMove }) =>
    new Promise((res) => setTimeout(() => res(chooseMove(Q.replay(game, moves), level)), 30)));
  if (!aiWorker) return { id, promise: onMainThread() };
  const promise = new Promise((resolve, reject) => {
    aiWaiters.set(id, { resolve, reject, fallback: () => onMainThread().then(resolve, reject) });
    aiWorker.postMessage({ id, game, moves, level });
  });
  return { id, promise };
}

function maybeAiMove() {
  if (ui.mode !== 'ai' || ui.game.result || ui.game.turn !== ui.aiColor || ui.aiThinking) return;
  ui.aiThinking = true;
  render();
  const started = Date.now();
  const { id, promise } = askAi(ui.gameId, ui.game.moves, ui.aiLevel);
  promise.then((move) => {
    if (id !== ui.aiReq || ui.mode !== 'ai') return; // cancelled (undo, new game, left)
    const wait = Math.max(0, 500 - (Date.now() - started)); // don't reply instantly
    setTimeout(() => {
      if (id !== ui.aiReq || ui.mode !== 'ai') return;
      ui.aiThinking = false;
      const r = move && Q.applyQuantumMove(ui.game, move);
      if (!r || !r.ok) {
        toast('The computer could not find a move.', 3000);
        render();
        return;
      }
      const before = ui.game;
      ui.history.push(before);
      announce(before, r.state);
      setGame(r.state);
    }, wait);
  }).catch((e) => {
    if (id !== ui.aiReq) return;
    console.error(e);
    ui.aiThinking = false;
    toast('The computer ran into a problem.', 3000);
    render();
  });
}

function startAi() {
  const level = radioValue('aiLevel') || 'medium';
  let color = radioValue('aiColor') || '0';
  if (color === 'random') color = Math.random() < 0.5 ? '0' : '1';
  savePref('qg-ai-level', level);
  showLobby();
  ui.aiLevel = level;
  ui.aiColor = 1 - +color; // the computer plays the other side
  ui.bottom = +color; // your pieces at the bottom
  enterGame('ai');
  render();
  maybeAiMove();
}

function startLocal() {
  showLobby();
  enterGame('local');
  render();
}

function createOnline() {
  const v = radioValue('colorPref') || 'random';
  const color = v === 'random' ? 'random' : +v;
  showLobby();
  startHosting(randomCode(), { color, fresh: true });
}

function openRoom(code) {
  code = normalizeCode(code);
  if (code.length !== 5) {
    lobbyError('Game codes are 5 characters.');
    return;
  }
  showLobby();
  // If this browser created the game, re-host it; otherwise join as a guest.
  if (loadPref(hostKey(code), null)) startHosting(code);
  else startGuest(code);
}

// On refresh/close, hang up cleanly: the signalling server frees the host's game code
// right away (so a reloading host gets it back instantly) and the other side notices at
// once instead of waiting for a timeout. If the page is restored from the back/forward
// cache, reconnect.
let hungUpRoom = null;
addEventListener('pagehide', () => {
  if (!net.peer) return;
  hungUpRoom = ui.mode === 'online' ? ui.room : null;
  teardownNet();
});
addEventListener('pageshow', (e) => {
  if (e.persisted && hungUpRoom && ui.mode === 'online') {
    if (loadPref(hostKey(hungUpRoom), null)) startHosting(hungUpRoom);
    else startGuest(hungUpRoom);
  }
  hungUpRoom = null;
});

$('#localBtn').onclick = startLocal;
$('#aiBtn').onclick = startAi;
setRadio('aiLevel', loadPref('qg-ai-level', 'medium'));
$('#createBtn').onclick = createOnline;
$('#joinForm').onsubmit = (e) => {
  e.preventDefault();
  openRoom($('#joinCode').value);
};
const help = setupHelp($('#rulesDlg'), () => G);
$('#rulesBtn').onclick = () => help.open();
$('#heroHelpBtn').onclick = () => help.open();
$('#backBtn').onclick = () => showLobby('home');
$('#cancelConnect').onclick = () => showLobby();
// Browser Back/Forward between the game picker and a game's page.
addEventListener('popstate', () => {
  const g = new URLSearchParams(location.search).get('game');
  if (GAME_IDS.includes(g)) setGameId(g);
  showLobby(GAME_IDS.includes(g) ? 'setup' : 'home');
});
for (const b of document.querySelectorAll('[data-close]')) b.onclick = () => b.closest('dialog').close();
for (const d of document.querySelectorAll('dialog')) {
  d.addEventListener('click', (e) => {
    if (e.target === d) d.close();
  });
}

boardEl.addEventListener('click', onBoardClick);
boardEl.addEventListener('pointerover', (e) => {
  const el = e.target.closest('.piece');
  if (!el) return;
  const id = +el.dataset.id;
  for (const g of boardEl.querySelectorAll(`.piece[data-id="${id}"]`)) g.classList.add('linked');
  for (const l of boardEl.querySelectorAll(`.link[data-id="${id}"]`)) l.classList.add('on');
  showGhostInfo(id, +el.closest('.cell').dataset.sq);
});
boardEl.addEventListener('pointerout', (e) => {
  const el = e.target.closest('.piece');
  if (!el) return;
  for (const g of boardEl.querySelectorAll('.piece.linked')) g.classList.remove('linked');
  for (const l of boardEl.querySelectorAll('.link.on')) l.classList.toggle('on', +l.dataset.id === ui.plan?.piece);
});
document.addEventListener('keydown', (e) => {
  if (ui.mode === null || e.target.closest?.('dialog, input, select, textarea')) return;
  if (e.key === 'Enter') commit();
  else if (e.key === 'Escape') {
    clearPlan();
    render();
  } else if (e.key === 'Backspace') {
    e.preventDefault();
    undoPlanStep();
  }
});

// ================================================================ start
setGameId(ui.gameId);
showLobby(GAME_IDS.includes(params.get('game')) ? 'setup' : 'home');
const roomParam = params.get('room');
if (roomParam) {
  $('#joinCode').value = normalizeCode(roomParam);
  openRoom(roomParam);
}
