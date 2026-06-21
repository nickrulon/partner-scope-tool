# Quit Goosin Around! — Programmer's Game Design Doc

This document restates the flavorful rules of *Quit Goosin Around!* as
deterministic, implementable logic for a multiplayer digital game. It is the
spec the code in `goose-game/` implements.

> The narrative voice ("ya goose", "coop d'état", etc.) is flavor. Everything
> below is the machine-readable truth.

---

## 1. Objective

First player to reach **21 total goose points** wins and becomes **The Great
Honkeror**. Points come from regular Goose cards held in hand plus Wild Goose
cards held in hand.

---

## 2. The two decks

There are exactly two draw piles. Cards are referenced by a `kind` key.

### 2.1 Goose deck (regular) — RESHUFFLES

| kind      | name    | points | count |
|-----------|---------|:------:|:-----:|
| `GOOSE`   | Goose   | 1      | 30    |
| `GEESE`   | Geese   | 2      | 18    |
| `GEESES`  | Geeses  | 4      | 10    |
| `BIG_BOY` | Big Boy | 0      | 10    |

Total: **68 cards.** When the Goose draw pile is empty, shuffle the Goose
discard pile to form a new draw pile. (Big Boy cards live in the Goose deck and
return to the Goose discard after they resolve.)

### 2.2 Wild Goose deck — ONE-TIME USE, NEVER RESHUFFLES

| kind             | name            | points | count | notes                         |
|------------------|-----------------|:------:|:-----:|-------------------------------|
| `UNGOOSABLE`     | Ungoosable Goose| 1      | 15    | pure defensive points; no action |
| `GOOSE_GANG`     | Goose Gang      | 1      | 3     | blocks Big Boy or Get Goosed  |
| `GET_GOOSED`     | Get Goosed      | 1      | 3     | divert a drawn Big Boy        |
| `LAWN_MOWER`     | Lawn Mower      | 1      | 1     | unblockable forced discard    |
| `GREAT_HONKEROR` | Great Honkeror  | 2      | 1     | champion bonus (see §7)       |

Total in deck: **22 cards** (the Great Honkeror is **set aside**, not shuffled
in — see §7). Once a Wild card is played, it goes to the Wild discard and is
**never reshuffled.** When the Wild deck is empty, no more Wilds exist.

**Critical rule:** Players never draw Wild cards on a normal turn. The **only**
way a Wild card enters a hand is the Wild Goose Market trade (§4.2).

---

## 3. Player state

```
player = {
  id, name,
  regular: [card...],   // GOOSE / GEESE / GEESES held
  wild:    [card...],   // Wild cards held (incl. Great Honkeror if champion)
  announcedBoutaGoose: bool,
  connected: bool
}
```

`score(player) = sum(regular points) + sum(wild points)`

Big Boy is never *held*; it resolves the instant it is drawn (§5.2).

---

## 4. Turn structure

A turn **begins and ends when the active player draws a Goose card.**
Before that draw, the active player is in the **PRE_DRAW** phase and may take
any number of free actions in any order:

### 4.1 Free actions during PRE_DRAW
- **Announce "I'm bouta goose!"** — allowed once `score >= 17`. Sets
  `announcedBoutaGoose = true`. Required to be allowed to win (§6).
- **Trade in the Wild Goose Market** (§4.2).
- **Play Lawn Mower** (§5.4).

### 4.2 Wild Goose Market (TRADE)
Spend regular Goose cards worth **exactly 4 points** (any combination, e.g.
4×GOOSE, or 2×GEESE, or 1×GEESES, or 1×GEESE+2×GOOSE) → draw the top Wild card.
- Spent cards go to the **Goose discard**.
- Requires the Wild deck to be non-empty.
- Net score effect: −4 regular, +1 wild (or +2 if Great Honkeror) — trading is
  an investment that *lowers* your immediate score for utility/defense.
- May be repeated while cards/Wilds remain.

### 4.3 Ending the turn
The active player **DRAWS** a Goose card. This always ends their turn (after any
Big Boy resolution completes), then play passes clockwise to the next connected
player.

---

## 5. Card resolution

### 5.1 Drawing GOOSE / GEESE / GEESES
Add to `regular` hand. Check win (§6). Turn ends.

### 5.2 Drawing BIG_BOY
The active player enters a **BIG_BOY response** and must choose one:
- **Absorb** — discard *all* regular Goose cards (Wilds are unaffected).
- **Goose Gang** — play a Goose Gang from hand to block; regular hand is safe.
- **Get Goosed** — only the player who drew the Big Boy may do this. Play a Get
  Goosed to divert Big Boy onto a chosen target (§5.3).

The Big Boy card returns to the Goose discard after resolution. Turn then ends.

### 5.3 GET_GOOSED chain
When Big Boy is diverted onto a target, that target enters a **GET_GOOSED
response** and chooses one:
- **Absorb** — discard all their regular Goose cards.
- **Goose Gang** — block; their hand is safe.
- **Get Goosed** — divert onto a *different* target (chain continues).

The chain resolves when someone absorbs or blocks. Played Get Goosed / Goose
Gang cards go to the Wild discard. After resolution, the turn ends and play
passes from the **original drawer**.

### 5.4 LAWN_MOWER
Playable by the active player during PRE_DRAW. Choose a target; that target
discards their **entire regular hand**. **Cannot be blocked.** The Lawn Mower
card goes to the Wild discard. This is a free action — the active player still
must DRAW to end their turn.

### 5.5 UNGOOSABLE / GREAT_HONKEROR
No action. They simply sit in hand as points.

---

## 6. Winning

After any score increase (normally a Goose draw), if `score >= 21`:
- If the **"bouta goose" house rule** is enabled (default ON) and the player
  never announced at 17+, they are penalized: they **lose their entire regular
  hand** instead of winning (the geese got caught), and play continues.
- Otherwise the player wins and becomes The Great Honkeror.

> Pre-mature announcement (announcing below 17) is simply disallowed by the UI;
> no penalty, per the rules ("lol learn to count").

---

## 7. The Great Honkeror (champion carry-over)

The `GREAT_HONKEROR` card is **set aside** at the start of the very first game
(never shuffled into the Wild deck). The winner of a game keeps it and **starts
the next game holding it** — worth +2 points immediately. Implemented as
`options.honkerorHolderId`: when a new game/round starts, that player begins
with the Great Honkeror card in their `wild` hand.

---

## 8. Turn / phase state machine

```
            ┌─────────────────────────────────────────────┐
            │                  PRE_DRAW                     │
            │  (active player)                              │
            │  • ANNOUNCE_GOOSE (if score>=17)              │
            │  • TRADE (Wild Goose Market)                  │
            │  • PLAY_LAWN_MOWER(target)                    │
            │  • DRAW  ───────────────────┐                 │
            └─────────────────────────────┼─────────────────┘
                                          │
                              draw a Goose card
                                          │
                 ┌────────────────────────┴───────────────────────┐
                 │                                                 │
        GOOSE/GEESE/GEESES                                      BIG_BOY
                 │                                                 │
          add to hand                                  AWAIT_BIG_BOY (drawer)
          check win                                      • absorb
                 │                                        • goose_gang
            end turn                                      • get_goosed(target)
                 │                                                 │
            next player                              (get_goosed) → AWAIT_GET_GOOSED (target)
                                                          • absorb
                                                          • goose_gang
                                                          • get_goosed(other) ↺ chain
                                                                  │
                                                            resolve → end turn → next player
```

While a response phase (`AWAIT_BIG_BOY` / `AWAIT_GET_GOOSED`) is active, only the
player who owes the response may act; everyone else waits.

---

## 9. Server actions (the wire protocol verbs)

Authoritative server validates every action against current phase/turn.

| action            | who          | phase            | payload          |
|-------------------|--------------|------------------|------------------|
| `START_GAME`      | host         | lobby            | options          |
| `ANNOUNCE_GOOSE`  | active       | PRE_DRAW         | —                |
| `TRADE`           | active       | PRE_DRAW         | `cardIds[]` (=4pts) |
| `PLAY_LAWN_MOWER` | active       | PRE_DRAW         | `targetId`       |
| `DRAW`            | active       | PRE_DRAW         | —                |
| `RESPOND`         | pending tgt  | AWAIT_*          | `response`, `targetId?` |

`response ∈ { absorb, goose_gang, get_goosed }`.

---

## 10. Determinism / fairness notes for implementers

- The deck is the single source of randomness; inject an RNG for reproducible
  tests (`createGame(playerIds, { rng })`).
- Each client receives a **redacted** view: full detail of its own hand, only
  *counts* and *scores* for opponents (so hands stay hidden).
- The "silliest goose goes first" social ritual is reduced to a random/host
  pick of the starting seat.
- "Stuff you gotta say" (HONK, "QUIT GOOSIN AROUND", lawn-mower noises) becomes
  flavor toasts/log entries, not a gameplay gate.
