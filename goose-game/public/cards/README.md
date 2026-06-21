# Drop your card art here 🎨

The game looks for an image named after each card's `kind` key:

```
goose-game/public/cards/GOOSE.png
goose-game/public/cards/GEESE.png
goose-game/public/cards/GEESES.png
goose-game/public/cards/BIG_BOY.png
goose-game/public/cards/UNGOOSABLE.png
goose-game/public/cards/GOOSE_GANG.png
goose-game/public/cards/GET_GOOSED.png
goose-game/public/cards/LAWN_MOWER.png
goose-game/public/cards/GREAT_HONKEROR.png
```

- Recommended size: **portrait, ~3:4 ratio** (e.g. 600×800 px). They're rendered
  into 84×116 slots and scaled with `background-size: cover`.
- The filename must match the `kind` exactly (uppercase, with underscores).
- No restart or code change needed for art to appear — refresh the browser.
- Until a file exists, the card shows a colored placeholder with an emoji, the
  name, and its point value, so the game is fully playable without art.

The card list, names, points, and colors all live in `goose-game/cards.js` —
edit there if you rename or rebalance cards.
