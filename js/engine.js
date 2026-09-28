// Rules engine for Love Letter (2019 edition, 2–6 players).
// Pure logic, no DOM or networking — the host phone runs this and sends each
// player a redacted view. Runs in the browser and in Node (for tests).

export const CARDS = [
  { rank: 0, name: 'Spy',        count: 2, text: 'No effect when played. At round end, if you are the only player still in who played or discarded a Spy, gain 1 token.' },
  { rank: 1, name: 'Maid',       count: 6, text: 'Name a non-Maid card and choose another player. If they hold it, they are out.' },
  { rank: 2, name: 'Assassin',   count: 2, text: 'Look at another player\'s hand.' },
  { rank: 3, name: 'Mercenary',  count: 2, text: 'Compare hands with another player. Lower card is out.' },
  { rank: 4, name: 'Handmaid',   count: 2, text: 'You can\'t be targeted until your next turn.' },
  { rank: 5, name: 'Viscount',   count: 2, text: 'Choose any player (even yourself). They discard their hand and draw a new card.' },
  { rank: 6, name: 'Chancellor', count: 2, text: 'Draw 2 cards. Keep 1 of your 3 cards and put the other 2 on the bottom of the deck.' },
  { rank: 7, name: 'King',       count: 1, text: 'Trade hands with another player.' },
  { rank: 8, name: 'Countess',   count: 1, text: 'If you hold a King, Viscount, Chancellor, or Princess, you must play this card.' },
  { rank: 9, name: 'Princess',   count: 1, text: 'If you play or discard her, you are out.' },
];

export const cardName = (rank) => CARDS[rank].name;
export const cardLabel = (rank) => `${rank} ${cardName(rank)}`;
// Holding the Countess (8) with any of these ranks forces you to play the Countess.
export const COUNTESS = 8;
export const FORCES_COUNTESS = [5, 6, 7, 9];
export const FORCED_PLAY_REASON = `If you hold a King, ${cardName(5)}, ${cardName(6)}, or Princess, you must play the Countess.`;
export const TOKENS_TO_WIN = { 2: 6, 3: 5, 4: 4, 5: 3, 6: 3 };
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;

// Which cards need a target, and whether self is allowed.
const TARGETED = { 1: 'other', 2: 'other', 3: 'other', 5: 'any', 7: 'other' };

// ---------- setup ----------

export function createGame() {
  return {
    phase: 'lobby',        // lobby | turn | chancellor | roundOver | gameOver
    players: [],           // {id, name, tokens, hand, discards, alive, protected}
    deck: [], setAside: null, faceUp: [],
    round: 0, turn: 0,
    lastWinners: [],
    roundResult: null,
    winnerIds: [],
    log: [], seq: 0,
    events: [],            // effect feedback for popups: {seq, type, to, ...}
  };
}

export function addPlayer(g, id, name) {
  const existing = g.players.find((p) => p.id === id);
  if (existing) return existing.left ? { ok: false, error: 'You left this game. Wait for the host to start a new one.' } : { ok: true };
  if (g.phase !== 'lobby') return { ok: false, error: 'Game already started.' };
  if (g.players.length >= MAX_PLAYERS) return { ok: false, error: 'Room is full (6 players max).' };
  g.players.push({ id, name: cleanName(name), tokens: 0, hand: [], discards: [], alive: true, protected: false, left: false });
  return { ok: true };
}

export function removePlayer(g, id) {
  if (g.phase !== 'lobby') return;
  g.players = g.players.filter((p) => p.id !== id);
}

/** Players still seated in the game (not departed). */
const seated = (g) => g.players.filter((p) => !p.left);

/**
 * A player leaves mid-game (explicitly, or removed by the host). In the lobby they are
 * removed outright. Otherwise they stay in `players` (so turn indexes stay valid) but are
 * marked `left`, knocked out of the round, and never get another turn. Idempotent: a
 * repeated leave for the same player changes nothing.
 */
export function leavePlayer(g, id) {
  const p = byId(g, id);
  if (!p) return { ok: true, changed: false };
  if (g.phase === 'lobby') { removePlayer(g, id); return { ok: true, changed: true }; }
  if (p.left) return { ok: true, changed: false };
  const inRound = g.phase === 'turn' || g.phase === 'chancellor';
  const hadTurn = inRound && current(g) === p;
  p.left = true;
  say(g, `${p.name} left the game.`);
  emit(g, 'left', { player: p.id, name: p.name });
  if (inRound && p.alive) eliminate(g, p, 'left the game', { quiet: true });
  p.alive = false;
  p.protected = false;

  if (seated(g).length < MIN_PLAYERS) {
    if (inRound) endRound(g);
    if (g.phase !== 'gameOver') finishGame(g, 'Not enough players left to continue.');
  } else if (hadTurn) {
    if (g.phase === 'chancellor') g.phase = 'turn';
    endTurn(g);              // advance exactly once, to the next eligible player
  } else if (inRound && g.players.filter((q) => q.alive).length <= 1) {
    endRound(g);
  }
  return { ok: true, changed: true };
}

function cleanName(name) {
  return String(name || 'Player').trim().slice(0, 16) || 'Player';
}

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function startGame(g, rng = Math.random) {
  g.players = seated(g);   // a new game drops anyone who left the last one
  if (g.players.length < MIN_PLAYERS) return { ok: false, error: 'Need at least 2 players.' };
  g.players.forEach((p) => { p.tokens = 0; });
  g.round = 0; g.winnerIds = []; g.lastWinners = []; g.log = [];
  startRound(g, rng);
  return { ok: true };
}

export function startRound(g, rng = Math.random) {
  let id = 0;
  const deck = [];
  for (const c of CARDS) for (let i = 0; i < c.count; i++) deck.push({ id: id++, rank: c.rank });
  shuffle(deck, rng);
  g.deck = deck;                       // top of deck = end of array
  g.setAside = g.deck.pop();
  g.faceUp = g.players.length === 2 ? [g.deck.pop(), g.deck.pop(), g.deck.pop()] : [];
  g.round += 1;
  g.roundResult = null;
  for (const p of g.players) {
    p.hand = p.left ? [] : [g.deck.pop()];
    p.discards = [];
    p.alive = !p.left;
    p.protected = false;
    p.outSeq = null;
  }
  // Previous round's winner starts; otherwise random.
  const first = g.players.findIndex((p) => !p.left && g.lastWinners.includes(p.id));
  const eligible = g.players.map((p, i) => (p.left ? -1 : i)).filter((i) => i >= 0);
  g.turn = first >= 0 ? first : eligible[Math.floor(rng() * eligible.length)];
  say(g, `— Round ${g.round} —`);
  if (g.faceUp.length) say(g, `Set aside face up: ${g.faceUp.map((c) => cardName(c.rank)).join(', ')}.`);
  beginTurn(g);
}

// ---------- helpers ----------

function say(g, text, to = null) {
  g.log.push({ seq: ++g.seq, text, to });
  if (g.log.length > 200) g.log.splice(0, g.log.length - 200);
}

/** Queue a card-effect event for popups. `to` limits who can see it (null = everyone). */
function emit(g, type, data, to = null) {
  if (!g.events) g.events = [];   // games saved before events existed
  g.events.push({ seq: ++g.seq, type, to, ...data });
  if (g.events.length > 50) g.events.splice(0, g.events.length - 50);
}

const current = (g) => g.players[g.turn];
const byId = (g, id) => g.players.find((p) => p.id === id);

function beginTurn(g) {
  const p = current(g);
  p.protected = false;
  p.hand.push(g.deck.pop());
  g.phase = 'turn';
}

function eliminate(g, p, why, { quiet = false } = {}) {
  p.alive = false;
  p.protected = false;
  for (const c of p.hand) p.discards.push(c);
  const revealed = p.hand.map((c) => cardName(c.rank));
  p.hand = [];
  say(g, `${p.name} is out${why ? ` (${why})` : ''}${revealed.length ? ` — discarded ${revealed.join(', ')}` : ''}.`);
  if (!quiet) emit(g, 'eliminated', { player: p.id, name: p.name, why });
  p.outSeq = g.seq;   // no more popups for this player until the next round
}

/** Valid targets for playing `rank` by player `pid`. Empty array = card has no effect. */
export function validTargets(g, pid, rank) {
  const mode = TARGETED[rank];
  if (!mode) return [];
  const others = g.players.filter((p) => p.alive && !p.protected && p.id !== pid).map((p) => p.id);
  return mode === 'any' ? [...others, pid] : others;
}

/** True if the Countess rule forbids playing this card (you hold the Countess plus a King, Viscount, Chancellor, or Princess). */
export function countessBlocks(hand, card) {
  const hasCountess = hand.some((c) => c.rank === COUNTESS);
  const hasForcing = hand.some((c) => FORCES_COUNTESS.includes(c.rank));
  return hasCountess && hasForcing && card.rank !== COUNTESS;
}

// ---------- actions ----------

export function applyAction(g, pid, action) {
  try {
    if (g.phase === 'turn') return playCard(g, pid, action);
    if (g.phase === 'chancellor') return chancellorReturn(g, pid, action);
    return { ok: false, error: 'Not accepting moves right now.' };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function playCard(g, pid, a) {
  const me = current(g);
  if (me.id !== pid) return { ok: false, error: 'Not your turn.' };
  if (a.type !== 'play') return { ok: false, error: 'Unexpected move.' };
  const card = me.hand.find((c) => c.id === a.cardId);
  if (!card) return { ok: false, error: 'You don\'t have that card.' };
  if (countessBlocks(me.hand, card)) return { ok: false, error: FORCED_PLAY_REASON };

  const targets = validTargets(g, pid, card.rank);
  let target = null;
  if (targets.length) {
    if (!targets.includes(a.target)) return { ok: false, error: 'Choose a valid player.' };
    target = byId(g, a.target);
  }
  if (card.rank === 1 && target) {
    const guess = Number(a.guess);
    if (!Number.isInteger(guess) || guess < 0 || guess > 9 || guess === 1) return { ok: false, error: `Name a card other than ${cardName(1)}.` };
  }

  // Commit: move card to discards.
  me.hand = me.hand.filter((c) => c !== card);
  me.discards.push(card);
  const nm = cardName(card.rank);
  const noEffect = TARGETED[card.rank] && !target;

  switch (card.rank) {
    case 0:
      say(g, `${me.name} played Spy.`);
      break;
    case 1:
      if (noEffect) { say(g, `${me.name} played ${nm} — no one to target.`); break; }
      say(g, `${me.name} played ${nm} on ${target.name}, naming ${cardName(a.guess)}.`);
      {
        const correct = target.hand[0].rank === Number(a.guess);
        // Public: the guess is said out loud, and a wrong guess only reveals what they don't hold.
        emit(g, 'guess', { actor: me.id, actorName: me.name, target: target.id, targetName: target.name, guess: Number(a.guess), correct });
        if (correct) eliminate(g, target, `${nm} guessed right`);
        else say(g, `Wrong guess.`);
      }
      break;
    case 2:
      if (noEffect) { say(g, `${me.name} played ${nm} — no one to target.`); break; }
      say(g, `${me.name} played ${nm} and looked at ${target.name}'s hand.`);
      say(g, `🔍 ${target.name} holds ${cardName(target.hand[0].rank)} (${target.hand[0].rank}).`, [me.id]);
      // Private: only the acting player learns the card.
      emit(g, 'reveal', { actor: me.id, target: target.id, name: target.name, rank: target.hand[0].rank }, [me.id]);
      // The target is told who looked (the card shown is their own).
      emit(g, 'seen', { actor: me.id, actorName: me.name, rank: target.hand[0].rank }, [target.id]);
      break;
    case 3: {
      if (noEffect) { say(g, `${me.name} played ${nm} — no one to target.`); break; }
      say(g, `${me.name} played ${nm} against ${target.name}.`);
      const mine = me.hand[0], theirs = target.hand[0];
      say(g, `⚖️ You: ${cardName(mine.rank)} (${mine.rank}) vs ${target.name}: ${cardName(theirs.rank)} (${theirs.rank}).`, [me.id]);
      say(g, `⚖️ You: ${cardName(theirs.rank)} (${theirs.rank}) vs ${me.name}: ${cardName(mine.rank)} (${mine.rank}).`, [target.id]);
      const winner = mine.rank > theirs.rank ? me : theirs.rank > mine.rank ? target : null;
      // Public: who won, never the compared cards (the loser's card is revealed by being discarded).
      emit(g, 'compare', { actor: me.id, actorName: me.name, target: target.id, targetName: target.name, winner: winner && winner.id });
      if (winner === me) eliminate(g, target, `lost the ${nm} comparison`);
      else if (winner === target) eliminate(g, me, `lost the ${nm} comparison`);
      else say(g, 'It\'s a tie — nobody is out.');
      break;
    }
    case 4:
      me.protected = true;
      say(g, `${me.name} played ${nm} and is protected until their next turn.`);
      emit(g, 'protected', { player: me.id, name: me.name });
      break;
    case 5: {
      const who = target === me ? 'themself' : target.name;
      say(g, `${me.name} played ${nm} on ${who}.`);
      const dropped = target.hand.pop();
      target.discards.push(dropped);
      const out = dropped.rank === 9;
      // The discarded card is face up, so everyone may see it.
      emit(g, 'discard', { actor: me.id, target: target.id, name: target.name, rank: dropped.rank, out });
      if (out) {
        say(g, `${target.name} discarded the Princess!`);
        eliminate(g, target, 'discarded the Princess');
      } else {
        say(g, `${target.name} discarded ${cardName(dropped.rank)} and drew a new card.`);
        if (g.deck.length) target.hand.push(g.deck.pop());
        else { target.hand.push(g.setAside); g.setAside = null; }
      }
      break;
    }
    case 6:
      say(g, `${me.name} played Chancellor.`);
      if (g.deck.length) {
        const n = Math.min(2, g.deck.length);
        for (let i = 0; i < n; i++) me.hand.push(g.deck.pop());
        g.phase = 'chancellor';
        return { ok: true };
      }
      say(g, 'The deck is empty — no effect.');
      emit(g, 'chancellor', { actor: me.id, name: me.name, count: 0 }, g.players.filter((p) => p !== me).map((p) => p.id));
      break;
    case 7:
      if (noEffect) { say(g, `${me.name} played ${nm} — no one to target.`); break; }
      say(g, `${me.name} played ${nm} and traded hands with ${target.name}.`);
      [me.hand, target.hand] = [target.hand, me.hand];
      say(g, `👑 You gave ${cardName(target.hand[0].rank)} and got ${cardName(me.hand[0].rank)}.`, [me.id]);
      say(g, `👑 You gave ${cardName(me.hand[0].rank)} and got ${cardName(target.hand[0].rank)}.`, [target.id]);
      {
        // Everyone else learns who traded; only the target is told which card they got.
        const trade = { actor: me.id, actorName: me.name, target: target.id, targetName: target.name };
        emit(g, 'trade', trade, g.players.filter((p) => p !== me && p !== target).map((p) => p.id));
        emit(g, 'trade', { ...trade, gave: me.hand[0].rank, got: target.hand[0].rank }, [target.id]);
      }
      break;
    case 8:
      say(g, `${me.name} played Countess.`);
      break;
    case 9:
      say(g, `${me.name} played the Princess!`);
      eliminate(g, me, 'played the Princess');
      break;
  }
  endTurn(g);
  return { ok: true, played: nm };
}

function chancellorReturn(g, pid, a) {
  const me = current(g);
  if (me.id !== pid) return { ok: false, error: 'Not your turn.' };
  if (a.type !== 'chancellor') return { ok: false, error: 'Choose a card to keep.' };
  const keep = me.hand.find((c) => c.id === a.keepId);
  if (!keep) return { ok: false, error: 'Pick a card to keep.' };
  const rest = me.hand.filter((c) => c !== keep);
  // a.bottom: ids in order, first = very bottom of the deck.
  let order = Array.isArray(a.bottom) ? a.bottom.map((id) => rest.find((c) => c.id === id)).filter(Boolean) : [];
  if (order.length !== rest.length || new Set(order).size !== rest.length) order = rest;
  me.hand = [keep];
  g.deck.unshift(...order);
  say(g, `${me.name} kept one card and put ${order.length} on the bottom of the deck.`);
  // Only for the other players, and only how many cards moved — never which.
  emit(g, 'chancellor', { actor: me.id, name: me.name, count: order.length }, g.players.filter((p) => p !== me).map((p) => p.id));
  endTurn(g);
  return { ok: true };
}

function endTurn(g) {
  const alive = g.players.filter((p) => p.alive);
  if (alive.length <= 1 || g.deck.length === 0) return endRound(g);
  let i = g.turn;
  do { i = (i + 1) % g.players.length; } while (!g.players[i].alive || g.players[i].left);
  g.turn = i;
  beginTurn(g);
}

function endRound(g) {
  const alive = g.players.filter((p) => p.alive);
  let winners;
  let reason;
  if (alive.length === 1) {
    winners = alive;
    reason = `${alive[0].name} is the last one standing.`;
  } else {
    const top = Math.max(...alive.map((p) => p.hand[0].rank));
    winners = alive.filter((p) => p.hand[0].rank === top);
    reason = `The deck ran out. Highest card: ${cardName(top)} (${top}).`;
    if (winners.length > 1) {
      const sum = (p) => p.discards.reduce((s, c) => s + c.rank, 0);
      const best = Math.max(...winners.map(sum));
      winners = winners.filter((p) => sum(p) === best);
      reason += ` Tie broken by discard total (${best}).`;
    }
  }
  winners.forEach((p) => { p.tokens += 1; });

  const spies = alive.filter((p) => p.discards.some((c) => c.rank === 0));
  const spyBonus = spies.length === 1 ? spies[0] : null;
  if (spyBonus) spyBonus.tokens += 1;

  g.lastWinners = winners.map((p) => p.id);
  g.roundResult = {
    reason,
    winners: winners.map((p) => p.id),
    spyBonus: spyBonus ? spyBonus.id : null,
    hands: Object.fromEntries(alive.map((p) => [p.id, p.hand[0].rank])),
    setAside: g.setAside ? g.setAside.rank : null,
  };
  say(g, `${reason} ${winners.map((p) => p.name).join(' & ')} ${winners.length > 1 ? 'win' : 'wins'} the round.`);
  if (spyBonus) say(g, `${spyBonus.name} gets a bonus token for the Spy.`);

  const need = TOKENS_TO_WIN[g.players.length];
  const reached = seated(g).filter((p) => p.tokens >= need);
  if (reached.length) finishGame(g, null, reached);
  else if (seated(g).length < MIN_PLAYERS) finishGame(g, 'Not enough players left to continue.');
  else g.phase = 'roundOver';
}

/** End the game; winners are the seated players (from `pool`) with the most tokens. */
function finishGame(g, why, pool = seated(g)) {
  if (why) say(g, why);
  const most = Math.max(0, ...pool.map((p) => p.tokens));
  g.winnerIds = pool.filter((p) => p.tokens === most).map((p) => p.id);
  g.phase = 'gameOver';
  if (g.winnerIds.length) say(g, `🏆 ${g.winnerIds.map((id) => byId(g, id).name).join(' & ')} won the game!`);
}

// ---------- views ----------

/** What one player is allowed to see. */
export function viewFor(g, pid) {
  const me = byId(g, pid);
  const cur = g.phase === 'turn' || g.phase === 'chancellor' ? current(g) : null;
  const myTurn = !!(cur && me && cur.id === pid);
  const reveal = g.phase === 'roundOver' || g.phase === 'gameOver';
  return {
    me: pid,
    phase: g.phase,
    round: g.round,
    tokensToWin: TOKENS_TO_WIN[g.players.length] || null,
    deckCount: g.deck.length,
    faceUp: g.faceUp.map((c) => c.rank),
    turnPlayer: cur ? cur.id : null,
    myTurn,
    players: g.players.map((p) => ({
      id: p.id, name: p.name, tokens: p.tokens, alive: p.alive, left: !!p.left,
      protected: p.protected, discards: p.discards.map((c) => c.rank),
      handCount: p.hand.length,
    })),
    hand: me ? me.hand.map((c) => ({
      id: c.id,
      rank: c.rank,
      blocked: myTurn && g.phase === 'turn' && countessBlocks(me.hand, c),
      blockedReason: myTurn && g.phase === 'turn' && countessBlocks(me.hand, c) ? FORCED_PLAY_REASON : null,
      targets: myTurn && g.phase === 'turn' ? validTargets(g, pid, c.rank) : [],
    })) : [],
    roundResult: reveal ? g.roundResult : null,
    winnerIds: g.winnerIds,
    log: g.log.filter((e) => !e.to || e.to.includes(pid)).slice(-60),
    // Private events are filtered here, on the host, so they never reach other phones.
    // Players who are out of the round stop getting popups (they still see their own exit).
    events: (g.events || []).filter((e) => (!e.to || e.to.includes(pid)) && !(me?.outSeq != null && e.seq > me.outSeq)).slice(-20)
      .map(({ to, ...e }) => e),
  };
}
