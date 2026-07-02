// Pure rules engine for Quit Goosin Around!
// No I/O, no networking — just (state, action) -> { state, error, events }.
// This is the single source of truth implementing GOOSE_GAME_DESIGN.md.

import { CARD_META, SET_ASIDE, TRADE_COST, WIN_SCORE, ANNOUNCE_AT, points } from './cards.js';

let _id = 0;
const newId = () => `c${++_id}`;

// Every goose can be named — regular geese AND wild geese (not Big Boy, the
// villain). Name slots = point value (Goose 1, Geese 2, Geeses 4), EXCEPT the
// Great Honkeror, who is one goose worth 2 points but only gets one name.
const NAMEABLE = new Set([
  'GOOSE', 'GEESE', 'GEESES',
  'UNGOOSABLE', 'GOOSE_GANG', 'GET_GOOSED', 'LAWN_MOWER', 'GREAT_HONKEROR',
]);
const nameSlots = (kind) => {
  if (!NAMEABLE.has(kind)) return 0;
  if (kind === 'GREAT_HONKEROR') return 1;   // one goose, one name (still worth 2 pts)
  return points(kind);
};

// --- Doodles ---------------------------------------------------------------
// A doodle is a list of crayon strokes stored ON the card object — like names,
// it survives discard → reshuffle and travels to whoever draws the card next.
// Format: [{ c: 0..6 (palette index), w: 0..2 (weight), p: [x,y,x,y,...] }]
// with coords as ints 0..1000 normalized to the card face. Vector (not
// raster) so it renders crisp at every card size and stays small on the wire.
const DOODLE_MAX_STROKES = 64;
const DOODLE_MAX_POINTS = 1500;   // total across all strokes (~12KB JSON worst case)

function cleanDoodle(input) {
  if (!Array.isArray(input)) return null;
  const out = [];
  let pts = 0;
  for (const s of input.slice(0, DOODLE_MAX_STROKES)) {
    if (!s || !Array.isArray(s.p)) continue;
    const c = Math.min(6, Math.max(0, s.c | 0));
    const w = Math.min(2, Math.max(0, s.w | 0));
    const p = [];
    for (let i = 0; i + 1 < s.p.length && pts < DOODLE_MAX_POINTS; i += 2) {
      const x = Math.round(+s.p[i]), y = Math.round(+s.p[i + 1]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      p.push(Math.min(1000, Math.max(0, x)), Math.min(1000, Math.max(0, y)));
      pts++;
    }
    if (p.length >= 4) out.push({ c, w, p });
  }
  return out.length ? out : null;
}

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

// Gather every personalized goose (from every pile + hand) as
// {kind, names, doodle} — used to carry names AND doodles from a finished game
// into the next one.
export function collectNames(state) {
  const out = [];
  const scan = (arr) => {
    for (const c of arr || []) {
      const named = NAMEABLE.has(c.kind) && Array.isArray(c.names) && c.names.length;
      const doodled = Array.isArray(c.doodle) && c.doodle.length;
      if (named || doodled) {
        out.push({
          kind: c.kind,
          names: named ? c.names.slice() : [],
          doodle: doodled ? c.doodle : null,
        });
      }
    }
  };
  for (const p of state.players) { scan(p.regular); scan(p.wild); }
  scan(state.gooseDraw);
  scan(state.gooseDiscard);
  if (state.bigBoyCard) scan([state.bigBoyCard]);
  return out;
}

// Stamp carried-over personalizations onto fresh, untouched cards of the same
// kind, in whichever deck holds that kind (goose deck or wild deck).
function applyCarriedNames(decks, carry) {
  if (!Array.isArray(carry)) return;
  const all = [].concat(...decks);
  for (const entry of carry) {
    if (!entry || !CARD_META[entry.kind]) continue;
    const names = (Array.isArray(entry.names) && entry.names.length && NAMEABLE.has(entry.kind))
      ? entry.names.slice(0, nameSlots(entry.kind)) : null;
    const doodle = cleanDoodle(entry.doodle);
    if (!names && !doodle) continue;
    const card = all.find((c) => c.kind === entry.kind && !c.names && !c.doodle);
    if (!card) continue;
    if (names) card.names = names;
    if (doodle) card.doodle = doodle;
  }
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

  // Carry over geese players named last game: stamp those name-sets onto fresh
  // cards of the same kind so the named geese live on into this game's deck.
  applyCarriedNames([state.gooseDraw, state.wildDraw], options.carryNames);

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
    const p = state.players[idx];
    if (p.connected && !p.removed) return idx;
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
  // actorId lets the client pick win/lose sounds by seat id (names can collide).
  emitFx(state, 'WIN', { actor: player.name, actorId: player.id });
  return true;
}

// --- Host controls (skip / remove) --------------------------------------
// These bypass normal turn rules; the server gates them to the host. They keep
// a game moving when someone disconnects or stalls.

// opts.auto = the server skipped an away player automatically (vs. the host
// pressing skip) — only changes the log wording.
export function skipTurn(state, opts = {}) {
  if (state.phase === 'GAME_OVER') return state;
  const why = opts.auto ? 'away too long' : 'skipped by the host';
  if (state.phase === 'AWAIT_BIG_BOY' || state.phase === 'AWAIT_GET_GOOSED') {
    // Stuck on a threat response — resolve it as "take the hit" and move on.
    const target = findPlayer(state, state.pending.target);
    if (target) discardRegularHand(state, target, `their response was skipped (${why})`);
    logMsg(state, `${target ? target.name : 'A goose'}'s response was skipped (${why}).`, 'bad');
    finishThreat(state);
    return state;
  }
  logMsg(state, `${activePlayer(state).name}'s turn was skipped (${why}).`, 'bad');
  endTurn(state);
  return state;
}

// opts.left = the player chose to leave (vs. host removed them) — only changes
// wording. Either way their geese scatter back into the decks, and if fewer
// than two geese remain the game ends.
export function removePlayer(state, playerId, opts = {}) {
  const p = findPlayer(state, playerId);
  if (!p || p.removed) return state;
  // Scatter their geese back into the decks.
  if (p.regular.length) { state.gooseDiscard.push(...p.regular); p.regular = []; }
  if (p.wild.length) {
    for (const c of p.wild) {
      if (c.kind === 'GREAT_HONKEROR') state.wildDiscard.push(c); // champion bonus retires
      else state.wildDraw.push(c);
    }
    p.wild = [];
    state.wildDraw = shuffle(state.wildDraw, state.rng);
  }
  p.removed = true;
  p.connected = false;
  p.announcedBoutaGoose = false;
  logMsg(state, `${p.name} ${opts.left ? 'left the pond' : 'was removed from the pond'} — their geese scattered back into the decks.`, 'bad');
  emitFx(state, 'PLAYER_OUT', { actor: p.name, left: !!opts.left });
  if (state.phase === 'GAME_OVER') return state;
  // Keep play moving if it was their turn or they owed a response.
  if (state.phase === 'AWAIT_BIG_BOY' || state.phase === 'AWAIT_GET_GOOSED') {
    if (state.pending && state.pending.target === playerId) finishThreat(state);
  } else if (activePlayer(state).id === playerId) {
    endTurn(state);
  }
  // Not enough geese left to keep going → the game ends (no winner).
  if (state.players.filter((x) => !x.removed).length < 2) {
    state.phase = 'GAME_OVER';
    state.winnerId = null;
    state.pending = null;
    logMsg(state, 'Not enough geese left — the game has ended.', 'bad');
    emitFx(state, 'ENDED', {});
  }
  return state;
}

// --- Action dispatch -----------------------------------------------------

function err(state, msg) { return { state, error: msg }; }

export function applyAction(state, playerId, action) {
  if (state.phase === 'GAME_OVER') return err(state, 'The game is over.');
  const type = action?.type;

  // Naming and doodling are purely cosmetic: allowed any time on cards you
  // own, and they never touch the turn, phase, or score. Both ride on the card
  // object, so they survive discard → reshuffle and travel to whoever next
  // draws the card.
  if (type === 'NAME_GOOSE') return nameGoose(state, playerId, action);
  if (type === 'DOODLE_GOOSE') return doodleGoose(state, playerId, action);

  // Response phase: only the pending target may act.
  if (state.phase === 'AWAIT_BIG_BOY' || state.phase === 'AWAIT_GET_GOOSED') {
    if (type !== 'RESPOND') return err(state, 'Waiting for a response to the threat.');
    if (playerId !== state.pending.target) return err(state, 'Not your threat to answer.');
    return respond(state, action);
  }

  // Post-draw announce decision: only the active player, before their turn ends.
  if (state.phase === 'AWAIT_ANNOUNCE') {
    if (type !== 'ANNOUNCE_DECISION') return err(state, 'Decide whether to announce first.');
    if (playerId !== state.pending.target) return err(state, 'Not your call.');
    return announceDecision(state, action);
  }

  // PRE_DRAW phase: only the active player may act.
  if (playerId !== activePlayer(state).id) return err(state, "It's not your turn.");

  switch (type) {
    case 'TRADE':          return trade(state, action);
    case 'PLAY_LAWN_MOWER':return lawnMower(state, action);
    case 'DRAW':           return draw(state);
    default:               return err(state, `Unknown action: ${type}`);
  }
}

function nameGoose(state, playerId, action) {
  const p = findPlayer(state, playerId);
  if (!p) return err(state, 'Unknown goose.');
  const card = p.regular.find((c) => c.id === action.cardId)
    || p.wild.find((c) => c.id === action.cardId);   // regular AND wild geese are nameable
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

// Crayon doodles: any card in your own gaggle (regular or wild). Sending an
// empty/invalid stroke set wipes the doodle (that's the editor's "Clear").
function doodleGoose(state, playerId, action) {
  const p = findPlayer(state, playerId);
  if (!p) return err(state, 'Unknown goose.');
  const card = p.regular.find((c) => c.id === action.cardId)
    || p.wild.find((c) => c.id === action.cardId);
  if (!card) return err(state, 'You can only doodle on geese in your own gaggle.');
  const doodle = cleanDoodle(action.strokes);
  if (doodle) {
    card.doodle = doodle;
    logMsg(state, `You doodled on your ${CARD_META[card.kind].name}. It's art.`, 'good', p.id);
  } else {
    delete card.doodle;
    logMsg(state, `You wiped your ${CARD_META[card.kind].name} clean.`, 'info', p.id);
  }
  return { state };
}

// The active player's end-of-turn choice (after drawing into 17+): call it, or
// stay quiet. Either way the turn then ends.
function announceDecision(state, action) {
  const p = activePlayer(state);
  if (action.announce) {
    p.announcedBoutaGoose = true;
    logMsg(state, `${p.name} announced: "I'M BOUTA GOOSE!"`, 'good');
    emitFx(state, 'ANNOUNCE', { actor: p.name });
  } else {
    logMsg(state, 'You kept quiet — stayin\' sneaky.', 'info', p.id);
  }
  endTurn(state);
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
  // Public: announce a trade happened (no card leak). Private: reveal the
  // actual Wild to the trader so it gets the same big center reveal as a draw.
  emitFx(state, 'TRADE', { actor: p.name });
  emitFx(state, 'TRADE_REVEAL', { actor: p.name, kind: wild.kind, cardId: wild.id, to: p.id });
  syncAnnounce(state, p);
  return { state, drewWild: wild.kind };
}

function lawnMower(state, action) {
  const p = activePlayer(state);
  // Validate the target BEFORE taking the card from the hand — erroring after
  // the splice would silently destroy the Lawn Mower.
  const target = findPlayer(state, action.targetId);
  if (!target) return err(state, 'Pick a valid target.');
  if (target.id === p.id) return err(state, "You can't mow your own gaggle.");
  if (target.removed) return err(state, "They've already left the pond — pick a goose who's still in.");
  const card = takeWildFromHand(p, 'LAWN_MOWER');
  if (!card) return err(state, "You don't have a Lawn Mower.");
  state.wildDiscard.push(card);
  logMsg(state, `${p.name} fired up the LAWN MOWER at ${target.name}! Unblockable!`, 'bad');
  emitFx(state, 'LAWN_MOWER', { actor: p.name, target: target.name });
  discardRegularHand(state, target, 'mowed down (unblockable)');
  return { state };
}

function draw(state) {
  const p = activePlayer(state);
  const card = drawGoose(state);
  if (!card) {
    // Draw + discard both empty (every card is in a hand). Drawing is the only
    // turn-ending action, so erroring here would strand the player with no
    // legal move — pass the turn instead.
    logMsg(state, `The pond is out of goose cards — ${p.name}'s turn passes.`, 'bad');
    endTurn(state);
    return { state };
  }

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
  // Reached the announce threshold this turn (but didn't win) and haven't
  // called it yet → decide NOW, before the turn passes. This is why you can't
  // announce-then-win on the same turn: you announce at the END of a turn, then
  // can win on a later one (giving everyone a chance to react in between).
  if (state.options.boutaGooseRule && score(p) >= ANNOUNCE_AT && !p.announcedBoutaGoose) {
    state.pending = { type: 'ANNOUNCE_CHOICE', target: p.id };
    state.phase = 'AWAIT_ANNOUNCE';
    logMsg(state, `You're at ${score(p)} — announce you're bouta goose?`, 'info', p.id);
    return { state };
  }
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
    // Hot potato rule: whoever Big Boy is sent at — the drawer OR a diverted
    // victim — may play their own Get Goosed to send him on. Each divert burns
    // a card (only 3 exist), so the chain always ends. You can bounce him
    // right back at whoever sent him, but never at yourself.
    // Validate the divert target BEFORE taking the card from the hand —
    // erroring after the splice would silently destroy the Get Goosed.
    const next = findPlayer(state, action.targetId);
    if (!next) return err(state, 'Pick a player to divert Big Boy onto.');
    if (next.id === target.id) return err(state, "You can't Get Goosed yourself.");
    if (next.removed) return err(state, "They've left the pond — pick a goose who's still in.");
    const card = takeWildFromHand(target, 'GET_GOOSED');
    if (!card) return err(state, "You don't have a Get Goosed.");
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
  // The announce decision is private to the deciding player — to everyone else
  // it just looks like that player's normal turn (so it doesn't leak that they
  // crossed 17).
  const hideAnnounce = state.phase === 'AWAIT_ANNOUNCE' && state.pending?.target !== viewerId;
  return {
    phase: hideAnnounce ? 'PRE_DRAW' : state.phase,
    turnPlayerId: state.players[state.turnIndex]?.id ?? null,
    pending: (state.pending && !hideAnnounce)
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
      // At game over the winner's whole hand is revealed to everyone (so the
      // table can admire the winning gaggle + the geese's names).
      const reveal = isMe || (state.phase === 'GAME_OVER' && p.id === state.winnerId);
      return {
        id: p.id,
        name: p.name,
        connected: p.connected,
        removed: !!p.removed,
        // Only you can see your own score; opponents' points stay hidden
        // (except the winner's, once the game is over).
        score: reveal ? score(p) : null,
        announcedBoutaGoose: p.announcedBoutaGoose,
        regularCount: p.regular.length,
        wildCount: p.wild.length,
        // Only the viewer sees their actual cards (plus the winner at game over).
        regular: reveal ? p.regular : undefined,
        wild: reveal ? p.wild : undefined,
      };
    }),
  };
}
