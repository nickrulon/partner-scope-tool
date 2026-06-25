// Standalone multiplayer server for Quit Goosin Around!
// HTTP serves the static client; WebSocket carries room + game traffic.
// Runs independently of the partner-scope-tool server. Default port 3030.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { createGame, applyAction, redact, makeRng, score } from './engine.js';
import { CARD_META, ANNOUNCE_AT } from './cards.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, 'public');
<<<<<<< HEAD
// Cloud hosts (Render/Railway/Fly/etc.) inject PORT; fall back for local dev.
const PORT = process.env.PORT || process.env.GOOSE_PORT || 3030;
=======
const PORT = process.env.GOOSE_PORT || process.env.PORT || 3030;
>>>>>>> e483106 (Name your geese, 3s draw reveal, center trade, turn anim, rematch fix)

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.json': 'application/json',
};

// --- Static file server --------------------------------------------------

const httpServer = http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.normalize(path.join(PUBLIC, urlPath));
  if (!filePath.startsWith(PUBLIC)) { res.writeHead(403); return res.end('nope'); }

  fs.readFile(filePath, (e, data) => {
    if (e) { res.writeHead(404); return res.end('Not found'); }
    // Never let the browser serve a stale copy — so edited/resized art and
    // updated client code always show on refresh.
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream',
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
  for (const m of room.members.values()) {
    if (m.isBot || !m.ws || m.ws.readyState !== m.ws.OPEN) continue; // bots have no socket
    send(m.ws, 'state', roomView(room, m.playerId));
  }
}

const isConnected = (m) => m.isBot || (m.ws && m.ws.readyState === m.ws.OPEN);

function roomView(room, viewerId) {
  return {
    code: room.code,
    hostId: room.hostId,
    started: !!room.game,
    boutaGooseRule: room.boutaGooseRule !== false,
    // Pre-game "silliest goose" vote: who voted for whom, and the result.
    votes: Object.fromEntries(room.votes || []),
    decided: room.decided || null,
    members: [...room.members.values()].map((m) => ({
      id: m.playerId, name: m.name, connected: isConnected(m), isBot: !!m.isBot,
    })),
    game: room.game ? redact(room.game, viewerId) : null,
  };
}

function send(ws, type, payload) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type, payload }));
}

// --- WebSocket protocol --------------------------------------------------

const wss = new WebSocketServer({ server: httpServer });

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
    const m = room.members.get(ws.meta.playerId);
    if (m && m.ws === ws) {
      if (room.game) {
        const gp = room.game.players.find((p) => p.id === m.playerId);
        if (gp) gp.connected = false;
      }
    }
    if (!room.game && !room.decided) afterVoteChange(room); else broadcast(room);
  });
});

function handle(ws, type, payload) {
  switch (type) {
    case 'create':    return doCreate(ws, payload);
    case 'join':      return doJoin(ws, payload);
    case 'start':     return doStart(ws, payload);
    case 'vote':      return doVote(ws, payload);
    case 'addbot':    return doAddBot(ws, payload);
    case 'removebot': return doRemoveBot(ws, payload);
    case 'config':    return doConfig(ws, payload);
    case 'action':    return doAction(ws, payload);
    case 'rematch':   return doRematch(ws, payload);
    case 'chat':      return doChat(ws, payload);
    default: send(ws, 'error', { message: `unknown message ${type}` });
  }
}

function joinRoom(ws, room, playerId, name) {
  ws.meta = { roomCode: room.code, playerId };
  room.members.set(playerId, { playerId, name, ws });
  if (room.game) {
    const gp = room.game.players.find((p) => p.id === playerId);
    if (gp) { gp.connected = true; gp.name = name; }
  }
  send(ws, 'joined', { code: room.code, playerId, hostId: room.hostId });
  if (!room.game && !room.decided) afterVoteChange(room); // recompute vote with the new goose
  else { broadcast(room); if (room.game) maybeRunBot(room); }
}

function doCreate(ws, { name, playerId }) {
  const code = makeCode();
  const pid = playerId || `p${Math.random().toString(36).slice(2, 9)}`;
  const room = {
    code, hostId: pid, members: new Map(), game: null, lastWinnerId: null,
    votes: new Map(), decided: null, boutaGooseRule: true,
    botTimer: null, startTimer: null,
  };
  rooms.set(code, room);
  joinRoom(ws, room, pid, (name || 'Goose').slice(0, 20));
}

function doJoin(ws, { code, name, playerId }) {
  const room = getRoom(code);
  if (!room) return send(ws, 'error', { message: 'No room with that code.' });
  const pid = playerId || `p${Math.random().toString(36).slice(2, 9)}`;
  const existing = room.members.get(pid);
  if (room.game && !existing && !room.game.players.find((p) => p.id === pid)) {
    return send(ws, 'error', { message: 'Game already started — ask for a rematch to join.' });
  }
  joinRoom(ws, room, pid, (name || existing?.name || 'Goose').slice(0, 20));
}

// --- Silliest-goose vote ------------------------------------------------
// The game can't start until everyone unanimously clicks the same goose.
// That goose goes first; turns then follow join order, wrapping around.

function doConfig(ws, payload) {
  const room = getRoom(ws.meta.roomCode);
  if (!room || room.game) return;
  if (ws.meta.playerId !== room.hostId) return;
  room.boutaGooseRule = payload.boutaGooseRule !== false;
  broadcast(room);
}

function doVote(ws, { candidateId }) {
  const room = getRoom(ws.meta.roomCode);
  if (!room || room.game) return;                          // you can still change your vote
  if (!room.members.has(candidateId)) return;
  room.votes.set(ws.meta.playerId, candidateId);
  afterVoteChange(room);
}

const BOT_NAMES = [
  'Sir Quacks-a-lot', 'Honkleberry', 'Featherbottom', 'Lord Wingsworth',
  'Gooseifer', 'Beaky McBeakface', 'Old Man Honk', 'Captain Waddles',
  'Sir Hiss-a-lot', 'Gandalf the Grey Goose', 'Duchess Featherton', 'Nibbles',
];
function doAddBot(ws) {
  const room = getRoom(ws.meta.roomCode);
  if (!room || room.game) return;
  if (ws.meta.playerId !== room.hostId) return send(ws, 'error', { message: 'Only the host can add computers.' });
  if (room.members.size >= 8) return send(ws, 'error', { message: 'The pond is full (8 geese max).' });
  const used = new Set([...room.members.values()].map((m) => m.name));
  const name = BOT_NAMES.find((n) => !used.has(n)) || `Goose-Bot ${room.members.size}`;
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
  room.votes.delete(botId);
  for (const [voter, cand] of [...room.votes]) if (cand === botId) room.votes.delete(voter);
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
  room.botTimer = setTimeout(() => runBotMove(room, actorId), 1200);
}

function runBotMove(room, actorId) {
  const g = room.game;
  if (!g || g.phase === 'GAME_OVER') return;
  const responding = g.phase === 'AWAIT_BIG_BOY' || g.phase === 'AWAIT_GET_GOOSED';
  const expected = responding ? g.pending?.target : g.players[g.turnIndex]?.id;
  if (expected !== actorId) return; // state moved on; bail
  const action = responding ? botResponse(g, actorId) : botTurn(g, actorId);
  const { state } = applyAction(g, actorId, action);
  room.game = state;
  if (state.winnerId) room.lastWinnerId = state.winnerId;
  broadcast(room);
  maybeRunBot(room);
}

function botTurn(g, botId) {
  const p = g.players.find((x) => x.id === botId);
  // Must announce before a winning draw is allowed (when the rule is on).
  if (g.options.boutaGooseRule && score(p) >= ANNOUNCE_AT && !p.announcedBoutaGoose) {
    return { type: 'ANNOUNCE_GOOSE' };
  }
  // Mow down whoever has the biggest gaggle, if it's worth it.
  if (p.wild.some((w) => w.kind === 'LAWN_MOWER')) {
    const victim = g.players
      .filter((x) => x.id !== botId && x.connected)
      .sort((a, b) => b.regular.length - a.regular.length)[0];
    if (victim && victim.regular.length >= 3) return { type: 'PLAY_LAWN_MOWER', targetId: victim.id };
  }
  return { type: 'DRAW' };
}

function botResponse(g, botId) {
  const t = g.players.find((x) => x.id === botId);
  if (t.wild.some((w) => w.kind === 'GOOSE_GANG')) return { type: 'RESPOND', response: 'goose_gang' };
  // Only the original Big Boy drawer may Get Goosed — divert to someone with geese.
  if (g.phase === 'AWAIT_BIG_BOY' && g.pending.target === g.pending.origin
      && t.wild.some((w) => w.kind === 'GET_GOOSED')) {
    const victim = g.players
      .filter((x) => x.id !== botId && x.connected)
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
  room.game = null;
  room.decided = null;
  room.votes = new Map();   // re-vote on the silliest goose for the next round
  broadcast(room);
}

function doAction(ws, { action }) {
  const room = getRoom(ws.meta.roomCode);
  if (!room || !room.game) return;
  const { state, error } = applyAction(room.game, ws.meta.playerId, action);
  room.game = state;
  if (error) return send(ws, 'error', { message: error });
  if (state.winnerId) room.lastWinnerId = state.winnerId;
  broadcast(room);
  maybeRunBot(room);
}

function doChat(ws, { text }) {
  const room = getRoom(ws.meta.roomCode);
  if (!room) return;
  const m = room.members.get(ws.meta.playerId);
  if (!m || !text) return;
  for (const other of room.members.values()) {
    send(other.ws, 'chat', { from: m.name, text: String(text).slice(0, 200) });
  }
}

httpServer.listen(PORT, () => {
  console.log(`🪿 Quit Goosin Around! running at http://localhost:${PORT}`);
});
