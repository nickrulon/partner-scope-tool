// Standalone multiplayer server for Quit Goosin Around!
// HTTP serves the static client; WebSocket carries room + game traffic.
// Runs independently of the partner-scope-tool server. Default port 3030.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { createGame, applyAction, redact, makeRng } from './engine.js';
import { CARD_META } from './cards.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, 'public');
// Cloud hosts (Render/Railway/Fly/etc.) inject PORT; fall back for local dev.
const PORT = process.env.PORT || process.env.GOOSE_PORT || 3030;

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
    if (m.ws.readyState !== m.ws.OPEN) continue;
    send(m.ws, 'state', roomView(room, m.playerId));
  }
}

function roomView(room, viewerId) {
  return {
    code: room.code,
    hostId: room.hostId,
    started: !!room.game,
    members: [...room.members.values()].map((m) => ({
      id: m.playerId, name: m.name, connected: m.ws.readyState === m.ws.OPEN,
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
    broadcast(room);
  });
});

function handle(ws, type, payload) {
  switch (type) {
    case 'create': return doCreate(ws, payload);
    case 'join':   return doJoin(ws, payload);
    case 'start':  return doStart(ws, payload);
    case 'action': return doAction(ws, payload);
    case 'rematch':return doRematch(ws, payload);
    case 'chat':   return doChat(ws, payload);
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
  broadcast(room);
}

function doCreate(ws, { name, playerId }) {
  const code = makeCode();
  const pid = playerId || `p${Math.random().toString(36).slice(2, 9)}`;
  const room = { code, hostId: pid, members: new Map(), game: null, lastWinnerId: null };
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

function doStart(ws, payload) {
  const room = getRoom(ws.meta.roomCode);
  if (!room) return;
  if (ws.meta.playerId !== room.hostId) return send(ws, 'error', { message: 'Only the host can start.' });
  const players = [...room.members.values()].map((m) => ({ id: m.playerId, name: m.name }));
  if (players.length < 2) return send(ws, 'error', { message: 'Need at least 2 geese to goose.' });
  room.game = createGame(players, {
    boutaGooseRule: payload.boutaGooseRule !== false,
    honkerorHolderId: room.lastWinnerId || null,
  });
  broadcast(room);
}

function doRematch(ws, payload) {
  const room = getRoom(ws.meta.roomCode);
  if (!room) return;
  if (ws.meta.playerId !== room.hostId) return send(ws, 'error', { message: 'Only the host can rematch.' });
  if (room.game && room.game.winnerId) room.lastWinnerId = room.game.winnerId;
  room.game = null;
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
