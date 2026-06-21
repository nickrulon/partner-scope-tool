// Client for Quit Goosin Around!
// Talks to server.js over WebSocket. Renders authoritative state; never
// computes rules locally. Art is loaded from cards/<KIND>.png with a graceful
// text fallback so the game is fully playable before any art exists.

const $ = (id) => document.getElementById(id);
const PID_KEY = 'goose_pid';
let playerId = localStorage.getItem(PID_KEY) || `p${Math.random().toString(36).slice(2, 9)}`;
localStorage.setItem(PID_KEY, playerId);

let ws, cardMeta = {}, room = null, view = null;
let tradeMode = false, tradeSel = new Set();
let targetMode = null; // { action, response? } awaiting an opponent click

// --- art existence cache: only try each image once ---
const artStatus = {}; // kind -> 'ok' | 'missing' | 'pending'
function probeArt(kind) {
  if (artStatus[kind]) return;
  artStatus[kind] = 'pending';
  const img = new Image();
  img.onload = () => { artStatus[kind] = 'ok'; rerender(); };
  img.onerror = () => { artStatus[kind] = 'missing'; };
  img.src = `cards/${kind}.png`;
}

// --- connection ----------------------------------------------------------

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}`);
  ws.onmessage = (ev) => {
    const { type, payload } = JSON.parse(ev.data);
    if (type === 'cardMeta') { cardMeta = payload; Object.keys(cardMeta).forEach(probeArt); }
    else if (type === 'joined') { room = { code: payload.code, hostId: payload.hostId }; }
    else if (type === 'state') { view = payload; render(); }
    else if (type === 'error') { toast(payload.message); $('lobbyErr').textContent = payload.message; }
    else if (type === 'chat') { addChat(payload.from, payload.text); }
  };
  ws.onclose = () => { toast('Disconnected — reconnecting…'); setTimeout(connect, 1500); };
}
function sendWs(type, payload = {}) { ws.readyState === 1 && ws.send(JSON.stringify({ type, payload })); }

// --- lobby ---------------------------------------------------------------

$('createBtn').onclick = () => sendWs('create', { name: $('nameInput').value || 'Goose', playerId });
$('joinBtn').onclick = () => sendWs('join', { code: $('codeInput').value, name: $('nameInput').value || 'Goose', playerId });
$('codeInput').addEventListener('input', (e) => e.target.value = e.target.value.toUpperCase());
$('startBtn').onclick = () => sendWs('start', { boutaGooseRule: $('boutaRule').checked });
$('chatSend').onclick = sendChat;
$('chatInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChat(); });
function sendChat() { const t = $('chatInput').value.trim(); if (t) { sendWs('chat', { text: t }); $('chatInput').value = ''; } }

// --- top-level render ----------------------------------------------------

function showScreen(id) {
  ['lobby', 'waiting', 'game'].forEach((s) => $(s).classList.toggle('hidden', s !== id));
}
function rerender() { if (view) render(); }

function render() {
  if (!view) return;
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

// --- game render ---------------------------------------------------------

function me() { return view.game.players.find((p) => p.id === playerId); }
function isMyTurn() { return view.game.turnPlayerId === playerId; }

function renderGame() {
  const g = view.game;
  // piles
  $('gooseDraw').querySelector('.pile-n').textContent = g.gooseDrawCount;
  $('wildDraw').querySelector('.pile-n').textContent = g.wildDrawCount;
  $('gooseDiscard').querySelector('.pile-n').textContent = g.gooseDiscardCount;

  // turn banner
  const turnP = g.players.find((p) => p.id === g.turnPlayerId);
  const banner = $('turnBanner');
  if (g.phase === 'GAME_OVER') {
    const w = g.players.find((p) => p.id === g.winnerId);
    banner.innerHTML = `🏆 ${esc(w?.name || '?')} is THE GREAT HONKEROR! Everybody flap and honk.`;
    banner.className = 'turn-banner mine';
  } else {
    banner.textContent = isMyTurn() ? '🪿 YOUR TURN — get yer geese!' : `${turnP?.name || ''}'s turn`;
    banner.className = 'turn-banner' + (isMyTurn() ? ' mine' : '');
  }

  renderOpponents();
  renderMine();
  renderControls();
  renderPrompt();
  renderLog();
}

function renderOpponents() {
  const g = view.game;
  const box = $('opponents'); box.innerHTML = '';
  for (const p of g.players) {
    if (p.id === playerId) continue;
    const el = document.createElement('div');
    el.className = 'opp';
    if (p.id === g.turnPlayerId) el.classList.add('active');
    if (g.pending && g.pending.targetId === p.id) el.classList.add('target');
    if (!p.connected) el.classList.add('off');
    el.innerHTML =
      `<div class="nm">${esc(p.name)}${p.announcedBoutaGoose ? ' 📣' : ''}</div>` +
      `<div class="sc">${p.score} <span style="font-size:.7rem;opacity:.7">/ 21</span></div>` +
      `<div class="meta">${p.regularCount} geese · ${p.wildCount} wild${p.connected ? '' : ' · away'}</div>`;
    if (targetMode) {
      el.classList.add('selectable');
      el.style.cursor = 'pointer';
      el.onclick = () => chooseTarget(p.id);
    }
    box.appendChild(el);
  }
}

function renderMine() {
  const p = me();
  $('myName').textContent = p.name + (isMyTurn() ? ' — your turn' : '');
  $('myScore').textContent = `${p.score} / 21`;
  $('myAnnounce').classList.toggle('hidden', !p.announcedBoutaGoose);

  const wild = $('myWild'); wild.innerHTML = '';
  (p.wild || []).forEach((c) => wild.appendChild(cardEl(c, false)));

  const reg = $('myRegular'); reg.innerHTML = '';
  (p.regular || []).forEach((c) => {
    const selectable = tradeMode;
    const el = cardEl(c, selectable);
    if (tradeMode) {
      if (tradeSel.has(c.id)) el.classList.add('selected');
      el.onclick = () => { tradeSel.has(c.id) ? tradeSel.delete(c.id) : tradeSel.add(c.id); renderMine(); renderControls(); };
    }
    reg.appendChild(el);
  });
}

function cardEl(card, selectable) {
  const meta = cardMeta[card.kind] || { name: card.kind, points: 0, color: '#444' };
  const el = document.createElement('div');
  el.className = 'card' + (selectable ? ' selectable' : '');
  el.style.background = meta.color;
  if (artStatus[card.kind] === 'ok') {
    el.style.backgroundImage = `url(cards/${card.kind}.png)`;
  }
  const showText = artStatus[card.kind] !== 'ok';
  el.innerHTML =
    `<div class="pts">${meta.points}</div>` +
    (showText ? `<div class="art-fallback">${emojiFor(card.kind)}</div>` : '') +
    (showText ? `<div class="label">${esc(meta.name)}</div>` : '');
  el.title = `${meta.name} — ${meta.desc || ''}`;
  return el;
}

function emojiFor(kind) {
  return { GOOSE: '🦢', GEESE: '🦢🦢', GEESES: '🪿', BIG_BOY: '👦', UNGOOSABLE: '🛡️',
    GOOSE_GANG: '🪿🪿', GET_GOOSED: '↪️', LAWN_MOWER: '🚜', GREAT_HONKEROR: '👑' }[kind] || '🪿';
}

// --- controls (PRE_DRAW actions) -----------------------------------------

function renderControls() {
  const g = view.game, p = me();
  const c = $('controls'); c.innerHTML = '';
  if (g.phase === 'GAME_OVER') {
    if (playerId === view.hostId) c.appendChild(btn('Rematch (winner keeps the crown)', 'primary', () => sendWs('rematch')));
    else c.appendChild(note('Waiting for host to start a rematch…'));
    return;
  }
  if (g.phase !== 'PRE_DRAW' || !isMyTurn()) {
    c.appendChild(note(g.phase === 'PRE_DRAW' ? 'Waiting for your turn…' : 'Resolving the threat…'));
    return;
  }

  if (tradeMode) {
    const total = [...tradeSel].reduce((s, id) => s + (cardMeta[p.regular.find((x) => x.id === id)?.kind]?.points || 0), 0);
    c.appendChild(note(`Wild Goose Market: select geese totaling exactly 4 points (selected: ${total}).`));
    const confirm = btn('Trade for a Wild', 'primary', doTrade);
    confirm.disabled = total !== 4 || g.wildDrawCount === 0;
    c.appendChild(confirm);
    c.appendChild(btn('Cancel', '', () => { tradeMode = false; tradeSel.clear(); renderMine(); renderControls(); }));
    return;
  }

  // Announce
  if (p.score >= 17 && !p.announcedBoutaGoose) c.appendChild(btn('📣 I\'m bouta goose!', 'primary', () => sendWs('action', { action: { type: 'ANNOUNCE_GOOSE' } })));
  // Trade
  const tradeBtn = btn('🛒 Trade in Wild Goose Market', '', () => { tradeMode = true; tradeSel.clear(); renderMine(); renderControls(); });
  tradeBtn.disabled = g.wildDrawCount === 0 || p.regular.length === 0;
  c.appendChild(tradeBtn);
  // Lawn Mower
  if ((p.wild || []).some((w) => w.kind === 'LAWN_MOWER')) {
    c.appendChild(btn('🚜 Play Lawn Mower', '', () => beginTarget({ type: 'PLAY_LAWN_MOWER' })));
  }
  // Draw — ends turn
  c.appendChild(btn('Draw a Goose Card ▶ (ends turn)', 'primary', () => sendWs('action', { action: { type: 'DRAW' } })));
}

function doTrade() {
  sendWs('action', { action: { type: 'TRADE', cardIds: [...tradeSel] } });
  tradeMode = false; tradeSel.clear();
}

// --- response prompt (Big Boy / Get Goosed) ------------------------------

function renderPrompt() {
  const g = view.game;
  const box = $('prompt');
  const amTarget = g.pending && g.pending.targetId === playerId;
  if (!amTarget) { box.classList.add('hidden'); box.innerHTML = ''; return; }
  const p = me();
  const hasGang = (p.wild || []).some((w) => w.kind === 'GOOSE_GANG');
  const hasGoosed = (p.wild || []).some((w) => w.kind === 'GET_GOOSED');
  const isBigBoyDrawer = g.pending.type === 'BIG_BOY'; // only drawer can get_goosed from BIG_BOY

  box.classList.remove('hidden');
  box.innerHTML = g.pending.type === 'BIG_BOY'
    ? `<h3>BIG BOY came for YOUR geese! 😱 "QUIT GOOSIN AROUND, YA GOOSE!"</h3>`
    : `<h3>Someone yelled GET GOOSED at you! Big Boy's comin'. 😱</h3>`;
  const row = document.createElement('div'); row.className = 'row';

  row.appendChild(btn('😩 Take it (discard my geese)', '', () => respond('absorb')));
  if (hasGang) row.appendChild(btn('🪿 Play Goose Gang (block)', 'primary', () => respond('goose_gang')));
  // Get Goosed: from BIG_BOY only by the drawer; from GET_GOOSED the target can re-divert.
  if (hasGoosed) row.appendChild(btn('↪️ Play Get Goosed (divert)', '', () => beginTarget({ type: 'RESPOND', response: 'get_goosed' })));
  box.appendChild(row);
}

function respond(response, targetId) {
  sendWs('action', { action: { type: 'RESPOND', response, targetId } });
}

// --- targeting -----------------------------------------------------------

function beginTarget(action) {
  targetMode = action;
  toast('Pick a target — click an opponent.');
  renderOpponents();
}
function chooseTarget(targetId) {
  const action = targetMode; targetMode = null;
  if (action.type === 'PLAY_LAWN_MOWER') sendWs('action', { action: { type: 'PLAY_LAWN_MOWER', targetId } });
  else if (action.type === 'RESPOND') respond('get_goosed', targetId);
  renderOpponents();
}

// --- log / chat ----------------------------------------------------------

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

// --- utils ---------------------------------------------------------------

function btn(label, cls, fn) { const b = document.createElement('button'); b.className = cls; b.textContent = label; b.onclick = fn; return b; }
function note(text) { const s = document.createElement('span'); s.className = 'tag'; s.textContent = text; return s; }
function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
let toastTimer;
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add('hidden'), 3000);
}

connect();
