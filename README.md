# Quantum Checkers

Checkers where a piece can make two moves at once and exist in superposition until the game forces it to collapse. You can play against the computer, two players on one device, or online with a friend through a link. It works on phones, tablets and desktops.

It's a static site, so there's no server to run or pay for.

## Putting it on GitHub Pages

1. Push this repo to GitHub.
2. In the repo, go to **Settings → Pages**. Under **Build and deployment**, choose **Deploy from a branch**, select **main** and **/ (root)**, then click **Save**.
3. After a minute the game is live at `https://<your-username>.github.io/<repo-name>/`.

## Playing

- **Vs computer:** pick a difficulty and your color, then click **Play the computer**. Easy makes mistakes, Medium looks a few moves ahead, and Hard thinks for up to about two seconds per move. The computer splits and collapses pieces too. Undo takes you back to your previous turn.
- **Same device:** click **Start local game**.
- **Online:** click **Create online game**, then **Copy invite link** and send it to a friend. Opening the link joins the game. Anyone who opens it after both seats are taken can watch.

How online play works: the creator's browser hosts the game, and the two browsers talk to each other directly (WebRTC, via [PeerJS](https://peerjs.com/)). PeerJS's free public service only introduces the browsers to each other. What this means in practice:

- **The host needs to keep their tab open.** If they close or refresh it, the game pauses. Reopening the invite link in the same browser restores the game, and the other player reconnects automatically.
- **Both players check every move.** The host rejects illegal moves from the guest, and the guest replays the host's move list with the same rules engine.
- **Some networks may not connect.** A few very strict networks (some workplace or school Wi-Fi) can block browser-to-browser connections. PeerJS falls back to a relay server, which fixes most cases.
- **Test it yourself** by opening the invite link in a second tab. Each tab gets its own seat.

## Running locally

```sh
npm start   # http://localhost:3000  (any static file server works too)
npm test    # rules engine, room and AI tests
```

Requires Node 18+. There are no dependencies to install.

## Rules

Checkers on an 8×8 board. Black moves first. Men move diagonally forward, and a man that reaches the far row becomes a king (which ends its move). **Jumping is optional**, and a multi-jump can stop after any hop.

**The game state is a set of possible worlds.** Each world is an ordinary checkers position.

- **Split:** a piece makes two different moves at once. Every world is copied: in one copy it went one way, in the other copy it went the other way. A piece can be in at most 4 places, and the game holds at most 512 worlds.
- **Collapse:** every move must be a legal, ordinary checkers move in each world it applies to. Worlds where it isn't are deleted. So:
  - **Jumping a ghost** proves it was really there. It's captured, and its other ghosts vanish.
  - **Moving onto a ghost's square** proves the piece wasn't there.
  - **Moving a superposed piece:** you give each ghost its own move (and can split a ghost again). Any ghost you don't move is ruled out, since in every world the piece you moved has to have actually moved.
- **Winning:** you lose when you have no legal move in any world. The game is a draw after 40 moves each of non-capturing king moves in every world, or by agreement in online games.

**The guarantee:** every surviving world is a normal game of checkers where each turn one piece made one legal move. The **Timelines** button lets you step through any of them. When the game ends, it shows the game that really happened.

## Controls

- Click a piece, then a destination. **Click the destination again** (or press **Enter**) to play the move.
- **Split:** click a second destination before confirming, then click either destination again.
- **Multi-jump:** click each landing square in turn, then click the last one again.
- **Moving a split piece:** click each ghost and give it a destination (up to two each). Ghosts you don't move are ruled out.
- Before you confirm, the panel shows what the move will collapse. **Backspace** takes back a step, **Esc** clears, and holding **Preview** shows the resulting board.
- Hover (or tap) a ghost to highlight its other ghosts and see what else would be true if it's the real one. Translucent pieces with a dashed outline are in superposition, and the tag shows the share of worlds they're in. A **♛?** crown means the piece is a king in only some worlds. The move log notes what each move collapsed.

Notation uses the standard 1–32 square numbers. `B10 10-14 | 10-15` means piece B10 split to squares 14 and 15. `&` separates moves of different ghosts, and `x` marks a jump.

## Code layout

| Path | What it is |
| --- | --- |
| `index.html`, `style.css`, `app.js` | The game page and UI. No build step. |
| `help.js` | The illustrated How to play guide (board diagrams are defined as small specs at the top). |
| `ai-worker.js` | Runs the computer opponent in the background so the page stays responsive. |
| `shared/rules.js` | Rules engine: worlds, classical move generation, quantum moves, collapse. |
| `shared/ai.js` | Computer opponent: alpha-beta search over quantum moves, scoring expected material across worlds. |
| `shared/room.js` | Online room logic (seats, turns, resign, draws, rematch). Runs in the host's browser. |
| `server.js` | Tiny local dev server. Not used on GitHub Pages. |
| `test/` | Engine, room and AI tests, including a fuzz test that checks every surviving world is a legal classical game. |
