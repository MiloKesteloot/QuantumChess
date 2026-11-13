# Quantum Games: Checkers, Chess and Reversi

Three classic board games with one twist: a piece can make two moves at once and exist in superposition until the game forces it to collapse. Pick a game on the start page, then play against the computer, two players on one device, or online with a friend through a link. It works on phones, tablets and desktops.

It's a static site, so there's no server to run or pay for.

## Putting it on GitHub Pages

1. Push this repo to GitHub.
2. In the repo, go to **Settings → Pages**. Under **Build and deployment**, choose **Deploy from a branch**, select **main** and **/ (root)**, then click **Save**.
3. After a minute the site is live at `https://<your-username>.github.io/<repo-name>/`. Add `?game=chess` (or `checkers`, `reversi`) to link straight to one game.

## Playing

- **Choose a game** on the opening page. That takes you to the game's own page, where you choose how to play it.
- **Play the computer:** pick a difficulty and your color, then click **Play**. Easy makes mistakes, Medium looks a few moves ahead, and Hard thinks for up to about two seconds per move. The computer splits and collapses pieces too. Undo takes you back to your previous turn.
- **Pass and play:** two players share one screen.
- **Play a friend online:** click **Create game**. The invite link appears over the board with a big **Copy invite link** button; send it to a friend, and the game starts when they open it. Opening the link joins the game (the creator chooses the game). Anyone who opens it after both seats are taken can watch. You can also type a game code into the yellow **Got a code?** box on the opening page.
- **Which way up:** you are always at the bottom of the board. In pass-and-play the side that moves first is at the bottom.

How online play works: the creator's browser hosts the game, and the two browsers talk to each other directly (WebRTC, via [PeerJS](https://peerjs.com/)). PeerJS's free public service only introduces the browsers to each other. What this means in practice:

- **Refreshing is fine.** Each player's seat is remembered by their browser, so after a refresh they are back in the same game within a second or two. If the host closes their tab for good, the game pauses; reopening the invite link in the same browser restores it, and the other player reconnects automatically.
- **Both players check every move.** The host rejects illegal moves from the guest, and the guest replays the host's move list with the same rules engine.
- **Some networks may not connect.** A few very strict networks (some workplace or school Wi-Fi) can block browser-to-browser connections. PeerJS falls back to a relay server, which fixes most cases.
- **Test it yourself** by opening the invite link in a second tab. Each tab gets its own seat.

## Running locally

```sh
npm start   # http://localhost:3000  (any static file server works too)
npm test    # engine, rules, room and AI tests
```

Requires Node 18+. There are no dependencies to install.

## The quantum rules (all three games)

**The game state is a set of possible worlds.** Each world is an ordinary position of the game you're playing, together with the ordinary move history that produced it.

- **Split:** instead of one move, make two different moves at once. Every world is copied: in one copy the piece went one way, in the other it went the other way. A piece can be in at most 4 places, and the game holds at most 512 worlds.
- **Collapse:** every move must be a legal, ordinary move in each world it applies to. Worlds where it isn't are deleted. Which moves are legal depends on where the ghosts really are, so moves act as measurements.
- **Moving a superposed piece:** give each ghost its own move (and you can split a ghost again). Any ghost you don't move is ruled out, since in every world the piece you moved has to have actually moved.
- **Winning:** you lose when you have no legal move in any world. If every surviving world is a draw, it's a draw. Online games can also end by resignation or agreement.

**The guarantee:** every surviving world is a normal game in which each turn the side to move made exactly one legal move. The **See the worlds** button lets you step through any of them. When the game ends, it shows the game that really happened.

### Checkers

Black moves first. Men move diagonally forward and become kings on the far row (which ends the move). **Jumping is optional**, and a multi-jump can stop after any hop.

- **Jumping a ghost** proves it was really there: it's captured, and its other ghosts vanish.
- **Moving onto a ghost's square** proves the piece wasn't there.
- Draw after 40 moves each of non-capturing king moves in every world.

### Chess

Full rules: castling, en passant, promotion, check. White moves first.

- A move may **never leave your own king in check** in a world, so if your king is in check in some worlds (it glows red), any move that ignores the check there rules those worlds out.
- **Sliding through a ghost** (rook, bishop, queen) or pushing a pawn onto one proves it wasn't there.
- **Moving onto a ghost's square** is legal either way: a capture where the piece is, a quiet move where it isn't, so by itself it collapses nothing. Tick **Declare the capture** to assert the piece is really there; only those worlds survive.
- **Checkmate:** no legal move in any world, and in check in at least one. No legal move anywhere without check is stalemate. Draw also after 50 moves each without a capture or pawn move in every world, or when neither side has mating material anywhere.

### Reversi

Black moves first. A placement must outflank and flip at least one enemy disc. If you have no legal placement you must pass; when nobody can move, the game is over.

- Flips happen separately in each world, so a disc can be **black in some worlds and white in others**: it's drawn half-and-half.
- Placing where you would **flip nothing** in some worlds rules those worlds out; placing on a ghost disc proves it wasn't there. Almost every move is a measurement.
- **Passing:** if you have no legal placement in some worlds, tick **Pass** for those while placing a disc in the others. If you have none anywhere, you pass automatically.
- **Scoring:** when nobody can move in any world, your score is your average disc count over the surviving timelines.

## Controls

- Click a piece (or, in Reversi, a square), then a destination. **Click the destination again** (or press **Enter**) to play the move.
- **Split:** click a second destination before confirming, then click either destination again.
- **Checkers multi-jump:** click each landing square in turn, then click the last one again.
- **Chess promotion** and **declared captures** get buttons in the move panel (and the bottom bar on phones).
- **Moving a split piece:** click each ghost and give it a destination (up to two each). Ghosts you don't move are ruled out.
- Before you confirm, the panel shows what the move will collapse. **Backspace** takes back a step, **Esc** clears, and holding **Preview** shows the resulting board.
- A see-through piece is a ghost: it might not really be there. A dashed line joins the ghosts of one piece. Nothing is random, so there are no odds to show; a ghost stays until a move proves where the piece is. Hover (or tap) a ghost to see what else would be true if it's the real one. A small **?** badge means the piece is that kind (say, a promoted queen) in only some worlds. The move log notes what each move collapsed.

Notation: checkers uses the standard 1–32 square numbers (`B10 10-14 | 10-15` means piece B10 split to squares 14 and 15; `x` marks a jump). Chess names pieces by their starting square (`♘g1 g1-f3 | g1-h3`; `h5xh6` is a declared capture; `e7-e8=Q` a promotion). Reversi lists squares (`d3 | f5`). `&` separates the moves of different ghosts.

## Code layout

| Path | What it is |
| --- | --- |
| `index.html`, `style.css`, `app.js` | The page and UI: game picker, board, move planning, timelines, networking glue. No build step. |
| `pieces/` | Chess piece images (see Credits). |
| `help.js` | The illustrated How to play guide, one deck per game (diagrams are small specs at the top). |
| `ai-worker.js` | Runs the computer opponent in the background so the page stays responsive. |
| `shared/quantum.js` | The quantum engine: worlds, quantum moves, collapse, timelines. Game-agnostic. |
| `shared/games/checkers.js`, `chess.js`, `reversi.js` | Classical rules for each game, behind one small interface (documented at the top of `quantum.js`). |
| `shared/ai.js` | Computer opponent: alpha-beta search over quantum moves, scoring each game's expected evaluation across worlds. |
| `shared/room.js` | Online room logic (seats, turns, resign, draws, rematch). Runs in the host's browser. |
| `server.js` | Tiny local dev server. Not used on GitHub Pages. |
| `test/` | Engine, per-game rules (including chess perft), room and AI tests, plus a fuzz test per game that checks every surviving world is a legal classical game. |

## Credits

The chess pieces in `pieces/` are the standard set drawn by Colin M.L. Burnett ("cburnett"), as used by Wikipedia and Lichess, available under the GPLv2+, BSD and GFDL licenses. The fonts (Bagel Fat One and DM Sans, both under the SIL Open Font License) load from Google Fonts; without a connection the page falls back to system fonts.

Adding a game means writing one module in `shared/games/` (classical move generation, apply, terminal status, formatting) and a slide deck in `help.js`; the engine, UI, AI and networking are shared.
