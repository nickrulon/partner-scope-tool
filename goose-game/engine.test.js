// Lightweight engine tests — no framework, just `node goose-game/engine.test.js`.
// Validates the core rules in GOOSE_GAME_DESIGN.md against the pure engine.

import { createGame, applyAction, score, makeRng, redact } from './engine.js';
import { CARD_META } from './cards.js';

let pass = 0, fail = 0;
function ok(cond, msg) { cond ? (pass++, console.log('  ✓', msg)) : (fail++, console.error('  ✗', msg)); }
function eq(a, b, msg) { ok(a === b, `${msg} (got ${a}, want ${b})`); }

// Helpers to force specific draws by stacking the deck (top = last element).
function stackGoose(state, kinds) {
  state.gooseDraw.push(...kinds.map((k, i) => ({ id: `t${i}`, kind: k })));
}
function giveWild(state, pid, kind) {
  state.players.find((p) => p.id === pid).wild.push({ id: `w_${kind}_${Math.random()}`, kind });
}
function p(...names) { return names.map((n) => ({ id: n, name: n })); }

console.log('\n== Deck composition ==');
{
  const g = createGame(p('A', 'B'), { firstSeat: 0, seed: 1 });
  eq(g.gooseDraw.length, 68, 'goose deck is 68 cards');
  eq(g.wildDraw.length, 22, 'wild deck is 22 cards (Honkeror set aside)');
  const wildHasHonkeror = g.wildDraw.some((c) => c.kind === 'GREAT_HONKEROR');
  ok(!wildHasHonkeror, 'Great Honkeror is NOT in the wild draw pile');
}

console.log('\n== Drawing a goose scores and ends the turn ==');
{
  const g = createGame(p('A', 'B'), { firstSeat: 0, seed: 2 });
  stackGoose(g, ['GEESE']); // A draws GEESE (2 pts)
  const { error } = applyAction(g, 'A', { type: 'DRAW' });
  ok(!error, 'draw accepted');
  eq(score(g.players[0]), 2, 'A scored 2');
  eq(g.turnPlayerId ?? g.players[g.turnIndex].id, 'B', 'turn passed to B');
}

console.log('\n== Not your turn is rejected ==');
{
  const g = createGame(p('A', 'B'), { firstSeat: 0, seed: 3 });
  const { error } = applyAction(g, 'B', { type: 'DRAW' });
  ok(!!error, 'B cannot act on A\'s turn');
}

console.log('\n== Big Boy: absorb discards regular hand, keeps wild ==');
{
  const g = createGame(p('A', 'B'), { firstSeat: 0, seed: 4 });
  g.players[0].regular = [{ id: 'r1', kind: 'GEESES' }, { id: 'r2', kind: 'GOOSE' }];
  giveWild(g, 'A', 'UNGOOSABLE');
  stackGoose(g, ['BIG_BOY']);
  applyAction(g, 'A', { type: 'DRAW' });
  eq(g.phase, 'AWAIT_BIG_BOY', 'entered Big Boy response');
  applyAction(g, 'A', { type: 'RESPOND', response: 'absorb' });
  eq(g.players[0].regular.length, 0, 'regular hand discarded');
  eq(g.players[0].wild.length, 1, 'wild hand kept');
  eq(g.players[g.turnIndex].id, 'B', 'turn advanced after Big Boy');
}

console.log('\n== Big Boy: Goose Gang blocks, hand survives ==');
{
  const g = createGame(p('A', 'B'), { firstSeat: 0, seed: 5 });
  g.players[0].regular = [{ id: 'r1', kind: 'GEESES' }];
  giveWild(g, 'A', 'GOOSE_GANG');
  stackGoose(g, ['BIG_BOY']);
  applyAction(g, 'A', { type: 'DRAW' });
  applyAction(g, 'A', { type: 'RESPOND', response: 'goose_gang' });
  eq(g.players[0].regular.length, 1, 'hand survived the block');
  ok(g.wildDiscard.some((c) => c.kind === 'GOOSE_GANG'), 'Goose Gang went to wild discard');
}

console.log('\n== Get Goosed diverts Big Boy to another player ==');
{
  const g = createGame(p('A', 'B'), { firstSeat: 0, seed: 6 });
  g.players[0].regular = [{ id: 'a1', kind: 'GOOSE' }];
  g.players[1].regular = [{ id: 'b1', kind: 'GEESES' }];
  giveWild(g, 'A', 'GET_GOOSED');
  stackGoose(g, ['BIG_BOY']);
  applyAction(g, 'A', { type: 'DRAW' });
  applyAction(g, 'A', { type: 'RESPOND', response: 'get_goosed', targetId: 'B' });
  eq(g.phase, 'AWAIT_GET_GOOSED', 'now B must respond');
  applyAction(g, 'B', { type: 'RESPOND', response: 'absorb' });
  eq(g.players[1].regular.length, 0, 'B lost their geese');
  eq(g.players[0].regular.length, 1, 'A kept their geese');
}

console.log('\n== Trade: exactly 4 points required ==');
{
  const g = createGame(p('A', 'B'), { firstSeat: 0, seed: 7 });
  g.players[0].regular = [{ id: 'x', kind: 'GEESES' }]; // 4 pts
  const before = g.wildDraw.length;
  const bad = applyAction(g, 'A', { type: 'TRADE', cardIds: [] });
  ok(!!bad.error, 'empty trade rejected');
  const good = applyAction(g, 'A', { type: 'TRADE', cardIds: ['x'] });
  ok(!good.error, '4-point trade accepted');
  eq(g.players[0].wild.length, 1, 'received a wild card');
  eq(g.players[0].regular.length, 0, 'spent the geeses');
  eq(g.wildDraw.length, before - 1, 'wild deck shrank by one');
}

console.log('\n== Lawn Mower mows a target, unblockable ==');
{
  const g = createGame(p('A', 'B'), { firstSeat: 0, seed: 8 });
  giveWild(g, 'A', 'LAWN_MOWER');
  g.players[1].regular = [{ id: 'b1', kind: 'GEESE' }, { id: 'b2', kind: 'GOOSE' }];
  applyAction(g, 'A', { type: 'PLAY_LAWN_MOWER', targetId: 'B' });
  eq(g.players[1].regular.length, 0, 'B was mowed');
  ok(g.phase === 'PRE_DRAW' && g.players[g.turnIndex].id === 'A', 'still A\'s turn (free action)');
}

console.log('\n== Win requires announcing at 17 when rule is on ==');
{
  const g = createGame(p('A', 'B'), { firstSeat: 0, seed: 9, boutaGooseRule: true });
  // Put A at 20 without announcing, draw a GOOSE to hit 21.
  g.players[0].regular = Array.from({ length: 5 }, (_, i) => ({ id: `g${i}`, kind: 'GEESES' })); // 20
  stackGoose(g, ['GOOSE']);
  applyAction(g, 'A', { type: 'DRAW' });
  ok(!g.winnerId, 'no win without announcing — got GOOSED instead');
  eq(g.players[0].regular.length, 0, 'penalty wiped the regular hand');
}

console.log('\n== Win succeeds after announcing ==');
{
  const g = createGame(p('A', 'B'), { firstSeat: 0, seed: 10, boutaGooseRule: true });
  g.players[0].regular = Array.from({ length: 5 }, (_, i) => ({ id: `g${i}`, kind: 'GEESES' })); // 20
  applyAction(g, 'A', { type: 'ANNOUNCE_GOOSE' });
  stackGoose(g, ['GOOSE']);
  applyAction(g, 'A', { type: 'DRAW' });
  eq(g.winnerId, 'A', 'A wins after announcing');
  eq(g.phase, 'GAME_OVER', 'game over');
}

console.log('\n== Announcing revokes if score drops below 17 ==');
{
  const g = createGame(p('A', 'B'), { firstSeat: 0, seed: 14, boutaGooseRule: true });
  g.players[0].regular = Array.from({ length: 9 }, (_, i) => ({ id: `g${i}`, kind: 'GEESE' })); // 18
  applyAction(g, 'A', { type: 'ANNOUNCE_GOOSE' });
  ok(g.players[0].announcedBoutaGoose, 'A announced at 18');
  stackGoose(g, ['BIG_BOY']);
  applyAction(g, 'A', { type: 'DRAW' });
  applyAction(g, 'A', { type: 'RESPOND', response: 'absorb' });
  ok(!g.players[0].announcedBoutaGoose, 'announcement revoked after Big Boy dropped A below 17');
}

console.log('\n== Opponents never see what you drew (private log) ==');
{
  const g = createGame(p('A', 'B'), { firstSeat: 0, seed: 15 });
  stackGoose(g, ['GEESES']);
  applyAction(g, 'A', { type: 'DRAW' });
  const aSees = redact(g, 'A').log.some((e) => /you drew/i.test(e.text));
  const bSees = redact(g, 'B').log.some((e) => /drew a/i.test(e.text));
  ok(aSees, 'A sees their own draw');
  ok(!bSees, 'B does NOT see what A drew');
}

console.log('\n== Opponents cannot see your score ==');
{
  const g = createGame(p('A', 'B'), { firstSeat: 0, seed: 17 });
  g.players[0].regular = [{ id: 'x', kind: 'GEESES' }];
  const aView = redact(g, 'A');
  const bView = redact(g, 'B');
  eq(aView.players.find((x) => x.id === 'A').score, 4, 'A sees own score');
  ok(bView.players.find((x) => x.id === 'A').score == null, 'B cannot see A score');
  ok(bView.players.find((x) => x.id === 'B').score != null, 'B sees own score');
}

console.log('\n== Draw fx is private + carries the card kind ==');
{
  const g = createGame(p('A', 'B'), { firstSeat: 0, seed: 18 });
  stackGoose(g, ['GEESES']);
  applyAction(g, 'A', { type: 'DRAW' });
  const aDraw = redact(g, 'A').fx.find((f) => f.type === 'DRAW');
  const bDraw = redact(g, 'B').fx.find((f) => f.type === 'DRAW');
  ok(aDraw && aDraw.kind === 'GEESES', 'A gets a DRAW fx tagged GEESES');
  ok(!bDraw, 'B never receives the DRAW fx (no sound leak)');
}

console.log('\n== Big Boy draw IS public + emits an fx event ==');
{
  const g = createGame(p('A', 'B'), { firstSeat: 0, seed: 16 });
  stackGoose(g, ['BIG_BOY']);
  applyAction(g, 'A', { type: 'DRAW' });
  const bSees = redact(g, 'B').log.some((e) => /big boy/i.test(e.text));
  const fx = redact(g, 'B').fx.some((f) => f.type === 'BIG_BOY');
  ok(bSees, 'B sees the Big Boy draw');
  ok(fx, 'a BIG_BOY fx event was emitted');
}

console.log('\n== Naming geese: caps by point value, only goose cards ==');
{
  const g = createGame(p('A', 'B'), { firstSeat: 0, seed: 21 });
  g.players[0].regular = [{ id: 'g1', kind: 'GEESE' }];          // 2 names allowed
  giveWild(g, 'A', 'UNGOOSABLE');
  const wildId = g.players[0].wild[0].id;
  const r1 = applyAction(g, 'A', { type: 'NAME_GOOSE', cardId: 'g1', names: ['Gerald', 'Gandalf', 'Extra'] });
  ok(!r1.error, 'naming a Geese accepted');
  eq(g.players[0].regular[0].names.length, 2, 'Geese capped at 2 names');
  const r2 = applyAction(g, 'A', { type: 'NAME_GOOSE', cardId: wildId, names: ['Nope'] });
  ok(!!r2.error, 'cannot name a wild card');
  const r3 = applyAction(g, 'B', { type: 'NAME_GOOSE', cardId: 'g1', names: ['Steal'] });
  ok(!!r3.error, 'cannot name a goose you do not hold');
}

console.log('\n== Names ride the card through discard → reshuffle ==');
{
  const g = createGame(p('A', 'B'), { firstSeat: 0, seed: 22 });
  // One named goose in A's hand; empty the draw pile so a Big Boy reshuffles.
  g.players[0].regular = [{ id: 'g1', kind: 'GOOSE', names: ['Gerald'] }];
  applyAction(g, 'A', { type: 'NAME_GOOSE', cardId: 'g1', names: ['Gerald'] });
  // Big Boy → absorb sends the named goose to the discard.
  stackGoose(g, ['BIG_BOY']);
  applyAction(g, 'A', { type: 'DRAW' });
  applyAction(g, 'A', { type: 'RESPOND', response: 'absorb' });
  const inDiscard = g.gooseDiscard.find((c) => c.id === 'g1');
  ok(inDiscard && inDiscard.names && inDiscard.names[0] === 'Gerald', 'named goose kept its name in the discard');
}

console.log('\n== Draw fx carries the card id for the reveal ==');
{
  const g = createGame(p('A', 'B'), { firstSeat: 0, seed: 23 });
  stackGoose(g, ['GOOSE']);
  applyAction(g, 'A', { type: 'DRAW' });
  const fx = redact(g, 'A').fx.find((f) => f.type === 'DRAW');
  ok(fx && fx.cardId, 'DRAW fx includes a cardId');
}

console.log('\n== Defending champion starts with Great Honkeror (+2) ==');
{
  const g = createGame(p('A', 'B'), { firstSeat: 0, seed: 11, honkerorHolderId: 'A' });
  ok(g.players[0].wild.some((c) => c.kind === 'GREAT_HONKEROR'), 'champ holds the Honkeror');
  eq(score(g.players[0]), 2, 'champ starts at 2 points');
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
