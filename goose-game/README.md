# 🪿 Quit Goosin Around! — the computer game

A real-time, multiplayer digital version of the card game. Self-contained and
independent of the partner-scope-tool that shares this repo.

## Run it

```bash
npm install        # once, to pull in `ws`
npm run game       # starts the game server on http://localhost:3030
```

Open http://localhost:3030 in a browser. To play with friends:
- One person clicks **Create a Pond** → taps **Copy Invite Link** (or just shares the 4-letter code).
- Others open the link (code pre-filled) and **Join**.
- Host picks options and clicks **Start Goosin'**. (2–8 players.)

Each browser tab is one player. Test it solo by opening several tabs.

```bash
npm run game:test  # rules-engine suite + server integration suite (rooms, votes, reconnects)
```

Change the port with `GOOSE_PORT=4000 npm run game`.

## Add your art

Drop PNGs into [`public/cards/`](public/cards/README.md) named after each card
(`GOOSE.png`, `BIG_BOY.png`, …). They appear instantly on refresh. Until then,
cards render as labeled colored placeholders, so the game is fully playable now.

## How it's built

| File | Role |
|------|------|
| `cards.js` | Data-driven card catalog: counts, points, colors. Single place to rebalance. |
| `engine.js` | **Pure** rules engine — `createGame` / `applyAction` / `redact`. No I/O. |
| `engine.test.js` | Rules-engine suite: decks, Big Boy chains, trading, win rules, edge cases. |
| `server.js` | HTTP static host + WebSocket rooms; the authoritative game host. |
| `server.test.js` | Integration suite: real ws clients through join/vote/start, reconnects, seat reclaims, auto-skip, room reaping. |
| `public/` | Browser client (vanilla JS, no build step). Renders state, never computes rules. |

The full rules-as-logic spec lives in
[`../GOOSE_GAME_DESIGN.md`](../GOOSE_GAME_DESIGN.md).

## Architecture in one breath

The **server owns the truth.** Clients send *actions* (`DRAW`, `TRADE`,
`RESPOND`, …); the engine validates them against the current phase/turn and
returns new state; the server broadcasts a **redacted** view to each player
(you see your hand; opponents show only counts + score). Randomness lives only
in the deck shuffle and is injectable for deterministic tests.
