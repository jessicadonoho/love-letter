// Run with: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, addPlayer, startGame, startRound, applyAction, viewFor, leavePlayer, CARDS, TOKENS_TO_WIN } from '../js/engine.js';

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

test('Maid (1) eliminates on correct guess, cannot name Maid', () => {
  const g = newGame(3);
  rig(g, [[1, 4], [7], [2]]);
  assert.equal(applyAction(g, 'p0', { type: 'play', cardId: cid(g, 0, 1), target: 'p1', guess: 1 }).ok, false);
  assert.ok(applyAction(g, 'p0', { type: 'play', cardId: cid(g, 0, 1), target: 'p1', guess: 7 }).ok);
  assert.equal(g.players[1].alive, false);
  assert.equal(g.players[2].id, g.players[g.turn].id, 'turn skips eliminated player');
});

test('Handmaid blocks targeting; Maid with no targets has no effect', () => {
  const g = createGame(); addPlayer(g, 'p0', 'A'); addPlayer(g, 'p1', 'B'); startGame(g, seeded(3));
  rig(g, [[4, 1], [1]], [2, 2, 2, 2]);
  applyAction(g, 'p0', { type: 'play', cardId: cid(g, 0, 4) });
  assert.equal(g.players[0].protected, true);
  // p1 plays Maid: no valid target
  const guard = g.players[1].hand.find((c) => c.rank === 1);
  assert.deepEqual(viewFor(g, 'p1').hand.find((c) => c.id === guard.id).targets, []);
  assert.ok(applyAction(g, 'p1', { type: 'play', cardId: guard.id }).ok);
  assert.equal(g.players[0].alive, true);
  assert.equal(g.players[0].protected, false, 'protection ends at start of own turn');
});

for (const [rank, label] of [[7, 'King'], [5, 'Viscount'], [9, 'Princess']]) {
  test(`Countess must be played when the other card is ${label}`, () => {
    const g = newGame(3);
    rig(g, [[8, rank], [1], [2]]);
    const res = applyAction(g, 'p0', { type: 'play', cardId: cid(g, 0, rank), target: 'p1' });
    assert.equal(res.ok, false, 'engine rejects the illegal card');
    assert.match(res.error, /King, Viscount, or Princess/);
    const view = viewFor(g, 'p0').hand;
    assert.equal(view.find((c) => c.rank === rank).blocked, true);
    assert.match(view.find((c) => c.rank === rank).blockedReason, /must play the Countess/);
    assert.equal(view.find((c) => c.rank === 8).blocked, false);
    assert.ok(applyAction(g, 'p0', { type: 'play', cardId: cid(g, 0, 8) }).ok);
  });
}

test('Countess is not forced with other cards', () => {
  for (const rank of [0, 1, 2, 3, 4, 6]) {
    const g = newGame(3);
    rig(g, [[8, rank], [1], [2]]);
    assert.equal(viewFor(g, 'p0').hand.find((c) => c.rank === rank).blocked, false, `rank ${rank}`);
  }
});

test('Mercenary (3): lower card is out, private messages to both', () => {
  const g = newGame(3);
  rig(g, [[3, 6], [2], [5]]);
  applyAction(g, 'p0', { type: 'play', cardId: cid(g, 0, 3), target: 'p1' });
  assert.equal(g.players[1].alive, false);
  assert.ok(viewFor(g, 'p0').log.some((e) => e.text.includes('⚖️')));
  assert.ok(viewFor(g, 'p1').log.some((e) => e.text.includes('⚖️')));
  assert.ok(!viewFor(g, 'p2').log.some((e) => e.text.includes('⚖️')));
});

test('Assassin (2) reveal is private', () => {
  const g = newGame(3);
  rig(g, [[2, 1], [9], [5]]);
  applyAction(g, 'p0', { type: 'play', cardId: cid(g, 0, 2), target: 'p1' });
  assert.ok(viewFor(g, 'p0').log.some((e) => e.text.includes('Princess')));
  assert.ok(!viewFor(g, 'p2').log.some((e) => e.text.includes('Princess')));
});

test('Viscount (5) makes Princess holder discard and lose; empty deck draws set-aside', () => {
  const g = newGame(3);
  rig(g, [[5, 1], [9], [2]]);
  applyAction(g, 'p0', { type: 'play', cardId: cid(g, 0, 5), target: 'p1' });
  assert.equal(g.players[1].alive, false);

  const h = newGame(3);
  rig(h, [[5, 1], [3], [2]], [4]);
  h.setAside = { id: 999, rank: 7 };
  // p0 plays Viscount on self with 1 card in deck; turn ends -> deck 0 -> round ends.
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
  // p0 holds Mercenary (3) + Spy bonus; p0 also highest -> 2 tokens
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

// ---------- card-effect events ----------

const evs = (g, pid, type) => viewFor(g, pid).events.filter((e) => e.type === type);

test('Assassin (2) popup event goes only to the acting player', () => {
  const g = newGame(3);
  rig(g, [[2, 1], [7], [5]]);
  applyAction(g, 'p0', { type: 'play', cardId: cid(g, 0, 2), target: 'p1' });
  const [ev] = evs(g, 'p0', 'reveal');
  assert.equal(ev.target, 'p1');
  assert.equal(ev.name, 'P1');
  assert.equal(ev.rank, 7);
  assert.equal(evs(g, 'p1', 'reveal').length, 0);
  assert.equal(evs(g, 'p2', 'reveal').length, 0);
  assert.ok(!('to' in ev), 'recipient list is not sent to clients');
  assert.ok(!JSON.stringify(viewFor(g, 'p2')).includes('"rank":7'), 'no leak to others');
});

test('Mercenary (3) reports the winner without card values', () => {
  const g = newGame(3);
  rig(g, [[3, 2], [6], [5]]);  // p0 keeps 2, p1 has 6 -> p1 wins
  applyAction(g, 'p0', { type: 'play', cardId: cid(g, 0, 3), target: 'p1' });
  for (const pid of ['p0', 'p1', 'p2']) {
    const [ev] = evs(g, pid, 'compare');
    assert.equal(ev.winner, 'p1');
    assert.ok(!('rank' in ev) && !JSON.stringify(ev).match(/"(mine|theirs|ranks?)"/), 'no card identities');
  }
  assert.equal(evs(g, 'p2', 'eliminated')[0].player, 'p0', 'loser gets elimination feedback');

  const t = newGame(3);
  rig(t, [[3, 4], [4], [5]]);
  applyAction(t, 'p0', { type: 'play', cardId: cid(t, 0, 3), target: 'p1' });
  assert.equal(evs(t, 'p2', 'compare')[0].winner, null, 'tie');
  assert.equal(evs(t, 'p2', 'eliminated').length, 0);
});

test('Handmaid (4) protection event, indicator lasts until own next turn', () => {
  const g = newGame(3);
  rig(g, [[4, 1], [1, 2], [2, 3]], [1, 1, 1, 1, 1]);
  applyAction(g, 'p0', { type: 'play', cardId: cid(g, 0, 4) });
  assert.equal(evs(g, 'p2', 'protected')[0].player, 'p0');
  const shown = (pid) => viewFor(g, pid).players.find((p) => p.id === 'p0').protected;
  assert.equal(shown('p1'), true);
  applyAction(g, 'p1', { type: 'play', cardId: cid(g, 1, 2), target: 'p2' });
  assert.equal(shown('p2'), true, 'still protected during others\' turns');
  applyAction(g, 'p2', { type: 'play', cardId: cid(g, 2, 2), target: 'p1' });
  assert.equal(g.players[g.turn].id, 'p0');
  assert.equal(shown('p1'), false, 'expires as soon as p0\'s next turn starts');
});

test('Viscount (5) reports the discarded card, redraws, or eliminates', () => {
  const g = newGame(3);
  rig(g, [[5, 1], [6], [2]], [1, 4]);
  applyAction(g, 'p0', { type: 'play', cardId: cid(g, 0, 5), target: 'p1' });
  const [ev] = evs(g, 'p2', 'discard');
  assert.deepEqual([ev.target, ev.name, ev.rank, ev.out], ['p1', 'P1', 6, false]);
  // p1 drew the replacement (4), then drew again (1) because it is now their turn.
  assert.deepEqual(g.players[1].hand.map((c) => c.rank), [4, 1], 'drew a replacement');
  assert.equal(g.players[g.turn].id, 'p1');

  const h = newGame(3);
  rig(h, [[5, 1], [9], [2]]);
  applyAction(h, 'p0', { type: 'play', cardId: cid(h, 0, 5), target: 'p1' });
  assert.equal(evs(h, 'p2', 'discard')[0].out, true);
  assert.equal(evs(h, 'p2', 'eliminated')[0].player, 'p1');
  assert.equal(h.players[1].hand.length, 0, 'no replacement when eliminated');
});

test('Event sequence numbers are unique and increasing', () => {
  const g = newGame(3);
  rig(g, [[3, 6], [2], [5]]);
  applyAction(g, 'p0', { type: 'play', cardId: cid(g, 0, 3), target: 'p1' });
  const seqs = viewFor(g, 'p2').events.map((e) => e.seq);
  assert.deepEqual(seqs, [...seqs].sort((a, b) => a - b));
  assert.equal(new Set(seqs).size, seqs.length);
});

// ---------- players leaving ----------

test('Current player leaving advances the turn exactly once', () => {
  const g = newGame(4);
  rig(g, [[1, 2], [3], [4], [6]], [1, 1, 1, 1, 1]);
  const deckBefore = g.deck.length;
  leavePlayer(g, 'p0');
  assert.equal(g.players[g.turn].id, 'p1');
  assert.equal(g.players[1].hand.length, 2, 'next player drew once');
  assert.equal(g.deck.length, deckBefore - 1);
  // Duplicate leave messages (e.g. several clients / retries) change nothing.
  assert.equal(leavePlayer(g, 'p0').changed, false);
  leavePlayer(g, 'p0');
  assert.equal(g.players[g.turn].id, 'p1');
  assert.equal(g.deck.length, deckBefore - 1);
  assert.equal(g.players[0].alive, false);
  assert.equal(g.players[0].hand.length, 0);
});

test('Non-current player leaving does not change the turn', () => {
  const g = newGame(4);
  rig(g, [[1, 2], [3], [4], [6]], [1, 1, 1, 1, 1]);
  leavePlayer(g, 'p2');
  assert.equal(g.players[g.turn].id, 'p0');
  assert.equal(g.players[0].hand.length, 2);
  assert.equal(g.phase, 'turn');
});

test('Turn order skips departed and eliminated players, also in later rounds', () => {
  const g = newGame(4);
  rig(g, [[1, 2], [3], [4], [6]], [1, 1, 1, 1, 1, 1, 1]);
  g.players[1].alive = false;           // eliminated
  leavePlayer(g, 'p2');                 // departed
  applyAction(g, 'p0', { type: 'play', cardId: cid(g, 0, 2), target: 'p3' });
  assert.equal(g.players[g.turn].id, 'p3');
  assert.equal(viewFor(g, 'p3').players.find((p) => p.id === 'p2').left, true);
  // Next rounds: the departed player is never dealt in or given a turn.
  for (let seed = 1; seed < 30; seed++) {
    g.phase = 'roundOver';
    startRound(g, seeded(seed));
    assert.notEqual(g.players[g.turn].id, 'p2');
    assert.equal(g.players[2].hand.length, 0);
    assert.equal(g.players[2].alive, false);
  }
});

test('Leaving during the Chancellor choice advances the turn', () => {
  const g = newGame(3);
  rig(g, [[6, 1], [2], [3]], [4, 5, 7, 1]);
  applyAction(g, 'p0', { type: 'play', cardId: cid(g, 0, 6) });
  assert.equal(g.phase, 'chancellor');
  leavePlayer(g, 'p0');
  assert.equal(g.phase, 'turn');
  assert.equal(g.players[g.turn].id, 'p1');
});

test('Round ends when only one eligible player remains', () => {
  const g = newGame(4);
  rig(g, [[1, 2], [3], [4], [6]], [1, 1, 1, 1]);
  g.players[3].alive = false;
  leavePlayer(g, 'p1');
  assert.equal(g.phase, 'turn');
  leavePlayer(g, 'p2');
  assert.equal(g.phase, 'roundOver');
  assert.deepEqual(g.roundResult.winners, ['p0']);
});

test('Game ends when fewer than two seated players remain; winners must be seated', () => {
  const g = newGame(2);
  rig(g, [[1, 2], [3]], [1, 1, 1]);
  g.players[1].tokens = 5;
  leavePlayer(g, 'p1');
  assert.equal(g.phase, 'gameOver');
  assert.deepEqual(g.winnerIds, ['p0']);

  const r = newGame(3);
  r.phase = 'roundOver';
  leavePlayer(r, 'p2');
  assert.equal(r.phase, 'roundOver', 'two players left can keep playing');
  leavePlayer(r, 'p1');
  assert.equal(r.phase, 'gameOver');
});

test('Refresh/rejoin does not duplicate players; departed players cannot rejoin mid-game', () => {
  const g = newGame(3);
  assert.ok(addPlayer(g, 'p1', 'P1 again').ok);
  assert.equal(g.players.length, 3);
  leavePlayer(g, 'p1');
  assert.equal(addPlayer(g, 'p1', 'P1').ok, false);
  assert.equal(g.players.length, 3);
});

test('Lobby leave removes the player; new game drops departed players', () => {
  const g = createGame();
  addPlayer(g, 'a', 'A'); addPlayer(g, 'b', 'B'); addPlayer(g, 'c', 'C');
  leavePlayer(g, 'b');
  assert.deepEqual(g.players.map((p) => p.id), ['a', 'c']);
  startGame(g, seeded(2));
  leavePlayer(g, 'c');
  g.phase = 'gameOver';
  assert.equal(startGame(g).ok, false, 'one player cannot start');
});

test('Games saved before this update still load and play', () => {
  const g = newGame(3);
  delete g.events;
  g.players.forEach((p) => { delete p.left; });
  const saved = JSON.parse(JSON.stringify(g));
  const v = viewFor(saved, 'p0');
  assert.deepEqual(v.events, []);
  const p = saved.players[saved.turn];
  const c = viewFor(saved, p.id).hand.find((x) => !x.blocked);
  const target = c.targets[0];
  assert.ok(applyAction(saved, p.id, { type: 'play', cardId: c.id, target, guess: 2 }).ok);
});

test('Fuzz: random departures never give a turn to an ineligible player', () => {
  for (let seed = 1; seed <= 200; seed++) {
    const n = 3 + (seed % 4);
    const rng = seeded(seed * 31);
    const g = newGame(n, seed);
    let steps = 0;
    while (g.phase !== 'gameOver' && steps++ < 3000) {
      if (g.phase === 'roundOver') { startRound(g, rng); continue; }
      if (rng() < 0.03) leavePlayer(g, g.players[Math.floor(rng() * n)].id);
      if (g.phase !== 'turn' && g.phase !== 'chancellor') continue;
      const p = g.players[g.turn];
      assert.ok(p.alive && !p.left, 'current player is eligible');
      g.players.forEach((q) => { if (q !== p) assert.ok(q.hand.length <= 1); });
      const v = viewFor(g, p.id);
      if (g.phase === 'chancellor') {
        assert.ok(applyAction(g, p.id, { type: 'chancellor', keepId: v.hand[0].id, bottom: [] }).ok);
        continue;
      }
      const c = v.hand.find((x) => !x.blocked);
      const r = applyAction(g, p.id, { type: 'play', cardId: c.id, target: c.targets[0], guess: 2 });
      assert.ok(r.ok, r.error);
      const count = g.deck.length + (g.setAside ? 1 : 0) + g.faceUp.length
        + g.players.reduce((s, q) => s + q.hand.length + q.discards.length, 0);
      if (g.phase === 'turn' || g.phase === 'chancellor') assert.equal(count, 21);
    }
    assert.equal(g.phase, 'gameOver');
    g.winnerIds.forEach((id) => assert.ok(!g.players.find((q) => q.id === id).left));
  }
});

test('Maid (1) guess event reports right and wrong guesses to everyone', () => {
  const g = newGame(3);
  rig(g, [[1, 4], [7], [2]]);
  applyAction(g, 'p0', { type: 'play', cardId: cid(g, 0, 1), target: 'p1', guess: 7 });
  for (const pid of ['p0', 'p1', 'p2']) {
    const [ev] = evs(g, pid, 'guess');
    assert.deepEqual([ev.actor, ev.target, ev.guess, ev.correct], ['p0', 'p1', 7, true]);
  }
  assert.equal(evs(g, 'p2', 'eliminated')[0].player, 'p1', 'correct guess also shows elimination');

  const w = newGame(3);
  rig(w, [[1, 4], [7], [2]]);
  applyAction(w, 'p0', { type: 'play', cardId: cid(w, 0, 1), target: 'p1', guess: 3 });
  const [ev] = evs(w, 'p2', 'guess');
  assert.equal(ev.correct, false);
  assert.equal(ev.guess, 3);
  assert.ok(!JSON.stringify(viewFor(w, 'p2').events).includes('"rank":7'), 'wrong guess does not reveal the real card');
  assert.equal(evs(w, 'p2', 'eliminated').length, 0);
});

test('Maid with no valid target shows no guess popup', () => {
  const g = newGame(2);
  rig(g, [[1, 4], [2]]);
  g.players[1].protected = true;
  applyAction(g, 'p0', { type: 'play', cardId: cid(g, 0, 1) });
  assert.equal(evs(g, 'p1', 'guess').length, 0);
});
