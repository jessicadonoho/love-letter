import {
  CARDS, cardName, MIN_PLAYERS, MAX_PLAYERS,
  createGame, addPlayer, removePlayer, startGame, startRound, applyAction, viewFor,
} from './engine.js';
import { Host, Client } from './net.js';

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
};

let game = null;   // host only: authoritative game state
let host = null;   // host only: Host network wrapper
let client = null; // client only
const connsById = new Map(); // host only: clientId -> conn

const $app = document.getElementById('app');

// ---------- helpers ----------

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
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
    removePlayer(game, conn.clientId);
    connsById.delete(conn.clientId);
    broadcast();
  }
}

function hostAct(action) {
  const res = applyAction(game, clientId, action);
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
        if (!prev || prev.phase !== msg.view.phase || prev.turnPlayer !== msg.view.turnPlayer) resetSelection();
        store.set(SESSION_KEY, { role: 'client', code: S.code, savedAt: Date.now() });
        keepAwake();
        render();
      } else if (msg.t === 'error') {
        toast(msg.error);
      } else if (msg.t === 'rejected') {
        leave(msg.error);
      }
    },
  });
  client.start();
  if (!quiet) render();
}

function act(action) {
  if (S.role === 'host') return hostAct(action);
  if (!client.send({ t: 'action', action })) toast('Not connected — try again in a moment.');
  else resetSelection();
  render();
}

function leave(reason) {
  if (S.role === 'client') client?.send({ t: 'leave' });
  setTimeout(() => { client?.destroy(); host?.destroy(); client = host = null; }, 200);
  game = null; connsById.clear();
  store.del(SESSION_KEY);
  Object.assign(S, { screen: 'home', role: null, view: null, code: '', status: '' });
  resetSelection();
  if (reason) toast(reason); else render();
}

// ---------- rendering ----------

function render() {
  $app.innerHTML = (S.screen === 'home' ? homeHTML() : roomHTML())
    + (S.showRules ? rulesHTML() : '')
    + (S.toast ? `<div class="toast" role="status">${esc(S.toast)}</div>` : '');
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
  return `<div class="banner ${v.myTurn ? 'mine' : ''}">${text}</div>`;
}

function playersHTML(v) {
  return `<ul class="players">${v.players.map((p) => `
    <li class="player ${p.alive ? '' : 'out'} ${p.id === v.turnPlayer ? 'turn' : ''}">
      <div class="p-row">
        <span class="p-name">${p.id === v.turnPlayer ? '▶ ' : ''}${esc(p.name)}${p.id === v.me ? ' (you)' : ''}</span>
        ${p.protected ? '<span class="badge">🛡 protected</span>' : ''}
        ${p.alive ? '' : '<span class="badge">out</span>'}
        ${dot(p.id)}
        <span class="tokens" title="Tokens">${'♥'.repeat(p.tokens)}<span class="muted">${'♡'.repeat(Math.max(0, (v.tokensToWin || 0) - p.tokens))}</span></span>
      </div>
      <div class="discards">${p.discards.length ? p.discards.map((r) => `<span class="mini r${r}">${r} ${cardName(r)}</span>`).join('') : '<span class="muted">no discards</span>'}</div>
    </li>`).join('')}
  </ul>
  ${v.faceUp.length ? `<div class="muted small">Set aside face up: ${v.faceUp.map((r) => `${r} ${cardName(r)}`).join(', ')}</div>` : ''}`;
}

function cardHTML(c, { selectable, selected, note } = {}) {
  const info = CARDS[c.rank];
  const art = ART[c.rank];
  return `<button class="card r${c.rank} ${art ? 'has-art' : ''} ${selected ? 'selected' : ''}" ${selectable ? `data-a="pick" data-id="${c.id}"` : 'disabled'}>
    ${art ? `<span class="art"><img src="${esc(art)}" alt=""></span>` : ''}
    <span class="card-head"><span class="rank">${c.rank}</span><span class="cname">${info.name}</span></span>
    <span class="ctext">${info.text}</span>${note ? `<span class="note">${note}</span>` : ''}</button>`;
}

function handHTML(v) {
  const me = v.players.find((p) => p.id === v.me);
  if (!me?.alive) return '<h2>Your hand</h2><p class="muted">You\'re out until next round.</p>';

  if (v.phase === 'chancellor' && v.myTurn) return chancellorHTML(v);

  const cards = v.hand.map((c) => cardHTML(c, {
    selectable: v.myTurn && !c.blocked,
    selected: S.sel === c.id,
    note: c.blocked ? 'Must play Countess' : '',
  })).join('');
  let panel = '';
  const sel = v.myTurn && v.hand.find((c) => c.id === S.sel);
  if (sel) panel = actionPanelHTML(v, sel);
  return `<h2>Your hand</h2><div class="hand">${cards}</div>${panel}`;
}

function actionPanelHTML(v, c) {
  const needsTarget = [1, 2, 3, 5, 7].includes(c.rank);
  let body = '';
  if (needsTarget && !c.targets.length) {
    body = '<p class="muted">Everyone else is protected or out — this card will have no effect.</p>';
  } else if (needsTarget) {
    body = `<div class="label">${c.rank === 5 ? 'Choose a player (can be you)' : 'Choose a player'}</div>
      <div class="opts">${c.targets.map((id) => `<button class="opt ${S.target === id ? 'on' : ''}" data-a="target" data-id="${esc(id)}">${esc(id === v.me ? 'Me' : nameOf(id))}</button>`).join('')}</div>`;
    if (c.rank === 1) {
      body += `<div class="label">Guess their card</div><div class="opts guess">${
        [0, 2, 3, 4, 5, 6, 7, 8, 9].map((r) => `<button class="opt ${S.guess === r ? 'on' : ''}" data-a="guess" data-r="${r}">${r} ${cardName(r)}</button>`).join('')}</div>`;
    }
  }
  if (c.rank === 9) body += '<p class="warn">Playing the Princess knocks you out of the round!</p>';
  const ready = !needsTarget || !c.targets.length || (S.target && (c.rank !== 1 || S.guess != null));
  return `<section class="action">${body}
    <button class="btn primary" data-a="play" ${ready ? '' : 'disabled'}>Play ${cardName(c.rank)}</button></section>`;
}

function chancellorHTML(v) {
  const cards = v.hand.map((c) => cardHTML(c, { selectable: true, selected: S.keep === c.id })).join('');
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
  return `<h2>Tap the card to keep</h2><div class="hand">${cards}</div>
    <section class="action">${order}<button class="btn primary" data-a="keep" ${S.keep == null ? 'disabled' : ''}>Keep it</button></section>`;
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
    case 'kick': removePlayer(game, el.dataset.id); connsById.get(el.dataset.id)?.close(); connsById.delete(el.dataset.id); broadcast(); break;
    case 'start': { const r = startGame(game); if (!r.ok) toast(r.error); broadcast(); break; }
    case 'next': startRound(game); broadcast(); break;
    case 'again': startGame(game); broadcast(); break;
    case 'pick': {
      const id = Number(el.dataset.id);
      if (v.phase === 'chancellor') { S.keep = id; S.bottom = []; }
      else { if (S.sel !== id) { S.target = null; S.guess = null; } S.sel = id; }
      render(); break;
    }
    case 'target': S.target = el.dataset.id; render(); break;
    case 'guess': S.guess = Number(el.dataset.r); render(); break;
    case 'play': act({ type: 'play', cardId: S.sel, target: S.target, guess: S.guess }); break;
    case 'swap': S.bottom = [...S.bottom].reverse(); render(); break;
    case 'keep': act({ type: 'chancellor', keepId: S.keep, bottom: S.bottom }); break;
  }
});

function confirmLeave() {
  // Avoid window.confirm (blocks some in-app browsers); use a second tap instead.
  if (S.leaveArmed) { S.leaveArmed = false; return true; }
  S.leaveArmed = true;
  toast(S.role === 'host' ? 'Tap Leave again to close the room for everyone.' : 'Tap Leave again to leave the room.');
  setTimeout(() => { S.leaveArmed = false; }, 3500);
  return false;
}

// ---------- card art ----------
// Drop images named by card number into the art/ folder (e.g. art/5.png for the Prince).
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
