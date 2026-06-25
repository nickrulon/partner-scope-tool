// Client for Quit Goosin' Around! — Linocut Pond Party UI.
// Renders authoritative server state; never computes rules locally.
// Card art loads from cards/<KIND>.png; sounds from sounds/<event>.<ext>.

import {
  initAudio, playSound, fxSound, drawSound, setMuted, isMuted, setVolume, getVolume,
} from './audio.js';

const $ = (id) => document.getElementById(id);
const PID_KEY = 'goose_pid';
let playerId = localStorage.getItem(PID_KEY) || `p${Math.random().toString(36).slice(2, 9)}`;
localStorage.setItem(PID_KEY, playerId);

let ws, cardMeta = {}, view = null;
let tradeMode = false, tradeSel = new Set();
let targetMode = null;            // lawn-mower targeting (click a player)
let goosedChoosing = false;       // get-goosed target picker inside overlay
let lastFxId = 0, fxPrimed = false;
let laneTimer = null;

const PILE_BACKS = { gooseDraw: 'GOOSE_CARD_BACK', wildDraw: 'WILD_GOOSE_BACK' };

// ---- art probing (resolves real extension; sizes as cover) ----
const artStatus = {}, artUrl = {};
const ART_EXTS = ['png', 'PNG', 'jpg', 'jpeg', 'JPG', 'webp'];
const ART_BUST = Date.now();
function probeArt(kind) {
  if (artStatus[kind]) return;
  artStatus[kind] = 'pending';
  let i = 0;
  const tryNext = () => {
    if (i >= ART_EXTS.length) { artStatus[kind] = 'missing'; return; }
    const url = `cards/${kind}.${ART_EXTS[i++]}?v=${ART_BUST}`;
    const img = new Image();
    img.onload = () => { artUrl[kind] = url; artStatus[kind] = 'ok'; rerender(); };
    img.onerror = tryNext;
    img.src = url;
  };
  tryNext();
}
const hasArt = (k) => artStatus[k] === 'ok';

// ---- connection ----
function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}`);
  ws.onmessage = (ev) => {
    const { type, payload } = JSON.parse(ev.data);
    if (type === 'cardMeta') { cardMeta = payload; Object.keys(cardMeta).forEach(probeArt); Object.values(PILE_BACKS).forEach(probeArt); }
    else if (type === 'joined') { view = view || {}; view.hostId = payload.hostId; }
    else if (type === 'state') { view = payload; render(); }
    else if (type === 'error') { toast(payload.message); $('lobbyErr').textContent = payload.message; }
    else if (type === 'chat') { addChat(payload.from, payload.text); if (payload.from) playSound('honk'); }
  };
  ws.onclose = () => { toast('Disconnected — reconnecting…'); setTimeout(connect, 1500); };
}
function sendWs(type, payload = {}) { ws.readyState === 1 && ws.send(JSON.stringify({ type, payload })); }

// ---- lobby wiring ----
$('createBtn').onclick = () => { playSound('click'); sendWs('create', { name: $('nameInput').value || 'Goose', playerId }); };
$('joinBtn').onclick = () => { playSound('click'); sendWs('join', { code: $('codeInput').value, name: $('nameInput').value || 'Goose', playerId }); };
$('codeInput').addEventListener('input', (e) => e.target.value = e.target.value.toUpperCase());
$('startBtn').onclick = () => { playSound('click'); sendWs('start', { boutaGooseRule: $('boutaRule').checked }); };
$('chatSend').onclick = sendChat;
$('chatInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChat(); });
function sendChat() { const t = $('chatInput').value.trim(); if (t) { sendWs('chat', { text: t }); $('chatInput').value = ''; } }

// ---- sound controls ----
function syncSoundUI() {
  $('soundToggle').textContent = isMuted() ? 'SOUND: OFF' : 'SOUND: ON';
  $('muteToggle').checked = isMuted();
  $('volSlider').value = Math.round(getVolume() * 100);
}
$('soundToggle').onclick = () => { setMuted(!isMuted()); syncSoundUI(); if (!isMuted()) playSound('click'); };
$('muteToggle').onchange = (e) => { setMuted(e.target.checked); syncSoundUI(); };
$('volSlider').oninput = (e) => { setVolume(e.target.value / 100); };
$('volSlider').onchange = () => playSound('click');

// ---- top-level render ----
function showScreen(id) { ['lobby', 'waiting', 'game'].forEach((s) => $(s).classList.toggle('hidden', s !== id)); }
function rerender() { if (view) render(); }

function render() {
  if (!view) return;
  if (!view.code) { showScreen('lobby'); return; }
  if (!view.game) { renderWaiting(); showScreen('waiting'); return; }
  renderGame();
  showScreen('game');
}

function renderWaiting() {
  $('roomCode').textContent = view.code;
  const list = $('memberList'); list.innerHTML = '';
  for (const m of view.members) {
    const li = document.createElement('li');
    li.className = m.id === view.hostId ? 'host' : '';
    li.innerHTML = `<span>${esc(m.name)}${m.id === playerId ? ' (you)' : ''}</span>`;
    list.appendChild(li);
  }
  const isHost = playerId === view.hostId;
  $('startBtn').classList.toggle('hidden', !isHost);
  $('boutaRule').disabled = !isHost;
  $('waitHint').textContent = isHost
    ? (view.members.length < 2 ? 'Need at least 2 geese.' : 'Ready when you are.')
    : 'Waiting for the host to start…';
}

const me = () => view.game.players.find((p) => p.id === playerId);
const isMyTurn = () => view.game.turnPlayerId === playerId;

function renderGame() {
  const g = view.game;
  $('gRoomName').textContent = view.code;
  $('gPlayerCount').textContent = `${g.players.length} geese`;

  applyPile('gooseDraw', g.gooseDrawCount, PILE_BACKS.gooseDraw);
  applyPile('wildDraw', g.wildDrawCount, PILE_BACKS.wildDraw);
  // Discard shows the goose card back, flipped upside down (see .pile-art CSS).
  $('gooseDiscard').querySelector('.pile-n').textContent = g.gooseDiscardCount;
  const dOk = hasArt('GOOSE_CARD_BACK') && g.gooseDiscardCount > 0;
  $('gooseDiscard').classList.toggle('empty', g.gooseDiscardCount === 0);
  $('discardArt').style.backgroundImage = dOk ? `url(${artUrl.GOOSE_CARD_BACK})` : '';

  renderTurnBanner();
  renderPlayers();
  renderMine();
  renderControls();
  renderLog();
  renderOverlay();
  handleFx();
  syncSoundUI();
}

function renderTurnBanner() {
  const g = view.game;
  const banner = $('turnBanner'), sub = $('turnSub');
  if (g.phase === 'GAME_OVER') {
    const w = g.players.find((p) => p.id === g.winnerId);
    banner.textContent = w ? `${w.name} wins!` : 'Game over';
    banner.className = 'turn-banner mine';
    sub.textContent = w && w.id === playerId ? 'you are the great honkeror' : 'flap yer wings and honk';
    return;
  }
  const turnP = g.players.find((p) => p.id === g.turnPlayerId);
  if (isMyTurn()) { banner.textContent = 'Your Turn'; banner.className = 'turn-banner mine'; sub.textContent = 'get yer geese'; }
  else { banner.textContent = `${turnP?.name || ''}'s turn`; banner.className = 'turn-banner'; sub.textContent = 'quit goosin’ around'; }
}

function applyPile(elId, count, backKind) {
  const el = $(elId);
  el.querySelector('.pile-n').textContent = count;
  const ok = hasArt(backKind) && count > 0;
  el.classList.toggle('has-back', ok);
  el.classList.toggle('empty', count === 0);
  el.style.backgroundImage = ok ? `url(${artUrl[backKind]})` : '';
  el.style.backgroundSize = ok ? 'cover' : '';
  el.style.backgroundPosition = ok ? 'center' : '';
}

function renderPlayers() {
  const g = view.game;
  const box = $('players'); box.innerHTML = '';
  // viewer first, then others in seat order
  const ordered = [me(), ...g.players.filter((p) => p.id !== playerId)];
  for (const p of ordered) {
    const el = document.createElement('div');
    el.className = 'player paper';
    if (p.id === g.turnPlayerId) el.classList.add('active');
    if (g.pending && g.pending.targetId === p.id) el.classList.add('target');
    if (!p.connected) el.classList.add('off');
    const goose = hasArt('GOOSE') ? `background-image:url(${artUrl.GOOSE})` : '';
    const scoreStr = p.score == null ? '<span class="hidden-score">?</span>' : p.score;
    el.innerHTML =
      `<div class="pinfo">
        <div class="pname">${esc(p.name)}${p.id === playerId ? ' <span class="you">(you)</span>' : ''}</div>
        <div class="pscore">${scoreStr}<span class="max"> / 21</span></div>
        <div class="pmeta">${p.regularCount} goose card${p.regularCount === 1 ? '' : 's'} · ${p.wildCount} wild goose card${p.wildCount === 1 ? '' : 's'}${p.connected ? '' : ' · away'}</div>
        ${p.announcedBoutaGoose ? '<div class="pmeta"><span class="stamp goose">bouta goose</span></div>' : ''}
      </div>
      <div class="pgoose" style="${goose}"></div>`;
    if (targetMode && p.id !== playerId) {
      el.classList.add('selectable');
      el.onclick = () => chooseLawnTarget(p.id);
    }
    box.appendChild(el);
  }
}

function renderMine() {
  const p = me();
  const wild = $('myWild'); wild.innerHTML = '';
  (p.wild || []).forEach((c) => wild.appendChild(cardEl(c, false)));
  const reg = $('myRegular'); reg.innerHTML = '';
  (p.regular || []).forEach((c) => {
    const el = cardEl(c, tradeMode);
    if (tradeMode) {
      if (tradeSel.has(c.id)) el.classList.add('selected');
      el.onclick = () => { tradeSel.has(c.id) ? tradeSel.delete(c.id) : tradeSel.add(c.id); renderMine(); renderControls(); };
    }
    reg.appendChild(el);
  });
  const total = (p.regular || []).reduce((s, c) => s + (cardMeta[c.kind]?.points || 0), 0);
  const n = p.regular ? p.regular.length : 0;
  $('handHint').textContent = `${n} goose card${n === 1 ? '' : 's'} · ${total} pts`;
}

function cardEl(card, selectable) {
  const meta = cardMeta[card.kind] || { name: card.kind, points: 0, color: '#caa' };
  const el = document.createElement('div');
  el.className = 'card' + (selectable ? ' selectable' : '');
  el.style.backgroundColor = meta.color;
  if (hasArt(card.kind)) {
    el.style.backgroundImage = `url(${artUrl[card.kind]})`;
    el.style.backgroundSize = 'cover';
    el.style.backgroundPosition = 'center';
  }
  const showText = !hasArt(card.kind);
  el.innerHTML =
    `<div class="pts">${meta.points}</div>` +
    (showText ? `<div class="label">${esc(meta.name)}</div>` : '<div class="nameless"></div>');
  el.title = `${meta.name} — ${meta.desc || ''}`;
  return el;
}

// ---- controls (PRE_DRAW) ----
function renderControls() {
  const g = view.game, p = me();
  const c = $('controls'); c.innerHTML = '';
  if (g.phase === 'GAME_OVER') {
    if (playerId === view.hostId) c.appendChild(btn('Rematch', 'btn-primary', () => sendWs('rematch')));
    else c.appendChild(hint('Waiting for host to start a rematch…'));
    return;
  }
  if (g.phase !== 'PRE_DRAW' || !isMyTurn()) {
    c.appendChild(hint(g.phase === 'PRE_DRAW' ? 'Waiting for your turn…' : 'Resolving Big Boy…'));
    return;
  }

  if (tradeMode) {
    const total = [...tradeSel].reduce((s, id) => s + (cardMeta[p.regular.find((x) => x.id === id)?.kind]?.points || 0), 0);
    const help = document.createElement('div'); help.className = 'trade-help';
    help.textContent = `Pick geese worth exactly 4 points (selected: ${total}).`;
    c.appendChild(help);
    const confirm = btn('Trade for a Wild', 'btn-primary', doTrade);
    confirm.disabled = total !== 4 || g.wildDrawCount === 0;
    c.appendChild(confirm);
    c.appendChild(btn('Cancel', 'btn-ghost', () => { tradeMode = false; tradeSel.clear(); renderMine(); renderControls(); }));
    return;
  }

  if (p.score >= 17 && !p.announcedBoutaGoose) {
    c.appendChild(btn('Announce: I’m bouta goose!', 'btn-primary', () => sendWs('action', { action: { type: 'ANNOUNCE_GOOSE' } })));
  }
  const tradeBtn = btn('Trade in Wild Goose Market', '', () => { tradeMode = true; tradeSel.clear(); renderMine(); renderControls(); });
  tradeBtn.disabled = g.wildDrawCount === 0 || p.regular.length === 0;
  c.appendChild(tradeBtn);
  if ((p.wild || []).some((w) => w.kind === 'LAWN_MOWER')) {
    c.appendChild(btn('Play Lawn Mower', '', () => beginLawnTarget()));
  }
  c.appendChild(btn('Draw a Goose Card  (ends turn)', 'btn-primary', () => sendWs('action', { action: { type: 'DRAW' } })));
}
function doTrade() { sendWs('action', { action: { type: 'TRADE', cardIds: [...tradeSel] } }); tradeMode = false; tradeSel.clear(); }

// ---- lawn-mower targeting (click a player panel) ----
function beginLawnTarget() { targetMode = true; toast('Pick a target — click a player.'); renderPlayers(); }
function chooseLawnTarget(targetId) { targetMode = false; sendWs('action', { action: { type: 'PLAY_LAWN_MOWER', targetId } }); renderPlayers(); }

// ---- Big Boy / Win overlay ----
let winDismissed = false;
function renderOverlay() {
  const g = view.game;
  const ov = $('overlay');
  const honk = $('overlayHonk'), banner = $('overlayBanner'), sub = $('overlaySub');
  const card = $('overlayCard'), art = $('overlayArt'), cc = $('overlayControls');

  // WIN — big banner across the middle for everyone
  if (g.phase === 'GAME_OVER') {
    if (winDismissed) { ov.classList.add('hidden'); return; }
    const w = g.players.find((p) => p.id === g.winnerId);
    ov.classList.remove('hidden'); ov.classList.add('win');
    honk.textContent = '';
    if (hasArt('GREAT_HONKEROR')) { card.style.display = ''; art.style.backgroundImage = `url(${artUrl.GREAT_HONKEROR})`; art.style.backgroundColor = ''; art.innerHTML = ''; }
    else { card.style.display = 'none'; }
    banner.textContent = w ? `${w.name} WINS!` : 'GAME OVER';
    sub.textContent = w ? 'The Great Honkeror, Ruler of the Pond' : '';
    cc.innerHTML = '';
    if (playerId === view.hostId) cc.appendChild(btn('Play Again', 'btn-primary', () => sendWs('rematch')));
    cc.appendChild(btn('View Board', 'btn-ghost', () => { winDismissed = true; renderOverlay(); }));
    return;
  }
  winDismissed = false;
  ov.classList.remove('win');

  const active = g.phase === 'AWAIT_BIG_BOY' || g.phase === 'AWAIT_GET_GOOSED';
  ov.classList.toggle('hidden', !active);
  if (!active) { goosedChoosing = false; return; }

  // BIG BOY
  honk.textContent = '((( HONK! HONK! )))';
  banner.textContent = "QUIT GOOSIN' AROUND, YA GOOSE!";
  sub.textContent = '';
  card.style.display = '';
  art.style.backgroundImage = hasArt('BIG_BOY') ? `url(${artUrl.BIG_BOY})` : '';
  art.style.backgroundColor = hasArt('BIG_BOY') ? '' : (cardMeta.BIG_BOY?.color || '#7a2e2e');
  art.innerHTML = hasArt('BIG_BOY') ? '' : '<div style="display:flex;height:100%;align-items:center;justify-content:center;font-family:var(--display);color:var(--cream);font-size:2rem">BIG BOY</div>';

  const amTarget = g.pending && g.pending.targetId === playerId;
  const targetName = g.players.find((p) => p.id === g.pending.targetId)?.name || '';
  cc.innerHTML = '';

  if (!amTarget) { cc.appendChild(msg(`Big Boy is after ${esc(targetName)}…`)); return; }

  if (goosedChoosing) {
    cc.appendChild(msg('Send Big Boy at…'));
    for (const o of g.players) {
      if (o.id === playerId) continue;
      cc.appendChild(btn(o.name, '', () => { goosedChoosing = false; respond('get_goosed', o.id); }));
    }
    cc.appendChild(btn('Back', 'btn-ghost', () => { goosedChoosing = false; renderOverlay(); }));
    return;
  }

  const hasGang = (me().wild || []).some((w) => w.kind === 'GOOSE_GANG');
  const hasGoosed = (me().wild || []).some((w) => w.kind === 'GET_GOOSED');
  cc.appendChild(btn('Take it (discard my geese)', 'btn-danger', () => respond('absorb')));
  if (hasGang) cc.appendChild(btn('Play Goose Gang (block)', 'btn-primary', () => respond('goose_gang')));
  if (hasGoosed) cc.appendChild(btn('Play Get Goosed (divert)', '', () => { goosedChoosing = true; renderOverlay(); }));
}
function respond(response, targetId) { sendWs('action', { action: { type: 'RESPOND', response, targetId } }); }

// ---- effects (sound + lane flash + overlay slam) ----
function handleFx() {
  const fx = view.game.fx || [];
  if (!fxPrimed) { lastFxId = fx.reduce((m, f) => Math.max(m, f.id), 0); fxPrimed = true; return; }
  const fresh = fx.filter((f) => f.id > lastFxId);
  if (!fresh.length) return;
  lastFxId = fx.reduce((m, f) => Math.max(m, f.id), lastFxId);
  for (const f of fresh) {
    if (f.type === 'WIN') { playSound(f.actor === me().name ? 'win' : 'lose'); }
    else if (f.type === 'DRAW') { playSound(drawSound(f.kind)); }
    else playSound(fxSound(f.type));
    if (f.type === 'BIG_BOY') slamOverlay();
    else if (['LAWN_MOWER', 'GET_GOOSED', 'GOOSE_GANG', 'ANNOUNCE', 'TRADE', 'PENALTY'].includes(f.type)) flashEvent(f);
  }
}

function slamOverlay() {
  const card = document.querySelector('.overlay-card');
  if (!card) return;
  card.style.animation = 'none'; void card.offsetWidth; card.style.animation = '';
}

const EVENT_FLASH = {
  LAWN_MOWER: { kind: 'LAWN_MOWER', title: 'LAWN MOWER!', sub: (f) => `${f.actor} mowed ${f.target}` },
  GET_GOOSED: { kind: 'GET_GOOSED', title: 'GET GOOSED!', sub: (f) => `${f.actor} → ${f.target}` },
  GOOSE_GANG: { kind: 'GOOSE_GANG', title: 'GOOSE GANG!', sub: (f) => `${f.actor} blocked it` },
  ANNOUNCE:   { kind: null, title: 'BOUTA GOOSE!', sub: (f) => `${f.actor} is closing in` },
  TRADE:      { kind: null, title: 'WILD MARKET', sub: (f) => `${f.actor} traded for a Wild` },
  PENALTY:    { kind: null, title: 'GOOSED!', sub: (f) => `${f.actor} forgot to announce` },
};
function flashEvent(f) {
  const cfg = EVENT_FLASH[f.type]; if (!cfg) return;
  const lane = $('eventLane');
  const artCss = cfg.kind && hasArt(cfg.kind) ? `background-image:url(${artUrl[cfg.kind]})` : '';
  lane.innerHTML = `<div class="event-flash">
      ${cfg.kind ? `<div class="ef-card" style="${artCss}"></div>` : ''}
      <div class="ef-title">${esc(cfg.title)}</div>
      <div class="ef-sub">${esc(cfg.sub(f))}</div>
    </div>`;
  clearTimeout(laneTimer);
  laneTimer = setTimeout(resetLane, 2400);
}
function resetLane() {
  $('eventLane').innerHTML = '<div class="event-idle"><span class="event-idle-title">★ Event Lane ★</span><span class="event-idle-sub">Game-wide moments show up here</span></div>';
}

// ---- log / chat ----
function renderLog() {
  const box = $('log'); box.innerHTML = '';
  for (const e of view.game.log) {
    const d = document.createElement('div');
    d.className = e.kind || 'info';
    d.textContent = e.text;
    box.appendChild(d);
  }
  box.scrollTop = box.scrollHeight;
}
function addChat(from, text) {
  const box = $('chat');
  const d = document.createElement('div');
  d.innerHTML = `<span class="c-from">${esc(from)}:</span> ${esc(text)}`;
  box.appendChild(d); box.scrollTop = box.scrollHeight;
}

// ---- utils ----
function btn(label, cls, fn) {
  const b = document.createElement('button');
  b.className = 'btn ' + (cls || '');
  b.textContent = label;
  b.onclick = () => { playSound('click'); fn(); };
  return b;
}
function hint(text) { const s = document.createElement('div'); s.className = 'hintline'; s.textContent = text; return s; }
function msg(html) { const s = document.createElement('div'); s.className = 'overlay-msg'; s.innerHTML = html; return s; }
function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
let toastTimer;
function toast(m) { const t = $('toast'); t.textContent = m; t.classList.remove('hidden'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add('hidden'), 3000); }

initAudio();
syncSoundUI();
resetLane();
connect();
