// Run with: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, addPlayer, startGame, startRound, applyAction, viewFor, CARDS, TOKENS_TO_WIN } from '../js/engine.js';

function seeded(seed) {
  return () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
}

function newGame(n, seed = 1) {
  const g = createGame();
  for (let i = 0; i < n; i++) addPlayer(g, `p${i}`, `P${i}`);
  startGame(g, seeded(seed));
  return g;
}

// Replace dealt hands/deck with a scripted setup.
function rig(g, hands, deck = [1, 1, 1, 1]) {
  let id = 100;
  g.players.forEach((p, i) => { p.hand = hands[i].map((rank) => ({ id: id++, rank })); p.alive = true; p.protected = false; p.discards = []; });
  g.deck = deck.map((rank) => ({ id: id++, rank }));
  g.turn = 0; g.phase = 'turn';
}
const cid = (g, i, rank) => g.players[i].hand.find((c) => c.rank === rank).id;

test('deck has 21 cards and all ranks', () => {
  assert.equal(CARDS.reduce((s, c) => s + c.count, 0), 21);
  const g = newGame(4);
  const total = g.deck.length + 1 + g.players.reduce((s, p) => s + p.hand.length, 0);
  assert.equal(total, 21);
  assert.equal(g.players.filter((p) => p.hand.length === 2).length, 1, 'current player drew');
});

test('2-player removes 3 face up', () => {
  const g = newGame(2);
  assert.equal(g.faceUp.length, 3);
  assert.equal(g.deck.length, 21 - 1 - 3 - 2 - 1);
});

test('Guard eliminates on correct guess, cannot name Guard', () => {
  const g = newGame(3);
  rig(g, [[1, 4], [7], [2]]);
  assert.equal(applyAction(g, 'p0', { type: 'play', cardId: cid(g, 0, 1), target: 'p1', guess: 1 }).ok, false);
  assert.ok(applyAction(g, 'p0', { type: 'play', cardId: cid(g, 0, 1), target: 'p1', guess: 7 }).ok);
  assert.equal(g.players[1].alive, false);
  assert.equal(g.players[2].id, g.players[g.turn].id, 'turn skips eliminated player');
});

test('Handmaid blocks targeting; Guard with no targets has no effect', () => {
  const g = createGame(); addPlayer(g, 'p0', 'A'); addPlayer(g, 'p1', 'B'); startGame(g, seeded(3));
  rig(g, [[4, 1], [1]], [2, 2, 2, 2]);
  applyAction(g, 'p0', { type: 'play', cardId: cid(g, 0, 4) });
  assert.equal(g.players[0].protected, true);
  // p1 plays Guard: no valid target
  const guard = g.players[1].hand.find((c) => c.rank === 1);
  assert.deepEqual(viewFor(g, 'p1').hand.find((c) => c.id === guard.id).targets, []);
  assert.ok(applyAction(g, 'p1', { type: 'play', cardId: guard.id }).ok);
  assert.equal(g.players[0].alive, true);
  assert.equal(g.players[0].protected, false, 'protection ends at start of own turn');
});

test('Countess must be played with King or Prince', () => {
  const g = newGame(3);
  rig(g, [[8, 7], [1], [2]]);
  assert.equal(applyAction(g, 'p0', { type: 'play', cardId: cid(g, 0, 7), target: 'p1' }).ok, false);
  assert.ok(applyAction(g, 'p0', { type: 'play', cardId: cid(g, 0, 8) }).ok);
});

test('Baron: lower card is out, private messages to both', () => {
  const g = newGame(3);
  rig(g, [[3, 6], [2], [5]]);
  applyAction(g, 'p0', { type: 'play', cardId: cid(g, 0, 3), target: 'p1' });
  assert.equal(g.players[1].alive, false);
  assert.ok(viewFor(g, 'p0').log.some((e) => e.text.includes('⚖️')));
  assert.ok(viewFor(g, 'p1').log.some((e) => e.text.includes('⚖️')));
  assert.ok(!viewFor(g, 'p2').log.some((e) => e.text.includes('⚖️')));
});

test('Priest reveal is private', () => {
  const g = newGame(3);
  rig(g, [[2, 1], [9], [5]]);
  applyAction(g, 'p0', { type: 'play', cardId: cid(g, 0, 2), target: 'p1' });
  assert.ok(viewFor(g, 'p0').log.some((e) => e.text.includes('Princess')));
  assert.ok(!viewFor(g, 'p2').log.some((e) => e.text.includes('Princess')));
});

test('Prince makes Princess holder discard and lose; empty deck draws set-aside', () => {
  const g = newGame(3);
  rig(g, [[5, 1], [9], [2]]);
  applyAction(g, 'p0', { type: 'play', cardId: cid(g, 0, 5), target: 'p1' });
  assert.equal(g.players[1].alive, false);

  const h = newGame(3);
  rig(h, [[5, 1], [3], [2]], [4]);
  h.setAside = { id: 999, rank: 7 };
  // p0 plays Prince on self with 1 card in deck; turn ends -> deck 0 -> round ends.
  applyAction(h, 'p0', { type: 'play', cardId: cid(h, 0, 5), target: 'p0' });
  assert.equal(h.players[0].hand[0].rank, 4);
  assert.equal(h.phase, 'roundOver', 'deck empty ends the round');

  const k = newGame(3);
  rig(k, [[5, 1], [3], [2]], []);
  k.setAside = { id: 999, rank: 7 };
  applyAction(k, 'p0', { type: 'play', cardId: cid(k, 0, 5), target: 'p1' });
  assert.equal(k.players[1].hand[0].rank, 7, 'drew the set-aside card');
});

test('Chancellor keeps one, returns two to bottom', () => {
  const g = newGame(3);
  rig(g, [[6, 1], [2], [3]], [4, 5, 7]);
  applyAction(g, 'p0', { type: 'play', cardId: cid(g, 0, 6) });
  assert.equal(g.phase, 'chancellor');
  assert.equal(g.players[0].hand.length, 3);
  const keep = cid(g, 0, 7);
  const rest = g.players[0].hand.filter((c) => c.id !== keep).map((c) => c.id);
  assert.ok(applyAction(g, 'p0', { type: 'chancellor', keepId: keep, bottom: rest }).ok);
  assert.equal(g.players[0].hand[0].rank, 7);
  assert.equal(g.deck[0].id, rest[0], 'first chosen goes to very bottom');
  assert.equal(g.phase, 'turn');
});

test('King swaps hands', () => {
  const g = newGame(3);
  rig(g, [[7, 2], [9], [3]]);
  applyAction(g, 'p0', { type: 'play', cardId: cid(g, 0, 7), target: 'p1' });
  assert.equal(g.players[0].hand[0].rank, 9);
  assert.equal(g.players[1].hand[0].rank, 2);
});

test('Playing Princess eliminates you', () => {
  const g = newGame(3);
  rig(g, [[9, 2], [1], [3]]);
  applyAction(g, 'p0', { type: 'play', cardId: cid(g, 0, 9) });
  assert.equal(g.players[0].alive, false);
});

test('Spy bonus goes to sole surviving Spy player', () => {
  const g = newGame(3);
  rig(g, [[0, 3], [1], [2]], []); // empty deck -> round ends after p0's turn
  applyAction(g, 'p0', { type: 'play', cardId: cid(g, 0, 0) });
  assert.equal(g.phase, 'roundOver');
  // p0 holds Baron (3) + Spy bonus; p0 also highest -> 2 tokens
  assert.equal(g.players[0].tokens, 2);
  assert.equal(g.roundResult.spyBonus, 'p0');
});

test('Views never leak other hands mid-round', () => {
  const g = newGame(4, 7);
  const v = viewFor(g, 'p1');
  const json = JSON.stringify(v);
  assert.equal(v.hand.length, g.players[1].hand.length);
  assert.ok(!('hand' in v.players[0]));
  assert.equal(v.roundResult, null);
  assert.ok(!json.includes('"deck":'));
});

test('Random full games always finish with valid state (fuzz)', () => {
  for (let seed = 1; seed <= 400; seed++) {
    const n = 2 + (seed % 5);
    const rng = seeded(seed * 97);
    const g = newGame(n, seed);
    let steps = 0;
    while (g.phase !== 'gameOver') {
      assert.ok(steps++ < 5000, 'game did not terminate');
      if (g.phase === 'roundOver') { startRound(g, rng); continue; }
      const p = g.players[g.turn];
      const v = viewFor(g, p.id);
      if (g.phase === 'chancellor') {
        const keep = v.hand[Math.floor(rng() * v.hand.length)].id;
        const r = applyAction(g, p.id, { type: 'chancellor', keepId: keep, bottom: v.hand.filter((c) => c.id !== keep).map((c) => c.id) });
        assert.ok(r.ok, r.error);
        continue;
      }
      const playable = v.hand.filter((c) => !c.blocked);
      assert.ok(playable.length > 0);
      const c = playable[Math.floor(rng() * playable.length)];
      const target = c.targets.length ? c.targets[Math.floor(rng() * c.targets.length)] : undefined;
      const guesses = [0, 2, 3, 4, 5, 6, 7, 8, 9];
      const r = applyAction(g, p.id, { type: 'play', cardId: c.id, target, guess: guesses[Math.floor(rng() * 9)] });
      assert.ok(r.ok, r.error);
      // invariants: card conservation
      if (g.phase === 'turn' || g.phase === 'chancellor') {
        const count = g.deck.length + (g.setAside ? 1 : 0) + g.faceUp.length
          + g.players.reduce((s, q) => s + q.hand.length + q.discards.length, 0);
        assert.equal(count, 21);
      }
    }
    const need = TOKENS_TO_WIN[n];
    assert.ok(g.winnerIds.length >= 1);
    g.winnerIds.forEach((id) => assert.ok(g.players.find((q) => q.id === id).tokens >= need));
  }
});
