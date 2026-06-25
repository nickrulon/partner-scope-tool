// Pure rules engine for Quit Goosin Around!
// No I/O, no networking — just (state, action) -> { state, error, events }.
// This is the single source of truth implementing GOOSE_GAME_DESIGN.md.

import { CARD_META, SET_ASIDE, TRADE_COST, WIN_SCORE, ANNOUNCE_AT, points } from './cards.js';

let _id = 0;
const newId = () => `c${++_id}`;

// Only the plain goose cards can be named (not Wilds / Ungoosables). The number
// of names a card can hold equals its point value: Goose 1, Geese 2, Geeses 4.
const NAMEABLE = new Set(['GOOSE', 'GEESE', 'GEESES']);
const nameSlots = (kind) => (NAMEABLE.has(kind) ? points(kind) : 0);

// Mulberry32 — small seedable RNG so tests are deterministic.
export function makeRng(seed = Date.now() >>> 0) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function buildDeck(deckName, rng) {
  const cards = [];
  for (const [kind, meta] of Object.entries(CARD_META)) {
    if (meta.deck !== deckName) continue;
    if (SET_ASIDE.has(kind)) continue; // Great Honkeror set aside
    for (let i = 0; i < meta.count; i++) cards.push({ id: newId(), kind });
  }
  return shuffle(cards, rng);
}

export function score(player) {
  let s = 0;
  for (const c of player.regular) s += points(c.kind);
  for (const c of player.wild) s += points(c.kind);
  return s;
}

// --- Game creation -------------------------------------------------------

export function createGame(players, options = {}) {
  const rng = options.rng || makeRng(options.seed);
  const state = {
    phase: 'PRE_DRAW',
    rng,
    options: { boutaGooseRule: options.boutaGooseRule !== false },
    players: players.map((p) => ({
      id: p.id,
      name: p.name,
      regular: [],
      wild: [],
      announcedBoutaGoose: false,
      connected: true,
    })),
    turnIndex: 0,           // seat whose turn it is
    pending: null,          // { type:'BIG_BOY'|'GET_GOOSED', target, origin }
    gooseDraw: buildDeck('goose', rng),
    gooseDiscard: [],
    wildDraw: buildDeck('wild', rng),
    wildDiscard: [],
    honkerorHolderId: options.honkerorHolderId || null,
    winnerId: null,
    log: [],
    fx: [],
    fxSeq: 0,
  };

  // Defending champion starts holding The Great Honkeror (+2).
  if (state.honkerorHolderId) {
    const champ = state.players.find((p) => p.id === state.honkerorHolderId);
    if (champ) champ.wild.push({ id: newId(), kind: 'GREAT_HONKEROR' });
  }

  // "Silliest goose goes first": random seat unless caller fixes it.
  state.turnIndex = options.firstSeat != null
    ? options.firstSeat
    : Math.floor(rng() * state.players.length);

  logMsg(state, `Game on! ${state.players[state.turnIndex].name} is the silliest goose — they go first.`);
  return state;
}

function logMsg(state, text, kind = 'info', to = null) {
  // `to` = a playerId means the entry is private to that player (hidden from
  // everyone else in redaction). null = public.
  state.log.push({ t: Date.now(), text, kind, to });
  if (state.log.length > 200) state.log.shift();
}

// Effects channel: a rolling buffer of discrete events the client uses to
// trigger sounds, the Big Boy overlay, and animations. Each has a unique id;
// clients play any id they haven't seen yet.
function emitFx(state, type, extra = {}) {
  state.fxSeq = (state.fxSeq || 0) + 1;
  state.fx.push({ id: state.fxSeq, type, ...extra });
  if (state.fx.length > 16) state.fx.shift();
}

// "Bouta goose" is public and strategic, but auto-revokes if the player's
// score falls back below the announce threshold (e.g. Big Boy wiped them).
function syncAnnounce(state, player) {
  if (player.announcedBoutaGoose && score(player) < ANNOUNCE_AT) {
    player.announcedBoutaGoose = false;
    logMsg(state, `${player.name} dropped below ${ANNOUNCE_AT} — "bouta goose" is off. Re-deck and call it again next time.`, 'bad');
  }
}

// --- Helpers -------------------------------------------------------------

const activePlayer = (s) => s.players[s.turnIndex];
const findPlayer = (s, id) => s.players.find((p) => p.id === id);

function drawGoose(state) {
  if (state.gooseDraw.length === 0) {
    if (state.gooseDiscard.length === 0) return null; // exhausted (shouldn't happen)
    state.gooseDraw = shuffle(state.gooseDiscard, state.rng);
    state.gooseDiscard = [];
    logMsg(state, 'Goose draw pile ran dry — discard reshuffled into a fresh pile.');
  }
  return state.gooseDraw.pop();
}

function discardRegularHand(state, player, reason) {
  if (player.regular.length === 0) return;
  state.gooseDiscard.push(...player.regular);
  const n = player.regular.length;
  player.regular = [];
  logMsg(state, `${player.name} lost ${n} regular goose card(s) — ${reason}.`, 'bad');
  syncAnnounce(state, player);
}

function takeWildFromHand(player, kind) {
  const i = player.wild.findIndex((c) => c.kind === kind);
  if (i === -1) return null;
  return player.wild.splice(i, 1)[0];
}

function nextSeat(state) {
  const n = state.players.length;
  for (let step = 1; step <= n; step++) {
    const idx = (state.turnIndex + step) % n;
    if (state.players[idx].connected) return idx;
  }
  return state.turnIndex;
}

function endTurn(state) {
  state.pending = null;
  state.turnIndex = nextSeat(state);
  state.phase = 'PRE_DRAW';
  logMsg(state, `It's ${activePlayer(state).name}'s turn.`);
  emitFx(state, 'TURN', { actor: activePlayer(state).name });
}

function checkWin(state, player) {
  if (score(player) < WIN_SCORE) return false;
  if (state.options.boutaGooseRule && !player.announcedBoutaGoose) {
    // Got caught with 21 without calling it — the whole gaggle scatters.
    discardRegularHand(state, player, `hit ${WIN_SCORE} but never announced "I'm bout to goose"`);
    logMsg(state, `${player.name} got GOOSED for not announcing "I'm bout to goose" — lost their whole regular hand! No crown this time.`, 'bad');
    emitFx(state, 'PENALTY', { actor: player.name });
    return false;
  }
  state.winnerId = player.id;
  state.phase = 'GAME_OVER';
  logMsg(state, `${player.name} reached ${score(player)} and is crowned THE GREAT HONKEROR!`, 'win');
  emitFx(state, 'WIN', { actor: player.name });
  return true;
}

// --- Action dispatch -----------------------------------------------------

function err(state, msg) { return { state, error: msg }; }

export function applyAction(state, playerId, action) {
  if (state.phase === 'GAME_OVER') return err(state, 'The game is over.');
  const type = action?.type;

  // Naming geese is purely cosmetic: allowed any time on cards you own, and it
  // never touches the turn, phase, or score. Names ride on the card object, so
  // they survive discard → reshuffle and travel to whoever next draws the card.
  if (type === 'NAME_GOOSE') return nameGoose(state, playerId, action);

  // Response phase: only the pending target may act.
  if (state.phase === 'AWAIT_BIG_BOY' || state.phase === 'AWAIT_GET_GOOSED') {
    if (type !== 'RESPOND') return err(state, 'Waiting for a response to the threat.');
    if (playerId !== state.pending.target) return err(state, 'Not your threat to answer.');
    return respond(state, action);
  }

  // PRE_DRAW phase: only the active player may act.
  if (playerId !== activePlayer(state).id) return err(state, "It's not your turn.");

  switch (type) {
    case 'ANNOUNCE_GOOSE': return announce(state);
    case 'TRADE':          return trade(state, action);
    case 'PLAY_LAWN_MOWER':return lawnMower(state, action);
    case 'DRAW':           return draw(state);
    default:               return err(state, `Unknown action: ${type}`);
  }
}

function nameGoose(state, playerId, action) {
  const p = findPlayer(state, playerId);
  if (!p) return err(state, 'Unknown goose.');
  const card = p.regular.find((c) => c.id === action.cardId);
  if (!card) return err(state, 'You can only name geese in your own gaggle.');
  const max = nameSlots(card.kind);
  if (max === 0) return err(state, 'That card can\'t be named.');
  const names = (action.names || [])
    .map((n) => String(n).trim().slice(0, 24))
    .filter(Boolean)
    .slice(0, max);
  card.names = names;
  if (names.length) {
    logMsg(state, `You named your ${CARD_META[card.kind].name}: ${names.join(', ')}.`, 'good', p.id);
  }
  return { state };
}

function announce(state) {
  const p = activePlayer(state);
  if (score(p) < ANNOUNCE_AT) return err(state, `Premature! Announce at ${ANNOUNCE_AT}+ (lol learn to count).`);
  if (p.announcedBoutaGoose) return err(state, 'Already announced.');
  p.announcedBoutaGoose = true;
  logMsg(state, `${p.name} announced: "I'M BOUTA GOOSE!"`, 'good');
  emitFx(state, 'ANNOUNCE', { actor: p.name });
  return { state };
}

function trade(state, action) {
  const p = activePlayer(state);
  if (state.wildDraw.length === 0) return err(state, 'The Wild Goose Market is empty.');
  const ids = action.cardIds || [];
  const chosen = [];
  for (const id of ids) {
    const c = p.regular.find((x) => x.id === id);
    if (!c) return err(state, 'You can only trade regular geese you hold.');
    chosen.push(c);
  }
  const total = chosen.reduce((s, c) => s + points(c.kind), 0);
  if (total !== TRADE_COST) return err(state, `Trade must total exactly ${TRADE_COST} goose points (you offered ${total}).`);
  // Spend the cards.
  const idset = new Set(ids);
  p.regular = p.regular.filter((c) => !idset.has(c.id));
  state.gooseDiscard.push(...chosen);
  // Draw a Wild.
  const wild = state.wildDraw.pop();
  p.wild.push(wild);
  logMsg(state, `${p.name} traded ${TRADE_COST} points in the Wild Goose Market for a Wild card.`, 'good');
  emitFx(state, 'TRADE', { actor: p.name });
  syncAnnounce(state, p);
  return { state, drewWild: wild.kind };
}

function lawnMower(state, action) {
  const p = activePlayer(state);
  const card = takeWildFromHand(p, 'LAWN_MOWER');
  if (!card) return err(state, "You don't have a Lawn Mower.");
  const target = findPlayer(state, action.targetId);
  if (!target) return err(state, 'Pick a valid target.');
  state.wildDiscard.push(card);
  logMsg(state, `${p.name} fired up the LAWN MOWER at ${target.name}! Unblockable!`, 'bad');
  emitFx(state, 'LAWN_MOWER', { actor: p.name, target: target.name });
  discardRegularHand(state, target, 'mowed down (unblockable)');
  return { state };
}

function draw(state) {
  const p = activePlayer(state);
  const card = drawGoose(state);
  if (!card) return err(state, 'No goose cards left to draw.');

  if (card.kind === 'BIG_BOY') {
    state.bigBoyCard = card;
    state.pending = { type: 'BIG_BOY', target: p.id, origin: p.id };
    state.phase = 'AWAIT_BIG_BOY';
    // Public — the one draw everyone is allowed to see.
    logMsg(state, `${p.name} drew BIG BOY! Everybody: "QUIT GOOSIN' AROUND, YA GOOSE!"`, 'bad');
    emitFx(state, 'BIG_BOY', { actor: p.name });
    return { state, bigBoy: true };
  }

  p.regular.push(card);
  // Private — opponents never learn what you drew (log AND sound stay private,
  // so the per-card draw sound can't reveal the card to the table).
  logMsg(state, `You drew a ${CARD_META[card.kind].name}.`, 'info', p.id);
  emitFx(state, 'DRAW', { actor: p.name, actorId: p.id, kind: card.kind, cardId: card.id, to: p.id });
  // Public, card-less — lets opponents animate a facedown mystery draw.
  emitFx(state, 'DRAW_HIDDEN', { actor: p.name, actorId: p.id });
  if (checkWin(state, p)) return { state };
  endTurn(state);
  return { state };
}

function respond(state, action) {
  const pending = state.pending;
  const target = findPlayer(state, pending.target);
  const resp = action.response;

  if (resp === 'goose_gang') {
    const card = takeWildFromHand(target, 'GOOSE_GANG');
    if (!card) return err(state, "You don't have a Goose Gang.");
    state.wildDiscard.push(card);
    logMsg(state, `${target.name} threw down the GOOSE GANG — blocked! Honk honk, son!`, 'good');
    emitFx(state, 'GOOSE_GANG', { actor: target.name });
    finishThreat(state);
    return { state };
  }

  if (resp === 'get_goosed') {
    // From BIG_BOY: only the original drawer may Get Goosed.
    if (state.phase === 'AWAIT_BIG_BOY' && pending.target !== pending.origin) {
      return err(state, 'Get Goosed can only be played by whoever drew the Big Boy.');
    }
    const card = takeWildFromHand(target, 'GET_GOOSED');
    if (!card) return err(state, "You don't have a Get Goosed.");
    const next = findPlayer(state, action.targetId);
    if (!next) return err(state, 'Pick a player to divert Big Boy onto.');
    if (next.id === target.id) return err(state, "You can't Get Goosed yourself.");
    state.wildDiscard.push(card);
    state.pending = { type: 'GET_GOOSED', target: next.id, origin: pending.origin };
    state.phase = 'AWAIT_GET_GOOSED';
    logMsg(state, `${target.name} yelled "GET GOOSED!" and sent Big Boy at ${next.name}!`, 'bad');
    emitFx(state, 'GET_GOOSED', { actor: target.name, target: next.name });
    return { state };
  }

  if (resp === 'absorb') {
    const had = target.regular.length;
    discardRegularHand(state, target, 'Big Boy scared the geese off');
    if (had === 0) logMsg(state, `${target.name} took the hit from Big Boy (no geese to lose).`, 'bad');
    emitFx(state, 'ABSORB', { actor: target.name });
    finishThreat(state);
    return { state };
  }

  return err(state, `Unknown response: ${resp}`);
}

function finishThreat(state) {
  // Big Boy card returns to the goose discard, then the original turn ends.
  if (state.bigBoyCard) {
    state.gooseDiscard.push(state.bigBoyCard);
    state.bigBoyCard = null;
  }
  // Restore turn to the original drawer, then advance.
  const originIdx = state.players.findIndex((p) => p.id === state.pending.origin);
  if (originIdx !== -1) state.turnIndex = originIdx;
  endTurn(state);
}

// --- Client-facing redaction --------------------------------------------
// Hide opponents' hands; reveal only counts + score.

export function redact(state, viewerId) {
  return {
    phase: state.phase,
    turnPlayerId: state.players[state.turnIndex]?.id ?? null,
    pending: state.pending
      ? { type: state.pending.type, targetId: state.pending.target }
      : null,
    winnerId: state.winnerId,
    gooseDrawCount: state.gooseDraw.length,
    gooseDiscardCount: state.gooseDiscard.length,
    wildDrawCount: state.wildDraw.length,
    wildDiscardCount: state.wildDiscard.length,
    options: state.options,
    // Private entries (a player's own draws) are hidden from everyone else.
    log: state.log.filter((e) => !e.to || e.to === viewerId).slice(-40),
    fx: state.fx.filter((f) => !f.to || f.to === viewerId).slice(-8),
    players: state.players.map((p) => {
      const isMe = p.id === viewerId;
      return {
        id: p.id,
        name: p.name,
        connected: p.connected,
        // Only you can see your own score; opponents' points stay hidden.
        score: isMe ? score(p) : null,
        announcedBoutaGoose: p.announcedBoutaGoose,
        regularCount: p.regular.length,
        wildCount: p.wild.length,
        // Only the viewer sees their actual cards.
        regular: isMe ? p.regular : undefined,
        wild: isMe ? p.wild : undefined,
      };
    }),
  };
}
