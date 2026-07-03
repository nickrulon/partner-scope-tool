# Launching the $2.99 Host Pass (Gumroad)

Everything is built and shipped, sitting behind env flags. The website stays
100% free until you finish this checklist and flip the switch. Total time:
~20 minutes.

## 1. Create the Gumroad account + product

1. Sign up at <https://gumroad.com> (free). Complete payout setup (bank or
   PayPal) under Settings → Payments.
2. **New product** → type "Digital product":
   - Name: `Quit Goosin' Around! — Host Pass`
   - Price: `$2.99`
   - URL slug: something short, e.g. `goosehostpass` — your product URL becomes
     `https://YOURNAME.gumroad.com/l/goosehostpass`
   - Description (feel free to riff): *One-time purchase. Host your own
     multiplayer ponds at quitgoosinaround.com, invite friends with a code or
     link, and pick the house rules. Joining ponds and playing the computer
     are free forever.*
   - Content/file: Gumroad wants a deliverable — upload a small "receipt" PDF
     or text file that says thanks + explains the license key unlocks hosting
     (I can generate this for you).
3. In the product's settings, **enable "Generate a unique license key per
   sale"** — this is required; keys are how restores work.
4. Find the **Product ID** (shown in the product's settings near the license
   key option — a long id string). Copy it.

## 2. Wire the Ping webhook

Gumroad Settings → Advanced → **Ping** → set the Ping URL to:

```
https://www.quitgoosinaround.com/gumroad/ping
```

This makes purchases unlock the pass automatically in the buyer's open tab.
(If a ping ever misses, the buyer just pastes their license key — the game's
upgrade sheet has a redeem box.)

## 2.5 Free copies for friends & family (offer codes)

Gumroad → your product → Checkout/Discounts → create an offer code at
**100% off** (optionally capped at N uses). A $0 "purchase" still generates a
real license key and still fires the Ping — the game treats it exactly like a
sale. Share the auto-applying link:

```
https://YOURNAME.gumroad.com/l/goosehostpass/YOURCODE
```

Every freebie is tracked in your Gumroad dashboard; kill the code anytime.

## 2.6 The friends & family door (friend codes — no Gumroad at all)

Set `GOOSE_FRIEND_CODE` on Render to a password (or several,
comma-separated): `GOOSEGANG` or `GOOSEGANG,POKERNIGHT`. Then either:

- Friends type the code into the "License key or friend code" box on the
  Host Pass sheet, **or**
- You text them the magic link — it unlocks hosting automatically on arrival,
  zero typing:

```
https://quitgoosinaround.com/?friend=GOOSEGANG
```

Codes are case-insensitive. Rotate or kill one anytime by editing the env
var (a leaked code can't be un-granted from people who already used it, but
it stops working for new people immediately). Friend grants are stored with
a `friend_` transaction prefix, so they're distinguishable from real sales.

## 3. Flip the switch on Render

**⚠ Do this at the same time: upgrade the Render instance.** The free tier's
disk is wiped on every deploy/restart — fine while nothing is for sale, fatal
once purchases exist (the server would forget who bought and buyers would
have to re-redeem keys). Upgrade to Starter (~$7/mo), add a 1GB persistent
disk mounted at `/data`, and set `GOOSE_DB=/data/goose.db`. Gumroad's records
always remain the permanent backup, but the disk makes deploys a non-event.

Render dashboard → your service → Environment → add:

| Key | Value |
|---|---|
| `GOOSE_GATE_WEB` | `1` |
| `GOOSE_GUMROAD_PRODUCT_ID` | the real long **product_id** (e.g. `-gfCeE8Olnzl-rCvx2mrFQ==`). **NOT** the permalink — Gumroad deprecated permalink verification. See "Finding the product_id" below. |
| `GOOSE_GUMROAD_URL` | your full product URL, e.g. `https://nickster612.gumroad.com/l/kgbop` |

### Finding the product_id

Gumroad hides it in the UI, but the license-verify API reveals it. Run (with
any real license key from a test purchase):

```
curl -s -X POST https://api.gumroad.com/v2/licenses/verify \
  --data-urlencode "product_permalink=YOUR_PERMALINK" \
  --data-urlencode "license_key=A-KEY-FROM-A-SALE"
```

It fails on purpose, but the error message says *"Please set 'product_id' to
'XXXX==' "* — that `XXXX==` is your product_id. (Or verify with a real key and
read `purchase.product_id` from the JSON.)

Save → the service redeploys → hosting is now gated. To un-launch at any
time, delete `GOOSE_GATE_WEB` and everything is free again. Nothing else
changes.

**Do NOT set** `GOOSE_GUMROAD_TEST_KEY` in production — it's a test-only
backdoor key (used by the automated tests and the local `goose-game-gated`
preview config).

## 4. Test with a real purchase

Gumroad test purchases: open your product page while logged into your own
Gumroad account and use the test-purchase option, or just buy it for real
($2.99 to yourself — Gumroad's fee on one sale is the cheapest QA you'll ever
buy). Confirm:

1. In the game, "Create a Pond" shows the Host Pass sheet.
2. Buying via the sheet's button unlocks it live ("HOST PASS ACTIVE" toast).
3. In a fresh incognito window, pasting the license key in the redeem box
   unlocks hosting there too (this is the restore path; a key works on up to
   5 browsers/devices).

## What stays free (enforced server-side)

- Joining any pond by code or invite link
- Playing the computer (solo ponds)
- Spectating
- Everything on iOS… someday (paused until the Apple budget)

## How the money flows

Gumroad is the **merchant of record**: they charge the buyer, handle sales
tax/VAT and chargebacks, and pay you out weekly. On each $2.99 sale you keep
roughly $2.10 after their 10% + processing.
