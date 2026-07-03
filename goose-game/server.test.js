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
  constructor(label, port = PORT) { this.label = label; this.port = port; this.msgs = []; this.waiters = []; }
  connect() {
    return new Promise((res, rej) => {
      this.ws = new WebSocket(`ws://localhost:${this.port}`);
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

async function newClient(label, port = PORT) { const c = new Client(label, port); await c.connect(); return c; }

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
  env: {
    ...process.env,
    GOOSE_PORT: String(PORT), GOOSE_GRACE_MS: '600', GOOSE_REAP_MS: '600',
    GOOSE_DB: ':memory:', GOOSE_DEV_SECRET: 'test-secret',
  },
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

  console.log('\n== Pond graffiti: shared strokes, own-undo, host-only clear ==');
  {
    const { clients, host } = await makeRoom(['Quill', 'Rex']);
    const rex = clients[1];
    host.send('pond', { op: 'stroke', stroke: { z: 'play', c: 1, w: 2, p: [100, 100, 300, 300] } });
    await rex.wait(isState((s) => (s.pond || []).length === 1), 'stroke broadcast to everyone');
    ok(true, 'a pond stroke reaches the whole room');
    host.send('pond', { op: 'stroke', stroke: { z: 'nonsense', c: 0, w: 0, p: [1, 1, 2, 2] } });
    host.send('pond', { op: 'stroke', stroke: { z: 'player:' + rex.playerId, c: 2, w: 1, p: [50, 50, 200, 200] } });
    await rex.wait(isState((s) => (s.pond || []).length === 2), 'player-zone stroke accepted');
    ok(rex.lastState().pond.every((st) => st.z !== 'nonsense'), 'unknown zones are rejected');
    // Rex's undo touches nothing (both marks are the host's); host undo removes one.
    rex.send('pond', { op: 'undo' });
    host.send('pond', { op: 'undo' });
    await rex.wait(isState((s) => (s.pond || []).length === 1), 'one stroke undone');
    ok(true, 'undo only removes your own most recent mark');
    rex.send('pond', { op: 'clear' });
    const err = await rex.wait((m) => m.type === 'error' && /host/i.test(m.payload.message), 'clear rejected');
    ok(!!err, 'only the host can clear the pond');
    host.send('pond', { op: 'clear' });
    await rex.wait(isState((s) => (s.pond || []).length === 0), 'pond cleared');
    ok(true, 'host clear wipes the graffiti');
    // Live streaming: mid-stroke previews relay to everyone else, not the artist.
    host.send('pond', { op: 'live', stroke: { z: 'play', c: 0, w: 1, p: [10, 10, 90, 90] } });
    const live = await rex.wait((m) => m.type === 'pondlive' && m.payload.stroke, 'live preview relayed');
    ok(live.payload.by === host.playerId && live.payload.stroke.z === 'play', 'others see the stroke as it is drawn');
    host.send('pond', { op: 'stroke', stroke: { z: 'play', c: 0, w: 1, p: [10, 10, 90, 90] } });
    const doneMsg = await rex.wait((m) => m.type === 'pondlive' && m.payload.done, 'preview cleared on commit');
    ok(!!doneMsg, 'committing the stroke ends the live preview');
    // Eraser: strokes have ids; erase removes them (any owner). Strokes are
    // tagged with distinct colors so waits can't match stale backlog states.
    const eStP = rex.waitNext(isState((s) => (s.pond || []).some((x) => x.c === 3)), 'erase target placed');
    host.send('pond', { op: 'stroke', stroke: { z: 'play', c: 3, w: 0, p: [20, 20, 80, 80] } });
    const eTarget = (await eStP).payload.pond.find((x) => x.c === 3);
    ok(eTarget.i != null, 'strokes carry ids for the eraser');
    const eGoneP = rex.waitNext(isState((s) => !(s.pond || []).some((x) => x.i === eTarget.i)), 'stroke erased');
    rex.send('pond', { op: 'erase', ids: [eTarget.i] });
    await eGoneP;
    ok(true, 'the eraser rubs out strokes by id (any owner)');
    // Precision eraser: carve replaces one stroke with its surviving pieces.
    const carvedP = rex.waitNext(isState((s) => (s.pond || []).some((x) => x.c === 2)), 'carve target placed');
    host.send('pond', { op: 'stroke', stroke: { z: 'play', c: 2, w: 1, p: [100, 100, 200, 200, 300, 300, 400, 400, 500, 500, 600, 600] } });
    const target = (await carvedP).payload.pond.find((x) => x.c === 2);
    const afterP = rex.waitNext(isState((s) => (s.pond || []).filter((x) => x.c === 2).length === 2), 'stroke split in two');
    host.send('pond', { op: 'carve', id: target.i, parts: [[100, 100, 200, 200], [500, 500, 600, 600]] });
    const pieces = (await afterP).payload.pond.filter((x) => x.c === 2);
    ok(pieces.every((s) => s.i !== target.i && s.by === target.by),
      'carved pieces get new ids but keep the color and artist');
    // Carving can only remove — parts with MORE points than the original are refused.
    host.send('pond', { op: 'carve', id: pieces[0].i, parts: [[1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7]] });
    await sleep(300);
    ok(rex.lastState().pond.filter((x) => x.c === 2).length === 2, 'a carve that adds points is rejected');
    // Empty parts = the eraser consumed the whole stroke.
    const goneP = rex.waitNext(isState((s) => (s.pond || []).filter((x) => x.c === 2).length === 1), 'fully-erased stroke removed');
    host.send('pond', { op: 'carve', id: pieces[0].i, parts: [] });
    await goneP;
    ok(true, 'carve with no survivors deletes the stroke');
    clients.forEach((c) => c.close());
  }

  console.log('\n== Identity cookie endpoint (iOS Safari persistence) ==');
  {
    const good = await fetch(`http://localhost:${PORT}/acct`, { method: 'POST', body: 'a_cookiegoose1' });
    const setCookie = good.headers.get('set-cookie') || '';
    ok(good.ok && /ga=a_cookiegoose1/.test(setCookie) && /Max-Age=63072000/.test(setCookie),
      'valid account id gets a 2-year HTTP-set cookie');
    const bad = await fetch(`http://localhost:${PORT}/acct`, { method: 'POST', body: 'DROP TABLE geese' });
    ok(bad.status === 400, 'garbage account ids are refused');
  }

  console.log('\n== Waiting-room doodles (no game yet) ==');
  {
    const { clients, host } = await makeRoom(['Sal', 'Tug'], { start: false });
    host.send('pond', { op: 'stroke', stroke: { z: 'waitcard', c: 7, w: 1, p: [100, 100, 400, 400] } });
    await clients[1].wait(isState((s) => (s.pond || []).some((x) => x.z === 'waitcard' && x.c === 7)), 'waitcard stroke visible');
    ok(true, 'doodling works in the waiting room (and white survives the clamp)');
    clients.forEach((c) => c.close());
  }

  console.log('\n== Host Pass gating: iOS pays to host, web and solo stay free ==');
  {
    // iOS client without the pass: multiplayer create refused, solo allowed.
    const ios = await newClient('ios');
    ios.send('hello', { accountId: 'a_iostester01', platform: 'ios' });
    const acct = await ios.wait((m) => m.type === 'account', 'account handshake');
    ok(acct.payload.accountId === 'a_iostester01' && acct.payload.entitlements.length === 0,
      'anonymous account registered with no entitlements');
    ios.send('create', { name: 'Appy' });
    const gate = await ios.wait((m) => m.type === 'error' && m.payload.code === 'NEED_HOST_PASS', 'create gated');
    ok(!!gate, 'iOS client without Host Pass cannot create a multiplayer pond');
    ios.send('create', { name: 'Appy', solo: true });
    await ios.wait((m) => m.type === 'joined', 'solo pond created');
    const soloState = await ios.wait(isState((s) => s.solo && s.members.length === 2), 'solo pre-stocked');
    ok(soloState.payload.members.some((x) => x.isBot), 'solo pond is free and comes with a computer goose');
    // Another human cannot pile into a solo pond.
    const gate2 = await newClient('gatecrash');
    gate2.send('join', { code: soloState.payload.code, name: 'Crasher' });
    const nope = await gate2.wait((m) => m.type === 'error' && /solo/i.test(m.payload.message), 'solo join blocked');
    ok(!!nope, 'humans cannot join a solo pond');
    gate2.close();
    // Grant the Host Pass via the dev endpoint (stand-in for StoreKit) → re-hello → create works.
    const resp = await fetch(`http://localhost:${PORT}/dev/grant?secret=test-secret&account=a_iostester01&product=host_pass`, { method: 'POST' });
    ok(resp.ok, 'dev grant accepted');
    ios.send('hello', { accountId: 'a_iostester01', platform: 'ios' });
    const acct2 = await ios.wait((m) => m.type === 'account' && m.payload.entitlements.includes('host_pass'), 'entitlement visible');
    ok(!!acct2, 'account now owns the Host Pass');
    ios.send('create', { name: 'Appy' });
    await ios.wait((m) => m.type === 'joined' && !m.payload.spectator, 'multiplayer create allowed');
    ok(true, 'Host Pass unlocks multiplayer hosting on iOS');
    // Web clients were never gated (all earlier scenarios created rooms without hello).
    const web = await newClient('webby');
    web.send('hello', { accountId: 'a_webtester01', platform: 'web' });
    await web.wait((m) => m.type === 'account', 'web hello');
    web.send('create', { name: 'Webby' });
    await web.wait((m) => m.type === 'joined', 'web create still free');
    ok(true, 'web hosting stays free (the website is the demo channel)');
    // Wrong dev secret is refused.
    const bad = await fetch(`http://localhost:${PORT}/dev/grant?secret=wrong&account=a_x&product=host_pass`, { method: 'POST' });
    ok(bad.status === 403, 'dev grant refuses a bad secret');
    ios.close(); web.close();
  }

  console.log('\n== Gumroad launch mode: web gated, buy URL, redeem, ping webhook ==');
  {
    // A second server with the web gate FLIPPED ON (how production will run
    // once Nick's Gumroad product is live) + a test license key.
    const GPORT = PORT + 1;
    const gated = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
      env: {
        ...process.env,
        GOOSE_PORT: String(GPORT), GOOSE_DB: ':memory:',
        GOOSE_GATE_WEB: '1',
        GOOSE_GUMROAD_TEST_KEY: 'HONK-HONK-SON',
        GOOSE_GUMROAD_URL: 'https://nick.gumroad.com/l/hostpass',
        GOOSE_FRIEND_CODE: 'GOOSEGANG, pondpals',
      },
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    await new Promise((res2, rej2) => {
      const t = setTimeout(() => rej2(new Error('gated server did not boot')), 8000);
      gated.stdout.on('data', (d) => { if (String(d).includes('running at')) { clearTimeout(t); res2(); } });
    });
    try {
      const web = await newClient('gatedweb', GPORT);
      web.send('hello', { accountId: 'a_webbuyer001', platform: 'web' });
      await web.wait((m) => m.type === 'account', 'hello');
      // Gated: create refused, with a buy URL carrying the account id.
      web.send('create', { name: 'Buyer' });
      const gate = await web.wait((m) => m.type === 'error' && m.payload.code === 'NEED_HOST_PASS', 'web create gated');
      ok(/accountId=a_webbuyer001/.test(gate.payload.buyUrl), 'upgrade sheet gets a Gumroad URL tagged with the account');
      // Solo still free even when the web is gated.
      web.send('create', { name: 'Buyer', solo: true });
      await web.wait((m) => m.type === 'joined', 'solo still free');
      ok(true, 'solo ponds stay free with the gate on');
      web.send('leave', {});
      // Bad license key → rejected.
      web.send('redeem', { key: 'TOTALLY-FAKE' });
      const bad = await web.wait((m) => m.type === 'error' && /didn't fly/i.test(m.payload.message), 'bad key rejected');
      ok(!!bad, 'a fake license key is rejected');
      // Good key → live account push with the entitlement → create works.
      web.send('redeem', { key: 'HONK-HONK-SON' });
      await web.wait((m) => m.type === 'account' && m.payload.entitlements.includes('host_pass'), 'live unlock push');
      ok(true, 'redeeming the license key unlocks the pass live');
      web.send('create', { name: 'Buyer' });
      await web.wait((m) => m.type === 'joined' && !m.payload.spectator, 'create now allowed');
      ok(true, 'gated web client can host after redeeming');
      // Ping webhook: a sale for a DIFFERENT account grants it automatically.
      const ping = await fetch(`http://localhost:${GPORT}/gumroad/ping`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'license_key=HONK-HONK-SON&url_params%5BaccountId%5D=a_pingbuyer01&sale_id=s1',
      });
      ok(ping.ok, 'ping endpoint answers 200');
      await sleep(300);   // grant is async after the 200
      const buyer2 = await newClient('pingbuyer', GPORT);
      buyer2.send('hello', { accountId: 'a_pingbuyer01', platform: 'web' });
      await buyer2.wait((m) => m.type === 'account' && m.payload.entitlements.includes('host_pass'), 'ping granted the pass');
      ok(true, 'Gumroad Ping auto-grants the pass to the tagged account');
      web.close(); buyer2.close();
      // Friend codes: passwords that skip Gumroad entirely (friends & family).
      // Case-insensitive, and the comma-separated env list is trimmed.
      const pal = await newClient('friendpal', GPORT);
      pal.send('hello', { accountId: 'a_friendpal01', platform: 'web' });
      await pal.wait((m) => m.type === 'account', 'friend hello');
      pal.send('redeem', { key: 'goosegang' });
      await pal.wait((m) => m.type === 'account' && m.payload.entitlements.includes('host_pass'), 'friend code granted');
      ok(true, 'friend code GOOSEGANG grants the pass (case-insensitive, no Gumroad)');
      pal.send('create', { name: 'Pal' });
      await pal.wait((m) => m.type === 'joined' && !m.payload.spectator, 'friend can host');
      ok(true, 'friend-code holder can create ponds');
      const pal2 = await newClient('friendpal2', GPORT);
      pal2.send('hello', { accountId: 'a_friendpal02', platform: 'web' });
      await pal2.wait((m) => m.type === 'account', 'friend2 hello');
      pal2.send('redeem', { key: 'PONDPALS' });
      await pal2.wait((m) => m.type === 'account' && m.payload.entitlements.includes('host_pass'), 'second code granted');
      ok(true, 'multiple comma-separated friend codes work (whitespace trimmed)');
      pal.close(); pal2.close();
    } finally {
      gated.kill();
    }
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
