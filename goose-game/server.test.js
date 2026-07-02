// Server integration tests — no framework, just `node goose-game/server.test.js`.
// Spawns the real server on a test port and drives real WebSocket clients
// through the room lifecycle: join/vote/start, late joins, disconnects,
// seat reclaiming, the join cap, auto-skip, and room reaping.

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3577;

let pass = 0, fail = 0;
function ok(cond, msg) { cond ? (pass++, console.log('  ✓', msg)) : (fail++, console.error('  ✗', msg)); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- tiny ws test client ---------------------------------------------------

class Client {
  constructor(label) { this.label = label; this.msgs = []; this.waiters = []; }
  connect() {
    return new Promise((res, rej) => {
      this.ws = new WebSocket(`ws://localhost:${PORT}`);
      this.ws.on('open', res);
      this.ws.on('error', rej);
      this.ws.on('message', (raw) => {
        const m = JSON.parse(raw);
        this.msgs.push(m);
        this.waiters = this.waiters.filter((w) => !w(m));
      });
    });
  }
  send(type, payload = {}) { this.ws.send(JSON.stringify({ type, payload })); }
  close() { try { this.ws.close(); } catch { /* already closed */ } }
  // Resolve with the first message (past or future) matching pred.
  wait(pred, label, ms = 6000) {
    const hit = this.msgs.find(pred);
    if (hit) return Promise.resolve(hit);
    return new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error(`[${this.label}] timeout waiting for ${label}`)), ms);
      this.waiters.push((m) => {
        if (!pred(m)) return false;
        clearTimeout(t); res(m); return true;
      });
    });
  }
  // Like wait(), but only considers messages arriving AFTER the call.
  waitNext(pred, label, ms = 6000) {
    return new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error(`[${this.label}] timeout waiting for ${label}`)), ms);
      this.waiters.push((m) => {
        if (!pred(m)) return false;
        clearTimeout(t); res(m); return true;
      });
    });
  }
  lastState() { for (let i = this.msgs.length - 1; i >= 0; i--) if (this.msgs[i].type === 'state') return this.msgs[i].payload; return null; }
}

const isState = (pred) => (m) => m.type === 'state' && pred(m.payload);

async function newClient(label) { const c = new Client(label); await c.connect(); return c; }

// Create a room with `names.length` clients, everyone votes for the first
// goose, and (optionally) the host starts the game. Returns clients + ids.
async function makeRoom(names, { start = true } = {}) {
  const clients = [];
  const host = await newClient(names[0]);
  host.send('create', { name: names[0] });
  const joined = await host.wait((m) => m.type === 'joined', 'joined');
  const code = joined.payload.code;
  host.playerId = joined.payload.playerId;
  clients.push(host);
  for (const n of names.slice(1)) {
    const c = await newClient(n);
    c.send('join', { code, name: n });
    const j = await c.wait((m) => m.type === 'joined', 'joined');
    c.playerId = j.payload.playerId;
    clients.push(c);
  }
  for (const c of clients) c.send('vote', { candidateId: host.playerId });
  await host.wait(isState((s) => s.decided && s.decided.id === host.playerId), 'unanimous vote');
  if (start) {
    host.send('start');
    await host.wait(isState((s) => s.started), 'game started');
  }
  return { clients, host, code };
}

// --- boot the server --------------------------------------------------------

const server = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
  env: { ...process.env, GOOSE_PORT: String(PORT), GOOSE_GRACE_MS: '600', GOOSE_REAP_MS: '600' },
  stdio: ['ignore', 'pipe', 'inherit'],
});
await new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error('server did not boot')), 8000);
  server.stdout.on('data', (d) => { if (String(d).includes('running at')) { clearTimeout(t); res(); } });
});

try {
  console.log('\n== Create / join / vote / start ==');
  {
    const { clients, host } = await makeRoom(['Ana', 'Bora']);
    const s = host.lastState();
    ok(s.started && s.game, 'game started after a unanimous vote');
    ok(s.game.turnPlayerId === host.playerId, 'the voted silliest goose goes first');
    ok(s.members.length === 2, 'two geese seated');
    clients.forEach((c) => c.close());
  }

  console.log('\n== A late join breaks unanimity (Start must re-check) ==');
  {
    const { clients, host, code } = await makeRoom(['Cleo', 'Dot'], { start: false });
    const late = await newClient('Eve');
    late.send('join', { code, name: 'Eve' });
    await late.wait((m) => m.type === 'joined', 'joined');
    await host.wait(isState((s) => !s.decided && s.members.length === 3), 'decided cleared when Eve joined');
    ok(true, 'unanimity resets when a new goose waddles in');
    host.send('start');
    const err = await host.wait((m) => m.type === 'error', 'start rejected');
    ok(/agree/i.test(err.payload.message), 'start is refused until everyone re-votes');
    [...clients, late].forEach((c) => c.close());
  }

  console.log('\n== Closing a lobby tab removes the ghost goose ==');
  {
    const { clients, host } = await makeRoom(['Fig', 'Gus', 'Hal'], { start: false });
    clients[2].close();
    await host.wait(isState((s) => s.members.length === 2), 'member list shrank');
    ok(true, 'disconnected lobby goose was removed (no zombie seat at start)');
    clients.slice(0, 2).forEach((c) => c.close());
  }

  console.log('\n== Seat reclaim: blocked while connected, allowed when away ==');
  {
    const { clients, host, code } = await makeRoom(['Ivy', 'Jud']);
    const jud = clients[1];
    // Hijack attempt: a NEW device claims Jud's name while Jud is connected.
    const thief = await newClient('thief');
    thief.send('join', { code, name: 'Jud' });
    const err = await thief.wait((m) => m.type === 'error', 'hijack rejected');
    ok(/still connected/i.test(err.payload.message), 'cannot claim a seat that is still connected');
    // Legit reclaim: Jud's tab dies, then a new device joins with his name.
    jud.close();
    await host.wait(isState((s) => s.game && s.game.players.some((p) => p.name === 'Jud' && !p.connected)), 'Jud marked away');
    thief.send('join', { code, name: 'Jud' });
    const j = await thief.wait((m) => m.type === 'joined' && m.payload.playerId === jud.playerId, 'seat reclaimed');
    ok(j.payload.playerId === jud.playerId, 'a disconnected seat can be reclaimed by exact name');
    [host, thief].forEach((c) => c.close());
  }

  console.log('\n== The pond caps at 8 geese ==');
  {
    const names = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8'];
    const { clients, code } = await makeRoom(names, { start: false });
    const ninth = await newClient('P9');
    ninth.send('join', { code, name: 'P9' });
    const err = await ninth.wait((m) => m.type === 'error', 'ninth join rejected');
    ok(/full/i.test(err.payload.message), 'ninth goose is turned away');
    [...clients, ninth].forEach((c) => c.close());
  }

  console.log('\n== A dropped player is auto-skipped after the grace window ==');
  {
    const { clients, host } = await makeRoom(['Kai', 'Lou']);
    // It's Kai's (host's) turn; Kai's wifi dies.
    const lou = clients[1];
    host.close();
    const m = await lou.wait(
      isState((x) => x.game && x.game.turnPlayerId === lou.playerId),
      'turn auto-passed to Lou', 6000,
    );
    const s = m.payload;
    ok(s.game.turnPlayerId === lou.playerId, 'game auto-skipped the away goose (no host action needed)');
    ok(s.game.log.some((e) => /away too long/i.test(e.text)), 'log explains the auto-skip');
    lou.close();
  }

  console.log('\n== Spectators are listed by name (birdwatchers) ==');
  {
    const { clients, code } = await makeRoom(['Olly', 'Pip'], { start: false });
    const w1 = await newClient('w1');
    w1.send('spectate', { code, name: 'Aunt Deb' });
    await w1.wait((m) => m.type === 'joined', 'spectator joined');
    await clients[0].wait(isState((s) => (s.spectators || []).some((x) => x.name === 'Aunt Deb')), 'watcher visible to players');
    ok(true, 'players can see who is watching, by name');
    // Same default name twice → de-duped, not blurred together.
    const w2 = await newClient('w2');
    w2.send('spectate', { code, name: 'Aunt Deb' });
    await w2.wait((m) => m.type === 'joined', 'second spectator joined');
    await clients[0].wait(isState((s) => (s.spectators || []).some((x) => x.name === 'Aunt Deb 2')), 'deduped watcher name');
    ok(true, 'duplicate watcher names de-dupe ("Aunt Deb 2")');
    // Leaving takes you off the strip.
    w1.close();
    await clients[0].wait(isState((s) => !(s.spectators || []).some((x) => x.name === 'Aunt Deb')), 'watcher removed on close');
    ok(true, 'a watcher who leaves disappears from the strip');
    [...clients, w2].forEach((c) => c.close());
  }

  console.log('\n== Empty rooms are reaped ==');
  {
    const { clients, code } = await makeRoom(['Mo', 'Nib'], { start: false });
    clients.forEach((c) => c.close());
    await sleep(1500);   // reap window is 600ms in tests
    const probe = await newClient('probe');
    probe.send('join', { code, name: 'probe' });
    const err = await probe.wait((m) => m.type === 'error', 'room gone');
    ok(/no room/i.test(err.payload.message), 'abandoned room was deleted (memory + code freed)');
    probe.close();
  }
} catch (e) {
  fail++;
  console.error('  ✗ scenario crashed:', e.stack);
} finally {
  server.kill();
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
