# Quit Goosin' Around! — iOS App Plan

> **STATUS UPDATE:** iOS phases are PAUSED (Apple budget deferred). The Host
> Pass launched on the WEB instead via Gumroad — see `GUMROAD_SETUP.md`. All
> infrastructure below is shared; the iOS plan resumes unchanged when the
> game has earned its $99.

The game ships to the Apple App Store as a **free app** with a **$2.99 one-time
Host Pass** in-app purchase, and expansion packs as future IAPs. The website
stays fully free (demo/growth channel) and is never mentioned inside the app.

## Product rules

| Capability | Free | Host Pass |
|---|---|---|
| Download, guest account | ✅ | ✅ |
| Play the computer (solo pond) | ✅ | ✅ |
| Join any pond by code / invite link | ✅ | ✅ |
| Play with content the host owns | ✅ | ✅ |
| Create multiplayer ponds | ❌ upgrade prompt | ✅ |
| Pick house rules for hosted ponds | ❌ | ✅ |
| Your expansion packs apply in your ponds | ❌ | ✅ |

"Host owns the room": entitlements are enforced **server-side** at room
creation. Web clients are exempt (platform: 'web'); only 'ios' clients gate.

## Architecture

- **Identity**: anonymous device accounts (`a_…` id generated on device,
  registered via ws `hello`). No sign-up. Purchases attach to the account;
  Apple's restore-purchases covers reinstalls. Sign in with Apple can layer on
  later for cross-device sync.
- **Store**: `store.js` — SQLite (better-sqlite3) at `GOOSE_DB` (persistent
  volume in prod). Tables: `accounts`, `entitlements` (txn_id UNIQUE blocks
  receipt replay). In-memory fallback when sqlite is unavailable.
- **Protocol**: `hello {accountId, platform}` → `account {accountId,
  entitlements}`. `create` without Host Pass on iOS → error `NEED_HOST_PASS` →
  client shows the upgrade sheet. `create {solo:true}` is free for everyone
  (bots-only pond, pre-stocked with one computer goose).
- **Purchases**: app shell installs `window.GoosePurchase`
  (`buyHostPass()`, `restore()`). StoreKit transaction JWS goes to the server's
  verify endpoint (Phase 3), which validates against Apple and calls
  `grantEntitlement`. Dev loop: `POST /dev/grant?secret=…&account=…&product=…`
  (enabled only when `GOOSE_DEV_SECRET` is set — never in prod).
- **Expansion packs** (Phase 4): entries in `store.js` `PRODUCTS` +
  `cards.js` pack catalogs; a hosted room's deck is composed from the host's
  owned packs at `createGame` time. Free joiners play with whatever the host
  brings.

## Phases

1. ✅ **Server foundation** — accounts, entitlement store, host gating, solo
   ponds, upgrade sheet, dev grant, tests (34 server asserts).
2. **App-mode client** — bundle client assets in the app, `window.GOOSE_SERVER`
   ws URL override, purchase adapter wiring, restore flow.
3. **Capacitor iOS project** — `ios/` platform, IAP plugin
   (cordova-plugin-purchase), `host_pass` product, server-side StoreKit
   transaction verification endpoint.
4. **Ship kit** — UGC report/mute (Apple Guideline 1.2 — chat + doodles count
   as UGC), expansion-pack plumbing, app icon/splash from Nick's art,
   App Store Connect submission checklist + review notes.

## Nick's checklist (start #1 NOW — it takes days)

1. **Enroll in the Apple Developer Program** ($99/yr):
   developer.apple.com/programs → enroll as an individual (fastest; no D-U-N-S
   needed). Use your normal Apple ID or a dedicated one.
2. After approval, **enroll in the App Store Small Business Program**
   (developer.apple.com/app-store/small-business-program) — cuts Apple's
   commission from 30% to 15% on your $2.99.
3. **Upgrade Render** when we're ready to submit: Starter instance (~$7/mo,
   no sleep) + 1GB persistent disk mounted at `/data`; set env
   `GOOSE_DB=/data/goose.db`. (Free tier is fine for all dev/testing.)
4. Install **Xcode** from the Mac App Store (large download — start early).
5. Have ready for the store listing: app name ("Quit Goosin' Around!"),
   subtitle, description, keywords, a 1024×1024 icon (your art), screenshots
   (I'll generate from the game), a support URL and privacy policy URL (a
   simple page works; I can write both).

## Costs

- Apple Developer: $99/yr
- Render always-on + disk: ~$7–8/mo
- Apple's cut: 15% of $2.99 ≈ $0.45/sale (with Small Business Program)
