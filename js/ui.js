// Pure HTML builders shared by main.js and the tests. No DOM access or app state here.
import { CARDS, cardName, cardLabel } from './engine.js';

export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- cards ----------

/**
 * One card. Every card has the same four sections (art, title, rule, note) so cards
 * in a hand line up row by row (see `.hand` in style.css).
 * `artSlot`: reserve the image area even if this card has no image, so cards match.
 */
export function cardHTML(c, { art = null, artSlot = !!art, selectable, selected, note = '', still = false } = {}) {
  const info = CARDS[c.rank];
  const artHTML = art
    ? `<span class="art"><img src="${esc(art)}" alt=""></span>`
    : artSlot ? `<span class="art art-empty" aria-hidden="true"><span>${c.rank}</span></span>` : '';
  // `still`: a picture of a card (e.g. in a popup), not a control.
  const tag = still ? 'div' : 'button';
  return `<${tag} class="card r${c.rank} ${artSlot ? 'has-art' : ''} ${selected ? 'selected' : ''} ${note ? 'blocked' : ''}" ${still ? '' : selectable ? `data-a="pick" data-id="${c.id}" aria-pressed="${selected ? 'true' : 'false'}"` : 'disabled'}>
    ${artHTML}
    <span class="card-head"><span class="rank">${c.rank}</span><span class="cname">${info.name}</span></span>
    <span class="ctext">${info.text}</span>
    <span class="note">${esc(note)}</span></${tag}>`;
}

/** A row of cards that share a layout grid. `artFor(rank)` returns an image URL or null. */
export function handGridHTML(cards, { artFor = () => null, cardOpts = () => ({}) } = {}) {
  const anyArt = cards.some((c) => artFor(c.rank));
  return `<div class="hand" data-count="${cards.length}" style="--cols:${Math.max(2, cards.length)}">${
    cards.map((c) => cardHTML(c, { art: artFor(c.rank), artSlot: anyArt, ...cardOpts(c) })).join('')}</div>`;
}

// ---------- fixed "Use this card" bar ----------

/**
 * The bottom action bar for the selected card.
 * mode: 'play' (normal turn) or 'keep' (Chancellor). `hint` explains the next step or a warning.
 */
export function useBarHTML({ mode = 'play', card, ready = true, hint = '', submitting = false }) {
  if (!card) return '';
  const verb = mode === 'keep' ? 'Keep this card' : 'Use this card';
  const illegal = !!card.blocked;
  const disabled = submitting || illegal || !ready;
  const note = submitting ? 'Sending your move…' : illegal ? card.blockedReason || 'You can\'t play this card right now.' : hint;
  const label = `${verb}: ${cardLabel(card.rank)}${note ? `. ${note}` : ''}`;
  return `<div class="use-bar" role="region" aria-label="Selected card">
    ${note ? `<p class="use-hint ${illegal ? 'warn' : ''}">${esc(note)}</p>` : ''}
    <button class="btn primary use-btn" data-a="${mode === 'keep' ? 'keep' : 'play'}" aria-label="${esc(label)}"${disabled ? ' disabled' : ''}${submitting ? ' aria-busy="true"' : ''}>
      ${submitting ? '<span class="spinner" aria-hidden="true"></span>' : ''}<span>${submitting ? 'Sending…' : verb}</span>
      <span class="use-card">${esc(cardLabel(card.rank))}</span>
    </button>
  </div>`;
}

// ---------- card-effect popups ----------

/** Plain-language description of an engine event, from `me`'s point of view. */
export function describeEvent(ev, me) {
  const you = (id) => id === me;
  const nm = (id, name) => (you(id) ? 'You' : name);
  switch (ev.type) {
    case 'guess': {
      // e.g. "Ann guessed Bea holds 7 King." / "You guessed Bea holds…" / "Ann guessed you hold…"
      const who = nm(ev.actor, ev.actorName);
      const target = you(ev.target) ? 'you hold' : `${ev.targetName} holds`;
      const guessed = `${who} guessed ${target} ${cardLabel(ev.guess)}`;
      const title = `${cardName(1)}: ${ev.correct ? 'correct guess' : 'wrong guess'}`;
      return ev.correct
        ? { icon: '🎯', title, text: `${guessed} — correct! ${you(ev.target) ? 'You are' : `${ev.targetName} is`} out of the round.` }
        : { icon: '💨', title, text: `${guessed} — wrong. ${you(ev.target) ? 'You stay' : `${ev.targetName} stays`} in the round.` };
    }
    case 'reveal':
      return {
        icon: '🗡️', card: ev.rank, title: `${cardName(2)}: ${ev.name}'s card`,
        text: `${ev.name} holds ${cardLabel(ev.rank)}. Only you can see this.`,
      };
    case 'seen':
      return {
        icon: '👀', card: ev.rank, title: `${cardName(2)}: ${ev.actorName} saw your card`,
        text: `${ev.actorName} used the ${cardName(2)} and now knows you hold ${cardLabel(ev.rank)}.`,
      };
    case 'eliminated':
      return {
        icon: '🏹', title: you(ev.player) ? 'You are out!' : `${ev.name} is out!`, dust: ev.name,
        text: `${you(ev.player) ? 'You are' : `${ev.name} is`} out of the round${ev.why ? ` (${ev.why})` : ''}.`,
      };
    case 'compare': {
      const title = `${cardName(3)}: ${nm(ev.actor, ev.actorName)} vs ${you(ev.target) ? 'you' : ev.targetName}`;
      if (!ev.winner) return { icon: '⚔️', title, text: 'It\'s a tie — nobody is out.' };
      const [w, l] = ev.winner === ev.actor ? [ev.actor, ev.target] : [ev.target, ev.actor];
      const name = (id) => (id === ev.actor ? ev.actorName : ev.targetName);
      return {
        icon: '⚔️', title,
        text: `${nm(w, name(w))} won the comparison against ${you(l) ? 'you' : name(l)}. ${you(l) ? 'You are' : `${name(l)} is`} out of the round.`,
      };
    }
    case 'protected':
      return {
        icon: '🛡️', title: you(ev.player) ? 'You are protected' : `${ev.name} is protected`,
        text: you(ev.player) ? 'No one can target you until your next turn.' : `No one can target ${ev.name} until their next turn.`,
      };
    case 'discard':
      return {
        icon: '🃏', title: `${cardName(5)}: ${you(ev.target) ? 'you' : ev.name} discarded a card`,
        text: `${you(ev.target) ? 'You' : ev.name} discarded ${cardLabel(ev.rank)}${ev.out ? '.' : ' and drew a new card.'}`,
      };
    case 'trade':
      // The King player gets no popup; the target is alerted and shown their new card.
      if (you(ev.target)) {
        return {
          icon: '👑', swap: { gave: ev.gave, got: ev.got }, title: `${cardName(7)}: ${ev.actorName} traded hands with you`,
          text: `${ev.actorName} used the ${cardName(7)} on you. You gave ${cardLabel(ev.gave)} and got ${cardLabel(ev.got)}.`,
        };
      }
      return { icon: '👑', title: `${cardName(7)}: ${ev.actorName} ⇄ ${ev.targetName}`, text: `${ev.actorName} used the ${cardName(7)} and traded hands with ${ev.targetName}.` };
    case 'countess':
      // The played card is face up, so showing it gives nothing away.
      return {
        icon: '💃', card: 8, title: `${ev.name} discarded the ${cardName(8)}`,
        text: `The ${cardName(8)} must be played when its holder also has a King, ${cardName(5)}, ${cardName(6)}, or Princess — but ${ev.name} may also have played it by choice.`,
      };
    case 'chancellor': {
      // Shown to the other players only; card backs stand in for the unknown cards.
      if (!ev.count) return { icon: '📜', title: `${cardName(6)}: no effect`, text: `The deck was empty, so ${ev.name} drew nothing.` };
      const n = ev.count === 1 ? '1 card' : `${ev.count} cards`;
      return {
        title: `${ev.name} played the ${cardName(6)}`, backs: ev.count,
        text: `${ev.name} drew ${n}, kept 1, and put ${n} face down on the bottom of the deck.`,
      };
    }
    case 'left':
      return { icon: '👋', title: `${ev.name} left the game`, text: `${ev.name} is out and won't take any more turns.` };
    default:
      return null;
  }
}

/** Letters that crumble to dust (CSS animation; static red when reduced motion is on). */
function dustHTML(name) {
  return [...name].map((ch, i) => `<span style="--i:${i};--dx:${((i * 37) % 21) - 10}px;--dy:${-8 - ((i * 13) % 12)}px">${ch === ' ' ? '&nbsp;' : esc(ch)}</span>`).join('');
}

export const CARD_BACK = 'art/back_of_card.jpg';

/**
 * Chancellor: the player's hand of `n + 1` face-down cards, then all but one slide away
 * to the bottom of the deck. The middle card stays, so the one kept isn't obvious.
 */
function backsHTML(n) {
  const keep = n >= 2 ? 1 : 0;
  const cards = Array.from({ length: n + 1 }, (_, i) =>
    `<img src="${CARD_BACK}" alt="" class="${i === keep ? 'kept' : 'leave'}" style="--i:${i}">`).join('');
  return `<div class="fx-chancellor-art" aria-hidden="true">
    <div class="fx-backs-cards">${cards}</div>
    <span class="fx-backs-label">Kept 1 · ${n} to the bottom of the deck</span>
  </div>`;
}

/** Two cards side by side: the one you gave and the one you got. */
function swapHTML({ gave, got }, artFor) {
  const col = (label, rank) => `<div class="fx-swap-col"><span class="fx-backs-label">${label}</span>${
    handGridHTML([{ id: 'fx', rank }], { artFor, cardOpts: () => ({ still: true }) })}</div>`;
  return `<div class="fx-swap">${col('You gave', gave)}<span class="fx-swap-arrow" aria-hidden="true">⇄</span>${col('You got', got)}</div>`;
}

/**
 * The popup for one event. `remaining` = how many more are queued behind it.
 * `artFor(rank)` returns a card image URL or null (for events that show a card).
 */
export function fxHTML(ev, me, remaining = 0, { artFor = () => null } = {}) {
  const d = describeEvent(ev, me);
  if (!d) return '';
  return `<div class="fx" data-fx="backdrop">
    <div class="fx-card fx-${ev.type}" role="dialog" aria-modal="true" aria-labelledby="fx-title" aria-describedby="fx-text">
      ${d.backs ? backsHTML(d.backs)
        : d.swap ? swapHTML(d.swap, artFor)
        : d.card != null ? `<div class="fx-shown-card">${handGridHTML([{ id: 'fx', rank: d.card }], { artFor, cardOpts: () => ({ still: true }) })}</div>`
        : `<div class="fx-icon" aria-hidden="true">${d.icon}</div>`}
      ${d.dust ? `<div class="fx-name dust" aria-hidden="true">${dustHTML(d.dust)}</div>` : ''}
      <h2 id="fx-title">${esc(d.title)}</h2>
      <p id="fx-text">${esc(d.text)}</p>
      ${remaining ? `<p class="muted small">${remaining} more update${remaining > 1 ? 's' : ''} waiting</p>` : ''}
      <button class="btn primary" data-fx="ok">${remaining ? 'Next' : 'OK'}</button>
    </div>
  </div>`;
}

// ---------- end-of-round / end-of-game result ----------

export const RESULT_ART = { won: 'art/you-won.jpg', lost: 'art/you-lost.jpeg' };

/**
 * "You won!" / "You lost" banner with artwork.
 * scope: 'round' or 'game'. `winnerNames`: everyone who won (you may be one of them).
 */
export function resultHeroHTML({ won, scope, winnerNames = [], otherWinners = [] }) {
  const what = scope === 'game' ? 'the game' : 'this round';
  const title = won ? 'You won!' : 'You lost';
  const sub = won
    ? `You won ${what}${otherWinners.length ? ` (tied with ${otherWinners.map(esc).join(' & ')})` : ''}.`
    : winnerNames.length ? `${winnerNames.map(esc).join(' & ')} won ${what}.` : `You didn't win ${what}.`;
  return `<div class="result-hero ${won ? 'won' : 'lost'}" role="status">
    <img src="${won ? RESULT_ART.won : RESULT_ART.lost}" alt="">
    <h2>${won ? '<span aria-hidden="true">💖 </span>' : ''}${title}</h2>
    <p>${sub}</p>
  </div>`;
}

const CONFETTI_COLORS = ['#ff4f8b', '#e0115f', '#ff9ec4', '#c8102e', '#ffc2d9', '#b3003c'];

/** Falling confetti: pink and red paper bits plus hearts. `rng` makes it testable. */
export function confettiHTML(count = 90, rng = Math.random) {
  const pieces = [];
  for (let i = 0; i < count; i++) {
    const color = CONFETTI_COLORS[Math.floor(rng() * CONFETTI_COLORS.length)];
    const kind = i % 3 === 0 ? 'heart' : i % 3 === 1 ? 'strip' : 'dot';
    const style = [
      `left:${(rng() * 100).toFixed(1)}%`,
      `--c:${color}`,
      `--delay:${(rng() * 1.8).toFixed(2)}s`,
      `--dur:${(2.8 + rng() * 2.2).toFixed(2)}s`,
      `--sway:${Math.round(rng() * 120 - 60)}px`,
      `--spin:${Math.round(rng() * 720 - 360)}deg`,
      `--size:${kind === 'heart' ? Math.round(14 + rng() * 14) : Math.round(7 + rng() * 6)}px`,
    ].join(';');
    pieces.push(`<span class="confetti-${kind}" style="${style}">${kind === 'heart' ? '♥' : ''}</span>`);
  }
  return `<div class="confetti" aria-hidden="true">${pieces.join('')}</div>`;
}
