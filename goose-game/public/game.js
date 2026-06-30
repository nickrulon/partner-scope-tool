// Client for Quit Goosin' Around! — Linocut Pond Party UI.
// Renders authoritative server state; never computes rules locally.
// Card art loads from cards/<KIND>.png; sounds from sounds/<event>.<ext>.

import {
  initAudio, playSound, enqueueSound, fxSound, drawSound, setMuted, isMuted, setVolume, getVolume,
} from './audio.js';

const $ = (id) => document.getElementById(id);
const PID_KEY = 'goose_pid';
let playerId = localStorage.getItem(PID_KEY) || `p${Math.random().toString(36).slice(2, 9)}`;
localStorage.setItem(PID_KEY, playerId);

const SID_KEY = 'goose_sid';
let spectatorId = localStorage.getItem(SID_KEY) || `s_${Math.random().toString(36).slice(2, 9)}`;
localStorage.setItem(SID_KEY, spectatorId);

let ws, cardMeta = {}, view = null;
let leaving = false;               // true after Leave Game — ignore in-flight states until we (re)join
let spectating = false;            // true while watching a game as audience
let tradeMode = false, tradeSel = new Set();
let targetMode = null;            // lawn-mower targeting (click a player)
let goosedChoosing = false;       // get-goosed target picker inside overlay
let lastFxId = 0, fxPrimed = false;
let laneTimer = null;

const PILE_BACKS = { gooseDraw: 'GOOSE_CARD_BACK', wildDraw: 'WILD_GOOSE_BACK' };
// How many names each card can hold (matches its point value). Regular AND
// wild geese are nameable; Big Boy is not.
const NAME_MAX = {
  GOOSE: 1, GEESE: 2, GEESES: 4,
  UNGOOSABLE: 1, GOOSE_GANG: 1, GET_GOOSED: 1, LAWN_MOWER: 1, GREAT_HONKEROR: 1,
};
// Playful suggestions shown as placeholders when naming a goose (one per name
// slot — a Geeses shows all four).
const GOOSE_PUNS = ['Honk Williams Jr.', 'Quackary', 'Honkuin Phoenix', 'Bill'];

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

// ---- reconnect memory ----
// Remember the room + name + mode so a refresh, wifi blip, or a fresh device
// drops you straight back into your seat instead of the lobby.
const ROOM_KEY = 'goose_room', NAME_KEY = 'goose_name', MODE_KEY = 'goose_mode';
function rememberSession() {
  if (!view || !view.code) return;
  localStorage.setItem(ROOM_KEY, view.code);
  localStorage.setItem(MODE_KEY, spectating ? 'watch' : 'play');
  const myName = view.game
    ? view.game.players.find((p) => p.id === playerId)?.name
    : (view.members || []).find((m) => m.id === playerId)?.name;
  if (myName) localStorage.setItem(NAME_KEY, myName);
}
function autoRejoin() {
  const code = localStorage.getItem(ROOM_KEY);
  if (!code) return;
  const name = localStorage.getItem(NAME_KEY) || '';
  if (localStorage.getItem(MODE_KEY) === 'watch') sendWs('spectate', { code, name: name || 'Spectator', playerId: spectatorId });
  else sendWs('join', { code, name, playerId });   // server slots you back by id, or by exact name
}

// ---- connection ----
function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}`);
  ws.onopen = () => autoRejoin();   // on first load AND every reconnect
  ws.onmessage = (ev) => {
    const { type, payload } = JSON.parse(ev.data);
    if (type === 'cardMeta') { cardMeta = payload; Object.keys(cardMeta).forEach(probeArt); Object.values(PILE_BACKS).forEach(probeArt); }
    else if (type === 'joined') {
      view = view || {}; view.hostId = payload.hostId;
      // Adopt the seat id the server gives us (matters when reclaiming a seat
      // by name from a new device); spectators keep their own id.
      if (payload.playerId && !payload.spectator) { playerId = payload.playerId; localStorage.setItem(PID_KEY, playerId); }
      if (payload.code) localStorage.setItem(ROOM_KEY, payload.code);
      localStorage.setItem(MODE_KEY, payload.spectator ? 'watch' : 'play');
      leaving = false;   // we (re)joined something — accept states again
    }
    else if (type === 'state') { if (leaving) return; view = payload; render(); }
    else if (type === 'error') {
      toast(payload.message); $('lobbyErr').textContent = payload.message;
      if (/no room with that code/i.test(payload.message)) localStorage.removeItem(ROOM_KEY); // stale room — don't keep retrying
    }
    else if (type === 'chat') { addChat(payload.from, payload.text); if (payload.from) playSound('honk'); }
    else if (type === 'nudge') { nudgeBanner(payload.text); playSound(payload.kind); }
  };
  ws.onclose = () => { toast('Disconnected — reconnecting…'); setTimeout(connect, 1500); };
}
function sendWs(type, payload = {}) { ws.readyState === 1 && ws.send(JSON.stringify({ type, payload })); }

// ---- lobby wiring ----
// Send the name blank if unset — the server assigns a fun honk-pun name.
$('createBtn').onclick = () => { leaving = false; playSound('click'); sendWs('create', { name: $('nameInput').value, playerId }); };
$('joinBtn').onclick = () => { leaving = false; playSound('click'); sendWs('join', { code: $('codeInput').value, name: $('nameInput').value, playerId }); };
$('watchBtn').onclick = () => { leaving = false; playSound('click'); sendWs('spectate', { code: $('codeInput').value, name: $('nameInput').value || 'Spectator', playerId: spectatorId }); };
$('codeInput').addEventListener('input', (e) => e.target.value = e.target.value.toUpperCase());
$('addBotBtn').onclick = () => { playSound('click'); sendWs('addbot'); };
$('keepNames').onchange = (e) => sendWs('setkeepnames', { keep: e.target.checked });
$('startBtn').onclick = () => { playSound('click'); sendWs('start'); };
$('chatSend').onclick = sendChat;
$('chatInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChat(); });
function sendChat() { const t = $('chatInput').value.trim(); if (t) { sendWs('chat', { text: t }); $('chatInput').value = ''; } }

// ---- lobby: vote + holler nudges + lobby chat ----
// "Vote!" always plays holler1 (the "vote" clip); "Holler" cycles the rest.
const HOLLER_SOUNDS = ['holler2', 'holler3', 'holler4', 'holler5', 'holler6'];
let hollerIdx = 0;
let lastNudge = 0;
function sendNudge(kind) {
  const now = Date.now();
  if (now - lastNudge < 2000) return false;   // client throttle (server also enforces)
  lastNudge = now;
  playSound('click');
  sendWs('nudge', { kind });            // the nudge sound plays when the broadcast returns
  return true;
}
$('voteBtn').onclick = () => sendNudge('holler1');
$('hollerBtn').onclick = () => { const k = HOLLER_SOUNDS[hollerIdx % HOLLER_SOUNDS.length]; if (sendNudge(k)) hollerIdx++; };
$('lobbyChatSend').onclick = sendLobbyChat;
$('lobbyChatInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendLobbyChat(); });
function sendLobbyChat() { const t = $('lobbyChatInput').value.trim(); if (t) { sendWs('chat', { text: t }); $('lobbyChatInput').value = ''; } }

let nudgeTimer;
function nudgeBanner(text) {
  const el = $('nudgeBanner');
  el.textContent = text;
  el.classList.remove('hidden');
  el.classList.add('show');
  clearTimeout(nudgeTimer);
  nudgeTimer = setTimeout(() => { el.classList.remove('show'); el.classList.add('hidden'); }, 2600);
}

// ---- sound controls ----
function syncSoundUI() {
  $('soundToggle').textContent = isMuted() ? 'SOUND: OFF' : 'SOUND: ON';
  $('muteToggle').checked = isMuted();
  $('volSlider').value = Math.round(getVolume() * 100);
}
$('specPanelToggle').onclick = () => { playSound('click'); document.body.classList.toggle('spec-panels-open'); };
$('leaveBtn').onclick = () => {
  if (!confirm('Leave the game? Your geese scatter back into the deck.')) return;
  playSound('click');
  leaving = true;                      // ignore any in-flight game states from here
  sendWs('leave');
  localStorage.removeItem(ROOM_KEY);   // don't auto-rejoin
  view = null; spectating = false;
  document.body.classList.remove('spectating');
  showScreen('lobby');
};
$('soundToggle').onclick = () => { setMuted(!isMuted()); syncSoundUI(); if (!isMuted()) playSound('click'); };
$('muteToggle').onchange = (e) => { setMuted(e.target.checked); syncSoundUI(); };
$('volSlider').oninput = (e) => { setVolume(e.target.value / 100); };
$('volSlider').onchange = () => playSound('click');

// ---- top-level render ----
function showScreen(id) { ['lobby', 'waiting', 'game'].forEach((s) => $(s).classList.toggle('hidden', s !== id)); }
function rerender() { if (view) render(); }

function render() {
  if (!view) return;
  spectating = !!view.spectator;
  document.body.classList.toggle('spectating', spectating);
  rememberSession();
  if (!view.code) { resetTransient(); showScreen('lobby'); return; }
  if (!view.game) { resetTransient(); renderWaiting(); showScreen('waiting'); return; }
  renderGame();
  showScreen('game');
}

// Tear down any in-game overlays/animations when we leave the table (back to
// lobby or waiting room on a rematch). Without this the Win overlay — Great
// Honkeror card + "X WINS" — stayed pinned on top of the new waiting screen.
// Also re-arms the fx feed so the next game's effects (which restart their id
// counter at 1) aren't filtered out as "already seen" — that was why the
// losing sound went quiet after a rematch.
function resetTransient() {
  $('overlay').classList.add('hidden');
  $('overlay').classList.remove('win');
  $('flyLayer').innerHTML = '';
  document.querySelectorAll('.name-modal').forEach((m) => m.remove());
  clearTimeout(laneTimer);
  winDismissed = false; laneBusy = false;
  tradeMode = false; tradeSel.clear(); targetMode = null; goosedChoosing = false;
  fxPrimed = false; lastFxId = 0;
}

function renderWaiting() {
  $('roomCode').textContent = view.code;
  const isHost = playerId === view.hostId;
  const votes = view.votes || {};            // voterId -> candidateId
  const myVote = votes[playerId] || null;

  // `decided` = the vote is unanimous. The vote stays visible and changeable
  // (changing it breaks the tie) — it just enables the host's Start button.
  const decided = view.decided;
  $('decidedMsg').classList.toggle('hidden', !decided);
  if (decided) {
    $('decidedMsg').innerHTML =
      `<div class="decided-head">It's been decided!</div>
       <div class="decided-body">The group agrees that <strong>${esc(decided.name)}</strong> is the silliest goose.</div>
       <div class="decided-foot">${esc(decided.name)} will go first${isHost ? ' — press Start!' : ''}</div>`;
  }

  // Build a vote card per goose: name + everyone currently voting for them.
  const list = $('voteList'); list.innerHTML = '';
  for (const m of view.members) {
    const voters = view.members.filter((v) => votes[v.id] === m.id);
    const card = document.createElement('div');
    card.className = 'vote-card' + (myVote === m.id ? ' my-vote' : '') + (voters.length ? ' has-votes' : '');
    const tags = `${m.id === playerId ? '<span class="vm-you">you</span>' : ''}${m.isBot ? '<span class="vm-bot">computer</span>' : ''}${m.id === view.hostId ? '<span class="vm-host">host</span>' : ''}`;
    card.innerHTML =
      `<div class="vc-top">
         <span class="vc-name">${esc(m.name)}</span>
         <span class="vc-tags">${tags}</span>
         <span class="vc-count">${voters.length || ''}</span>
       </div>
       <div class="vc-voters">${voters.map((v) => `<span class="voter-chip">${esc(v.name)}${v.id === playerId ? ' (you)' : ''}</span>`).join('')}</div>`;
    // You can always (re)cast your vote, even after it's unanimous — but a
    // spectator only watches, so no click handler for them.
    if (!spectating) {
      card.classList.add('clickable');
      card.onclick = () => { playSound('click'); sendWs('vote', { candidateId: m.id }); };
    }
    // remove-computer control for the host
    if (isHost && m.isBot) {
      const x = document.createElement('button');
      x.className = 'vc-remove'; x.textContent = '✕'; x.title = 'Remove this computer';
      x.onclick = (e) => { e.stopPropagation(); playSound('click'); sendWs('removebot', { botId: m.id }); };
      card.querySelector('.vc-top').appendChild(x);
    }
    list.appendChild(card);
  }

  $('hostControls').classList.toggle('hidden', !isHost);
  // "Keep last game's geese" — only when there are names to carry.
  $('keepNamesRow').classList.toggle('hidden', !isHost || !view.carryNamesAvailable);
  $('keepNames').checked = view.keepNames !== false;
  $('startBtn').disabled = !decided;   // enabled only once the vote is unanimous

  // Vote tally (members only — spectator votes don't count toward unanimity).
  const total = view.members.length;
  const votedCount = view.members.filter((m) => votes[m.id]).length;
  const allVoted = total >= 2 && votedCount === total;

  // Compact status line near the vote list.
  const status = $('voteStatus');
  if (total < 2) status.textContent = 'need at least 2 geese';
  else if (decided) status.textContent = 'Unanimous!';
  else if (allVoted) status.textContent = `${votedCount}/${total} voted — not unanimous`;
  else status.textContent = `${votedCount}/${total} voted`;
  status.className = 'vote-status' + (decided ? ' good' : (allVoted ? ' split' : ''));

  // Spectators just watch.
  if (spectating) {
    $('startHint').textContent = '';
    $('waitHint').textContent = decided
      ? `Waiting for the host to start… (${esc(decided.name)} goes first)`
      : "you're watchin' — the geese are votin'.";
    return;
  }

  // Spell out exactly why Start is disabled (host), or what's happening (others).
  let reason;
  if (total < 2) reason = 'Add a computer (or share the code) — need at least 2 geese.';
  else if (decided) reason = 'It\'s been decided. Start when ready.';
  else if (!allVoted) { const left = total - votedCount; reason = `Waitin' on ${left} ${left === 1 ? 'goose' : 'geese'} to vote.`; }
  else reason = 'Votes are split — everyone must pick the same goose.';
  $('startHint').textContent = isHost ? reason : '';
  $('waitHint').textContent = isHost ? '' : (decided ? `Waiting for the host to start… (${esc(decided.name)} goes first)` : reason);
}

const me = () => view.game.players.find((p) => p.id === playerId);
const isMyTurn = () => view.game.turnPlayerId === playerId;

function renderGame() {
  const g = view.game;
  $('gRoomName').textContent = view.code;
  $('gPlayerCount').textContent = `${g.players.length} geese`;
  // Spectator badge in the top bar.
  $('specBadge').classList.toggle('hidden', !spectating);
  $('specPanelToggle').classList.toggle('hidden', !spectating);
  if (spectating) $('specBadge').textContent = `WATCHING${view.spectatorCount > 1 ? ` · ${view.spectatorCount} viewers` : ''}`;
  else document.body.classList.remove('spec-panels-open');

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
  renderPlayArea();
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
  // Players: viewer first, then others. Spectators have no seat → seat order.
  const ordered = spectating ? g.players.slice() : [me(), ...g.players.filter((p) => p.id !== playerId)];
  for (const p of ordered) {
    const el = document.createElement('div');
    el.className = 'player paper';
    el.dataset.pid = p.id;
    if (p.id === g.turnPlayerId) el.classList.add('active');
    if (g.pending && g.pending.targetId === p.id) el.classList.add('target');
    if (!p.connected) el.classList.add('off');
    if (p.removed) el.classList.add('removed');
    const goose = hasArt('GOOSE') ? `background-image:url(${artUrl.GOOSE})` : '';
    const scoreStr = p.score == null ? '<span class="hidden-score">?</span>' : p.score;
    const statusTail = p.removed ? ' · removed' : (p.connected ? '' : ' · away');
    el.innerHTML =
      `<div class="pinfo">
        <div class="pname">${esc(p.name)}${p.id === playerId ? ' <span class="you">(you)</span>' : ''}</div>
        <div class="pscore">${scoreStr}<span class="max"> / 21</span></div>
        <div class="pmeta">${p.regularCount} goose card${p.regularCount === 1 ? '' : 's'} · ${p.wildCount} wild goose card${p.wildCount === 1 ? '' : 's'}${statusTail}</div>
        ${p.announcedBoutaGoose ? '<div class="pmeta"><span class="stamp goose">bouta goose</span></div>' : ''}
      </div>
      <div class="pgoose" style="${goose}"></div>`;
    // Host controls: skip the current turn, or remove a stuck/gone player.
    if (!spectating && playerId === view.hostId && g.phase !== 'GAME_OVER') {
      const hc = document.createElement('div');
      hc.className = 'host-ctl';
      if (p.id === g.turnPlayerId) {
        const sk = document.createElement('button');
        sk.className = 'hc-btn'; sk.textContent = 'skip';
        sk.title = `Skip ${p.name}'s turn`;
        sk.onclick = (e) => { e.stopPropagation(); playSound('click'); sendWs('skip'); };
        hc.appendChild(sk);
      }
      if (p.id !== playerId && !p.removed) {
        const rm = document.createElement('button');
        rm.className = 'hc-btn danger'; rm.textContent = 'remove';
        rm.title = `Remove ${p.name} from the game`;
        rm.onclick = (e) => { e.stopPropagation(); playSound('click'); sendWs('kick', { targetId: p.id }); };
        hc.appendChild(rm);
      }
      if (hc.children.length) el.appendChild(hc);
    }
    if (targetMode && p.id !== playerId) {
      el.classList.add('selectable');
      el.onclick = () => chooseLawnTarget(p.id);
    }
    box.appendChild(el);
  }
}

// Build a gaggle card: the card + its name caption, click-to-name when
// nameable, or trade-select when trading. Used for wild AND regular geese.
function gaggleSlot(c, canTrade) {
  const slot = document.createElement('div');
  slot.className = 'card-slot';
  const el = cardEl(c, canTrade);
  if (canTrade) {
    if (tradeSel.has(c.id)) el.classList.add('selected');
    el.onclick = () => {
      tradeSel.has(c.id) ? tradeSel.delete(c.id) : tradeSel.add(c.id);
      renderMine(); renderControls(); renderPlayArea();
    };
  } else if (NAME_MAX[c.kind]) {
    el.classList.add('nameable');
    el.title = 'Click to name this goose';
    el.onclick = () => { playSound('click'); openNameModal(c.id); };
  }
  slot.appendChild(el);
  const names = c.names || [];
  const cap = document.createElement('div');
  cap.className = 'card-cap';
  if (names.length) cap.textContent = names.join(' · ');
  else if (NAME_MAX[c.kind] && !canTrade) cap.innerHTML = '<span class="unnamed">name me</span>';
  slot.appendChild(cap);
  return slot;
}

function renderMine() {
  if (spectating) return;           // spectators have no hand
  const p = me();
  const wild = $('myWild'); wild.innerHTML = '';
  (p.wild || []).forEach((c) => wild.appendChild(gaggleSlot(c, false)));  // wilds: nameable, never traded
  const reg = $('myRegular'); reg.innerHTML = '';
  (p.regular || []).forEach((c) => reg.appendChild(gaggleSlot(c, tradeMode)));
  // Total points = regular geese + wild geese (matches your score on the panel).
  const total = [...(p.regular || []), ...(p.wild || [])]
    .reduce((s, c) => s + (cardMeta[c.kind]?.points || 0), 0);
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
  const c = $('stageActions'); c.innerHTML = '';
  if (spectating) return;           // spectators can't act
  const g = view.game, p = me();
  if (g.phase === 'GAME_OVER') {
    // After "View Board", keep Play Again (host) easy to reach, and let anyone
    // pop the winner screen back up.
    if (playerId === view.hostId) c.appendChild(btn('Play Again', 'btn-primary', () => sendWs('rematch')));
    c.appendChild(btn('View Winner', 'btn-ghost', () => { winDismissed = false; renderOverlay(); }));
    return;
  }
  if (g.phase !== 'PRE_DRAW' || !isMyTurn()) return; // play-area shows status

  if (tradeMode) {
    const total = [...tradeSel].reduce((s, id) => s + (cardMeta[p.regular.find((x) => x.id === id)?.kind]?.points || 0), 0);
    const help = document.createElement('div'); help.className = 'trade-help';
    help.textContent = `Pick geese worth exactly 4 points (selected: ${total}).`;
    c.appendChild(help);
    const confirm = btn('Trade for a Wild', 'btn-primary', doTrade);
    confirm.disabled = total !== 4 || g.wildDrawCount === 0;
    c.appendChild(confirm);
    c.appendChild(btn('Cancel', 'btn-ghost', () => { tradeMode = false; tradeSel.clear(); laneBusy = false; clearTimeout(laneTimer); renderMine(); renderControls(); renderPlayArea(); }));
    return;
  }

  // (Announcing "I'm bouta goose" now happens via a prompt AFTER you draw into
  // 17+, not as a pre-draw action — see the AWAIT_ANNOUNCE overlay.)
  const tradeBtn = btn('Trade in Wild Goose Market', '', () => { tradeMode = true; tradeSel.clear(); laneBusy = false; clearTimeout(laneTimer); renderMine(); renderControls(); renderPlayArea(); });
  tradeBtn.disabled = g.wildDrawCount === 0 || p.regular.length === 0;
  c.appendChild(tradeBtn);
  if ((p.wild || []).some((w) => w.kind === 'LAWN_MOWER')) {
    c.appendChild(btn('Play Lawn Mower', '', () => beginLawnTarget()));
  }
  c.appendChild(btn('Draw a Goose Card  (ends turn)', 'btn-primary', () => sendWs('action', { action: { type: 'DRAW' } }), { seqClick: true }));
}
function doTrade() { sendWs('action', { action: { type: 'TRADE', cardIds: [...tradeSel] } }); tradeMode = false; tradeSel.clear(); }

// ---- name your geese ----
// Goose holds 1 name, Geese 2, Geeses 4. Names persist on the card object, so
// they survive the reshuffle and travel to whoever next draws the card.
function openNameModal(cardId, onClose) {
  const done = () => { wrap.remove(); onClose && onClose(); };
  const card = (me().regular || []).find((c) => c.id === cardId)
    || (me().wild || []).find((c) => c.id === cardId);
  const max = card ? (NAME_MAX[card.kind] || 0) : 0;
  const wrap = document.createElement('div');
  wrap.className = 'overlay name-modal';
  if (!card || max === 0) { onClose && onClose(); return; }
  const meta = cardMeta[card.kind] || {};
  const existing = card.names || [];
  const box = document.createElement('div');
  box.className = 'paper name-box';
  const h = document.createElement('div');
  h.className = 'nm-title';
  h.textContent = max === 1 ? `Name your ${meta.name}` : `Name your ${meta.name} — up to ${max} names`;
  box.appendChild(h);
  const inputs = [];
  for (let i = 0; i < max; i++) {
    const inp = document.createElement('input');
    inp.className = 'nm-input';
    inp.maxLength = 24;
    inp.placeholder = `e.g. ${GOOSE_PUNS[i % GOOSE_PUNS.length]}`;
    inp.value = existing[i] || '';
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
    inputs.push(inp);
    box.appendChild(inp);
  }
  const row = document.createElement('div');
  row.className = 'nm-actions';
  const save = () => {
    const names = inputs.map((x) => x.value.trim()).filter(Boolean);
    sendWs('action', { action: { type: 'NAME_GOOSE', cardId, names } });
    done();
  };
  row.appendChild(btn('Save name' + (max > 1 ? 's' : ''), 'btn-primary', save));
  row.appendChild(btn('Cancel', 'btn-ghost', done));
  box.appendChild(row);
  wrap.appendChild(box);
  // Click on the dim backdrop cancels.
  wrap.addEventListener('click', (e) => { if (e.target === wrap) done(); });
  document.body.appendChild(wrap);
  inputs[0] && inputs[0].focus();
}

// ---- lawn-mower targeting (click a player panel) ----
function beginLawnTarget() { targetMode = true; toast('Pick a target — click a player.'); renderPlayers(); }
function chooseLawnTarget(targetId) { targetMode = false; sendWs('action', { action: { type: 'PLAY_LAWN_MOWER', targetId } }); renderPlayers(); }

// ---- Big Boy / Win overlay ----
// Spread the winner's whole gaggle (regular + wild) under the banner so the
// table can see every winning card and the names below them.
function renderWinHand(w) {
  const box = $('winHand');
  box.innerHTML = '';
  if (!w) return;
  const cards = [...(w.regular || []), ...(w.wild || [])];
  if (!cards.length) return;
  const title = document.createElement('div');
  title.className = 'wh-title';
  title.textContent = 'the winning gaggle';
  box.appendChild(title);
  const row = document.createElement('div');
  row.className = 'wh-cards';
  for (const c of cards) {
    const slot = document.createElement('div');
    slot.className = 'card-slot';
    slot.appendChild(cardEl(c, false));
    const names = c.names || [];
    if (names.length) {
      const cap = document.createElement('div');
      cap.className = 'card-cap';
      cap.textContent = names.join(' · ');
      slot.appendChild(cap);
    }
    row.appendChild(slot);
  }
  box.appendChild(row);
}

// Render the winner's gaggle to a 9:16 PNG and download it. Same image on
// desktop and mobile. Card art is same-origin so the canvas isn't tainted.
function loadImg(src) {
  return new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = src; });
}
function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
async function downloadWinImage(w) {
  try { if (document.fonts && document.fonts.ready) await document.fonts.ready; } catch { /* ignore */ }
  const W = 1080, H = 1920;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  // pond-green background
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#2a5142'); g.addColorStop(0.25, '#1f4034'); g.addColorStop(1, '#163026');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center';
  // title
  ctx.fillStyle = '#e07a2e';
  ctx.font = 'bold 120px Rye, Georgia, serif';
  ctx.fillText('WINNING', W / 2, 170);
  ctx.fillText('GAGGLE', W / 2, 300);
  ctx.fillStyle = '#f1e7cf';
  ctx.font = 'bold 56px "Special Elite", Georgia, serif';
  ctx.fillText(`${w.name} — The Great Honkeror`, W / 2, 380);

  const cards = [...(w.regular || []), ...(w.wild || [])];
  const n = Math.max(1, cards.length);
  const cols = n <= 4 ? 2 : (n <= 9 ? 3 : 4);
  const rows = Math.ceil(n / cols);
  const areaTop = 440, areaBottom = H - 70, areaW = W - 140, gap = 28, nameH = 46;
  let cardW = (areaW - (cols - 1) * gap) / cols;
  let cardH = cardW * 4 / 3;
  let pitch = cardH + nameH + gap;
  const maxPitch = (areaBottom - areaTop) / rows;
  if (pitch > maxPitch) { const s = maxPitch / pitch; cardW *= s; cardH *= s; pitch *= s; }
  const gridW = cols * cardW + (cols - 1) * gap;
  const startX = (W - gridW) / 2;

  const imgs = await Promise.all(cards.map((c) => (hasArt(c.kind) ? loadImg(artUrl[c.kind]) : Promise.resolve(null))));
  cards.forEach((c, i) => {
    const col = i % cols, row = Math.floor(i / cols);
    const x = startX + col * (cardW + gap), y = areaTop + row * pitch;
    const r = Math.max(8, cardW * 0.06);
    ctx.fillStyle = '#f1e7cf'; roundRectPath(ctx, x, y, cardW, cardH, r); ctx.fill();
    const im = imgs[i];
    if (im) { ctx.save(); roundRectPath(ctx, x, y, cardW, cardH, r); ctx.clip(); ctx.drawImage(im, x, y, cardW, cardH); ctx.restore(); }
    else {
      ctx.fillStyle = cardMeta[c.kind]?.color || '#6b8e23';
      roundRectPath(ctx, x, y, cardW, cardH, r); ctx.fill();
      ctx.fillStyle = '#f1e7cf'; ctx.font = `bold ${Math.round(cardW * 0.12)}px Georgia, serif`;
      ctx.fillText(cardMeta[c.kind]?.name || c.kind, x + cardW / 2, y + cardH / 2);
    }
    ctx.strokeStyle = '#2a2118'; ctx.lineWidth = Math.max(3, cardW * 0.02);
    roundRectPath(ctx, x, y, cardW, cardH, r); ctx.stroke();
    const names = (c.names || []).join(' · ');
    if (names) {
      ctx.fillStyle = '#f1e7cf'; ctx.font = `bold ${Math.round(Math.min(34, cardW * 0.14))}px Georgia, serif`;
      ctx.fillText(names, x + cardW / 2, y + cardH + nameH * 0.7, cardW + gap);
    }
  });

  try {
    const a = document.createElement('a');
    a.href = cv.toDataURL('image/png');
    a.download = `winning-gaggle-${(w.name || 'goose').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.png`;
    document.body.appendChild(a); a.click(); a.remove();
  } catch (e) { toast('Could not make the image on this browser.'); }
}

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
    // Show the Honkeror trophy only for a real win; a no-winner end (everyone
    // left) just shows the "game ended" banner.
    if (w && hasArt('GREAT_HONKEROR')) { card.style.display = ''; art.style.backgroundImage = `url(${artUrl.GREAT_HONKEROR})`; art.style.backgroundColor = ''; art.innerHTML = ''; }
    else { card.style.display = 'none'; }
    banner.textContent = w ? `${w.name} WINS!` : 'GAME HAS ENDED';
    sub.textContent = w ? 'The Great Honkeror, Ruler of the Pond' : 'not enough geese left in the pond';
    renderWinHand(w);
    cc.innerHTML = '';
    if (playerId === view.hostId) cc.appendChild(btn('Play Again', 'btn-primary', () => sendWs('rematch')));
    if (w && (w.regular || w.wild)) cc.appendChild(btn('Download Gaggle', '', () => downloadWinImage(w)));
    cc.appendChild(btn('View Board', 'btn-ghost', () => { winDismissed = true; renderOverlay(); }));
    return;
  }
  $('winHand').innerHTML = '';
  winDismissed = false;
  ov.classList.remove('win');

  // Post-draw announce prompt (only the deciding player ever sees this phase).
  if (g.phase === 'AWAIT_ANNOUNCE') {
    goosedChoosing = false;
    ov.classList.remove('hidden');
    honk.textContent = '';
    card.style.display = 'none';
    banner.textContent = 'BOUTA GOOSE?';
    sub.textContent = `You're at ${me()?.score ?? ''}. Reach 21 without callin' it and you get GOOSED — lose all yer geese. Call it now, or stay sneaky a lil' longer.`;
    cc.innerHTML = '';
    cc.appendChild(btn("I'm bouta goose!", 'btn-primary', () => sendWs('action', { action: { type: 'ANNOUNCE_DECISION', announce: true } })));
    cc.appendChild(btn('Stay quiet', 'btn-ghost', () => sendWs('action', { action: { type: 'ANNOUNCE_DECISION', announce: false } })));
    return;
  }

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

  // If this batch animates a draw, the turn-pass (its sound + the center
  // "turn passes" banner) waits until the card has finished its trip — so the
  // turn sound lands with a clear visual instead of overlapping the draw sound.
  const drawsThisBatch = fresh.some((f) => f.type === 'DRAW' || (f.type === 'DRAW_HIDDEN' && f.actorId !== playerId));
  const turnFx = fresh.find((f) => f.type === 'TURN');
  const afterDraw = () => { if (turnFx) playTurn(turnFx); };
  // My own trade gets a private reveal of the Wild — so skip the public
  // "WILD MARKET" flash for me (the reveal stands in for it).
  const myTradeReveal = fresh.some((f) => f.type === 'TRADE_REVEAL');

  for (const f of fresh) {
    if (f.type === 'WIN') { playSound(spectating ? 'win' : (f.actor === me()?.name ? 'win' : 'lose')); }
    // Your own draw: play your private per-card sound, fly it big into center,
    // hold it ~3s so you can read it, then sail it into your gaggle.
    else if (f.type === 'DRAW') {
      enqueueSound(drawSound(f.kind));
      flyDraw({ faceKind: f.kind, cardId: f.cardId, reveal: true, toEl: $('myRegular'), onSettled: afterDraw });
    }
    // Opponent's draw: a facedown mystery card flies to their panel (no reveal).
    else if (f.type === 'DRAW_HIDDEN') {
      if (f.actorId !== playerId) flyDraw({ faceKind: null, toEl: playerPanel(f.actorId), onSettled: afterDraw });
    }
    // Your Wild Market pull: same big 3s reveal as a draw, flying from the
    // Wild Market into your wild hand (private — only you see which Wild).
    else if (f.type === 'TRADE_REVEAL') {
      flyDraw({ faceKind: f.kind, cardId: f.cardId, reveal: true, fromEl: $('wildDraw'), toEl: $('myWild') });
    }
    else if (f.type === 'TURN') { if (!drawsThisBatch) playTurn(f); }
    else if (f.type === 'PLAYER_OUT') { toast(`${f.actor} ${f.left ? 'left' : 'was removed from'} the room`); }
    else if (f.type === 'ENDED') { /* the GAME_OVER overlay shows the "game ended" banner */ }
    else playSound(fxSound(f.type));
    if (f.type === 'BIG_BOY') slamOverlay();
    else if (['LAWN_MOWER', 'GET_GOOSED', 'GOOSE_GANG', 'ANNOUNCE', 'TRADE', 'PENALTY'].includes(f.type)) {
      if (!(f.type === 'TRADE' && myTradeReveal)) flashEvent(f);
    }
  }
}

// Turn-pass: the sound plus a short center banner so it's clear what the sound
// means (this is a transition, kept brief on purpose so it doesn't block play).
function playTurn() {
  playSound('turn');
  flashTurn();
}
function flashTurn() {
  const pa = $('playArea');
  if (!pa) return;
  const g = view.game;
  if (g.phase !== 'PRE_DRAW') return; // mid-threat / game over — skip the banner
  const mineNow = isMyTurn();
  const who = mineNow ? 'You' : (g.players.find((x) => x.id === g.turnPlayerId)?.name || 'next goose');
  pa.innerHTML = `<div class="turn-flip${mineNow ? ' mine' : ''}">
      <div class="tf-label">turn passes to</div>
      <div class="tf-name">${esc(who)}</div>
    </div>`;
  laneBusy = true;
  clearTimeout(laneTimer);
  laneTimer = setTimeout(() => { laneBusy = false; renderPlayArea(); }, 1800);
}

function playerPanel(id) { return document.querySelector(`.player[data-pid="${id}"]`); }

// Animate a card from the goose deck, big through the center, to a destination.
// `reveal` (your own draw) holds it large for ~3s with a caption + naming, then
// sails it to your gaggle. Facedown opponent draws get a quick fly-by.
function flyDraw({ faceKind, cardId, reveal, toEl, fromEl, onSettled }) {
  const deck = fromEl || $('gooseDraw'), play = $('playArea'), layer = $('flyLayer');
  if (!deck || !layer) { onSettled && onSettled(); return; }
  const fr = deck.getBoundingClientRect();
  const w = fr.width || 72, h = fr.height || 96;
  const startCx = fr.left + w / 2, startCy = fr.top + h / 2;
  // A reveal (your own draw / wild trade) pops to the VIEWPORT center so you
  // always see what you drew, even if you're scrolled to the chat/log. A
  // facedown opponent draw just flies to their panel.
  const centerX = reveal ? window.innerWidth / 2 : (play ? play.getBoundingClientRect().left + play.getBoundingClientRect().width / 2 : window.innerWidth / 2);
  const centerY = reveal ? window.innerHeight / 2 : (play ? play.getBoundingClientRect().top + play.getBoundingClientRect().height / 2 : window.innerHeight / 2);
  const cdx = centerX - startCx, cdy = centerY - startCy;
  const bigScale = reveal
    ? Math.max(1.8, Math.min(4.5, (window.innerHeight * 0.4) / h))
    : Math.max(1.4, Math.min(3, ((play?.getBoundingClientRect().height || 200) * 0.4) / h));

  let backdrop = null;
  if (reveal) {
    backdrop = document.createElement('div');
    backdrop.className = 'reveal-backdrop';
    layer.appendChild(backdrop);
    laneBusy = true; // keep idle status from wiping the center reveal
  }

  const card = document.createElement('div');
  card.className = 'fly-card';
  const kind = faceKind || 'GOOSE_CARD_BACK';
  if (hasArt(kind)) card.style.backgroundImage = `url(${artUrl[kind]})`;
  else card.style.backgroundColor = faceKind ? (cardMeta[faceKind]?.color || '#caa') : '#1a3328';
  Object.assign(card.style, { left: `${fr.left}px`, top: `${fr.top}px`, width: `${w}px`, height: `${h}px` });
  layer.appendChild(card);

  const HOLD = reveal ? 3000 : 500;
  let caption = null, outTimer = null, settled = false;

  const finish = () => {
    if (settled) return; settled = true;
    if (caption) caption.remove();
    if (backdrop) backdrop.remove();
    card.remove();
    if (reveal) laneBusy = false;
    if (onSettled) onSettled();
    else renderPlayArea(); // no turn follows (e.g. a trade) — restore the center
  };
  const flyOut = () => {
    if (caption) { caption.remove(); caption = null; }
    if (backdrop) { backdrop.remove(); backdrop = null; }
    const tr = (toEl || play || deck).getBoundingClientRect();
    const ddx = (tr.left + tr.width / 2) - startCx, ddy = (tr.top + tr.height / 2) - startCy;
    const destScale = toEl ? Math.max(0.4, (tr.height * 0.7) / h) : 1;
    const out = card.animate([
      { transform: `translate(${cdx}px,${cdy}px) scale(${bigScale})`, opacity: 1 },
      { transform: `translate(${ddx}px,${ddy}px) scale(${destScale})`, opacity: 0.15 },
    ], { duration: 520, easing: 'cubic-bezier(.5,0,.7,1)', fill: 'forwards' });
    out.onfinish = finish; out.oncancel = finish;
  };

  const inAnim = card.animate([
    { transform: 'translate(0,0) scale(1)', opacity: 0.6 },
    { transform: `translate(${cdx}px,${cdy}px) scale(${bigScale})`, opacity: 1 },
  ], { duration: 460, easing: 'cubic-bezier(.3,1.3,.5,1)', fill: 'forwards' });
  inAnim.oncancel = finish;
  inAnim.onfinish = () => {
    if (reveal) caption = buildDrawCaption(cardId, faceKind, {
      pause: () => clearTimeout(outTimer),
      resume: () => { outTimer = setTimeout(flyOut, 700); },
    });
    outTimer = setTimeout(flyOut, HOLD);
  };
}

// The caption that sits under the big revealed card: its name, any goose names
// already on it, and a button to (re)name it. Returns the element so flyDraw
// can remove it when the card flies off.
function buildDrawCaption(cardId, faceKind, hooks) {
  const tag = document.createElement('div');
  tag.className = 'draw-caption';
  const card = (me().regular || []).find((c) => c.id === cardId)
    || (me().wild || []).find((c) => c.id === cardId);
  const meta = cardMeta[faceKind] || {};
  const names = card?.names || [];
  const max = NAME_MAX[faceKind] || 0;
  tag.innerHTML = `<div class="dc-name">${esc(meta.name || faceKind)}</div>` +
    (names.length ? `<div class="dc-geesenames">${names.map((n) => esc(n)).join(' · ')}</div>` : '');
  if (max > 0 && names.length < max) {
    const b = document.createElement('button');
    b.className = 'btn btn-primary dc-btn';
    b.textContent = names.length ? 'Add a name' : (max > 1 ? 'Name your geese' : 'Name this goose');
    b.onclick = () => {
      playSound('click');
      hooks.pause();                       // freeze the fly-out while naming
      openNameModal(cardId, () => hooks.resume());
    };
    tag.appendChild(b);
  }
  $('flyLayer').appendChild(tag);   // fixed layer → caption stays viewport-centered
  return tag;
}

function slamOverlay() {
  const card = document.querySelector('.overlay-card');
  if (!card) return;
  card.style.animation = 'none'; void card.offsetWidth; card.style.animation = '';
}

// ---- center play area: idle status + dramatic event flashes ----
let laneBusy = false;
function lastMove() {
  const l = view.game.log;
  for (let i = l.length - 1; i >= 0; i--) { if (!/^It's /.test(l[i].text)) return l[i].text; }
  return '';
}
function renderPlayArea() {
  if (laneBusy) return;
  const g = view.game, pa = $('playArea');
  if (g.phase === 'AWAIT_BIG_BOY' || g.phase === 'AWAIT_GET_GOOSED' || g.phase === 'AWAIT_ANNOUNCE') { pa.innerHTML = ''; return; }
  if (tradeMode && isMyTurn() && g.phase === 'PRE_DRAW') { renderTradeStage(pa); return; }
  let main, mine = false;
  if (g.phase === 'GAME_OVER') { const w = g.players.find((x) => x.id === g.winnerId); main = w ? `${w.name} wins` : 'Game over'; }
  else if (isMyTurn()) { main = 'Your move'; mine = true; }
  else { main = `Waiting for ${g.players.find((x) => x.id === g.turnPlayerId)?.name || ''}…`; }
  const last = lastMove();
  pa.innerHTML = `<div class="play-idle${mine ? ' mine' : ''}">
      <div class="pi-main">${esc(main)}</div>
      ${last ? `<div class="pi-sub">Last: ${esc(last)}</div>` : ''}
    </div>`;
}

// Trade pulls your tradeable geese into the center, big enough to pick from.
function renderTradeStage(pa) {
  const p = me();
  const total = [...tradeSel].reduce((s, id) => s + (cardMeta[p.regular.find((x) => x.id === id)?.kind]?.points || 0), 0);
  pa.innerHTML = `<div class="trade-stage">
      <div class="ts-head">Wild Goose Market</div>
      <div class="ts-sub">Tap geese worth exactly 4 points to trade for a Wild card — selected ${total}/4</div>
      <div class="ts-cards" id="tsCards"></div>
    </div>`;
  const box = pa.querySelector('#tsCards');
  if (!p.regular || !p.regular.length) { box.innerHTML = '<div class="ts-empty">No geese in your gaggle to trade.</div>'; return; }
  p.regular.forEach((c) => {
    const slot = document.createElement('div');
    slot.className = 'card-slot';
    const el = cardEl(c, true);
    el.classList.add('big');
    if (tradeSel.has(c.id)) el.classList.add('selected');
    el.onclick = () => {
      tradeSel.has(c.id) ? tradeSel.delete(c.id) : tradeSel.add(c.id);
      renderTradeStage(pa); renderControls(); renderMine();
    };
    slot.appendChild(el);
    const names = c.names || [];
    if (names.length) {
      const cap = document.createElement('div');
      cap.className = 'card-cap';
      cap.textContent = names.join(' · ');
      slot.appendChild(cap);
    }
    box.appendChild(slot);
  });
}

const EVENT_FLASH = {
  LAWN_MOWER: { kind: 'LAWN_MOWER', title: 'LAWN MOWER!', sub: (f) => `${f.actor} mowed ${f.target}` },
  GET_GOOSED: { kind: 'GET_GOOSED', title: 'GET GOOSED!', sub: (f) => `${f.actor} → ${f.target}` },
  GOOSE_GANG: { kind: 'GOOSE_GANG', title: 'GOOSE GANG!', sub: (f) => `${f.actor} blocked it` },
  ANNOUNCE:   { kind: null, title: 'BOUTA GOOSE!', sub: (f) => `${f.actor} is closing in` },
  TRADE:      { kind: null, title: 'WILD MARKET', sub: (f) => `${f.actor} traded for a Wild` },
  PENALTY:    { kind: null, title: 'GOOSED!', sub: (f) => `${f.actor} got goosed for not announcing “I'm bout to goose”` },
};
function flashEvent(f) {
  const cfg = EVENT_FLASH[f.type]; if (!cfg) return;
  const pa = $('playArea');
  const artCss = cfg.kind && hasArt(cfg.kind) ? `background-image:url(${artUrl[cfg.kind]})` : '';
  pa.innerHTML = `<div class="event-flash">
      ${cfg.kind ? `<div class="ef-card" style="${artCss}"></div>` : ''}
      <div class="ef-title">${esc(cfg.title)}</div>
      <div class="ef-sub">${esc(cfg.sub(f))}</div>
    </div>`;
  laneBusy = true;
  clearTimeout(laneTimer);
  // Hold center messages on screen ≥3s so they're easy to read.
  laneTimer = setTimeout(() => { laneBusy = false; renderPlayArea(); }, 3200);
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
  // Same messages feed both the in-game Honk Chat and the lobby chat box.
  for (const id of ['chat', 'lobbyChat']) {
    const box = $(id);
    if (!box) continue;
    const d = document.createElement('div');
    d.innerHTML = `<span class="c-from">${esc(from)}:</span> ${esc(text)}`;
    box.appendChild(d); box.scrollTop = box.scrollHeight;
  }
}

// ---- utils ----
function btn(label, cls, fn, opts = {}) {
  const b = document.createElement('button');
  b.className = 'btn ' + (cls || '');
  b.textContent = label;
  // seqClick routes the click into the sequential queue (used by Draw) so it
  // leads the click→draw→turn chain instead of overlapping it.
  b.onclick = () => { opts.seqClick ? enqueueSound('click') : playSound('click'); fn(); };
  return b;
}
function hint(text) { const s = document.createElement('div'); s.className = 'hintline'; s.textContent = text; return s; }
function msg(html) { const s = document.createElement('div'); s.className = 'overlay-msg'; s.innerHTML = html; return s; }
function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
let toastTimer;
function toast(m) { const t = $('toast'); t.textContent = m; t.classList.remove('hidden'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add('hidden'), 3000); }

initAudio();
syncSoundUI();
connect();
