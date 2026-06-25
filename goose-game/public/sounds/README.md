# Drop your sound files here 🔊

The game plays a sound for each event by loading `sounds/<name>.<ext>`.
Supported extensions (first one found wins): **mp3, ogg, wav, m4a**.

| Filename (any ext) | Plays when… |
|--------------------|-------------|
| `click`      | a button is pressed |
| `drawgoose`  | you draw a **Goose** (1 pt) — plays only for you |
| `drawgeese`  | you draw a **Geese** (2 pts) — plays only for you |
| `drawgeeses` | you draw a **Geeses** (4 pts) — plays only for you |
| `honk`       | someone honks in chat |
| `bigboy`    | **Big Boy** is drawn (the big shared event) |
| `lawnmower` | Lawn Mower is played |
| `getgoosed` | Get Goosed is played |
| `goosegang` | Goose Gang blocks |
| `turn`      | the turn passes to the next player |
| `announce`  | a player announces "I'm bouta goose!" |
| `trade`     | a Wild Goose Market trade happens |
| `goosed`    | a player loses their hand (Big Boy / penalty) |
| `win`       | someone wins |
| `lose`      | you lose (the winner was someone else) |

Examples: `sounds/bigboy.mp3`, `sounds/honk.wav`.

- Files are **optional** — anything missing is simply silent, so the game runs
  fine with no audio at all.
- Keep them short (a second or two) and reasonably small.
- A mute button and volume slider live in the game's **Sounds** panel; settings
  are remembered in the browser.
- No restart needed — add a file and refresh.
