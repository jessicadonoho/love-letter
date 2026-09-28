import {
  CARDS, cardName, MIN_PLAYERS, MAX_PLAYERS,
  createGame, addPlayer, leavePlayer, startGame, startRound, applyAction, viewFor,
} from './engine.js';
import { Host, Client } from './net.js';
import { esc, handGridHTML, useBarHTML, fxHTML } from './ui.js';

// ---------- local identity & storage ----------

const store = {
  get(k, fallback = null) { try { const v = localStorage.getItem('ll.' + k); return v == null ? fallback : JSON.parse(v); } catch { return fallback; } },
  set(k, v) { try { localStorage.setItem('ll.' + k, JSON.stringify(v)); } catch { /* private mode */ } },
  del(k) { try { localStorage.removeItem('ll.' + k); } catch { /* ignore */ } },
};

const params = new URLSearchParams(location.search);
// ?as=name gives each browser tab its own identity (handy for testing on one computer).
const idKey = 'clientId' + (params.get('as') ? '.' + params.get('as') : '');
let clientId = store.get(idKey);
if (!clientId) { clientId = Math.random().toString(36).slice(2, 10); store.set(idKey, clientId); }

const SESSION_KEY = 'session' + (params.get('as') ? '.' + params.get('as') : '');
const SESSION_TTL = 12 * 60 * 60 * 1000;
// Last effect-popup event seen, so refreshes and repeated syncs never replay a popup.
const FX_KEY = 'fxSeen' + (params.get('as') ? '.' + params.get('as') : '');

// ---------- app state ----------

const S = {
  screen: 'home',          // home | room
  role: null,              // host | client
  code: '',
  name: store.get('name', params.get('as') || ''),
  status: '',              // connection status text
  view: null,              // latest view from the engine
  online: [],              // player ids with a live connection
  toast: '',
  // local UI selections
  sel: null, target: null, guess: null,
  keep: null, bottom: [],
  showRules: false,
  submitting: false,       // a move is on its way to the host
  fxQueue: [],             // card-effect popups waiting to be shown, oldest first
};

let game = null;   // host only: authoritative game state
let host = null;   // host only: Host network wrapper
let client = null; // client only
const connsById = new Map(); // host only: clientId -> conn

const $app = document.getElementById('app');

// ---------- helpers ----------

const nameOf = (id) => S.view?.players.find((p) => p.id === id)?.name ?? '?';
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const newCode = () => Array.from({ length: 4 }, () => LETTERS[Math.floor(Math.random() * LETTERS.length)]).join('');

let toastTimer;
function toast(msg) {
  S.toast = msg;
  render();
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { S.toast = ''; render(); }, 3500);
}

function resetSelection() {
  S.sel = null; S.target = null; S.guess = null; S.keep = null; S.bottom = [];
}

let wakeLock = null;
async function keepAwake() {
  try { if ('wakeLock' in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); } } catch { /* not supported */ }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.screen === 'room') keepAwake(); });

// ---------- host ----------

function hostRoom(resume = null) {
  S.role = 'host';
  S.code = resume?.code || newCode();
  game = resume?.game || createGame();
  if (!resume) addPlayer(game, clientId, S.name);
  S.screen = 'room';
  S.status = 'Opening room…';
  host = new Host(S.code, {
    onStatus(st, detail) {
      S.status = st === 'open' ? '' : st === 'id-taken' ? 'Reclaiming room… (a few seconds)' : `Connection problem: ${detail}`;
      if (st === 'open' && resume) toast('Room restored. Other phones will reconnect on their own.');
      render();
    },
    onMessage: hostOnMessage,
    onLeave(conn) {
      if (conn.clientId && connsById.get(conn.clientId) === conn) connsById.delete(conn.clientId);
      broadcast();
    },
  });
  host.start();
  keepAwake();
  broadcast();
}

function hostOnMessage(conn, msg) {
  if (!msg || typeof msg !== 'object') return;
  if (msg.t === 'hello') {
    const id = String(msg.clientId || '').slice(0, 20);
    if (!id) return;
    const res = addPlayer(game, id, msg.name);
    if (!res.ok) {
      host.send(conn, { t: 'rejected', error: res.error });
      setTimeout(() => conn.close(), 500);
      return;
    }
    const old = connsById.get(id);
    if (old && old !== conn) old.close();
    conn.clientId = id;
    connsById.set(id, conn);
    broadcast();
  } else if (msg.t === 'action' && conn.clientId) {
    const res = applyAction(game, conn.clientId, msg.action || {});
    if (!res.ok) host.send(conn, { t: 'error', error: res.error });
    broadcast();
  } else if (msg.t === 'leave' && conn.clientId) {
    // Idempotent: a repeated leave (or leave + remove) for the same player is ignored.
    leavePlayer(game, conn.clientId);
    connsById.delete(conn.clientId);
    broadcast();
  }
}

function hostAct(action) {
  const res = applyAction(game, clientId, action);
  S.submitting = false;
  if (!res.ok) toast(res.error);
  else resetSelection();
  broadcast();
}

function broadcast() {
  const online = [clientId, ...connsById.keys()];
  for (const [id, conn] of connsById) {
    if (game.players.some((p) => p.id === id)) host.send(conn, { t: 'state', view: viewFor(game, id), online, code: S.code });
  }
  const prevPhase = S.view?.phase;
  S.view = viewFor(game, clientId);
  S.online = online;
  if (prevPhase !== S.view.phase) resetSelection();
  ingestEvents(S.view);
  store.set(SESSION_KEY, { role: 'host', code: S.code, game, savedAt: Date.now() });
  render();
}

// ---------- client ----------

function joinRoom(code, quiet = false) {
  S.role = 'client';
  S.code = code.toUpperCase();
  S.screen = 'room';
  S.status = 'Connecting…';
  S.view = null;
  store.set(SESSION_KEY, { role: 'client', code: S.code, savedAt: Date.now() });
  client = new Client(S.code, {
    onStatus(st, detail) {
      if (st === 'connected') { S.status = ''; client.send({ t: 'hello', clientId, name: S.name }); }
      else if (st === 'no-host') S.status = `Looking for room ${S.code}… (is the host's screen on?)`;
      else if (st === 'lost') S.status = 'Lost connection — reconnecting…';
      else S.status = `Connection problem: ${detail} — retrying…`;
      render();
    },
    onMessage(msg) {
      if (msg.t === 'state') {
        const prev = S.view;
        S.view = msg.view; S.online = msg.online || [];
        S.submitting = false;
        if (!prev || prev.phase !== msg.view.phase || prev.turnPlayer !== msg.view.turnPlayer) resetSelection();
        ingestEvents(S.view);
        store.set(SESSION_KEY, { role: 'client', code: S.code, savedAt: Date.now() });
        keepAwake();
        render();
      } else if (msg.t === 'error') {
        S.submitting = false;
        toast(msg.error);
      } else if (msg.t === 'rejected') {
        leave(msg.error);
      } else if (msg.t === 'closed') {
        leave('The host closed the room.');
      }
    },
  });
  client.start();
  if (!quiet) render();
}

let submitTimer;
function act(action) {
  if (S.submitting) return;              // ignore double taps while a move is in flight
  if (S.role === 'host') return hostAct(action);
  if (!client.send({ t: 'action', action })) { toast('Not connected — try again in a moment.'); return; }
  // Keep the selection (and a disabled "Sending…" button) until the host answers.
  S.submitting = true;
  clearTimeout(submitTimer);
  submitTimer = setTimeout(() => { if (S.submitting) { S.submitting = false; render(); } }, 8000);
  render();
}

function leave(reason) {
  if (S.role === 'client') client?.send({ t: 'leave' });
  // The room lives on the host's phone, so the host leaving closes it for everyone.
  if (S.role === 'host') for (const conn of connsById.values()) host?.send(conn, { t: 'closed' });
  setTimeout(() => { client?.destroy(); host?.destroy(); client = host = null; }, 200);
  game = null; connsById.clear();
  store.del(SESSION_KEY);
  Object.assign(S, { screen: 'home', role: null, view: null, code: '', status: '' });
  resetSelection();
  S.submitting = false; S.fxQueue = []; renderFx();
  if (reason) toast(reason); else render();
}

// ---------- card-effect popups ----------

function ingestEvents(v) {
  const events = v.events || [];
  const top = events.reduce((m, e) => Math.max(m, e.seq), 0);
  const seen = store.get(FX_KEY);
  if (!seen || seen.code !== S.code) {
    // First view of this room on this device: don't replay old effects.
    store.set(FX_KEY, { code: S.code, seq: top });
    return;
  }
  const fresh = events.filter((e) => e.seq > seen.seq);
  if (!fresh.length) return;
  store.set(FX_KEY, { code: S.code, seq: top });
  const wasEmpty = !S.fxQueue.length;
  S.fxQueue.push(...fresh);
  if (wasEmpty) renderFx(); else updateFxCount();
}

// Popups live outside #app so game re-renders never restart their animation or steal focus.
const $fx = document.createElement('div');
$fx.id = 'fx';
document.body.append($fx);
let fxReturnFocus = null;

function renderFx() {
  const ev = S.fxQueue[0];
  if (!ev) { $fx.innerHTML = ''; restoreFocus(fxReturnFocus); fxReturnFocus = null; return; }
  if (!$fx.firstChild) fxReturnFocus = focusKey();
  $fx.innerHTML = fxHTML(ev, S.view?.me ?? clientId, S.fxQueue.length - 1);
  if (!$fx.firstChild) { S.fxQueue.shift(); renderFx(); return; } // unknown event type
  $fx.querySelector('[data-fx="ok"]').focus();
}

function updateFxCount() {
  // Only the "N more waiting" line changes; don't rebuild (keeps the animation running).
  const ok = $fx.querySelector('[data-fx="ok"]');
  if (!ok) return renderFx();
  const n = S.fxQueue.length - 1;
  let line = $fx.querySelector('.fx-more');
  if (!line) { line = document.createElement('p'); line.className = 'muted small fx-more'; ok.before(line); }
  line.textContent = `${n} more update${n > 1 ? 's' : ''} waiting`;
  ok.textContent = 'Next';
}

function dismissFx() {
  S.fxQueue.shift();
  renderFx();
}

$fx.addEventListener('click', (e) => {
  const a = e.target.dataset?.fx;
  if (a === 'ok' || a === 'backdrop') dismissFx();
});
$fx.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { e.preventDefault(); dismissFx(); }
  else if (e.key === 'Tab') { e.preventDefault(); $fx.querySelector('[data-fx="ok"]')?.focus(); } // only one control: keep focus in the dialog
});

// ---------- rendering ----------

// Re-rendering replaces the DOM, so remember which control had focus and restore it.
function focusKey() {
  const el = document.activeElement;
  if (!el || el === document.body || !$app.contains(el)) return null;
  if (el.id) return `#${CSS.escape(el.id)}`;
  if (!el.dataset.a) return null;
  return ['a', 'id', 'r'].filter((k) => el.dataset[k] != null).map((k) => `[data-${k}="${CSS.escape(el.dataset[k])}"]`).join('');
}
function restoreFocus(key) {
  if (key && !$fx.firstChild) $app.querySelector(key)?.focus();
}

function render() {
  const key = focusKey();
  const bar = S.screen === 'room' ? useBar() : '';
  $app.innerHTML = (S.screen === 'home' ? homeHTML() : roomHTML())
    + bar
    + (S.showRules ? rulesHTML() : '')
    + (S.toast ? `<div class="toast" role="status">${esc(S.toast)}</div>` : '');
  document.body.classList.toggle('has-bar', !!bar);
  restoreFocus(key);
}

function homeHTML() {
  const sess = store.get(SESSION_KEY);
  const canResume = sess && Date.now() - sess.savedAt < SESSION_TTL;
  const prefill = params.get('room') || '';
  return `
  <main class="home">
    <h1>Love Letter</h1>
    <p class="sub">Each player uses their own phone. One person hosts, everyone else joins with the room code.</p>
    <label class="field">Your name
      <input id="name" maxlength="16" autocomplete="nickname" value="${esc(S.name)}" placeholder="e.g. Jess">
    </label>
    ${canResume ? `<button class="btn primary" data-a="resume">Rejoin room ${esc(sess.code)}${sess.role === 'host' ? ' (as host)' : ''}</button>` : ''}
    <button class="btn ${canResume ? '' : 'primary'}" data-a="host">Host a new room</button>
    <div class="or">or join a friend</div>
    <div class="join">
      <input id="code" maxlength="4" autocapitalize="characters" autocomplete="off" placeholder="CODE" value="${esc(prefill)}">
      <button class="btn" data-a="join">Join</button>
    </div>
    <button class="link" data-a="rules">How to play / card list</button>
  </main>`;
}

function roomHTML() {
  const v = S.view;
  const head = `
  <header class="top">
    <div><strong>Room ${esc(S.code)}</strong>${v && v.phase !== 'lobby' ? ` · Round ${v.round} · Deck ${v.deckCount}` : ''}</div>
    <div class="top-btns"><button class="chip" data-a="rules">Cards</button><button class="chip" data-a="leave">Leave</button></div>
  </header>
  ${S.status ? `<div class="status">${esc(S.status)}</div>` : ''}`;
  if (!v) return head + `<main><p class="muted center">Waiting for the host…</p></main>`;
  if (v.phase === 'lobby') return head + lobbyHTML(v);
  return head + gameHTML(v);
}

function lobbyHTML(v) {
  const isHost = S.role === 'host';
  const n = v.players.length;
  const link = `${location.origin}${location.pathname}?room=${S.code}`;
  return `
  <main>
    <section class="card-panel center">
      <div class="muted">Room code</div>
      <div class="code">${esc(S.code)}</div>
      <button class="chip" data-a="share" data-link="${esc(link)}">Share join link</button>
    </section>
    <h2>Players (${n}/${MAX_PLAYERS})</h2>
    <ul class="players">
      ${v.players.map((p) => `<li class="player row"><span>${esc(p.name)}${p.id === v.me ? ' (you)' : ''}${p.id === v.players[0].id ? ' · host' : ''}</span>
        ${dot(p.id)}${isHost && p.id !== v.me ? `<button class="chip" data-a="kick" data-id="${esc(p.id)}">Remove</button>` : ''}</li>`).join('')}
    </ul>
    ${isHost
      ? `<button class="btn primary" data-a="start" ${n < MIN_PLAYERS ? 'disabled' : ''}>${n < MIN_PLAYERS ? 'Waiting for players…' : `Start game with ${n}`}</button>`
      : '<p class="muted center">Waiting for the host to start…</p>'}
  </main>`;
}

function dot(id) {
  return S.online.includes(id) ? '' : '<span class="offline" title="Disconnected">offline</span>';
}

function gameHTML(v) {
  return `<main>${bannerHTML(v)}${v.phase === 'roundOver' || v.phase === 'gameOver' ? resultHTML(v) : handHTML(v)}<h2>Players</h2>${playersHTML(v)}${logHTML(v)}</main>`;
}

function bannerHTML(v) {
  let text;
  if (v.phase === 'gameOver') text = `🏆 ${v.winnerIds.map(nameOf).map(esc).join(' & ')} won the game!`;
  else if (v.phase === 'roundOver') text = 'Round over';
  else if (v.myTurn && v.phase === 'chancellor') text = 'Chancellor: keep one card';
  else if (v.myTurn) text = 'Your turn — pick a card to play';
  else if (!v.players.find((p) => p.id === v.me)?.alive) text = `You're out this round. ${esc(nameOf(v.turnPlayer))} is playing…`;
  else text = `${esc(nameOf(v.turnPlayer))} is playing…`;
  if (!v.myTurn && v.turnPlayer && !S.online.includes(v.turnPlayer)) {
    text += S.role === 'host' ? ' (offline — you can remove them below)' : ' (offline — waiting for them to reconnect)';
  }
  return `<div class="banner ${v.myTurn ? 'mine' : ''}">${text}</div>`;
}

const SHIELD = '<span class="badge shield" role="img" aria-label="Protected until next turn" title="Protected until next turn"><span aria-hidden="true">🛡️</span> Protected</span>';

function playersHTML(v) {
  const isHost = S.role === 'host';
  return `<ul class="players">${v.players.map((p) => `
    <li class="player ${p.alive ? '' : 'out'} ${p.id === v.turnPlayer ? 'turn' : ''}">
      <div class="p-row">
        <span class="p-name">${p.id === v.turnPlayer ? '▶ ' : ''}${esc(p.name)}${p.id === v.me ? ' (you)' : ''}</span>
        ${p.protected ? SHIELD : ''}
        ${p.left ? '<span class="badge">left</span>' : p.alive ? '' : '<span class="badge">out</span>'}
        ${p.left ? '' : dot(p.id)}
        ${isHost && p.id !== v.me && !p.left && !S.online.includes(p.id) ? `<button class="chip" data-a="kick" data-id="${esc(p.id)}">Remove</button>` : ''}
        <span class="tokens" title="Tokens">${'♥'.repeat(p.tokens)}<span class="muted">${'♡'.repeat(Math.max(0, (v.tokensToWin || 0) - p.tokens))}</span></span>
      </div>
      <div class="discards">${p.discards.length ? p.discards.map((r) => `<span class="mini r${r}">${r} ${cardName(r)}</span>`).join('') : '<span class="muted">no discards</span>'}</div>
    </li>`).join('')}
  </ul>
  ${v.faceUp.length ? `<div class="muted small">Set aside face up: ${v.faceUp.map((r) => `${r} ${cardName(r)}`).join(', ')}</div>` : ''}`;
}

function handHTML(v) {
  const me = v.players.find((p) => p.id === v.me);
  if (!me?.alive) return '<h2>Your hand</h2><p class="muted">You\'re out until next round.</p>';

  if (v.phase === 'chancellor' && v.myTurn) return chancellorHTML(v);

  const cards = handGridHTML(v.hand, {
    artFor: (r) => ART[r] || null,
    cardOpts: (c) => ({ selectable: v.myTurn && !c.blocked && !S.submitting, selected: S.sel === c.id, note: c.blocked ? c.blockedReason : '' }),
  });
  let panel = '';
  const sel = v.myTurn && v.hand.find((c) => c.id === S.sel);
  if (sel) panel = actionPanelHTML(v, sel);
  return `<h2>Your hand</h2>${cards}${panel}`;
}

const NEEDS_TARGET = [1, 2, 3, 5, 7];

/** What the selected card still needs before it can be played, or a warning. */
function playStatus(c) {
  const needsTarget = NEEDS_TARGET.includes(c.rank);
  if (needsTarget && !c.targets.length) return { ready: true, hint: 'Everyone else is protected or out — this card will have no effect.' };
  if (needsTarget && !S.target) return { ready: false, hint: 'Next: choose a player above.' };
  if (c.rank === 1 && S.guess == null) return { ready: false, hint: 'Next: guess their card above.' };
  if (c.rank === 9) return { ready: true, hint: 'Playing the Princess knocks you out of the round!' };
  return { ready: true, hint: '' };
}

/** The fixed bottom "Use this card" / "Keep this card" bar, if a card is selected. */
function useBar() {
  const v = S.view;
  if (!v?.myTurn || !v.players.find((p) => p.id === v.me)?.alive) return '';
  if (v.phase === 'chancellor') {
    const card = v.hand.find((c) => c.id === S.keep);
    return useBarHTML({ mode: 'keep', card, submitting: S.submitting });
  }
  if (v.phase !== 'turn') return '';
  const card = v.hand.find((c) => c.id === S.sel);
  if (!card) return '';
  return useBarHTML({ card, ...playStatus(card), submitting: S.submitting });
}

function actionPanelHTML(v, c) {
  const needsTarget = NEEDS_TARGET.includes(c.rank);
  let body = '';
  if (needsTarget && !c.targets.length) {
    return '';   // the bottom bar explains that the card will have no effect
  } else if (needsTarget) {
    body = `<div class="label">${c.rank === 5 ? 'Choose a player (can be you)' : 'Choose a player'}</div>
      <div class="opts">${c.targets.map((id) => `<button class="opt ${S.target === id ? 'on' : ''}" data-a="target" data-id="${esc(id)}">${esc(id === v.me ? 'Me' : nameOf(id))}</button>`).join('')}</div>`;
    if (c.rank === 1) {
      body += `<div class="label">Guess their card</div><div class="opts guess">${
        [0, 2, 3, 4, 5, 6, 7, 8, 9].map((r) => `<button class="opt ${S.guess === r ? 'on' : ''}" data-a="guess" data-r="${r}">${r} ${cardName(r)}</button>`).join('')}</div>`;
    }
  }
  if (c.rank === 9) body += '<p class="warn">Playing the Princess knocks you out of the round!</p>';
  return body ? `<section class="action">${body}</section>` : '';
}

function chancellorHTML(v) {
  const cards = handGridHTML(v.hand, {
    artFor: (r) => ART[r] || null,
    cardOpts: (c) => ({ selectable: !S.submitting, selected: S.keep === c.id }),
  });
  let order = '';
  if (S.keep != null) {
    if (S.bottom.length !== v.hand.length - 1) S.bottom = v.hand.filter((c) => c.id !== S.keep).map((c) => c.id);
    const rank = (id) => v.hand.find((c) => c.id === id).rank;
    order = S.bottom.length > 1
      ? `<div class="label">Going to the bottom of the deck</div>
         <ol class="order">${S.bottom.map((id, i) => `<li>${cardName(rank(id))}${i === 0 ? ' <span class="muted">(very bottom)</span>' : ''}</li>`).join('')}</ol>
         <button class="chip" data-a="swap">Swap order</button>`
      : `<p class="muted">${cardName(rank(S.bottom[0]))} goes to the bottom of the deck.</p>`;
  }
  return `<h2>Tap the card to keep</h2>${cards}${order ? `<section class="action">${order}</section>` : ''}`;
}

function resultHTML(v) {
  const r = v.roundResult;
  const isHost = S.role === 'host';
  const rows = r ? Object.entries(r.hands).map(([id, rank]) =>
    `<li>${esc(nameOf(id))}: <strong>${rank} ${cardName(rank)}</strong>${r.winners.includes(id) ? ' 💌' : ''}${r.spyBonus === id ? ' +1 Spy' : ''}</li>`).join('') : '';
  return `<section class="card-panel">
    ${r ? `<p>${esc(r.reason)}</p><p><strong>${r.winners.map(nameOf).map(esc).join(' & ')}</strong> ${r.winners.length > 1 ? 'win' : 'wins'} the round.</p>
    ${r.spyBonus ? `<p>${esc(nameOf(r.spyBonus))} gets +1 for the Spy.</p>` : ''}
    ${rows ? `<div class="label">Final hands</div><ul class="plain">${rows}</ul>` : ''}
    ${r.setAside != null ? `<p class="muted small">Face-down set-aside card was ${r.setAside} ${cardName(r.setAside)}.</p>` : ''}` : ''}
    ${isHost
      ? `<button class="btn primary" data-a="${v.phase === 'gameOver' ? 'again' : 'next'}">${v.phase === 'gameOver' ? 'Play again' : 'Next round'}</button>`
      : `<p class="muted">Waiting for the host to ${v.phase === 'gameOver' ? 'start a new game' : 'deal the next round'}…</p>`}
  </section>`;
}

function logHTML(v) {
  const items = v.log.slice(-25).reverse();
  return `<details class="log" open><summary>Game log</summary><ul>${items.map((e) => `<li class="${e.to ? 'private' : ''}">${esc(e.text)}</li>`).join('')}</ul></details>`;
}

function rulesHTML() {
  const v = S.view;
  // Unseen = not in any discard pile, not face up, not in my hand.
  const seen = {};
  if (v && v.phase !== 'lobby') {
    [...v.players.flatMap((p) => p.discards), ...v.faceUp, ...v.hand.map((c) => c.rank)].forEach((r) => { seen[r] = (seen[r] || 0) + 1; });
  }
  const showUnseen = v && v.phase !== 'lobby';
  return `<div class="sheet" data-a="closeRules"><div class="sheet-body" data-stop>
    <div class="p-row"><h2>Cards</h2><button class="chip" data-a="closeRules">Close</button></div>
    <p class="small muted">On your turn draw a card, then play one of your two. Knock others out, or hold the highest card when the deck runs out.
    Tokens to win: 2p 6 · 3p 5 · 4p 4 · 5–6p 3.</p>
    <table class="ref"><thead><tr><th>#</th><th>Card</th><th>In deck</th>${showUnseen ? '<th>Unseen</th>' : ''}</tr></thead><tbody>
    ${CARDS.map((c) => `<tr><td>${c.rank}</td><td>${ART[c.rank] ? `<img class="thumb" src="${esc(ART[c.rank])}" alt="">` : ''}<strong>${c.name}</strong><div class="small">${c.text}</div></td><td>${c.count}</td>${showUnseen ? `<td>${c.count - (seen[c.rank] || 0)}</td>` : ''}</tr>`).join('')}
    </tbody></table>
  </div></div>`;
}

// ---------- events ----------

$app.addEventListener('input', (e) => {
  if (e.target.id === 'name') { S.name = e.target.value; store.set('name', S.name); }
  if (e.target.id === 'code') e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, '');
});

$app.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.id === 'code') $app.querySelector('[data-a="join"]').click();
});

$app.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-a]');
  if (!el) return;
  if (el.dataset.a === 'closeRules' && e.target.closest('[data-stop]') && el.classList.contains('sheet')) return;
  const v = S.view;
  const needName = () => { if (!S.name.trim()) { toast('Enter your name first.'); return true; } return false; };

  switch (el.dataset.a) {
    case 'host': if (!needName()) hostRoom(); break;
    case 'join': {
      if (needName()) break;
      const code = document.getElementById('code').value.trim().toUpperCase();
      if (code.length !== 4) { toast('Room codes are 4 letters.'); break; }
      joinRoom(code); break;
    }
    case 'resume': {
      const sess = store.get(SESSION_KEY);
      if (sess?.role === 'host') hostRoom(sess); else if (sess) joinRoom(sess.code);
      break;
    }
    case 'leave':
      if (confirmLeave()) leave();
      break;
    case 'rules': S.showRules = true; render(); break;
    case 'closeRules': S.showRules = false; render(); break;
    case 'share': {
      const link = el.dataset.link;
      try {
        if (navigator.share) await navigator.share({ title: 'Love Letter', text: `Join my Love Letter room: ${S.code}`, url: link });
        else { await navigator.clipboard.writeText(link); toast('Link copied!'); }
      } catch { /* cancelled */ }
      break;
    }
    case 'kick': {
      // Mid-game, removing a player is permanent for this game, so ask for a second tap.
      if (v.phase !== 'lobby' && !armed('kick:' + el.dataset.id, `Tap Remove again to take ${nameOf(el.dataset.id)} out of the game.`)) break;
      leavePlayer(game, el.dataset.id); connsById.get(el.dataset.id)?.close(); connsById.delete(el.dataset.id); broadcast(); break;
    }
    case 'start': { const r = startGame(game); if (!r.ok) toast(r.error); broadcast(); break; }
    case 'next': startRound(game); broadcast(); break;
    case 'again': startGame(game); broadcast(); break;
    case 'pick': {
      if (S.submitting) break;
      const id = Number(el.dataset.id);
      if (v.phase === 'chancellor') { S.keep = id; S.bottom = []; }
      else { if (S.sel !== id) { S.target = null; S.guess = null; } S.sel = id; }
      render(); break;
    }
    case 'target': if (!S.submitting) { S.target = el.dataset.id; render(); } break;
    case 'guess': if (!S.submitting) { S.guess = Number(el.dataset.r); render(); } break;
    case 'play': act({ type: 'play', cardId: S.sel, target: S.target, guess: S.guess }); break;
    case 'swap': S.bottom = [...S.bottom].reverse(); render(); break;
    case 'keep': act({ type: 'chancellor', keepId: S.keep, bottom: S.bottom }); break;
  }
});

function confirmLeave() {
  return armed('leave', S.role === 'host' ? 'Tap Leave again to close the room for everyone.' : 'Tap Leave again to leave the room.');
}

// Avoid window.confirm (blocks some in-app browsers); use a second tap instead.
let armedKey = null, armedTimer;
function armed(key, msg) {
  if (armedKey === key) { armedKey = null; return true; }
  armedKey = key;
  toast(msg);
  clearTimeout(armedTimer);
  armedTimer = setTimeout(() => { armedKey = null; }, 3500);
  return false;
}

// ---------- card art ----------
// Drop images named by card number into the art/ folder (e.g. art/5.png for the Viscount).
// Any of these extensions work; cards without an image keep the text-only look.
const ART = {};
const ART_EXTS = ['png', 'jpg', 'jpeg', 'webp', 'svg'];

function findArt(rank) {
  return new Promise((resolve) => {
    let i = 0;
    const tryNext = () => {
      if (i >= ART_EXTS.length) return resolve(null);
      const url = `art/${rank}.${ART_EXTS[i++]}`;
      const img = new Image();
      img.onload = () => resolve(url);
      img.onerror = tryNext;
      img.src = url;
    };
    tryNext();
  });
}

Promise.all(CARDS.map(async (c) => { const url = await findArt(c.rank); if (url) ART[c.rank] = url; }))
  .then(() => { if (Object.keys(ART).length) render(); });

// Auto-rejoin after a refresh; prefill code from ?room=
(function boot() {
  const sess = store.get(SESSION_KEY);
  if (sess && Date.now() - sess.savedAt < SESSION_TTL && S.name && !params.get('room')) {
    if (sess.role === 'host') hostRoom(sess); else joinRoom(sess.code);
    return;
  }
  render();
})();
