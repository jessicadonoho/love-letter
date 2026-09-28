# Love Letter for phones

A small website for playing Love Letter (2019 rules, 2–6 players) with friends. Everyone plays on their own phone in the same room.

- **No server or account needed.** It's plain HTML/CSS/JS, so you can host it free on GitHub Pages.
- **Phones talk to each other directly** over WebRTC (PeerJS). The host's phone runs the game and only sends each player what they're allowed to see.
- **Minimal, text-first UI with an art slot.** Put images in `art/` (like `art/5.png` for the Viscount) and they show at the top of each card. The rule text always stays visible below the art. See `art/README.md`.

## Play

1. One person taps **Host a new room** and gets a 4-letter code.
2. Everyone else types the code and taps **Join**. The host can also tap **Share join link** and send it instead.
3. The host taps **Start**. On your turn, tap a card, choose a player (and a guess for the Maid), then tap **Use this card** at the bottom of the screen.
4. After each round, the host taps **Next round**.

This version renames four cards: **Maid** (1), **Assassin** (2), **Mercenary** (3), and **Viscount** (5). The Countess (8) must be played if you also hold a King, Viscount, or Princess.

If someone taps **Leave** during a game, they're out for the rest of that game and their turns are skipped. If a phone just loses its connection, the game waits for it to come back. The host can remove an offline player from the player list. If the host leaves, the room closes for everyone.

**Keep the host's screen on.** The game lives on the host's phone. The app asks the phone to stay awake, but if the host locks the phone or switches apps, the other phones will pause and reconnect once the host is back. If anyone refreshes the page, they rejoin automatically.

## Put it online (GitHub Pages, free)

1. Create a new public repo on GitHub, for example `love-letter`.
2. Upload every file in this folder (`index.html`, `style.css`, `js/`, etc.) to the repo.
   - Or, from a terminal: `git init && git add . && git commit -m "Love Letter" && git branch -M main && git remote add origin https://github.com/<you>/love-letter.git && git push -u origin main`
3. In the repo, open **Settings → Pages**. Under "Build and deployment," choose **Deploy from a branch**, then **main** and **/ (root)**, and save.
4. After a minute or so, the site is live at `https://<you>.github.io/love-letter/`. Everyone opens that link.

Netlify Drop, Cloudflare Pages, or any other static host works too. Just upload the folder.

## Run it on your computer (for development)

```bash
npm run dev          # serves the folder at http://localhost:8080
npm test             # rules-engine tests (Node 18+)
```

To test multiplayer on one computer, open several tabs with different `?as=` values so each tab acts as a different player:
`http://localhost:8080/?as=a`, `http://localhost:8080/?as=b`, …

## How it works

| File | What it does |
|---|---|
| `js/engine.js` | Pure rules engine: deck, turns, card effects, Spy bonus, round and game end, and per-player redacted views. It has no DOM code, so the tests run it in Node. |
| `js/net.js` | PeerJS wrappers. `Host` registers a peer ID from the room code; `Client` connects to it and retries if the connection drops. |
| `js/main.js` | App state, rendering, and tap handling. The host applies moves to the engine and sends each player their own view. |
| `js/ui.js` | Pure HTML builders: cards, the fixed "Use this card" bar, and card-effect popups. |
| `art/` | Optional card images, named by card number. |
| `style.css` | Mobile-first styles with automatic dark mode. |
| `tests/engine.test.js` | Unit tests for every card, players leaving, and effect events, plus random full games checked for rule and card-count errors. |
| `tests/ui.test.js` | Popup text, the "Use this card" bar, and a check that old card names are gone. |
| `tests/layout.test.js` | Measures real card layout in headless Chrome at phone and desktop widths (skipped if Chrome isn't installed). |

**Networking note:** PeerJS's free public "broker" server (0.peerjs.com) is used only to introduce the phones to each other. After that, game data goes phone to phone. On the same Wi-Fi this is very reliable. Some strict networks (campus or corporate Wi-Fi, or some cellular carriers) can block direct connections. If phones can't connect, try a phone hotspot. You can also self-host a broker (`npx peer --port 9000`) and add `?peer=yourhost:9000` to the URL.

**Hidden info:** Only the host's phone knows every hand. A player who knows how to use browser dev tools *on the host's phone* could peek, so let the host be someone you trust (or yourself).

## Ideas for next steps

- Fill in the `art/` folder, or reskin the theme by swapping the names and text in `CARDS` in `engine.js`
- Animations for hand trades
- Spectator mode, or a "table" view for a shared tablet
- Choose the tokens-to-win target in the lobby
- Classic 16-card mode (2–4 players)

*Love Letter is a game by Seiji Kanai, published by Z-Man Games. This is an unofficial fan project for personal play and is not affiliated with the publisher.*
