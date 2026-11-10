// Visual "How to play" guide. Each slide shows small board diagrams built from
// simple specs, rendered with the same pieces and colors as the real board.
//
// Diagram spec: {
//   rows: [r0, r1], cols: [c0, c1],        // the part of the 8×8 board to show
//   pieces: [[r, c, 'b'|'r', opts]],       // opts: { frac, king, ring: 'selected'|'active' }
//   arrows: [{ path: [[r, c], ...], color }],
//   planned: [[r, c]], dots: [[r, c]], gone: [[r, c]],
// }

const CYAN = '#5ee6ff', PINK = '#ff6bd6', WHITE = '#ffffff';

// A split pair of black ghosts on (3,2) and (3,4), used on several slides.
const ghosts = [[3, 2, 'b', { frac: 0.5 }], [3, 4, 'b', { frac: 0.5 }]];

const SLIDES = [
  {
    title: "It's checkers…",
    text: 'Pieces move diagonally forward. Jump over an enemy piece to capture it. Jumping is <b>optional</b>, and a multi-jump can stop after any hop. Reach the far row and your piece becomes a <b>king</b> ♛ that moves both ways.',
    frames: [
      { label: 'Move', board: { rows: [2, 4], cols: [1, 4], pieces: [[2, 3, 'b']], arrows: [{ path: [[2, 3], [3, 2]] }, { path: [[2, 3], [3, 4]] }] } },
      { label: 'Jump', board: { rows: [2, 4], cols: [1, 4], pieces: [[2, 1, 'b'], [3, 2, 'r']], arrows: [{ path: [[2, 1], [4, 3]] }] } },
      { label: 'King', board: { rows: [5, 7], cols: [0, 3], pieces: [[7, 2, 'b', { king: true }]], arrows: [{ path: [[6, 1], [7, 2]], dashed: true }] } },
    ],
  },
  {
    title: '…but a piece can split',
    text: 'Instead of one move, make <b>two moves at once</b>. The piece is now in both places, shown as two see-through <b>ghosts</b>. The % shows how likely each one is.',
    frames: [
      {
        label: 'Pick two squares',
        board: {
          rows: [2, 4], cols: [1, 4], pieces: [[2, 3, 'b', { ring: 'active' }]],
          arrows: [{ path: [[2, 3], [3, 2]], color: CYAN }, { path: [[2, 3], [3, 4]], color: PINK }], planned: [[3, 2], [3, 4]],
        },
      },
      { label: 'In both places', board: { rows: [2, 4], cols: [1, 4], pieces: ghosts } },
    ],
  },
  {
    title: 'Every split makes worlds',
    text: 'Behind the scenes the game keeps <b>every possible board</b>. In each one, the piece is really in just one place, and each one is an ordinary game of checkers.',
    frames: [
      { label: 'What you see', board: { rows: [2, 4], cols: [1, 4], pieces: ghosts } },
      { op: '=', label: 'World 1', board: { rows: [2, 4], cols: [1, 4], pieces: [[3, 2, 'b']] } },
      { op: '+', label: 'World 2', board: { rows: [2, 4], cols: [1, 4], pieces: [[3, 4, 'b']] } },
    ],
  },
  {
    title: 'Jump a ghost: it was real',
    text: 'You can only jump a piece that is really there, so <b>jumping a ghost proves it was the real one</b>. It gets captured, and its other ghosts vanish.',
    frames: [
      { label: 'Red jumps a ghost', board: { rows: [2, 4], cols: [1, 4], pieces: [...ghosts, [4, 1, 'r']], arrows: [{ path: [[4, 1], [2, 3]], color: CYAN }] } },
      { label: 'Both are gone', board: { rows: [2, 4], cols: [1, 4], pieces: [[2, 3, 'r']], gone: [[3, 2], [3, 4]] } },
    ],
  },
  {
    title: 'Block a ghost: it was elsewhere',
    text: 'You can only move onto an empty square, so <b>moving onto a ghost proves it wasn\'t there</b>. The piece collapses to its other spot.',
    frames: [
      { label: 'Red moves onto a ghost', board: { rows: [2, 4], cols: [2, 5], pieces: [...ghosts, [4, 5, 'r']], arrows: [{ path: [[4, 5], [3, 4]], color: CYAN }] } },
      { label: 'The other one is real', board: { rows: [2, 4], cols: [2, 5], pieces: [[3, 2, 'b'], [3, 4, 'r']], gone: [] } },
    ],
  },
  {
    title: 'Moving a split piece',
    text: 'Give <b>every ghost</b> a move and the piece stays split. Moving <b>just one</b> ghost means you are saying that one is real, and the others vanish.',
    frames: [
      {
        label: 'Move both',
        board: { rows: [2, 4], cols: [1, 4], pieces: ghosts, arrows: [{ path: [[3, 2], [4, 1]], color: CYAN }, { path: [[3, 4], [4, 3]], color: PINK }] },
      },
      { label: 'Still split', board: { rows: [2, 4], cols: [1, 4], pieces: [[4, 1, 'b', { frac: 0.5 }], [4, 3, 'b', { frac: 0.5 }]] } },
      { label: 'Or move one…', board: { rows: [2, 4], cols: [1, 4], pieces: [[4, 1, 'b']], gone: [[3, 4]] }, op: 'or' },
    ],
  },
  {
    title: 'How to move',
    text: 'Tap a piece, tap where it should go, then <b>tap that square again</b> to play. To split, tap a second square before confirming. On a keyboard: <kbd>Enter</kbd> plays, <kbd>Backspace</kbd> undoes a step, <kbd>Esc</kbd> clears.',
    frames: [
      { label: '1. Tap a piece', board: { rows: [2, 4], cols: [1, 4], pieces: [[2, 3, 'b', { ring: 'active' }]], dots: [[3, 2], [3, 4]] } },
      { label: '2. Tap a square', board: { rows: [2, 4], cols: [1, 4], pieces: [[2, 3, 'b', { ring: 'active' }]], arrows: [{ path: [[2, 3], [3, 4]], color: CYAN }], planned: [[3, 4]] } },
      { label: '3. Tap it again', board: { rows: [2, 4], cols: [1, 4], pieces: [[3, 4, 'b']] } },
    ],
  },
  {
    title: 'Winning',
    text: 'You lose when you have <b>no legal move in any world</b>. However the worlds split and collapse, every one that survives is a normal game of checkers. Open <b>Timelines</b> to replay one, move by move.',
    frames: [{ label: '', custom: 'timeline' }],
    final: true,
  },
];

// ---------------------------------------------------------------- diagrams
const SVG = 'http://www.w3.org/2000/svg';

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

export function miniBoard(spec) {
  const [r0, r1] = spec.rows, [c0, c1] = spec.cols;
  const rows = r1 - r0 + 1, cols = c1 - c0 + 1;
  const board = el('div', 'mini-board');
  board.style.setProperty('--cols', cols);
  board.style.setProperty('--rows', rows);
  const key = (r, c) => `${r},${c}`;
  const cells = new Map();
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const cell = el('div', `cell ${(r + c) % 2 ? 'dark' : 'light'}`);
      cells.set(key(r, c), cell);
      board.append(cell);
    }
  }
  for (const [r, c] of spec.planned || []) cells.get(key(r, c))?.classList.add('planned');
  for (const [r, c] of spec.gone || []) cells.get(key(r, c))?.append(el('div', 'gone'));
  for (const [r, c, color, o = {}] of spec.pieces || []) {
    const frac = o.frac ?? 1;
    const p = el('div', `piece ${color === 'b' ? 'black' : 'red'}`);
    p.style.setProperty('--frac', frac);
    if (frac < 1) {
      p.classList.add('quantum');
      p.append(el('span', 'tag', `${Math.round(frac * 100)}%`));
    }
    if (o.king) p.append(el('span', 'crown', '♛'));
    if (o.ring) p.classList.add(o.ring);
    cells.get(key(r, c))?.append(p);
  }
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', `0 0 ${cols} ${rows}`);
  svg.setAttribute('class', 'overlay');
  const pt = ([r, c]) => [c - c0 + 0.5, r - r0 + 0.5];
  (spec.arrows || []).forEach((a, i) => {
    const color = a.color || WHITE;
    const id = `hm${Math.random().toString(36).slice(2, 8)}${i}`;
    const marker = document.createElementNS(SVG, 'marker');
    for (const [k, v] of Object.entries({ id, viewBox: '0 0 10 10', refX: 6, refY: 5, markerWidth: 4, markerHeight: 4, orient: 'auto-start-reverse' })) {
      marker.setAttribute(k, v);
    }
    const tip = document.createElementNS(SVG, 'path');
    tip.setAttribute('d', 'M0,0 L10,5 L0,10 z');
    tip.setAttribute('fill', color);
    marker.append(tip);
    svg.append(marker);
    const line = document.createElementNS(SVG, 'polyline');
    line.setAttribute('points', a.path.map((p) => pt(p).join(',')).join(' '));
    for (const [k, v] of Object.entries({ fill: 'none', stroke: color, 'stroke-width': 0.1, 'stroke-linecap': 'round', 'marker-end': `url(#${id})` })) {
      line.setAttribute(k, v);
    }
    if (a.dashed) line.setAttribute('stroke-dasharray', '0.15 0.12');
    svg.append(line);
  });
  for (const d of spec.dots || []) {
    const [x, y] = pt(d);
    const c = document.createElementNS(SVG, 'circle');
    c.setAttribute('cx', x);
    c.setAttribute('cy', y);
    c.setAttribute('r', 0.14);
    c.setAttribute('fill', CYAN);
    svg.append(c);
  }
  board.append(svg);
  return board;
}

// One world splitting into several and collapsing back to one surviving timeline.
function timelineDiagram() {
  const wrap = el('div', 'tl-diagram');
  wrap.innerHTML = `
    <svg viewBox="0 0 300 120" role="img" aria-label="One game splits into several worlds; one surviving timeline is highlighted">
      <g stroke="#5b6080" stroke-width="3" fill="none" stroke-linecap="round">
        <path d="M20 60 H80 C110 60 110 25 140 25 H200"/>
        <path d="M80 60 C110 60 110 95 140 95 H170"/>
        <path d="M140 25 C165 25 165 5 190 5"/>
      </g>
      <path d="M20 60 H80 C110 60 110 25 140 25 H280" stroke="${CYAN}" stroke-width="4" fill="none" stroke-linecap="round"/>
      <g fill="#5b6080"><circle cx="170" cy="95" r="6"/><circle cx="190" cy="5" r="5"/><circle cx="200" cy="25" r="0"/></g>
      <g font-size="13" fill="#9aa0c3" font-family="system-ui, sans-serif">
        <text x="150" y="112">ruled out</text>
      </g>
      <circle cx="20" cy="60" r="7" fill="${CYAN}"/>
      <circle cx="280" cy="25" r="8" fill="${CYAN}"/>
      <text x="218" y="48" font-size="13" fill="${CYAN}" font-family="system-ui, sans-serif">the real game</text>
    </svg>`;
  return wrap;
}

// ---------------------------------------------------------------- carousel
export function setupHelp(dialog, { onFinish } = {}) {
  const body = dialog.querySelector('.help-body');
  const dots = dialog.querySelector('.help-dots');
  const prev = dialog.querySelector('.help-prev');
  const next = dialog.querySelector('.help-next');
  let index = 0;
  let built = false;

  function build() {
    body.innerHTML = '';
    dots.innerHTML = '';
    SLIDES.forEach((s, i) => {
      const slide = el('section', 'slide');
      slide.hidden = true;
      slide.append(el('h3', 'slide-title', s.title));
      const frames = el('div', 'frames');
      s.frames.forEach((f, j) => {
        if (j > 0) frames.append(el('div', 'frame-op', f.op || '→'));
        const fr = el('figure', 'frame');
        fr.append(f.custom === 'timeline' ? timelineDiagram() : miniBoard(f.board));
        if (f.label) fr.append(el('figcaption', null, f.label));
        frames.append(fr);
      });
      slide.append(frames);
      const p = el('p', 'slide-text');
      p.innerHTML = s.text;
      slide.append(p);
      body.append(slide);
      const dot = el('button', 'help-dot');
      dot.type = 'button';
      dot.setAttribute('aria-label', `Step ${i + 1}: ${s.title}`);
      dot.onclick = () => show(i);
      dots.append(dot);
    });
    built = true;
  }

  function show(i) {
    index = Math.max(0, Math.min(SLIDES.length - 1, i));
    [...body.children].forEach((s, j) => (s.hidden = j !== index));
    [...dots.children].forEach((d, j) => d.classList.toggle('on', j === index));
    prev.disabled = index === 0;
    next.textContent = SLIDES[index].final ? 'Start playing' : 'Next';
    next.classList.toggle('primary', !!SLIDES[index].final);
  }

  prev.onclick = () => show(index - 1);
  next.onclick = () => {
    if (SLIDES[index].final) {
      dialog.close();
      onFinish?.();
    } else show(index + 1);
  };
  dialog.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') show(index + 1);
    else if (e.key === 'ArrowLeft') show(index - 1);
  });

  // Swipe between slides on touch screens.
  let startX = null, startY = null;
  body.addEventListener('pointerdown', (e) => {
    startX = e.clientX;
    startY = e.clientY;
  });
  body.addEventListener('pointerup', (e) => {
    if (startX === null) return;
    const dx = e.clientX - startX, dy = e.clientY - startY;
    startX = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) show(index + (dx < 0 ? 1 : -1));
  });

  return {
    open(at = 0) {
      if (!built) build();
      show(at);
      dialog.showModal();
    },
  };
}
