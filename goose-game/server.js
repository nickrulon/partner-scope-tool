// Standalone multiplayer server for Quit Goosin Around!
// HTTP serves the static client; WebSocket carries room + game traffic.
// Runs independently of the partner-scope-tool server. Default port 3030.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { createGame, applyAction, redact, makeRng, score, collectNames, skipTurn, removePlayer } from './engine.js';
import { CARD_META, ANNOUNCE_AT } from './cards.js';
import { touchAccount, grantEntitlement, getEntitlements, hasEntitlement, PRODUCTS } from './store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, 'public');
// Cloud hosts (Render/Railway/Fly/etc.) inject PORT; fall back for local dev.
const PORT = process.env.PORT || process.env.GOOSE_PORT || 3030;

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.json': 'application/json',
  // audio (drop-in sound files)
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.wav': 'audio/wav',
};
// Case-insensitive lookup so uppercase asset names (GOOSE.PNG, .M4A) serve with
// the right type on case-sensitive hosts like Render's Linux, not octet-stream.
const mimeFor = (fp) => MIME[path.extname(fp).toLowerCase()] || 'application/octet-stream';

// --- Static file server --------------------------------------------------

const httpServer = http.createServer((req, res) => {
  // Dev/test entitlement grant — enabled ONLY when GOOSE_DEV_SECRET is set
  // (never in production). Lets us test host-gating before StoreKit exists.
  if (req.method === 'POST' && req.url.startsWith('/dev/grant')) {
    const params = new URL(req.url, 'http://x').searchParams;
    if (!process.env.GOOSE_DEV_SECRET || params.get('secret') !== process.env.GOOSE_DEV_SECRET) {
      res.writeHead(403); return res.end('nope');
    }
    const ok = grantEntitlement(params.get('account'), params.get('product') || 'host_pass', { platform: 'dev' });
    res.writeHead(ok ? 200 : 400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ granted: ok }));
  }
  if (req.url === '/healthz') { res.writeHead(200); return res.end('honk'); }

  // Gumroad Ping: fires on every sale of the Host Pass. Always answer 200
  // (Gumroad retries otherwise); the license verify guards against fakes.
  if (req.method === 'POST' && req.url.startsWith('/gumroad/ping')) {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 100_000) req.destroy(); });
    req.on('end', async () => {
      res.writeHead(200); res.end('ok');
      try {
        const p = new URLSearchParams(body);
        const key = p.get('license_key');
        const accountId = p.get('url_params[accountId]') || p.get('accountId');
        if (!key || !accountId || !/^a_[a-z0-9]{6,32}$/i.test(accountId)) return;
        const v = await verifyGumroadLicense(key);
        if (!v.ok) return;
        if (grantEntitlement(accountId, 'host_pass', { platform: 'web', txnId: `gum_${v.saleId}` })) {
          pushAccount(accountId);   // the buyer's open tab unlocks on the spot
        }
      } catch { /* malformed ping — verified sales can still redeem by key */ }
    });
    return;
  }

  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.normalize(path.join(PUBLIC, urlPath));
  // Prefix must include the separator, or a sibling dir like `public-x`
  // would pass the check.
  if (!filePath.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end('nope'); }

  fs.readFile(filePath, (e, data) => {
    if (e) { res.writeHead(404); return res.end('Not found'); }
    // Never let the browser serve a stale copy — so edited/resized art and
    // updated client code always show on refresh.
    res.writeHead(200, {
      'Content-Type': mimeFor(filePath),
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    });
    res.end(data);
  });
});

// --- Rooms ---------------------------------------------------------------

const rooms = new Map(); // code -> room

function makeCode() {
  let code;
  do {
    code = Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('');
  } while (rooms.has(code));
  return code;
}

function getRoom(code) { return rooms.get((code || '').toUpperCase()); }

function broadcast(room) {
  if (room.game) armGraceTimer(room);   // re-check "waiting on an away goose?" on every state change
  for (const m of room.members.values()) {
    if (m.isBot || !m.ws || m.ws.readyState !== m.ws.OPEN) continue; // bots have no socket
    send(m.ws, 'state', roomView(room, m.playerId));
  }
  // Spectators see the same public projection: redact() with their (non-player)
  // id hides every hand, score, private draw, and private fx automatically.
  for (const s of (room.spectators || new Map()).values()) {
    if (!s.ws || s.ws.readyState !== s.ws.OPEN) continue;
    send(s.ws, 'state', roomView(room, s.id, true));
  }
}

const isConnected = (m) => m.isBot || (m.ws && m.ws.readyState === m.ws.OPEN);

function roomView(room, viewerId, asSpectator = false) {
  return {
    code: room.code,
    hostId: room.hostId,
    started: !!room.game,
    solo: !!room.solo,
    spectator: asSpectator,
    spectatorCount: (room.spectators || new Map()).size,
    // Who's watching, by name — rendered as the "birdwatchers" strip. Kept
    // separate from members so watchers never read as seats.
    spectators: [...(room.spectators || new Map()).values()].map((s) => ({ id: s.id, name: s.name })),
    boutaGooseRule: room.boutaGooseRule !== false,
    // Named geese carried from a previous game, and whether we'll keep them.
    carryNamesAvailable: !!(room.carryNames && room.carryNames.length),
    keepNames: room.keepNames !== false,
    // Pre-game "silliest goose" vote: who voted for whom, and the result.
    votes: Object.fromEntries(room.votes || []),
    decided: room.decided || null,
    members: [...room.members.values()].map((m) => ({
      id: m.playerId, name: m.name, connected: isConnected(m), isBot: !!m.isBot,
    })),
    // Shared table graffiti: crayon strokes anchored to UI zones, visible to
    // everyone (spectators included).
    pond: room.pond || [],
    // viewerId is the spectator's own (non-player) id, so nothing private leaks.
    game: room.game ? redact(room.game, viewerId) : null,
  };
}

// --- Pond graffiti ---------------------------------------------------------
// Doodles on the table itself (not on cards): strokes anchored to a UI zone
// ('play', 'topbar', 'decks', 'myhand', or 'player:<id>') with coords
// normalized 0..1000 to that zone's box, so every client renders them onto
// the same UI element regardless of screen size or layout. Room-level (not
// game state) so the graffiti survives rematches; the host can wipe it.
// 'waitcard' = the big paper card in the waiting room — doodling starts
// before the game does.
const POND_ZONES = new Set(['play', 'topbar', 'decks', 'myhand', 'waitcard']);
const POND_MAX_STROKES = 250;      // oldest graffiti fades away
const POND_MAX_POINTS = 1200;      // per stroke

function pondSanitize(room, stroke) {
  const s = stroke || {};
  const zone = String(s.z || '');
  const zoneOk = POND_ZONES.has(zone)
    || (zone.startsWith('player:') && !!room.game && room.game.players.some((p) => `player:${p.id}` === zone));
  if (!zoneOk || !Array.isArray(s.p)) return null;
  const c = Math.min(7, Math.max(0, s.c | 0));   // 8-color palette (incl. white)
  const w = Math.min(2, Math.max(0, s.w | 0));
  const p = [];
  for (let i = 0; i + 1 < s.p.length && p.length / 2 < POND_MAX_POINTS; i += 2) {
    const x = Math.round(+s.p[i]), y = Math.round(+s.p[i + 1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    p.push(Math.min(1000, Math.max(0, x)), Math.min(1000, Math.max(0, y)));
  }
  if (p.length < 4) return null;
  return { z: zone, c, w, p };
}

// Relay a lightweight live-drawing event to everyone EXCEPT the artist —
// no room state involved, so mid-stroke streaming stays cheap.
function pondRelay(room, exceptPid, payload) {
  for (const m of room.members.values()) {
    if (m.isBot || m.playerId === exceptPid) continue;
    send(m.ws, 'pondlive', payload);
  }
  for (const s of room.spectators.values()) send(s.ws, 'pondlive', payload);
}

function doPond(ws, { op, stroke, ids }) {
  const room = getRoom(ws.meta.roomCode);
  if (!room || ws.meta.isSpectator) return;   // players only (waiting room OR in-game)
  const pid = ws.meta.playerId;
  if (!room.members.has(pid)) return;
  room.pond = room.pond || [];
  if (op === 'live') {
    // In-progress stroke preview: relay only, never stored. An invalid/empty
    // stroke means "preview over" (e.g. the artist bailed on a tiny stroke).
    const live = pondSanitize(room, stroke);
    pondRelay(room, pid, live ? { by: pid, stroke: live } : { by: pid, done: true });
    return;   // no broadcast — this is the whole point
  }
  if (op === 'clear') {
    if (pid !== room.hostId) return send(ws, 'error', { message: 'Only the host can hose down the pond.' });
    room.pond = [];
  } else if (op === 'undo') {
    // Remove the caller's own most recent mark only.
    for (let i = room.pond.length - 1; i >= 0; i--) {
      if (room.pond[i].by === pid) { room.pond.splice(i, 1); break; }
    }
  } else if (op === 'erase') {
    // The eraser rubs out whole strokes by id — anyone can erase anything
    // (same social contract as doodling over it).
    if (!Array.isArray(ids)) return;
    const kill = new Set(ids.slice(0, 64).map((n) => n | 0));
    room.pond = room.pond.filter((s) => !kill.has(s.i));
  } else if (op === 'stroke') {
    const clean = pondSanitize(room, stroke);
    if (!clean) return;
    room.pondSeq = (room.pondSeq || 0) + 1;
    room.pond.push({ i: room.pondSeq, ...clean, by: pid });
    if (room.pond.length > POND_MAX_STROKES) room.pond.shift();
    pondRelay(room, pid, { by: pid, done: true });   // drop everyone's preview of this stroke
  } else return;
  broadcast(room);
}

function send(ws, type, payload) {
  if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type, payload }));
}

// --- WebSocket protocol --------------------------------------------------

// maxPayload: the biggest legit message is a max-size doodle (~12KB of stroke
// JSON) — cap frames well below the 100MB ws default so one hostile client
// can't balloon memory.
const wss = new WebSocketServer({ server: httpServer, maxPayload: 32 * 1024 });

wss.on('connection', (ws) => {
  ws.meta = { roomCode: null, playerId: null };
  send(ws, 'cardMeta', CARD_META);

  ws.on('message', (raw) => {
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    const { type, payload } = msg || {};
    try { handle(ws, type, payload || {}); }
    catch (e) { send(ws, 'error', { message: e.message }); }
  });

  ws.on('close', () => {
    const room = getRoom(ws.meta.roomCode);
    if (!room) return;
    if (ws.meta.isSpectator) {
      room.spectators.delete(ws.meta.playerId);
      scheduleReap(room);
      broadcast(room);
      return;
    }
    const m = room.members.get(ws.meta.playerId);
    if (m && m.ws === ws) {
      if (room.game) {
        // Mid-game: keep the seat (they can reconnect), just mark it away.
        const gp = room.game.players.find((p) => p.id === m.playerId);
        if (gp) gp.connected = false;
      } else {
        // Lobby: drop them entirely — a ghost member would linger in the vote
        // list forever and get seated as a zombie when the game starts.
        room.members.delete(m.playerId);
        dropVotesFor(room, m.playerId);
        handOffHost(room, m.playerId);
      }
    }
    scheduleReap(room);
    if (!room.game) afterVoteChange(room); else broadcast(room);
  });
});

// Delete every vote cast BY this goose and every vote cast FOR them — a stale
// vote for a departed candidate would otherwise still count toward unanimity.
function dropVotesFor(room, playerId) {
  room.votes.delete(playerId);
  for (const [voter, cand] of [...room.votes]) if (cand === playerId) room.votes.delete(voter);
}

// If the departing goose was the host, promote the first connected human.
function handOffHost(room, leavingId) {
  if (leavingId !== room.hostId) return;
  const next = [...room.members.values()].find((m) => !m.isBot && m.ws && m.ws.readyState === m.ws.OPEN);
  if (next) room.hostId = next.playerId;
}

// Rooms live in memory only — reap any room that's had no connected humans
// (players or spectators) for 10 minutes, so codes and memory free up.
const REAP_MS = Number(process.env.GOOSE_REAP_MS) || 10 * 60 * 1000;   // env override for tests
function roomHasHumans(room) {
  return [...room.members.values()].some((m) => !m.isBot && m.ws && m.ws.readyState === m.ws.OPEN)
    || [...room.spectators.values()].some((s) => s.ws && s.ws.readyState === s.ws.OPEN);
}
function scheduleReap(room) {
  clearTimeout(room.reapTimer);
  if (roomHasHumans(room)) return;
  room.reapTimer = setTimeout(() => {
    if (roomHasHumans(room)) return;
    clearTimeout(room.botTimer);
    clearTimeout(room.graceTimer);
    rooms.delete(room.code);
  }, REAP_MS);
}

// Whose input is the game waiting on right now?
function actorNeeded(g) {
  if (!g || g.phase === 'GAME_OVER') return null;
  return (g.phase === 'AWAIT_BIG_BOY' || g.phase === 'AWAIT_GET_GOOSED' || g.phase === 'AWAIT_ANNOUNCE')
    ? g.pending?.target
    : g.players[g.turnIndex]?.id;
}

// If the game is waiting on a disconnected human, auto-skip them after a grace
// window so one dropped wifi connection doesn't stall the whole pond.
const GRACE_MS = Number(process.env.GOOSE_GRACE_MS) || 60 * 1000;      // env override for tests
function armGraceTimer(room) {
  clearTimeout(room.graceTimer);
  const actorId = actorNeeded(room.game);
  if (!actorId) return;
  const m = room.members.get(actorId);
  if (!m || m.isBot || isConnected(m)) return;
  room.graceTimer = setTimeout(() => {
    if (actorNeeded(room.game) !== actorId) return;      // game moved on
    const m2 = room.members.get(actorId);
    if (m2 && isConnected(m2)) return;                    // they came back
    room.game = skipTurn(room.game, { auto: true });
    broadcast(room);
    maybeRunBot(room);
  }, GRACE_MS);
}

function handle(ws, type, payload) {
  switch (type) {
    case 'hello':     return doHello(ws, payload);
    case 'create':    return doCreate(ws, payload);
    case 'join':      return doJoin(ws, payload);
    case 'spectate':  return doSpectate(ws, payload);
    case 'start':     return doStart(ws, payload);
    case 'vote':      return doVote(ws, payload);
    case 'addbot':    return doAddBot(ws, payload);
    case 'removebot': return doRemoveBot(ws, payload);
    case 'config':    return doConfig(ws, payload);
    case 'setkeepnames': return doSetKeepNames(ws, payload);
    case 'action':    return doAction(ws, payload);
    case 'skip':      return doSkip(ws, payload);
    case 'kick':      return doKick(ws, payload);
    case 'leave':     return doLeave(ws, payload);
    case 'nudge':     return doNudge(ws, payload);
    case 'pond':      return doPond(ws, payload);
    case 'redeem':    return doRedeem(ws, payload);
    case 'rematch':   return doRematch(ws, payload);
    case 'chat':      return doChat(ws, payload);
    default: send(ws, 'error', { message: `unknown message ${type}` });
  }
}

function joinRoom(ws, room, playerId, name) {
  // Preserve account identity (hello) — replacing meta wholesale wiped it.
  ws.meta = { ...ws.meta, roomCode: room.code, playerId, isSpectator: false };
  room.members.set(playerId, { playerId, name, ws });
  scheduleReap(room);   // a human is here — cancel any pending reap
  if (room.game) {
    const gp = room.game.players.find((p) => p.id === playerId);
    if (gp) { gp.connected = true; gp.name = name; }
  }
  send(ws, 'joined', { code: room.code, playerId, hostId: room.hostId });
  // Membership changed → always recompute unanimity. (Previously a goose
  // joining AFTER the vote was unanimous left `decided` set, so the Start
  // button looked live but doStart re-checked the vote and failed.)
  if (!room.game) afterVoteChange(room);
  else { broadcast(room); maybeRunBot(room); }
}

// Honk-pun names — used for computer geese AND for any human who joins without
// typing a name (so nobody is just "Goose"). Picks the first one not in use.
const GOOSE_NAMES = [
  'Goosille Ball', 'Honkleberry', 'Featherbottom', 'Lord Wingsworth',
  'Gooseifer', 'Beaky McBeakface', 'Old Man Honk', 'Captain Waddles', 'Quackary',
  'Sir Hiss-a-lot', 'Gandalf the Grey Goose', 'Duchess Featherton', 'Honk Williams Jr.',
  'Duck Norris', 'Nibbles',
];
function pickGooseName(room) {
  const used = new Set([...room.members.values()].map((m) => m.name));
  return GOOSE_NAMES.find((n) => !used.has(n)) || `Goose ${room.members.size + 1}`;
}
const cleanName = (name, room) => (name && name.trim() ? name.trim().slice(0, 20) : pickGooseName(room));

// Two geese with the same name breaks name-based reconnects (and the table's
// sanity) — de-dupe by appending a number: "Bob", "Bob 2", "Bob 3"…
function uniqueName(room, name, pid) {
  const taken = (n) => [...room.members.values()].some(
    (m) => m.playerId !== pid && m.name.toLowerCase() === n.toLowerCase(),
  );
  if (!taken(name)) return name;
  const base = name.slice(0, 17);
  for (let i = 2; ; i++) {
    const candidate = `${base} ${i}`;
    if (!taken(candidate)) return candidate;
  }
}

// --- Accounts & entitlements ----------------------------------------------
// Anonymous device accounts: the client generates a stable opaque id and
// introduces itself with `hello`. Purchases (Host Pass, future packs) attach
// to that account. Platform matters: 'ios' clients are host-gated behind the
// Host Pass; 'web' stays free (the website is the free demo/growth channel).

function doHello(ws, { accountId, platform }) {
  const id = (typeof accountId === 'string' && /^a_[a-z0-9]{6,32}$/i.test(accountId))
    ? accountId : `a_${Math.random().toString(36).slice(2, 12)}`;
  const plat = platform === 'ios' ? 'ios' : 'web';
  touchAccount(id, plat);
  ws.meta.accountId = id;
  ws.meta.platform = plat;
  send(ws, 'account', { accountId: id, platform: plat, entitlements: getEntitlements(id) });
}

// --- Gumroad (web Host Pass checkout) --------------------------------------
// Gumroad is the merchant of record (their liability shield was the point).
// Two grant paths, both replay-safe:
//   1. Ping webhook: the upgrade sheet opens the Gumroad product URL with
//      ?accountId=… ; Gumroad POSTs the sale to /gumroad/ping with that id in
//      url_params → verify the license → grant → push the account live.
//   2. Redeem: the buyer pastes the license key from their receipt (restore
//      path for new browsers/devices) → verify (uses-capped) → grant.
// Web gating stays OFF until GOOSE_GATE_WEB=1 — flipping it is the launch.
const GATE_WEB = process.env.GOOSE_GATE_WEB === '1';
const GUMROAD_PRODUCT_ID = process.env.GOOSE_GUMROAD_PRODUCT_ID || '';
const GUMROAD_URL = process.env.GOOSE_GUMROAD_URL || '';
const GUMROAD_TEST_KEY = process.env.GOOSE_GUMROAD_TEST_KEY || '';   // tests/dev only
const REDEEM_USE_CAP = 5;   // one key restores on up to 5 browsers/devices

// Friend codes: passwords that grant the Host Pass directly, skipping Gumroad
// entirely — the friends & family door. Comma-separated in GOOSE_FRIEND_CODE
// (e.g. "GOOSEGANG" or "GOOSEGANG,POKERNIGHT"), case-insensitive. Friends
// type one into the redeem box, or just open ?friend=CODE which redeems
// automatically. Rotate or kill codes by editing the env var. Grants are
// recorded with a friend_ txn prefix so they're distinguishable from sales
// in the entitlements table.
const FRIEND_CODES = new Set(
  (process.env.GOOSE_FRIEND_CODE || '')
    .split(',').map((c) => c.trim().toUpperCase()).filter(Boolean),
);

// One verify attempt against Gumroad, identifying the product by a given
// param name. Returns { data } on a completed HTTP call, or { netErr } if the
// request itself failed.
async function gumroadVerifyOnce(paramName, key, increment) {
  try {
    const resp = await fetch('https://api.gumroad.com/v2/licenses/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        [paramName]: GUMROAD_PRODUCT_ID,
        license_key: key,
        increment_uses_count: increment ? 'true' : 'false',
      }),
    });
    return { data: await resp.json() };
  } catch {
    return { netErr: true };
  }
}

// GUMROAD_PRODUCT_ID must hold the real long product_id (e.g.
// "-gfCeE8Olnzl-rCvx2mrFQ=="), NOT the permalink — Gumroad deprecated
// permalink verification (product_permalink now hard-errors). We still try
// product_permalink as a legacy fallback in case Gumroad ever re-enables it;
// only the SUCCEEDING call increments the use count. See GUMROAD_SETUP.md for
// how to find the product_id.
async function verifyGumroadLicense(key, { increment = false } = {}) {
  if (GUMROAD_TEST_KEY && key === GUMROAD_TEST_KEY) return { ok: true, saleId: 'test_sale' };
  if (!GUMROAD_PRODUCT_ID) return { ok: false, why: 'purchases not configured yet' };
  let netFailed = false;
  for (const paramName of ['product_id', 'product_permalink']) {
    const { data, netErr } = await gumroadVerifyOnce(paramName, key, increment);
    if (netErr) { netFailed = true; continue; }
    if (!data || !data.success) continue;   // wrong param name or bad key — try the next form
    const p = data.purchase || {};
    if (p.refunded || p.chargebacked || p.disputed) return { ok: false, why: 'that purchase was refunded' };
    if (increment && (p.uses || 0) > REDEEM_USE_CAP) return { ok: false, why: 'key already used on too many devices' };
    return { ok: true, saleId: p.sale_id || p.id || key };
  }
  return netFailed
    ? { ok: false, why: 'could not reach Gumroad — try again in a minute' }
    : { ok: false, why: 'key not recognized' };
}

// Live-unlock: after a grant, any connected socket on that account learns
// about it immediately (the upgrade sheet closes itself mid-session).
function pushAccount(accountId) {
  for (const client of wss.clients) {
    if (client.meta?.accountId === accountId && client.readyState === client.OPEN) {
      send(client, 'account', { accountId, platform: client.meta.platform, entitlements: getEntitlements(accountId) });
    }
  }
}

async function doRedeem(ws, { key }) {
  const k = String(key || '').trim();
  if (!k) return send(ws, 'error', { message: 'Paste yer license key first (it\'s in your Gumroad receipt).' });
  if (!ws.meta.accountId) return send(ws, 'error', { message: 'Connection hiccup — refresh and try again.' });
  // Friend code? Grant directly — no Gumroad involved.
  if (FRIEND_CODES.has(k.toUpperCase())) {
    grantEntitlement(ws.meta.accountId, 'host_pass', {
      platform: 'web',
      txnId: `friend_${k.toUpperCase()}_${ws.meta.accountId}`.slice(0, 190),
    });
    return pushAccount(ws.meta.accountId);
  }
  const v = await verifyGumroadLicense(k, { increment: true });
  if (!v.ok) return send(ws, 'error', { message: `That key didn't fly: ${v.why}.` });
  grantEntitlement(ws.meta.accountId, 'host_pass', { platform: 'web', txnId: `gumkey_${k}_${ws.meta.accountId}`.slice(0, 190) });
  pushAccount(ws.meta.accountId);
}

const needsHostPass = (ws) => (ws.meta.platform === 'ios' || GATE_WEB)
  && !hasEntitlement(ws.meta.accountId, 'host_pass');

function doCreate(ws, { name, playerId, solo }) {
  // "Host owns the room": on iOS, creating a MULTIPLAYER room requires the
  // Host Pass. Solo ponds (you + computer geese) are free for everyone —
  // that's the try-before-you-buy experience.
  if (!solo && needsHostPass(ws)) {
    // buyUrl carries the buyer's account id so the Gumroad Ping can grant
    // the pass to the right goose automatically.
    const buyUrl = GUMROAD_URL
      ? `${GUMROAD_URL}${GUMROAD_URL.includes('?') ? '&' : '?'}accountId=${encodeURIComponent(ws.meta.accountId || '')}&wanted=true`
      : null;
    return send(ws, 'error', {
      code: 'NEED_HOST_PASS',
      buyUrl,
      message: 'Hosting yer own pond takes a Host Pass. You can still join any pond with a code, or play the computer for free.',
    });
  }
  const code = makeCode();
  const pid = playerId || `p${Math.random().toString(36).slice(2, 9)}`;
  const room = {
    code, hostId: pid, members: new Map(), game: null, lastWinnerId: null,
    votes: new Map(), decided: null, boutaGooseRule: true,
    botTimer: null, startTimer: null, spectators: new Map(),
    solo: !!solo,
  };
  rooms.set(code, room);
  joinRoom(ws, room, pid, cleanName(name, room));
  // Solo ponds come pre-stocked with a computer goose so the game is one
  // vote away from starting.
  if (room.solo) {
    const botId = `bot_${Math.random().toString(36).slice(2, 9)}`;
    room.members.set(botId, { playerId: botId, name: pickGooseName(room), ws: null, isBot: true });
    afterVoteChange(room);
  }
}

function doJoin(ws, { code, name, playerId }) {
  const room = getRoom(code);
  if (!room) return send(ws, 'error', { message: 'No room with that code.' });
  const pid = playerId || `p${Math.random().toString(36).slice(2, 9)}`;
  const existing = room.members.get(pid);
  // Solo ponds are one human + computers — only that human may (re)join.
  if (room.solo && !existing && !(room.game && room.game.players.some((p) => p.id === pid))) {
    return send(ws, 'error', { message: "That's a solo pond — the goose in it is playin' the computer." });
  }
  const knownById = !!existing || (room.game && room.game.players.some((p) => p.id === pid));
  if (room.game && !knownById) {
    // Reconnecting from a new device / cleared storage: reclaim your seat by
    // matching the exact name you were playing under — but ONLY if that seat
    // is disconnected. Otherwise anyone with the room code + a player's name
    // could hijack a live seat and see their hand.
    const want = (name || '').trim().toLowerCase();
    const seat = want && room.game.players.find((p) => !p.removed && p.name.toLowerCase() === want);
    if (seat && seat.connected) {
      return send(ws, 'error', { message: `"${seat.name}" is still connected — that seat isn't up for grabs.` });
    }
    if (seat) {
      ws.meta = { ...ws.meta, roomCode: room.code, playerId: seat.id, isSpectator: false };   // adopt the existing seat id, keep account identity
      room.members.set(seat.id, { playerId: seat.id, name: seat.name, ws });
      scheduleReap(room);
      seat.connected = true;
      send(ws, 'joined', { code: room.code, playerId: seat.id, hostId: room.hostId });
      broadcast(room);
      maybeRunBot(room);
      return;
    }
    return send(ws, 'error', { message: 'Game in progress — rejoin with the exact name you used, or wait for a rematch.' });
  }
  // The 8-goose cap applies to NEW joins only (rejoining members always fit).
  if (!knownById && room.members.size >= 8) {
    return send(ws, 'error', { message: 'The pond is full (8 geese max).' });
  }
  const wanted = (name && name.trim()) ? name.trim().slice(0, 20) : (existing?.name || pickGooseName(room));
  joinRoom(ws, room, pid, uniqueName(room, wanted, pid));
}

// --- Silliest-goose vote ------------------------------------------------
// The game can't start until everyone unanimously clicks the same goose.
// That goose goes first; turns then follow join order, wrapping around.

// Spectators watch a room without ever becoming a player or a seat. They get
// the same public projection as everyone else (redacted with their own
// non-player id), can watch a game already in progress, and never vote/act.
function doSpectate(ws, { code, name, playerId }) {
  const room = getRoom(code);
  if (!room) return send(ws, 'error', { message: 'No room with that code to watch.' });
  const sid = (typeof playerId === 'string' && playerId.startsWith('s_'))
    ? playerId : `s_${Math.random().toString(36).slice(2, 9)}`;
  ws.meta = { ...ws.meta, roomCode: room.code, playerId: sid, isSpectator: true };   // keep account identity
  // De-dupe watcher names ("Spectator", "Spectator 2", …) so the birdwatchers
  // strip stays readable.
  const base = ((name || '').trim() || 'Spectator').slice(0, 20);
  const used = new Set([...room.spectators.values()].filter((s) => s.id !== sid).map((s) => s.name.toLowerCase()));
  let specName = base;
  for (let i = 2; used.has(specName.toLowerCase()); i++) specName = `${base.slice(0, 17)} ${i}`;
  room.spectators.set(sid, { id: sid, name: specName, ws });
  scheduleReap(room);   // a human is watching — cancel any pending reap
  send(ws, 'joined', { code: room.code, playerId: sid, hostId: room.hostId, spectator: true });
  send(ws, 'state', roomView(room, sid, true));
  broadcast(room); // let players see the spectator count tick up
}

function doConfig(ws, payload) {
  const room = getRoom(ws.meta.roomCode);
  if (!room || room.game) return;
  if (ws.meta.playerId !== room.hostId) return;
  room.boutaGooseRule = payload.boutaGooseRule !== false;
  broadcast(room);
}

// Host chooses whether the next game keeps last game's named geese or starts
// with a fresh, unnamed deck.
function doSetKeepNames(ws, payload) {
  const room = getRoom(ws.meta.roomCode);
  if (!room || room.game) return;
  if (ws.meta.playerId !== room.hostId) return;
  room.keepNames = payload.keep !== false;
  broadcast(room);
}

function doVote(ws, { candidateId }) {
  const room = getRoom(ws.meta.roomCode);
  if (!room || room.game || ws.meta.isSpectator) return;   // spectators watch only; you can still change your vote
  if (!room.members.has(candidateId)) return;
  room.votes.set(ws.meta.playerId, candidateId);
  afterVoteChange(room);
}

function doAddBot(ws) {
  const room = getRoom(ws.meta.roomCode);
  if (!room || room.game) return;
  if (ws.meta.playerId !== room.hostId) return send(ws, 'error', { message: 'Only the host can add computers.' });
  if (room.members.size >= 8) return send(ws, 'error', { message: 'The pond is full (8 geese max).' });
  const name = pickGooseName(room);
  const pid = `bot_${Math.random().toString(36).slice(2, 9)}`;
  room.members.set(pid, { playerId: pid, name, ws: null, isBot: true });
  afterVoteChange(room);
}
function doRemoveBot(ws, { botId }) {
  const room = getRoom(ws.meta.roomCode);
  if (!room || room.game) return;
  if (ws.meta.playerId !== room.hostId) return;
  const m = room.members.get(botId);
  if (!m || !m.isBot) return;
  room.members.delete(botId);
  dropVotesFor(room, botId);
  afterVoteChange(room);
}

// Bots follow the humans' emerging consensus so unanimity is reachable
// exactly when the people agree.
function botsVote(room) {
  const humans = [...room.members.values()].filter((m) => !m.isBot && isConnected(m));
  const tally = new Map();
  for (const h of humans) { const v = room.votes.get(h.playerId); if (v) tally.set(v, (tally.get(v) || 0) + 1); }
  if (tally.size === 0) { // no human has voted yet → bots abstain
    for (const m of room.members.values()) if (m.isBot) room.votes.delete(m.playerId);
    return;
  }
  const order = [...room.members.keys()];
  let leader = null, best = -1;
  for (const [cand, n] of tally) {
    if (n > best || (n === best && order.indexOf(cand) < order.indexOf(leader))) { best = n; leader = cand; }
  }
  for (const m of room.members.values()) if (m.isBot) room.votes.set(m.playerId, leader);
}

// Returns the unanimous candidate id, or null if not everyone agrees yet.
function voteResult(room) {
  const eligible = [...room.members.values()].filter(isConnected);
  if (eligible.length < 2) return null;
  let cand = null;
  for (const m of eligible) {
    const v = room.votes.get(m.playerId);
    if (!v) return null;
    if (cand === null) cand = v;
    else if (v !== cand) return null;
  }
  return cand;
}

function afterVoteChange(room) {
  if (room.game) return;
  botsVote(room);
  const cand = voteResult(room);
  // `decided` just means "the vote is unanimous" — it enables the host's Start
  // button. It clears again if someone changes their vote and breaks the tie.
  room.decided = cand ? { id: cand, name: room.members.get(cand)?.name || 'someone' } : null;
  broadcast(room);
}

// Host pressed Start — only allowed once the silliest-goose vote is unanimous.
function doStart(ws) {
  const room = getRoom(ws.meta.roomCode);
  if (!room || room.game) return;
  if (ws.meta.playerId !== room.hostId) return send(ws, 'error', { message: 'Only the host can start.' });
  if ([...room.members.values()].filter(isConnected).length < 2) {
    return send(ws, 'error', { message: 'Need at least 2 geese to goose.' });
  }
  const winner = voteResult(room);
  if (!winner) return send(ws, 'error', { message: 'Everyone has to agree on the silliest goose first.' });
  room.decided = { id: winner, name: room.members.get(winner)?.name || 'someone' };
  startGameFromVote(room);
}

function startGameFromVote(room) {
  if (room.game || !room.decided) return;
  const memberArr = [...room.members.values()];
  if (memberArr.length < 2) { room.decided = null; broadcast(room); return; }
  const players = memberArr.map((m) => ({ id: m.playerId, name: m.name }));
  const firstSeat = memberArr.findIndex((m) => m.playerId === room.decided.id);
  room.game = createGame(players, {
    boutaGooseRule: room.boutaGooseRule !== false,
    honkerorHolderId: room.lastWinnerId || null,
    firstSeat: firstSeat >= 0 ? firstSeat : 0,
    // Carry named geese only if the host kept them (works even when players
    // were added/removed between games).
    carryNames: (room.keepNames !== false) ? (room.carryNames || null) : null,
  });
  broadcast(room);
  maybeRunBot(room);
}

// --- Computer players (bots) --------------------------------------------
// After every state change, if it's a bot's move, schedule it on a short
// delay so humans can see the animation, then chain to the next move.

function maybeRunBot(room) {
  clearTimeout(room.botTimer);
  const g = room.game;
  if (!g || g.phase === 'GAME_OVER') return;
  const actorId = (g.phase === 'AWAIT_BIG_BOY' || g.phase === 'AWAIT_GET_GOOSED')
    ? g.pending?.target
    : g.players[g.turnIndex]?.id;
  const m = actorId && room.members.get(actorId);
  if (!m || !m.isBot) return;
  // Randomized "thinking" time (~2–4s): humans can follow the move, and no
  // fixed tell distinguishes a computer's quick decisions from its hard ones.
  room.botTimer = setTimeout(() => runBotMove(room, actorId), 2000 + Math.random() * 2000);
}

function runBotMove(room, actorId) {
  const g = room.game;
  if (!g || g.phase === 'GAME_OVER') return;
  const responding = g.phase === 'AWAIT_BIG_BOY' || g.phase === 'AWAIT_GET_GOOSED';
  const expected = (responding || g.phase === 'AWAIT_ANNOUNCE') ? g.pending?.target : g.players[g.turnIndex]?.id;
  if (expected !== actorId) return; // state moved on; bail
  let action;
  if (g.phase === 'AWAIT_ANNOUNCE') action = botAnnounce(g, actorId);
  else if (responding) action = botResponse(g, actorId);
  else action = botTurn(g, actorId);
  const { state } = applyAction(g, actorId, action);
  room.game = state;
  if (state.winnerId) { room.lastWinnerId = state.winnerId; room.carryNames = collectNames(state); }
  broadcast(room);
  maybeRunBot(room);
}

const pts = (kind) => CARD_META[kind]?.points ?? 0;
const botScore = (p) => [...p.regular, ...p.wild].reduce((s, c) => s + pts(c.kind), 0);

// Find a set of regular geese worth exactly 4 points (the Wild Market price):
// one 4, two 2s, a 2 + two 1s, or four 1s.
function findTradeCombo(p) {
  const byPts = (n) => p.regular.filter((c) => pts(c.kind) === n);
  const ones = byPts(1), twos = byPts(2), fours = byPts(4);
  if (fours.length >= 1) return [fours[0]];
  if (twos.length >= 2) return twos.slice(0, 2);
  if (twos.length >= 1 && ones.length >= 2) return [twos[0], ...ones.slice(0, 2)];
  if (ones.length >= 4) return ones.slice(0, 4);
  return null;
}

// Bots only act on PUBLIC info + their own hand (card counts, not opponents'
// scores or hands) so they play by the same rules of knowledge as a human.
function botTurn(g, botId) {
  const p = g.players.find((x) => x.id === botId);
  // Mow down whoever has the biggest gaggle, if it's worth it.
  if (p.wild.some((w) => w.kind === 'LAWN_MOWER')) {
    const victim = g.players
      .filter((x) => x.id !== botId && !x.removed && x.connected)
      .sort((a, b) => b.regular.length - a.regular.length)[0];
    if (victim && victim.regular.length >= 3) return { type: 'PLAY_LAWN_MOWER', targetId: victim.id };
  }
  // Sometimes hit the Wild Goose Market: spend an exact-4 set for a Wild when
  // holding none — insurance (Ungoosable/Goose Gang) against a Big Boy wipe.
  // Trading doesn't end the turn, so the draw still follows.
  if (g.wildDraw.length > 0 && p.wild.length === 0 && botScore(p) >= 8 && Math.random() < 0.4) {
    const combo = findTradeCombo(p);
    if (combo) return { type: 'TRADE', cardIds: combo.map((c) => c.id) };
  }
  return { type: 'DRAW' };
}

// Post-draw announce decision. Staying quiet is a bluff, but at 18+ any draw
// can bust an unannounced hand at 21 — so bots always call it when close.
function botAnnounce(g, botId) {
  const p = g.players.find((x) => x.id === botId);
  const announce = botScore(p) >= 18 || Math.random() < 0.5;
  return { type: 'ANNOUNCE_DECISION', announce };
}

function botResponse(g, botId) {
  const t = g.players.find((x) => x.id === botId);
  if (t.wild.some((w) => w.kind === 'GOOSE_GANG')) return { type: 'RESPOND', response: 'goose_gang' };
  // Hot potato: whoever Big Boy is after (drawer OR diverted victim) may send
  // him on with their own Get Goosed. Aim at the biggest gaggle still in play.
  if (t.wild.some((w) => w.kind === 'GET_GOOSED') && t.regular.length > 0) {
    const victim = g.players
      .filter((x) => x.id !== botId && !x.removed && x.connected)
      .sort((a, b) => b.regular.length - a.regular.length)[0];
    if (victim) return { type: 'RESPOND', response: 'get_goosed', targetId: victim.id };
  }
  return { type: 'RESPOND', response: 'absorb' };
}

function doRematch(ws, payload) {
  const room = getRoom(ws.meta.roomCode);
  if (!room) return;
  if (ws.meta.playerId !== room.hostId) return send(ws, 'error', { message: 'Only the host can rematch.' });
  if (room.game && room.game.winnerId) room.lastWinnerId = room.game.winnerId;
  clearTimeout(room.botTimer);
  clearTimeout(room.startTimer);
  clearTimeout(room.graceTimer);
  room.game = null;
  room.decided = null;
  room.keepNames = true;    // default each round to keeping last game's names (host can opt out)
  room.votes = new Map();   // re-vote on the silliest goose for the next round
  broadcast(room);
}

function doAction(ws, { action }) {
  const room = getRoom(ws.meta.roomCode);
  if (!room || !room.game) return;
  const { state, error } = applyAction(room.game, ws.meta.playerId, action);
  room.game = state;
  if (error) return send(ws, 'error', { message: error });
  if (state.winnerId) { room.lastWinnerId = state.winnerId; room.carryNames = collectNames(state); }
  broadcast(room);
  maybeRunBot(room);
}

// Host-only: skip the current turn / response, to keep play moving.
function doSkip(ws) {
  const room = getRoom(ws.meta.roomCode);
  if (!room || !room.game) return;
  if (ws.meta.playerId !== room.hostId) return send(ws, 'error', { message: 'Only the host can skip a turn.' });
  room.game = skipTurn(room.game);
  broadcast(room);
  maybeRunBot(room);
}

// Host-only: remove a player; their geese scatter back into the decks and play
// continues without them.
function doKick(ws, { targetId }) {
  const room = getRoom(ws.meta.roomCode);
  if (!room || !room.game) return;
  if (ws.meta.playerId !== room.hostId) return send(ws, 'error', { message: 'Only the host can remove a goose.' });
  if (targetId === room.hostId) return send(ws, 'error', { message: "You can't remove yourself, host." });
  room.game = removePlayer(room.game, targetId);
  if (room.game.winnerId) { room.lastWinnerId = room.game.winnerId; room.carryNames = collectNames(room.game); }
  broadcast(room);
  maybeRunBot(room);
}

// A player leaves voluntarily: scatter their geese back to the decks (like a
// kick), drop them from the room, hand off host if needed, and end the game if
// too few geese remain.
function doLeave(ws) {
  const room = getRoom(ws.meta.roomCode);
  if (!room) return;
  const pid = ws.meta.playerId;
  if (ws.meta.isSpectator) { room.spectators.delete(pid); ws.meta.roomCode = null; broadcast(room); return; }
  if (room.game && room.game.players.some((p) => p.id === pid && !p.removed)) {
    room.game = removePlayer(room.game, pid, { left: true });
  }
  room.members.delete(pid);
  dropVotesFor(room, pid);
  ws.meta.roomCode = null;
  handOffHost(room, pid);
  scheduleReap(room);
  if (!room.game) afterVoteChange(room); else broadcast(room);
}

// Lobby nudge: a public "honk" reminding everyone to vote / agree. Throttled
// per player so it can be playful without spamming the room.
// holler1 = the "Vote!" clip; holler = the one committed Holler-button sound.
const HOLLER_KINDS = new Set(['holler1', 'holler']);
function doNudge(ws, { kind }) {
  const room = getRoom(ws.meta.roomCode);
  if (!room || room.game) return;                 // lobby only
  if (!HOLLER_KINDS.has(kind)) return;
  const member = room.members.get(ws.meta.playerId) || room.spectators.get(ws.meta.playerId);
  if (!member) return;
  const now = Date.now();
  room.nudgeAt = room.nudgeAt || {};
  if (now - (room.nudgeAt[ws.meta.playerId] || 0) < 2000) return;  // 2s cooldown
  room.nudgeAt[ws.meta.playerId] = now;
  const text = kind === 'holler1' ? `${member.name} says: VOTE!` : `${member.name} hollered!`;
  const msg = { kind, text };
  for (const m of room.members.values()) send(m.ws, 'nudge', msg);
  for (const s of room.spectators.values()) send(s.ws, 'nudge', msg);
}

function doChat(ws, { text }) {
  const room = getRoom(ws.meta.roomCode);
  if (!room) return;
  const m = room.members.get(ws.meta.playerId) || room.spectators.get(ws.meta.playerId);
  if (!m || !text) return;
  const from = m.name + (room.spectators.has(ws.meta.playerId) ? ' (watching)' : '');
  const msg = { from, text: String(text).slice(0, 200) };
  for (const other of room.members.values()) send(other.ws, 'chat', msg); // send() ignores botless/closed sockets
  for (const s of room.spectators.values()) send(s.ws, 'chat', msg);
}

httpServer.listen(PORT, () => {
  console.log(`Quit Goosin Around! running at http://localhost:${PORT}`);
});
