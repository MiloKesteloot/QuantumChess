import * as R from './shared/rules.js';
import { Room, randomCode, normalizeCode } from './shared/room.js';

const $ = (s) => document.querySelector(s);
const boardEl = $('#board');
const PATH_COLORS = ['#5ee6ff', '#ff6bd6', '#ffd166', '#8cff8a', '#b69cff', '#ff9f5e', '#7cf5c8', '#f2f2f2'];

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

const ui = {
  mode: null, // 'local' | 'online'
  game: R.initialState(),
  sum: null,
  history: [], // local undo stack
  flipped: false,
  plan: null, // { piece, paths, active, cur, cache }
  quantum: loadPref('qc-quantum', false), // planning mode vs. classic clicks
  previewing: false,
  preview: null, // { ok, state?, error?, effects? }
  me: null, // online seat (0/1) or null for spectator
  room: null,
  roomInfo: null,
  pending: false,
  connected: false,
  isHost: false,
  notes: [], // per ply: { worlds: [before, after], effects: [...] } for the move log
};

// ================================================================ helpers
const pct = (f) => `${Math.round(f * 100)}%`;
const sameMove = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const startsWith = (p, prefix) => prefix.every((s, i) => p[i] === s);
const uniq = (xs) => [...new Set(xs)];

function result() {
  return ui.mode === 'online' ? ui.roomInfo?.result ?? null : ui.game.result;
}
function canAct() {
  if (result() || ui.pending) return false;
  if (ui.mode === 'local') return true;
  return ui.mode === 'online' && ui.me === ui.game.turn && ui.connected;
}

function resultText(res) {
  if (!res) return '';
  if (res.winner === null) {
    return res.reason === 'agreement' ? 'Draw by agreement' : 'Draw: 40 moves each with no progress';
  }
  const w = R.colorName(res.winner), l = R.colorName(1 - res.winner);
  const why = res.reason === 'resign' ? `${l} resigned` : `${l} has no legal move in any world`;
  return `${w} wins — ${why}`;
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
  const r = R.rowOf(sq), c = R.colOf(sq);
  return ui.flipped ? [7 - r, 7 - c] : [r, c];
}

function buildBoard(el, sum) {
  el.innerHTML = '';
  const frag = document.createDocumentFragment();
  for (let vr = 0; vr < 8; vr++) {
    for (let vc = 0; vc < 8; vc++) {
      const r = ui.flipped ? 7 - vr : vr, c = ui.flipped ? 7 - vc : vc;
      const sq = R.sqAt(r, c);
      const cell = document.createElement('div');
      cell.className = 'cell ' + (sq >= 0 ? 'dark' : 'light');
      if (sq >= 0) {
        cell.dataset.sq = sq;
        const n = document.createElement('span');
        n.className = 'num';
        n.textContent = sq + 1;
        cell.append(n);
        const entries = [...sum.squares[sq]].sort((a, b) => b[1].n - a[1].n);
        // Up to 4 different pieces fit on a square; beyond that, show 3 and a "+N" badge.
        const shown = entries.length > 4 ? entries.slice(0, 3) : entries;
        shown.forEach(([id, e], i) => cell.append(pieceEl(id, e, sum, entries.length > 1 ? i : -1)));
        if (entries.length > 4) {
          const more = document.createElement('div');
          more.className = 'more';
          more.textContent = `+${entries.length - 3}`;
          more.title = entries.slice(3).map(([id, e]) => `${R.labelOf(id)} (${e.n} of ${sum.W} worlds)`).join(', ');
          cell.append(more);
        }
      }
      frag.append(cell);
    }
  }
  el.append(frag);
}

function pieceEl(id, e, sum, slot) {
  const d = document.createElement('div');
  const frac = e.n / sum.W;
  const p = sum.pieces.get(id);
  const quantum = p.locs.size > 1 || p.alive < sum.W;
  d.className = `piece ${R.colorOfId(id) === R.BLACK ? 'black' : 'red'}`;
  if (quantum) d.classList.add('quantum');
  if (slot >= 0) d.classList.add('mini', `slot${Math.min(slot, 3)}`);
  d.dataset.id = id;
  d.style.setProperty('--frac', frac);
  const partialKing = e.k > 0 && e.k < e.n;
  d.title = (quantum ? `${R.labelOf(id)}: here in ${e.n} of ${sum.W} worlds` : R.labelOf(id)) +
    (partialKing ? `; a king in ${e.k} of those ${e.n}` : e.k ? ' (king)' : '');
  if (e.k) {
    // A piece that is a king in only some worlds gets a "?" crown.
    const k = document.createElement('span');
    k.className = partialKing ? 'crown partial' : 'crown';
    k.textContent = partialKing ? '♛?' : '♛';
    d.append(k);
  }
  if (quantum) {
    const t = document.createElement('span');
    t.className = 'tag';
    t.textContent = `${R.labelOf(id)} ${pct(frac)}`;
    d.append(t);
  }
  return d;
}

function center(sq) {
  const [r, c] = displayRC(sq);
  return [c + 0.5, r + 0.5];
}

// lines: [{ path, color, dashed, width }], dots: [{ sq, color }]
function drawOverlay(el, lines, dots = []) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 8 8');
  svg.setAttribute('class', 'overlay');
  const defs = document.createElementNS(ns, 'defs');
  svg.append(defs);
  lines.forEach((l, i) => {
    const mid = `m${i}-${Math.random().toString(36).slice(2, 7)}`;
    const marker = document.createElementNS(ns, 'marker');
    marker.setAttribute('id', mid);
    marker.setAttribute('viewBox', '0 0 10 10');
    marker.setAttribute('refX', '6');
    marker.setAttribute('refY', '5');
    marker.setAttribute('markerWidth', '4');
    marker.setAttribute('markerHeight', '4');
    marker.setAttribute('orient', 'auto-start-reverse');
    const tip = document.createElementNS(ns, 'path');
    tip.setAttribute('d', 'M0,0 L10,5 L0,10 z');
    tip.setAttribute('fill', l.color);
    marker.append(tip);
    defs.append(marker);
    const pl = document.createElementNS(ns, 'polyline');
    pl.setAttribute('points', l.path.map((s) => center(s).join(',')).join(' '));
    pl.setAttribute('fill', 'none');
    pl.setAttribute('stroke', l.color);
    pl.setAttribute('stroke-width', l.width ?? 0.09);
    pl.setAttribute('stroke-linecap', 'round');
    pl.setAttribute('stroke-linejoin', 'round');
    pl.setAttribute('opacity', l.opacity ?? 0.95);
    if (l.dashed) pl.setAttribute('stroke-dasharray', '0.15 0.12');
    pl.setAttribute('marker-end', `url(#${mid})`);
    svg.append(pl);
  });
  for (const d of dots) {
    const [x, y] = center(d.sq);
    const c = document.createElementNS(ns, 'circle');
    c.setAttribute('cx', x);
    c.setAttribute('cy', y);
    c.setAttribute('r', 0.13);
    c.setAttribute('fill', d.color);
    c.setAttribute('opacity', 0.9);
    svg.append(c);
  }
  el.append(svg);
}

// ================================================================ planning
function planCands(origin) {
  const p = ui.plan;
  if (!p.cache.has(origin)) p.cache.set(origin, R.candidatePaths(ui.game, p.piece, origin));
  return p.cache.get(origin);
}
function isComplete(path) {
  return planCands(path[0]).some((c) => R.samePath(c.path, path));
}
function extSteps() {
  const p = ui.plan;
  if (!p || p.cur < 0) return [];
  const prefix = p.paths[p.cur];
  return uniq(
    planCands(prefix[0])
      .filter((c) => c.path.length > prefix.length && startsWith(c.path, prefix))
      .map((c) => c.path[prefix.length]),
  );
}
function firstSteps() {
  const p = ui.plan;
  if (!p || p.active == null) return [];
  if (p.cur >= 0 && !isComplete(p.paths[p.cur])) return [];
  const mine = p.paths.filter((x) => x[0] === p.active);
  if (mine.length >= 2) return [];
  const used = mine.map((x) => x[1]);
  return uniq(planCands(p.active).map((c) => c.path[1])).filter((s) => !used.includes(s));
}
function pieceInfo(id) {
  return ui.sum.pieces.get(id);
}
function newPlan(piece, origin) {
  ui.plan = { piece, paths: [], active: origin, cur: -1, cache: new Map() };
}
function clearPlan() {
  ui.plan = null;
  ui.preview = null;
}

function computePreview() {
  const p = ui.plan;
  ui.preview = null;
  if (!p || !p.paths.length) return;
  if (!p.paths.every(isComplete)) {
    ui.preview = { ok: false, incomplete: true, error: 'Finish the jump: click the next landing square.' };
    return;
  }
  const r = R.applyQuantumMove(ui.game, { piece: p.piece, paths: p.paths });
  if (!r.ok) {
    ui.preview = r;
    return;
  }
  r.effects = R.describeChange(ui.game, r.state, p.piece);
  ui.preview = r;
}

function afterPlanChange(ev) {
  computePreview();
  const p = ui.plan;
  const instantMode = ui.quantum ? ev?.shiftKey : !ev?.shiftKey;
  const info = p && pieceInfo(p.piece);
  // Only play instantly when nothing collapses (world count unchanged). Moves that
  // collapse other pieces always stop at the plan panel so you can see the consequences.
  if (
    instantMode && p.paths.length === 1 && ui.preview?.ok &&
    ui.preview.state.worlds.length === ui.sum.W &&
    info.locs.size === 1 && info.alive === ui.sum.W && !extSteps().length
  ) {
    commit();
    return;
  }
  render();
}

function onBoardClick(ev) {
  if (ui.previewing) return;
  const cell = ev.target.closest('.cell[data-sq]');
  if (!cell) return;
  const sq = +cell.dataset.sq;
  const ghost = ev.target.closest('.piece');
  const gid = ghost ? +ghost.dataset.id : null;
  if (!canAct()) {
    // Tapping still explains ghosts (touch screens have no hover).
    if (gid !== null) showGhostInfo(gid, sq);
    return;
  }
  const p = ui.plan;

  if (p) {
    if (extSteps().includes(sq)) {
      p.paths[p.cur].push(sq);
      return afterPlanChange(ev);
    }
    if (firstSteps().includes(sq)) {
      p.paths.push([p.active, sq]);
      p.cur = p.paths.length - 1;
      return afterPlanChange(ev);
    }
    const idx = p.paths.findIndex((x) => x[x.length - 1] === sq);
    if (idx >= 0) {
      const path = p.paths[idx];
      if (path.length > 2) {
        path.pop();
        p.cur = idx;
      } else {
        p.paths.splice(idx, 1);
        p.cur = -1;
      }
      return afterPlanChange(ev);
    }
    if (pieceInfo(p.piece).locs.has(sq) && (gid === null || gid === p.piece)) {
      p.active = sq;
      p.cur = -1;
      return render();
    }
  }

  const mine = [...ui.sum.squares[sq].keys()].filter((id) => R.colorOfId(id) === ui.game.turn);
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
    if (!planCands(sq).length) {
      const mustCapture = ui.game.worlds.some((w) => w.b[sq] && w.b[sq] >> 2 === pick &&
        R.isJumpPath(R.classicalMoves(w.b, ui.game.turn)[0] ?? [0, 0]));
      toast(`${R.labelOf(pick)} can't move from ${sq + 1} in any world.` +
        (mustCapture ? ' A capture is mandatory elsewhere.' : ''), 3000);
    }
    render();
    if (gid !== null) showGhostInfo(gid, sq);
    return;
  }
  if (p && !p.paths.length) clearPlan();
  render();
  if (gid !== null) showGhostInfo(gid, sq);
}

// "If this ghost is the real one, what else must be true?" Shows entanglement.
function showGhostInfo(id, sq) {
  const hint = $('#hint');
  if (!hint) return;
  const info = ui.sum.pieces.get(id);
  if (!info || (info.locs.size <= 1 && info.alive === ui.sum.W)) {
    hint.textContent = '';
    return;
  }
  const worlds = ui.game.worlds.filter((w) => w.b[sq] && w.b[sq] >> 2 === id);
  if (!worlds.length) return;
  const effects = R.describeChange(ui.game, { worlds }, id);
  hint.textContent = `If ${R.labelOf(id)} is really on ${sq + 1} (${worlds.length} of ${ui.sum.W} worlds): ` +
    (effects.length ? effects.join(' · ') : 'nothing else on the board changes.');
}

function commit() {
  const p = ui.plan;
  if (!p || !ui.preview?.ok) return;
  const move = { piece: p.piece, paths: p.paths.map((x) => x.slice()) };
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
}

function setGame(state) {
  ui.game = state;
  clearPlan();
  render();
}

function announce(before, after) {
  const move = after.moves[after.moves.length - 1];
  if (!move) return;
  const effects = R.describeChange(before, after, move.piece);
  ui.notes[after.ply - 1] = { worlds: [before.worlds.length, after.worlds.length], effects };
  const mover = R.colorName(R.colorOfId(move.piece));
  let html = `<b>${mover}</b> played <b>${esc(R.fmtMove(move))}</b>`;
  if (before.worlds.length !== after.worlds.length) html += ` · worlds ${before.worlds.length} → ${after.worlds.length}`;
  if (effects.length) html += `<ul>${effects.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>`;
  toast(html, effects.length ? 6000 : 3000);
}

// ================================================================ main render
function render() {
  $('#hint').textContent = '';
  ui.sum = R.summarize(ui.game);
  const showing = ui.previewing && ui.preview?.ok ? ui.preview.state : ui.game;
  const sum = showing === ui.game ? ui.sum : R.summarize(showing);
  buildBoard(boardEl, sum);

  const lines = [];
  const dots = [];
  const p = ui.plan;
  const acting = canAct();
  if (!ui.previewing) {
    const last = ui.game.moves[ui.game.moves.length - 1];
    if (last && !p) {
      for (const path of last.paths) lines.push({ path, color: '#ffffff', dashed: true, width: 0.06, opacity: 0.45 });
    }
    if (acting) {
      for (const el of boardEl.querySelectorAll('.piece')) {
        if (R.colorOfId(+el.dataset.id) === ui.game.turn) el.classList.add('movable');
      }
    }
    if (p) {
      for (const el of boardEl.querySelectorAll(`.piece[data-id="${p.piece}"]`)) {
        el.classList.add('selected');
        if (+el.closest('.cell').dataset.sq === p.active) el.classList.add('active');
      }
      p.paths.forEach((path, i) => lines.push({ path, color: PATH_COLORS[i % PATH_COLORS.length] }));
      const nextColor = PATH_COLORS[p.paths.length % PATH_COLORS.length];
      for (const sq of extSteps()) dots.push({ sq, color: PATH_COLORS[p.cur % PATH_COLORS.length] });
      for (const sq of firstSteps()) dots.push({ sq, color: nextColor });
      for (const d of dots) boardEl.querySelector(`.cell[data-sq="${d.sq}"]`)?.classList.add('target');
    }
  } else if (ui.preview?.ok) {
    ui.plan.paths.forEach((path, i) => lines.push({ path, color: PATH_COLORS[i % PATH_COLORS.length], opacity: 0.5 }));
  }
  drawOverlay(boardEl, lines, dots);

  renderStrips();
  renderStatus();
  renderRoom();
  renderPlan();
  renderLog();
  renderControls();
}

function stripHTML(color) {
  const sum = ui.sum;
  let certain = 0, maybe = 0;
  for (const [id, info] of sum.pieces) {
    if (R.colorOfId(id) !== color) continue;
    if (info.alive === sum.W) certain++;
    else if (info.alive > 0) maybe++;
  }
  const res = result();
  let conn = '';
  if (ui.mode === 'online' && ui.roomInfo) {
    const on = ui.roomInfo.online[color];
    const seated = ui.roomInfo.seated[color];
    conn = `<span class="${on ? 'dot-on' : 'dot-off'}" title="${on ? 'connected' : seated ? 'disconnected' : 'waiting for player'}"></span>`;
  }
  const you = ui.mode === 'online' && ui.me === color ? ' (you)' : '';
  const turn = !res && ui.game.turn === color ? '<span class="turn">to move</span>' : '';
  return `<span class="chip ${color === R.BLACK ? 'black' : 'red'}"></span>${conn}
    <span class="who">${R.colorName(color)}${you}</span>
    <span>${certain} pieces${maybe ? ` + ${maybe} maybe` : ''}</span>${turn}`;
}
function renderStrips() {
  const bottom = ui.flipped ? R.BLACK : R.RED;
  $('#stripTop').innerHTML = stripHTML(1 - bottom);
  $('#stripBottom').innerHTML = stripHTML(bottom);
}

function renderStatus() {
  const res = result();
  const W = ui.game.worlds.length;
  let turnline;
  if (res) turnline = 'Game over';
  else if (ui.mode === 'online' && ui.me === null) turnline = `Spectating · ${R.colorName(ui.game.turn)} to move`;
  else if (ui.mode === 'online') turnline = ui.me === ui.game.turn ? 'Your move' : `Waiting for ${R.colorName(ui.game.turn)}…`;
  else turnline = `${R.colorName(ui.game.turn)} to move`;
  const chip = `<span class="strip"><span class="chip ${ui.game.turn === R.BLACK ? 'black' : 'red'}"></span></span>`;
  $('#status').innerHTML = `
    <div class="turnline">${res ? '' : chip}${turnline}</div>
    <div class="meta">
      <span>Worlds: <b>${W}</b></span>
      <span>Ply: <b>${ui.game.ply}</b></span>
      <button class="btn small" id="tlOpen">Timelines</button>
    </div>
    ${res ? `<div class="result"><strong>${esc(resultText(res))}</strong>
      ${W > 1 ? `${W} timelines survive, and every one of them is a normal game with this result.` : 'Exactly one timeline survives: the game that really happened.'}
      <div style="margin-top:8px"><button class="btn small" id="tlOpen2">Replay the real game</button></div></div>` : ''}
    ${ui.mode === 'online' && !ui.connected
      ? '<p class="error">Lost connection to the host. Reconnecting automatically when their game is open again…</p>' : ''}`;
  $('#tlOpen').onclick = openTimeline;
  const b2 = $('#tlOpen2');
  if (b2) b2.onclick = openTimeline;
}

function renderRoom() {
  const el = $('#roomPanel');
  if (ui.mode !== 'online' || !ui.roomInfo) {
    el.hidden = true;
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
      : `<p><b>${R.colorName(info.drawOffer)} offers a draw.</b></p>
         <div class="row"><button class="btn small" id="drawYes">Accept</button><button class="btn small" id="drawNo">Decline</button></div>`;
  }
  let rematch = '';
  if (info.result && ui.me !== null) {
    rematch = info.rematch[ui.me]
      ? '<p class="muted">Rematch requested, waiting for opponent…</p>'
      : info.rematch[1 - ui.me] ? '<p><b>Opponent wants a rematch.</b></p>' : '';
  }
  el.innerHTML = `
    <h3>Online game</h3>
    <div class="row"><span class="code">${info.room}</span>
      <button class="btn small" id="copyLink">Copy invite link</button></div>
    ${waiting ? '<p class="muted">Waiting for an opponent to join. Send them the link or the code.</p>' : ''}
    ${ui.me === null ? '<p class="muted">Both seats are taken, so you are watching.</p>' : ''}
    ${ui.isHost ? '<p class="muted">Your browser is hosting this game. Keep this tab open, or the game pauses until you come back.</p>' : ''}
    ${draw}${rematch}`;
  $('#copyLink').onclick = async () => {
    try {
      await navigator.clipboard.writeText(link);
      toast('Invite link copied.', 2000);
    } catch {
      prompt('Copy this link:', link);
    }
  };
  const yes = $('#drawYes'), no = $('#drawNo');
  if (yes) yes.onclick = () => sendNet({ t: 'answerDraw', accept: true });
  if (no) no.onclick = () => sendNet({ t: 'answerDraw', accept: false });
}

function renderPlan() {
  const el = $('#planPanel');
  const seg = `<div class="seg" role="group" aria-label="Input mode">
      <button data-q="0" class="${ui.quantum ? '' : 'on'}">Classic clicks</button>
      <button data-q="1" class="${ui.quantum ? 'on' : ''}">Quantum planning</button></div>`;
  const p = ui.plan;
  let body;
  if (result()) body = '<p class="hint">The game is over.</p>';
  else if (!canAct()) {
    body = ui.pending ? '<p class="hint">Sending move…</p>' : '<p class="hint">Waiting for the other player.</p>';
  } else if (!p) {
    body = `<p class="hint">Select one of your pieces. ${ui.quantum
      ? 'Choose up to two destinations per ghost, then press Commit or Enter.'
      : 'Moves of certain pieces play instantly. Shift-click a destination to plan a split.'}</p>`;
  } else {
    const info = pieceInfo(p.piece);
    const W = ui.sum.W;
    const locs = [...info.locs.entries()].sort((a, b) => b[1] - a[1]);
    let html = `<h3>Moving ${R.labelOf(p.piece)}</h3>`;
    for (const [sq, n] of locs) {
      const mine = p.paths.map((x, i) => [x, i]).filter(([x]) => x[0] === sq);
      const rows = mine.map(([x, i]) => `<div class="pathrow"><span class="sw" style="background:${PATH_COLORS[i % PATH_COLORS.length]}"></span>
          ${esc(R.fmtPath(x))}${isComplete(x) ? '' : ' …'}
          <button class="x" data-rm="${i}" aria-label="Remove">✕</button></div>`).join('');
      const ruled = !mine.length && p.paths.length
        ? `<div class="ruled">Not moved, so the worlds where ${R.labelOf(p.piece)} is here are ruled out</div>` : '';
      const none = !planCands(sq).length ? '<div class="ruled">No legal move from here</div>' : '';
      html += `<div class="loc ${sq === p.active ? 'active' : ''}" data-loc="${sq}">
        <div class="head"><span>From ${sq + 1}</span><span>${W > 1 ? (n === W ? 'all worlds' : `${n} of ${W} worlds`) : ''}</span></div>
        ${rows || none ? `<div class="paths">${rows}${none}</div>` : ''}${ruled}</div>`;
    }
    if (info.alive < W && p.paths.length) {
      html += `<div class="ruled">${R.labelOf(p.piece)} is captured in ${W - info.alive} worlds; moving it rules those out.</div>`;
    }
    const pv = ui.preview;
    if (pv && !pv.ok) html += `<p class="err">${esc(pv.error)}</p>`;
    if (pv?.ok) {
      const W2 = pv.state.worlds.length;
      html += `<p class="summary">Worlds: <b>${W}</b> → <b>${W2}</b>${p.paths.length > 1 && p.paths.some((x, i) => p.paths.findIndex((y) => y[0] === x[0]) !== i) ? ' · split' : ''}</p>`;
      if (W2 < W) html += '<p class="ruled">This move collapses the board. Check what changes below, then commit.</p>';
      if (pv.effects.length) html += `<ul class="effects">${pv.effects.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>`;
      if (pv.state.result) html += `<p class="summary"><b>${esc(resultText(pv.state.result))}</b></p>`;
    }
    html += `<div class="actions">
      <button class="btn primary" id="commitBtn" ${pv?.ok ? '' : 'disabled'}>Commit move ⏎</button>
      <button class="btn" id="previewBtn" ${pv?.ok ? '' : 'disabled'}>Hold to preview</button>
      <button class="btn subtle" id="clearBtn">Clear</button></div>`;
    body = html;
  }
  el.innerHTML = seg + body;

  for (const b of el.querySelectorAll('.seg button')) {
    b.onclick = () => {
      ui.quantum = b.dataset.q === '1';
      savePref('qc-quantum', ui.quantum);
      render();
    };
  }
  for (const b of el.querySelectorAll('[data-rm]')) {
    b.onclick = (e) => {
      e.stopPropagation();
      ui.plan.paths.splice(+b.dataset.rm, 1);
      ui.plan.cur = -1;
      computePreview();
      render();
    };
  }
  for (const d of el.querySelectorAll('[data-loc]')) {
    d.onclick = () => {
      ui.plan.active = +d.dataset.loc;
      ui.plan.cur = -1;
      render();
    };
  }
  const c = $('#commitBtn');
  if (c) c.onclick = commit;
  const cl = $('#clearBtn');
  if (cl) cl.onclick = () => (clearPlan(), render());
  const pb = $('#previewBtn');
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
    if (n && (n.effects.length || n.worlds[0] !== n.worlds[1])) {
      extra = `<div class="note">worlds ${n.worlds[0]} → ${n.worlds[1]}${n.effects.length ? ` · ${esc(n.effects.join(' · '))}` : ''}</div>`;
    }
    return `<li class="${R.colorOfId(m.piece) === R.BLACK ? 'b' : 'r'}">${esc(R.fmtMove(m))}${extra}</li>`;
  }).join('');
  el.scrollTop = el.scrollHeight;
}

// Rebuilds a game from its move list, recording what each move collapsed.
function replayWithNotes(moves) {
  let st = R.initialState();
  const notes = [];
  for (const m of moves) {
    const r = R.applyQuantumMove(st, m);
    if (!r.ok) throw new Error(r.error);
    notes.push({ worlds: [st.worlds.length, r.state.worlds.length], effects: R.describeChange(st, r.state, m.piece) });
    st = r.state;
  }
  ui.notes = notes;
  return st;
}

function renderControls() {
  const el = $('#controls');
  const res = result();
  const btns = [];
  if (ui.mode === 'local') {
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
  btns.push('<button class="btn" id="flipBtn">Flip board</button>');
  btns.push('<button class="btn subtle" id="menuBtn">Main menu</button>');
  el.innerHTML = btns.join('');
  const on = (id, fn) => {
    const b = $(id);
    if (b) b.onclick = fn;
  };
  on('#undoBtn', () => {
    if (!ui.history.length) return;
    setGame(ui.history.pop());
  });
  on('#newBtn', () => {
    if (ui.game.ply && !confirm('Start a new game?')) return;
    ui.history = [];
    setGame(R.initialState());
  });
  on('#drawBtn', () => sendNet({ t: 'offerDraw' }));
  on('#resignBtn', () => confirm('Resign this game?') && sendNet({ t: 'resign' }));
  on('#rematchBtn', () => sendNet({ t: 'rematch' }));
  on('#flipBtn', () => {
    ui.flipped = !ui.flipped;
    render();
  });
  on('#menuBtn', () => {
    if (ui.mode === 'local' && ui.game.ply && !result() && !confirm('Leave this game?')) return;
    showLobby();
  });
}

// ================================================================ timelines
const tl = { boards: [], paths: [], step: 0 };

function openTimeline() {
  const worlds = ui.game.worlds;
  const sel = $('#tlSelect');
  const n = Math.min(worlds.length, 200);
  sel.innerHTML = Array.from({ length: n }, (_, i) => `<option value="${i}">${i + 1} of ${worlds.length}</option>`).join('');
  sel.parentElement.hidden = worlds.length < 2;
  $('#tlIntro').textContent = worlds.length > 1
    ? `${worlds.length} possible worlds are still alive. Each one is an ordinary game of checkers where every turn one piece made one legal move. Pick one and step through it.`
    : 'Only one world is left, and this is it: an ordinary game of checkers where every turn one piece made one legal move.';
  loadTimeline(0);
  $('#timelineDlg').showModal();
}

function loadTimeline(i) {
  const paths = R.timeline(ui.game.worlds[i]);
  const boards = [R.initialBoard()];
  for (const p of paths) boards.push(R.applyClassical(boards[boards.length - 1], p));
  tl.boards = boards;
  tl.paths = paths;
  tl.step = boards.length - 1;
  renderTimeline();
}

function renderTimeline() {
  const el = $('#tlBoard');
  const st = R.stateFromBoards([tl.boards[tl.step]]);
  buildBoard(el, R.summarize(st));
  const p = tl.paths[tl.step - 1];
  drawOverlay(el, p ? [{ path: p, color: PATH_COLORS[0] }] : []);
  $('#tlLabel').textContent = tl.step === 0
    ? 'Start position'
    : `Ply ${tl.step}: ${R.colorName((tl.step - 1) % 2 === 0 ? R.BLACK : R.RED)} ${R.fmtPath(p)}`;
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
const PEER_PREFIX = 'quantum-checkers-v1-';
const HEARTBEAT_MS = 4000;
const TIMEOUT_MS = 15000;

const net = {
  peer: null,
  room: null, // set when this tab is the host
  hostClient: null, // the host's own loopback client
  guests: new Set(),
  conn: null, // guest's connection to the host
  lastHeard: 0,
  timers: [],
  wanted: false,
};

const tokenKey = (room) => `qc-token-${room}`;
const hostKey = (room) => `qc-host-${room}`;
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

function lobbyStatus(text) {
  $('#lobbyStatus').textContent = text;
}

function failToLobby(message) {
  showLobby();
  $('#lobbyError').textContent = message;
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
  if (!Array.isArray(msg.moves)) return;
  const first = !ui.roomInfo;
  const prevMe = ui.me;
  ui.roomInfo = msg;
  ui.me = msg.you === 0 || msg.you === 1 ? msg.you : null;
  if (ui.mode !== 'online') enterGame('online');
  if (first || prevMe !== ui.me) ui.flipped = ui.me === R.BLACK;

  const cur = ui.game.moves;
  let st = ui.game;
  const extends_ = msg.moves.length >= cur.length && cur.every((m, i) => sameMove(m, msg.moves[i]));
  try {
    if (extends_) {
      for (let i = cur.length; i < msg.moves.length; i++) {
        const r = R.applyQuantumMove(st, msg.moves[i]);
        if (!r.ok) throw new Error(r.error);
        ui.notes[i] = {
          worlds: [st.worlds.length, r.state.worlds.length],
          effects: R.describeChange(st, r.state, msg.moves[i].piece),
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
function enterGame(mode) {
  ui.mode = mode;
  $('#lobby').hidden = true;
  $('#game').hidden = false;
}

function showLobby() {
  teardownNet();
  Object.assign(ui, {
    mode: null, game: R.initialState(), history: [], plan: null, preview: null, isHost: false, notes: [],
    me: null, room: null, roomInfo: null, pending: false, connected: false, flipped: false,
  });
  history.replaceState(null, '', location.pathname);
  $('#game').hidden = true;
  $('#lobby').hidden = false;
  $('#lobbyError').textContent = '';
  lobbyStatus('');
}

function startLocal() {
  showLobby();
  enterGame('local');
  render();
}

function createOnline() {
  const color = $('#colorPref').value;
  showLobby();
  startHosting(randomCode(), { color, fresh: true });
}

function openRoom(code) {
  code = normalizeCode(code);
  if (code.length !== 5) {
    $('#lobbyError').textContent = 'Game codes are 5 characters.';
    return;
  }
  showLobby();
  // If this browser created the game, re-host it; otherwise join as a guest.
  if (loadPref(hostKey(code), null)) startHosting(code);
  else startGuest(code);
}

$('#localBtn').onclick = startLocal;
$('#createBtn').onclick = createOnline;
$('#joinForm').onsubmit = (e) => {
  e.preventDefault();
  openRoom($('#joinCode').value);
};
$('#rulesBtn').onclick = () => $('#rulesDlg').showModal();
for (const b of document.querySelectorAll('[data-close]')) b.onclick = () => b.closest('dialog').close();
for (const d of document.querySelectorAll('dialog')) {
  d.addEventListener('click', (e) => {
    if (e.target === d) d.close();
  });
}

boardEl.addEventListener('click', onBoardClick);
boardEl.addEventListener('mouseover', (e) => {
  const g = e.target.closest('.piece');
  if (!g) return;
  for (const el of boardEl.querySelectorAll(`.piece[data-id="${g.dataset.id}"]`)) el.classList.add('linked');
  showGhostInfo(+g.dataset.id, +g.closest('.cell').dataset.sq);
});
boardEl.addEventListener('mouseout', (e) => {
  const g = e.target.closest('.piece');
  if (!g || g.contains(e.relatedTarget)) return;
  for (const el of boardEl.querySelectorAll('.piece.linked')) el.classList.remove('linked');
  $('#hint').textContent = '';
});

document.addEventListener('keydown', (e) => {
  if (ui.mode === null || document.querySelector('dialog[open]')) return;
  if (e.target.matches('input, select, textarea')) return;
  if (e.key === 'Enter' && ui.preview?.ok) {
    e.preventDefault();
    commit();
  } else if (e.key === 'Escape' && ui.plan) {
    clearPlan();
    render();
  }
});

const params = new URLSearchParams(location.search);
if (params.get('room')) openRoom(params.get('room'));
