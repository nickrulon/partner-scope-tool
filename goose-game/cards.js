// Data-driven card catalog. Change counts/points here and the whole game,
// decks, scoring, and UI follow. Art is resolved at render time from
// `public/cards/<kind>.png` — drop images there to replace placeholders.

export const CARD_META = {
  // --- Goose deck (regular, reshuffles) ---
  GOOSE:   { name: 'Goose',            points: 1, deck: 'goose', count: 30, color: '#6b8e23', desc: 'Worth 1 goose point.' },
  GEESE:   { name: 'Geese',            points: 2, deck: 'goose', count: 18, color: '#4f7942', desc: 'Worth 2 goose points.' },
  GEESES:  { name: 'Geeses',           points: 4, deck: 'goose', count: 10, color: '#2e5339', desc: 'Worth 4 goose points.' },
  BIG_BOY: { name: 'Big Boy',          points: 0, deck: 'goose', count: 10, color: '#7a2e2e', desc: 'Scares away all your regular geese — discard your whole regular hand (or stop it).' },

  // --- Wild Goose deck (one-time use, never reshuffles) ---
  UNGOOSABLE:     { name: 'Ungoosable Goose', points: 1, deck: 'wild', count: 15, color: '#3a6ea5', desc: 'Unflappable. Does nothing but stand thyur — 1 steady point.' },
  GOOSE_GANG:     { name: 'Goose Gang',       points: 1, deck: 'wild', count: 3,  color: '#b8860b', desc: 'Play to block a Big Boy or Get Goosed. HONK, HONK, SON!' },
  GET_GOOSED:     { name: 'Get Goosed',       points: 1, deck: 'wild', count: 3,  color: '#8b5a2b', desc: 'Only when YOU draw a Big Boy: divert it onto another player.' },
  LAWN_MOWER:     { name: 'Lawn Mower',        points: 1, deck: 'wild', count: 1,  color: '#a0522d', desc: 'On your turn, force any player to discard their whole regular hand. Unblockable.' },
  GREAT_HONKEROR: { name: 'The Great Honkeror',points: 2, deck: 'wild', count: 1,  color: '#6a0dad', desc: 'Champion bonus — worth 2 points. Held by the reigning winner.' },
};

// The Great Honkeror is set aside, never shuffled into the draw deck.
export const SET_ASIDE = new Set(['GREAT_HONKEROR']);

export const TRADE_COST = 4; // regular goose-points spent per Wild card drawn
export const WIN_SCORE = 21;
export const ANNOUNCE_AT = 17;

export function points(kind) {
  return CARD_META[kind]?.points ?? 0;
}
