// Pure HTML builders shared by main.js and the tests. No DOM access or app state here.
import { CARDS, cardName, cardLabel } from './engine.js';

export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- cards ----------

/**
 * One card. Every card has the same four sections (art, title, rule, note) so cards
 * in a hand line up row by row (see `.hand` in style.css).
 * `artSlot`: reserve the image area even if this card has no image, so cards match.
 */
export function cardHTML(c, { art = null, artSlot = !!art, selectable, selected, note = '' } = {}) {
  const info = CARDS[c.rank];
  const artHTML = art
    ? `<span class="art"><img src="${esc(art)}" alt=""></span>`
    : artSlot ? `<span class="art art-empty" aria-hidden="true"><span>${c.rank}</span></span>` : '';
  return `<button class="card r${c.rank} ${artSlot ? 'has-art' : ''} ${selected ? 'selected' : ''} ${note ? 'blocked' : ''}" ${selectable ? `data-a="pick" data-id="${c.id}" aria-pressed="${selected ? 'true' : 'false'}"` : 'disabled'}>
    ${artHTML}
    <span class="card-head"><span class="rank">${c.rank}</span><span class="cname">${info.name}</span></span>
    <span class="ctext">${info.text}</span>
    <span class="note">${esc(note)}</span></button>`;
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
        icon: '🗡️', title: `${cardName(2)}: ${ev.name}'s card`,
        text: `${ev.name} holds ${cardLabel(ev.rank)}. Only you can see this.`,
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

/** The popup for one event. `remaining` = how many more are queued behind it. */
export function fxHTML(ev, me, remaining = 0) {
  const d = describeEvent(ev, me);
  if (!d) return '';
  return `<div class="fx" data-fx="backdrop">
    <div class="fx-card fx-${ev.type}" role="dialog" aria-modal="true" aria-labelledby="fx-title" aria-describedby="fx-text">
      <div class="fx-icon" aria-hidden="true">${d.icon}</div>
      ${d.dust ? `<div class="fx-name dust" aria-hidden="true">${dustHTML(d.dust)}</div>` : ''}
      <h2 id="fx-title">${esc(d.title)}</h2>
      <p id="fx-text">${esc(d.text)}</p>
      ${remaining ? `<p class="muted small">${remaining} more update${remaining > 1 ? 's' : ''} waiting</p>` : ''}
      <button class="btn primary" data-fx="ok">${remaining ? 'Next' : 'OK'}</button>
    </div>
  </div>`;
}
