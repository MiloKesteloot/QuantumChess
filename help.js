// Visual "How to play" guide, one slide deck per game. Each slide shows small
// board diagrams built from simple specs, rendered with the same pieces and
// colors as the real board.
//
// Diagram spec: {
//   rows: [r0, r1], cols: [c0, c1],              // the part of the 8×8 board to show
//   pieces: [[r, c, color, opts]],               // color 0/1; opts: { kind, ghost, mixed, ring }
//                                                // ghost: true, or a name shared by the ghosts of one piece (they get joined by a line)
//   arrows: [{ path: [[r, c], ...], color, dashed }],
//   planned: [[r, c]], dots: [[r, c]], rings: [[r, c]], gone: [[r, c]],
// }

const CYAN = '#1f5fff', PINK = '#ff3d9a', WHITE = '#17141f'; // blue and pink inks; plain arrows are ink-black
const half = { ghost: 'a' }; // one of the two places a split piece might be

// Shared "how to move" and "winning" slides, worded per game.
function tapSlide(piece, dots, dest, extra = '') {
  return {
    title: 'How to move',
    text: `Tap a ${piece}, tap where it should go, then <b>tap that square again</b> to play. To split, tap a second square before confirming.${extra} On a keyboard: <kbd>Enter</kbd> plays, <kbd>Backspace</kbd> undoes a step, <kbd>Esc</kbd> clears.`,
    frames: [
      { label: `1. Tap a ${piece}`, board: dots },
      { label: '2. Tap a square', board: dest },
      { label: '3. Tap it again', board: dest.after },
    ],
  };
}

const CHECKERS = (() => {
  const ghosts = [[3, 2, 0, half], [3, 4, 0, half]];
  const crop = { rows: [2, 4], cols: [1, 4] };
  return [
    {
      title: "It's checkers…",
      text: 'Pieces move diagonally forward. Jump over an enemy piece to capture it. Jumping is <b>optional</b>, and a multi-jump can stop after any hop. Reach the far row and your piece is crowned a <b>king</b> that moves both ways.',
      frames: [
        { label: 'Move', board: { ...crop, pieces: [[2, 3, 0]], arrows: [{ path: [[2, 3], [3, 2]] }, { path: [[2, 3], [3, 4]] }] } },
        { label: 'Jump', board: { ...crop, pieces: [[2, 1, 0], [3, 2, 1]], arrows: [{ path: [[2, 1], [4, 3]] }] } },
        { label: 'King', board: { rows: [5, 7], cols: [0, 3], pieces: [[7, 2, 0, { kind: 1 }]], arrows: [{ path: [[6, 1], [7, 2]], dashed: true }] } },
      ],
    },
    {
      title: '…but a piece can split',
      text: 'Instead of one move, make <b>two moves at once</b>. The piece is now in both places, shown as two see-through <b>ghosts</b> joined by a line. Nothing is left to chance: it stays that way until a later move proves which one is real.',
      frames: [
        { label: 'Pick two squares', board: { ...crop, pieces: [[2, 3, 0, { ring: 'active' }]], arrows: [{ path: [[2, 3], [3, 2]], color: CYAN }, { path: [[2, 3], [3, 4]], color: PINK }], planned: [[3, 2], [3, 4]] } },
        { label: 'In both places', board: { ...crop, pieces: ghosts } },
      ],
    },
    {
      title: 'Every split makes worlds',
      text: 'Behind the scenes the game keeps <b>every possible board</b>. In each one, the piece is really in just one place, and each one is an ordinary game of checkers.',
      frames: [
        { label: 'What you see', board: { ...crop, pieces: ghosts } },
        { op: '=', label: 'World 1', board: { ...crop, pieces: [[3, 2, 0]] } },
        { op: '+', label: 'World 2', board: { ...crop, pieces: [[3, 4, 0]] } },
      ],
    },
    {
      title: 'Jump a ghost: it was real',
      text: 'You can only jump a piece that is really there, so <b>jumping a ghost proves it was the real one</b>. It gets captured, and its other ghosts vanish.',
      frames: [
        { label: 'Red jumps a ghost', board: { ...crop, pieces: [...ghosts, [4, 1, 1]], arrows: [{ path: [[4, 1], [2, 3]], color: CYAN }] } },
        { label: 'Both are gone', board: { ...crop, pieces: [[2, 3, 1]], gone: [[3, 2], [3, 4]] } },
      ],
    },
    {
      title: 'Block a ghost: it was elsewhere',
      text: 'You can only move onto an empty square, so <b>moving onto a ghost proves it wasn\'t there</b>. The piece collapses to its other spot.',
      frames: [
        { label: 'Red moves onto a ghost', board: { rows: [2, 4], cols: [2, 5], pieces: [...ghosts, [4, 5, 1]], arrows: [{ path: [[4, 5], [3, 4]], color: CYAN }] } },
        { label: 'The other one is real', board: { rows: [2, 4], cols: [2, 5], pieces: [[3, 2, 0], [3, 4, 1]] } },
      ],
    },
    {
      title: 'Moving a split piece',
      text: 'Give <b>every ghost</b> a move and the piece stays split. Moving <b>just one</b> ghost says that one is real, and the others vanish.',
      frames: [
        { label: 'Move both', board: { ...crop, pieces: ghosts, arrows: [{ path: [[3, 2], [4, 1]], color: CYAN }, { path: [[3, 4], [4, 3]], color: PINK }] } },
        { label: 'Still split', board: { ...crop, pieces: [[4, 1, 0, half], [4, 3, 0, half]] } },
        { label: 'Or move one…', board: { ...crop, pieces: [[4, 1, 0]], gone: [[3, 4]] }, op: 'or' },
      ],
    },
    tapSlide('piece',
      { ...crop, pieces: [[2, 3, 0, { ring: 'active' }]], dots: [[3, 2], [3, 4]] },
      Object.assign({ ...crop, pieces: [[2, 3, 0, { ring: 'active' }]], arrows: [{ path: [[2, 3], [3, 4]], color: CYAN }], planned: [[3, 4]] },
        { after: { ...crop, pieces: [[3, 4, 0]] } }),
      ' For a multi-jump, tap each landing square in turn.'),
    {
      title: 'Winning',
      text: 'You lose when you have <b>no legal move in any world</b>. However the worlds split and collapse, every one that survives is a normal game of checkers. Press <b>See the worlds</b> to replay one, move by move.',
      frames: [{ label: '', custom: 'timeline' }],
      final: true,
    },
  ];
})();

const CHESS = (() => {
  const N = 1, B = 2, R = 3, Q = 4, K = 5, P = 0;
  const crop = { rows: [4, 7], cols: [3, 7] };
  const knights = [[5, 5, 0, { kind: N, ...half }], [5, 7, 0, { kind: N, ...half }]];
  return [
    {
      title: "It's chess…",
      text: 'All the normal rules: every piece moves as usual, including <b>castling</b>, <b>en passant</b> and <b>promotion</b>. You may never leave your own king in check.',
      frames: [
        { label: 'Move', board: { ...crop, pieces: [[7, 6, 0, { kind: N }]], arrows: [{ path: [[7, 6], [5, 5]] }, { path: [[7, 6], [5, 7]] }] } },
        { label: 'Check', board: { rows: [4, 7], cols: [1, 4], pieces: [[7, 4, 0, { kind: K }], [4, 4, 1, { kind: R }]], arrows: [{ path: [[4, 4], [6, 4]], dashed: true, color: '#e0202a' }] } },
      ],
    },
    {
      title: '…but a piece can split',
      text: 'Instead of one move, make <b>two moves at once</b>. The piece is now in both places, shown as two see-through <b>ghosts</b> joined by a line. Nothing is left to chance: it stays that way until a later move proves which one is real. Any piece can split, even the king.',
      frames: [
        { label: 'Pick two squares', board: { ...crop, pieces: [[7, 6, 0, { kind: N, ring: 'active' }]], arrows: [{ path: [[7, 6], [5, 5]], color: CYAN }, { path: [[7, 6], [5, 7]], color: PINK }], planned: [[5, 5], [5, 7]] } },
        { label: 'In both places', board: { ...crop, pieces: knights } },
      ],
    },
    {
      title: 'Every split makes worlds',
      text: 'Behind the scenes the game keeps <b>every possible board</b>. In each one, the piece is really in just one place, and each one is an ordinary game of chess.',
      frames: [
        { label: 'What you see', board: { ...crop, pieces: knights } },
        { op: '=', label: 'World 1', board: { ...crop, pieces: [[5, 5, 0, { kind: N }]] } },
        { op: '+', label: 'World 2', board: { ...crop, pieces: [[5, 7, 0, { kind: N }]] } },
      ],
    },
    {
      title: 'Capturing a ghost',
      text: 'Moving onto a ghost\'s square is legal either way: a capture where it is, a quiet move where it isn\'t, so the ghost stays uncertain. Tick <b>Declare the capture</b> to say it is really there: that world is kept and the other ghost vanishes.',
      frames: [
        { label: 'Black declares ♗×f3', board: { ...crop, pieces: [...knights, [4, 6, 1, { kind: B }]], arrows: [{ path: [[4, 6], [5, 5]], color: CYAN }] } },
        { label: 'It was on f3', board: { ...crop, pieces: [[5, 5, 1, { kind: B }]], gone: [[5, 7]] } },
      ],
    },
    {
      title: 'Slide through a ghost: it was elsewhere',
      text: 'A rook, bishop or queen cannot pass through a piece, and a pawn can only step onto an empty square. So <b>moving through or onto a ghost\'s square proves it wasn\'t there</b>.',
      frames: [
        { label: 'The rook slides through h3', board: { rows: [4, 7], cols: [4, 7], pieces: [...knights, [4, 7, 1, { kind: R }]], arrows: [{ path: [[4, 7], [6, 7]], color: CYAN }] } },
        { label: 'So the knight is on f3', board: { rows: [4, 7], cols: [4, 7], pieces: [[5, 5, 0, { kind: N }], [6, 7, 1, { kind: R }]], gone: [[5, 7]] } },
      ],
    },
    {
      title: 'Check across worlds',
      text: 'Your king may be in check in <b>some</b> worlds and safe in others (its square glows red). A move that leaves it in check somewhere rules those worlds out. Checkmate is when you have no legal move in any world and are in check in at least one of them.',
      frames: [
        { label: 'Check, if the queen is on e4', board: { rows: [4, 7], cols: [1, 5], pieces: [[7, 4, 0, { kind: K }], [4, 4, 1, { kind: Q, ...half }], [4, 2, 1, { kind: Q, ...half }]], arrows: [{ path: [[4, 4], [6, 4]], dashed: true, color: '#e0202a' }] } },
        { label: 'Stepping aside keeps both', board: { rows: [4, 7], cols: [1, 5], pieces: [[7, 5, 0, { kind: K }], [4, 4, 1, { kind: Q, ...half }], [4, 2, 1, { kind: Q, ...half }]], arrows: [{ path: [[7, 4], [7, 5]], color: CYAN }] } },
      ],
    },
    tapSlide('piece',
      { ...crop, pieces: [[7, 6, 0, { kind: N, ring: 'active' }]], dots: [[5, 5], [5, 7]] },
      Object.assign({ ...crop, pieces: [[7, 6, 0, { kind: N, ring: 'active' }]], arrows: [{ path: [[7, 6], [5, 5]], color: CYAN }], planned: [[5, 5]] },
        { after: { ...crop, pieces: [[5, 5, 0, { kind: N }]] } }),
      ' Promotions and declared captures get buttons in the move panel.'),
    {
      title: 'Winning',
      text: '<b>Checkmate</b>: no legal move in any world, and in check in at least one. No move anywhere without check is stalemate. Every surviving world is a normal game of chess; press <b>See the worlds</b> to replay one.',
      frames: [{ label: '', custom: 'timeline' }],
      final: true,
    },
  ];
})();

const REVERSI = (() => {
  const crop = { rows: [2, 5], cols: [2, 5] };
  const maybe = { ghost: true };
  const start = [[3, 3, 1], [3, 4, 0], [4, 3, 0], [4, 4, 1]];
  return [
    {
      title: "It's Reversi…",
      text: 'Place a disc so that enemy discs lie in a straight line between it and one of yours: they all <b>flip</b> to your color. Every move must flip at least one disc. If you have no legal move you <b>pass</b>; when nobody can move, most discs wins.',
      frames: [
        { label: 'Black plays d3', board: { ...crop, pieces: start, rings: [[2, 3]], arrows: [{ path: [[2, 3], [3, 3]], color: CYAN }] } },
        { label: 'd4 flips', board: { ...crop, pieces: [[2, 3, 0], [3, 3, 0], [3, 4, 0], [4, 3, 0], [4, 4, 1]] } },
      ],
    },
    {
      title: '…but a disc can go in two squares',
      text: 'Instead of one square, pick <b>two squares at once</b>. The new disc is now in both places, shown as two see-through <b>ghosts</b>. Nothing is left to chance: they stay that way until a later move proves which one is real.',
      frames: [
        { label: 'Pick two squares', board: { ...crop, pieces: start, planned: [[2, 3], [4, 5]], rings: [[2, 3], [4, 5]] } },
        { label: 'In both places', board: { ...crop, pieces: [[2, 3, 0, maybe], [4, 5, 0, maybe], [3, 3, 1, { mixed: true }], [3, 4, 0], [4, 3, 0], [4, 4, 1, { mixed: true }]] } },
      ],
    },
    {
      title: 'Every split makes worlds',
      text: 'Behind the scenes the game keeps <b>every possible board</b>. The flips are different in each world, so discs can end up <b>half one color, half the other</b>: that disc is black in some worlds and white in others.',
      frames: [
        { label: 'What you see', board: { ...crop, pieces: [[2, 3, 0, maybe], [4, 5, 0, maybe], [3, 3, 1, { mixed: true }], [3, 4, 0], [4, 3, 0], [4, 4, 1, { mixed: true }]] } },
        { op: '=', label: 'World 1', board: { ...crop, pieces: [[2, 3, 0], [3, 3, 0], [3, 4, 0], [4, 3, 0], [4, 4, 1]] } },
        { op: '+', label: 'World 2', board: { ...crop, pieces: [[4, 5, 0], [3, 3, 1], [3, 4, 0], [4, 3, 0], [4, 4, 0]] } },
      ],
    },
    {
      title: 'A move must flip something',
      text: 'Your move has to be legal in a world for that world to survive. Placing where you would flip <b>nothing</b> in some worlds rules those worlds out, and placing on a ghost disc proves it <b>wasn\'t there</b>. Almost every move measures the board.',
      frames: [
        { label: 'White plays c3', board: { ...crop, pieces: [[2, 3, 0, maybe], [4, 5, 0, maybe], [3, 3, 1, { mixed: true }], [3, 4, 0], [4, 3, 0], [4, 4, 1, { mixed: true }]], rings: [[2, 2]] } },
        { label: 'Only legal where d4 was black', board: { ...crop, pieces: [[2, 2, 1], [2, 3, 0], [3, 3, 1], [3, 4, 0], [4, 3, 0], [4, 4, 1]], gone: [[4, 5]] } },
      ],
    },
    {
      title: 'Passing',
      text: 'If you have no legal placement in <b>some</b> worlds, tick <b>Pass</b> for those while placing a disc in the others. If you have none anywhere, you pass automatically. Passing on purpose where you could have moved rules those worlds out.',
      frames: [
        { label: 'No move here…', board: { rows: [1, 4], cols: [1, 4], pieces: [[2, 2, 1], [2, 3, 1], [2, 4, 1], [3, 2, 1], [3, 3, 0], [3, 4, 1], [4, 2, 1], [4, 3, 1], [4, 4, 1]] } },
        { op: '+', label: '…but a move here', board: { rows: [1, 4], cols: [1, 4], pieces: [[2, 2, 1], [2, 3, 1], [2, 4, 1], [3, 2, 1], [3, 3, 0], [4, 2, 1], [4, 3, 1], [4, 4, 1]], rings: [[3, 4]] } },
      ],
    },
    tapSlide('square',
      { ...crop, pieces: start, dots: [[2, 3], [3, 2], [4, 5], [5, 4]] },
      Object.assign({ ...crop, pieces: start, planned: [[2, 3]], rings: [[2, 3]] },
        { after: { ...crop, pieces: [[2, 3, 0], [3, 3, 0], [3, 4, 0], [4, 3, 0], [4, 4, 1]] } })),
    {
      title: 'Winning',
      text: 'The game ends when <b>nobody can move in any world</b>. Your score is your average disc count over the surviving timelines, and each of those is a normal game of Reversi. Press <b>See the worlds</b> to replay one.',
      frames: [{ label: '', custom: 'timeline' }],
      final: true,
    },
  ];
})();

const SLIDES = { checkers: CHECKERS, chess: CHESS, reversi: REVERSI };

// ---------------------------------------------------------------- diagrams
const SVG = 'http://www.w3.org/2000/svg';

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

export function miniBoard(game, spec) {
  const [r0, r1] = spec.rows, [c0, c1] = spec.cols;
  const rows = r1 - r0 + 1, cols = c1 - c0 + 1;
  const board = el('div', 'mini-board');
  board.dataset.game = game.id;
  board.style.setProperty('--cols', cols);
  board.style.setProperty('--rows', rows);
  const key = (r, c) => `${r},${c}`;
  // Drawn the way the real board is: the side that moves first at the bottom.
  const flip = !!game.homeRow && game.homeRow[0] === 0;
  const cells = new Map();
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const r = flip ? r1 - i : r0 + i, c = flip ? c1 - j : c0 + j;
      const cell = el('div', `cell ${(r + c) % 2 ? 'dark' : 'light'}`);
      cells.set(key(r, c), cell);
      board.append(cell);
    }
  }
  for (const [r, c] of spec.planned || []) cells.get(key(r, c))?.classList.add('planned');
  for (const [r, c] of spec.gone || []) cells.get(key(r, c))?.append(el('div', 'gone'));
  const groups = new Map(); // ghost name -> the squares that piece might be on
  for (const [r, c, color, o = {}] of spec.pieces || []) {
    const p = el('div', `piece ${game.id} c${color} k${o.kind ?? 0}`);
    if (o.ghost) {
      p.classList.add('ghost');
      if (o.ghost !== true) groups.set(o.ghost, [...(groups.get(o.ghost) || []), [r, c]]);
    }
    if (o.mixed) p.classList.add('mixed');
    if (o.ring) cells.get(key(r, c))?.classList.add('sel');
    cells.get(key(r, c))?.append(p);
  }
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', `0 0 ${cols} ${rows}`);
  svg.setAttribute('class', 'overlay');
  const pt = ([r, c]) => (flip ? [c1 - c + 0.5, r1 - r + 0.5] : [c - c0 + 0.5, r - r0 + 0.5]);
  for (const sqs of groups.values()) {
    for (let i = 1; i < sqs.length; i++) {
      const [x1, y1] = pt(sqs[i - 1]), [x2, y2] = pt(sqs[i]);
      const t = 0.4 / Math.hypot(x2 - x1, y2 - y1);
      const line = document.createElementNS(SVG, 'line');
      for (const [k, v] of Object.entries({ class: 'link', x1: x1 + (x2 - x1) * t, y1: y1 + (y2 - y1) * t, x2: x2 - (x2 - x1) * t, y2: y2 - (y2 - y1) * t })) {
        line.setAttribute(k, v);
      }
      svg.append(line);
    }
  }
  (spec.arrows || []).forEach((a, i) => {
    const color = a.color || WHITE;
    const id = `hm${Math.random().toString(36).slice(2, 8)}${i}`;
    const marker = document.createElementNS(SVG, 'marker');
    for (const [k, v] of Object.entries({ id, viewBox: '0 0 10 10', refX: 6, refY: 5, markerWidth: 3.6, markerHeight: 3.6, orient: 'auto-start-reverse' })) {
      marker.setAttribute(k, v);
    }
    const tip = document.createElementNS(SVG, 'path');
    tip.setAttribute('d', 'M0,0 L10,5 L0,10 z');
    tip.setAttribute('fill', color);
    marker.append(tip);
    svg.append(marker);
    const line = document.createElementNS(SVG, 'polyline');
    line.setAttribute('points', a.path.map((p) => pt(p).join(',')).join(' '));
    for (const [k, v] of Object.entries({ fill: 'none', stroke: color, 'stroke-width': 0.11, 'stroke-linecap': 'round', 'marker-end': `url(#${id})` })) {
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
  for (const d of spec.rings || []) {
    const [x, y] = pt(d);
    const c = document.createElementNS(SVG, 'circle');
    c.setAttribute('cx', x);
    c.setAttribute('cy', y);
    c.setAttribute('r', 0.36);
    c.setAttribute('fill', 'none');
    c.setAttribute('stroke', CYAN);
    c.setAttribute('stroke-width', 0.08);
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
      <g stroke="#a39c8c" stroke-width="3" fill="none" stroke-linecap="round">
        <path d="M20 60 H80 C110 60 110 25 140 25 H200"/>
        <path d="M80 60 C110 60 110 95 140 95 H170"/>
        <path d="M140 25 C165 25 165 5 190 5"/>
      </g>
      <path d="M20 60 H80 C110 60 110 25 140 25 H280" stroke="${CYAN}" stroke-width="4" fill="none" stroke-linecap="round"/>
      <g fill="#a39c8c"><circle cx="170" cy="95" r="6"/><circle cx="190" cy="5" r="5"/></g>
      <g font-size="13" font-weight="700" fill="#645d70" font-family="system-ui, sans-serif">
        <text x="150" y="112">ruled out</text>
      </g>
      <circle cx="20" cy="60" r="7" fill="${CYAN}"/>
      <circle cx="280" cy="25" r="8" fill="${CYAN}"/>
      <text x="208" y="48" font-size="13" font-weight="700" fill="${CYAN}" font-family="system-ui, sans-serif">the real game</text>
    </svg>`;
  return wrap;
}

// ---------------------------------------------------------------- carousel
// `getGame` returns the current game module; the deck is rebuilt when it changes.
export function setupHelp(dialog, getGame, { onFinish } = {}) {
  const body = dialog.querySelector('.help-body');
  const dots = dialog.querySelector('.help-dots');
  const prev = dialog.querySelector('.help-prev');
  const next = dialog.querySelector('.help-next');
  const title = dialog.querySelector('.help-title');
  let index = 0;
  let builtFor = null;
  let slides = [];

  function build(game) {
    slides = SLIDES[game.id];
    body.innerHTML = '';
    dots.innerHTML = '';
    if (title) title.textContent = `How to play Quantum ${game.name}`;
    slides.forEach((s, i) => {
      const slide = el('section', 'slide');
      slide.hidden = true;
      slide.append(el('h3', 'slide-title', s.title));
      const frames = el('div', 'frames');
      s.frames.forEach((f, j) => {
        if (j > 0) frames.append(el('div', 'frame-op', f.op || '→'));
        const fr = el('figure', 'frame');
        fr.append(f.custom === 'timeline' ? timelineDiagram() : miniBoard(game, f.board));
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
    builtFor = game.id;
  }

  function show(i) {
    index = Math.max(0, Math.min(slides.length - 1, i));
    [...body.children].forEach((s, j) => (s.hidden = j !== index));
    [...dots.children].forEach((d, j) => d.classList.toggle('on', j === index));
    prev.disabled = index === 0;
    next.textContent = slides[index].final ? 'Start playing' : 'Next';
    next.classList.toggle('primary', !!slides[index].final);
  }

  prev.onclick = () => show(index - 1);
  next.onclick = () => {
    if (slides[index].final) {
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
      const game = getGame();
      if (builtFor !== game.id) build(game);
      show(at);
      dialog.showModal();
    },
  };
}
