# Deploying Quit Goosin' Around! online

This is a **real-time multiplayer** game: a persistent Node + WebSocket server
(`goose-game/server.js`) holds the rooms/turns/decks in memory and also serves
the browser client. That means it needs a host that runs an **always-on Node
process** — **not** a static host.

- ✅ Works: **Render** (free), Railway, Fly.io, any Node VPS.
- ❌ Won't work: Netlify / GitHub Pages / Vercel static (no persistent
  WebSocket server).

One service hosts everything (client + server on the same port), so there's no
separate frontend/backend to wire up.

---

## Before you deploy: get your assets into the repo

The cloud builds from GitHub. Your card art and sounds currently live only on
your Mac, so push them (and any local code changes) first:

```bash
cd ~/partner-scope-tool
git add -A
git commit -m "Add card art, sounds, and latest game updates"
git push origin claude/quit-goosin-around-game-ivjp3n
```

> If `git push` complains that the branch has diverged, run
> `git pull --no-rebase origin claude/quit-goosin-around-game-ivjp3n` first,
> resolve anything it flags, then push again.

Verify on GitHub that `goose-game/public/cards/` shows your `.png` files (not
just the README).

---

## Deploy on Render (recommended, free)

1. Go to <https://render.com> and sign up (you can use "Sign in with GitHub").
2. Click **New +** → **Blueprint**.
3. Connect your GitHub and pick the **`partner-scope-tool`** repo.
4. When asked which branch, choose the branch that has your art
   (`claude/quit-goosin-around-game-ivjp3n`, unless you merged to `main`).
5. Render reads `render.yaml` and proposes the **quit-goosin-around** web
   service. Click **Apply** / **Create**.
6. Wait for the build (a couple minutes). When it's live you'll get a URL like
   `https://quit-goosin-around.onrender.com`.

Open that URL on your laptop and your phone — Create a Pond on one, share the
4-letter code, Join on the other. It's a public link, so friends anywhere can
play.

### Notes
- **Free tier sleeps** after ~15 min idle; the first visit after that takes
  ~30–60s to wake up. Fine for casual games. Upgrade the plan to keep it warm.
- **One instance** keeps all rooms in memory — perfect for friends. Don't scale
  to multiple instances or rooms would split across them.
- HTTPS is automatic, so the client uses secure `wss://` WebSockets with no
  changes.

## Alternative: Railway
Railway also supports WebSockets. Create a project from the repo and set the
service's **start command** to `npm run game` (the repo's root `npm start` runs
a different app). Railway injects `PORT`, which the server already reads.
