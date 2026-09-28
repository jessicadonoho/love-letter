// Rules engine for Love Letter (2019 edition, 2–6 players).
// Pure logic, no DOM or networking — the host phone runs this and sends each
// player a redacted view. Runs in the browser and in Node (for tests).

export const CARDS = [
  { rank: 0, name: 'Spy',        count: 2, text: 'No effect when played. At round end, if you are the only player still in who played or discarded a Spy, gain 1 token.' },
  { rank: 1, name: 'Guard',      count: 6, text: 'Name a non-Guard card and choose another player. If they hold it, they are out.' },
  { rank: 2, name: 'Priest',     count: 2, text: 'Look at another player\'s hand.' },
  { rank: 3, name: 'Baron',      count: 2, text: 'Compare hands with another player. Lower card is out.' },
  { rank: 4, name: 'Handmaid',   count: 2, text: 'You can\'t be targeted until your next turn.' },
  { rank: 5, name: 'Prince',     count: 2, text: 'Choose any player (even yourself). They discard their hand and draw a new card.' },
  { rank: 6, name: 'Chancellor', count: 2, text: 'Draw 2 cards. Keep 1 of your 3 cards and put the other 2 on the bottom of the deck.' },
  { rank: 7, name: 'King',       count: 1, text: 'Trade hands with another player.' },
  { rank: 8, name: 'Countess',   count: 1, text: 'Must be played if you also hold the King or a Prince.' },
  { rank: 9, name: 'Princess',   count: 1, text: 'If you play or discard her, you are out.' },
];

export const cardName = (rank) => CARDS[rank].name;
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
  };
}

export function addPlayer(g, id, name) {
  if (g.players.some((p) => p.id === id)) return { ok: true };
  if (g.phase !== 'lobby') return { ok: false, error: 'Game already started.' };
  if (g.players.length >= MAX_PLAYERS) return { ok: false, error: 'Room is full (6 players max).' };
  g.players.push({ id, name: cleanName(name), tokens: 0, hand: [], discards: [], alive: true, protected: false });
  return { ok: true };
}

export function removePlayer(g, id) {
  if (g.phase !== 'lobby') return;
  g.players = g.players.filter((p) => p.id !== id);
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
    p.hand = [g.deck.pop()];
    p.discards = [];
    p.alive = true;
    p.protected = false;
  }
  // Previous round's winner starts; otherwise random.
  const first = g.players.findIndex((p) => g.lastWinners.includes(p.id));
  g.turn = first >= 0 ? first : Math.floor(rng() * g.players.length);
  say(g, `— Round ${g.round} —`);
  if (g.faceUp.length) say(g, `Set aside face up: ${g.faceUp.map((c) => cardName(c.rank)).join(', ')}.`);
  beginTurn(g);
}

// ---------- helpers ----------

function say(g, text, to = null) {
  g.log.push({ seq: ++g.seq, text, to });
  if (g.log.length > 200) g.log.splice(0, g.log.length - 200);
}

const current = (g) => g.players[g.turn];
const byId = (g, id) => g.players.find((p) => p.id === id);

function beginTurn(g) {
  const p = current(g);
  p.protected = false;
  p.hand.push(g.deck.pop());
  g.phase = 'turn';
}

function eliminate(g, p, why) {
  p.alive = false;
  p.protected = false;
  for (const c of p.hand) p.discards.push(c);
  const revealed = p.hand.map((c) => cardName(c.rank));
  p.hand = [];
  say(g, `${p.name} is out${why ? ` (${why})` : ''}${revealed.length ? ` — discarded ${revealed.join(', ')}` : ''}.`);
}

/** Valid targets for playing `rank` by player `pid`. Empty array = card has no effect. */
export function validTargets(g, pid, rank) {
  const mode = TARGETED[rank];
  if (!mode) return [];
  const others = g.players.filter((p) => p.alive && !p.protected && p.id !== pid).map((p) => p.id);
  return mode === 'any' ? [...others, pid] : others;
}

/** True if the Countess rule forbids playing this card. */
function countessBlocks(hand, card) {
  const hasCountess = hand.some((c) => c.rank === 8);
  const hasRoyal = hand.some((c) => c.rank === 5 || c.rank === 7);
  return hasCountess && hasRoyal && card.rank !== 8;
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
  if (countessBlocks(me.hand, card)) return { ok: false, error: 'You must play the Countess.' };

  const targets = validTargets(g, pid, card.rank);
  let target = null;
  if (targets.length) {
    if (!targets.includes(a.target)) return { ok: false, error: 'Choose a valid player.' };
    target = byId(g, a.target);
  }
  if (card.rank === 1 && target) {
    const guess = Number(a.guess);
    if (!Number.isInteger(guess) || guess < 0 || guess > 9 || guess === 1) return { ok: false, error: 'Name a card other than Guard.' };
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
      if (noEffect) { say(g, `${me.name} played Guard — no one to target.`); break; }
      say(g, `${me.name} played Guard on ${target.name}, naming ${cardName(a.guess)}.`);
      if (target.hand[0].rank === Number(a.guess)) eliminate(g, target, 'Guard guessed right');
      else say(g, `Wrong guess.`);
      break;
    case 2:
      if (noEffect) { say(g, `${me.name} played Priest — no one to target.`); break; }
      say(g, `${me.name} played Priest and looked at ${target.name}'s hand.`);
      say(g, `🔍 ${target.name} holds ${cardName(target.hand[0].rank)} (${target.hand[0].rank}).`, [me.id]);
      break;
    case 3: {
      if (noEffect) { say(g, `${me.name} played Baron — no one to target.`); break; }
      say(g, `${me.name} played Baron against ${target.name}.`);
      const mine = me.hand[0], theirs = target.hand[0];
      say(g, `⚖️ You: ${cardName(mine.rank)} (${mine.rank}) vs ${target.name}: ${cardName(theirs.rank)} (${theirs.rank}).`, [me.id]);
      say(g, `⚖️ You: ${cardName(theirs.rank)} (${theirs.rank}) vs ${me.name}: ${cardName(mine.rank)} (${mine.rank}).`, [target.id]);
      if (mine.rank > theirs.rank) eliminate(g, target, 'lost the Baron comparison');
      else if (theirs.rank > mine.rank) eliminate(g, me, 'lost the Baron comparison');
      else say(g, 'It\'s a tie — nobody is out.');
      break;
    }
    case 4:
      me.protected = true;
      say(g, `${me.name} played Handmaid and is protected until their next turn.`);
      break;
    case 5: {
      const who = target === me ? 'themself' : target.name;
      say(g, `${me.name} played Prince on ${who}.`);
      const dropped = target.hand.pop();
      target.discards.push(dropped);
      if (dropped.rank === 9) {
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
      break;
    case 7:
      if (noEffect) { say(g, `${me.name} played King — no one to target.`); break; }
      say(g, `${me.name} played King and traded hands with ${target.name}.`);
      [me.hand, target.hand] = [target.hand, me.hand];
      say(g, `👑 You gave ${cardName(target.hand[0].rank)} and got ${cardName(me.hand[0].rank)}.`, [me.id]);
      say(g, `👑 You gave ${cardName(me.hand[0].rank)} and got ${cardName(target.hand[0].rank)}.`, [target.id]);
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
  endTurn(g);
  return { ok: true };
}

function endTurn(g) {
  const alive = g.players.filter((p) => p.alive);
  if (alive.length <= 1 || g.deck.length === 0) return endRound(g);
  let i = g.turn;
  do { i = (i + 1) % g.players.length; } while (!g.players[i].alive);
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
  const reached = g.players.filter((p) => p.tokens >= need);
  if (reached.length) {
    const most = Math.max(...reached.map((p) => p.tokens));
    g.winnerIds = reached.filter((p) => p.tokens === most).map((p) => p.id);
    g.phase = 'gameOver';
    say(g, `🏆 ${g.winnerIds.map((id) => byId(g, id).name).join(' & ')} won the game!`);
  } else {
    g.phase = 'roundOver';
  }
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
      id: p.id, name: p.name, tokens: p.tokens, alive: p.alive,
      protected: p.protected, discards: p.discards.map((c) => c.rank),
      handCount: p.hand.length,
    })),
    hand: me ? me.hand.map((c) => ({
      id: c.id,
      rank: c.rank,
      blocked: myTurn && g.phase === 'turn' && countessBlocks(me.hand, c),
      targets: myTurn && g.phase === 'turn' ? validTargets(g, pid, c.rank) : [],
    })) : [],
    roundResult: reveal ? g.roundResult : null,
    winnerIds: g.winnerIds,
    log: g.log.filter((e) => !e.to || e.to.includes(pid)).slice(-60),
  };
}
