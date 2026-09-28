// UI helpers (pure HTML builders) and user-facing text checks.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { CARDS } from '../js/engine.js';
import { useBarHTML, describeEvent, fxHTML, handGridHTML } from '../js/ui.js';

const root = new URL('../', import.meta.url);
const read = (f) => readFileSync(new URL(f, root), 'utf8');

// ---------- names ----------

test('cards use the new names', () => {
  assert.deepEqual([1, 2, 3, 5].map((r) => CARDS[r].name), ['Maid', 'Assassin', 'Mercenary', 'Viscount']);
  assert.equal(CARDS[8].text, 'If you hold a King, Viscount, or Princess, you must play this card.');
});

test('old card names and the "precvent" typo appear nowhere user-facing', () => {
  const files = ['index.html', 'README.md', 'art/README.md', 'style.css',
    ...readdirSync(new URL('js/', root)).map((f) => `js/${f}`)];
  for (const f of files) {
    const text = read(f);
    // \b keeps "Princess" and "Handmaid" from matching.
    const hit = text.match(/\b(Guard|Priest|Baron|Prince)\b/);
    assert.equal(hit, null, `${f} still mentions "${hit?.[0]}"`);
    assert.ok(!/precvent/i.test(text), `${f} has the "precvent" typo`);
  }
});

// ---------- "Use this card" bar ----------

const card = (rank, extra = {}) => ({ id: 1, rank, targets: [], blocked: false, blockedReason: null, ...extra });
const btn = (html) => html.match(/<button[^>]*>/)[0];

test('use bar: hidden without a selected card', () => {
  assert.equal(useBarHTML({ card: undefined }), '');
});

test('use bar: enabled with a descriptive label', () => {
  const html = useBarHTML({ card: card(4) });
  assert.match(html, /class="use-bar"/);
  assert.ok(!btn(html).includes('disabled'));
  assert.match(btn(html), /data-a="play"/);
  assert.match(btn(html), /aria-label="Use this card: 4 Handmaid"/);
  assert.match(html, />Use this card</);
});

test('use bar: disabled until the next step is done, and says what it is', () => {
  const html = useBarHTML({ card: card(2, { targets: ['p1'] }), ready: false, hint: 'Next: choose a player above.' });
  assert.match(btn(html), / disabled/);
  assert.match(html, /Next: choose a player above\./);
  assert.match(btn(html), /aria-label="Use this card: 2 Assassin\. Next: choose a player above\."/);
});

test('use bar: disabled with an explanation for an illegal card', () => {
  const html = useBarHTML({ card: card(7, { blocked: true, blockedReason: 'If you hold a King, Viscount, or Princess, you must play the Countess.' }) });
  assert.match(btn(html), / disabled/);
  assert.match(html, /use-hint warn/);
  assert.match(html, /must play the Countess/);
});

test('use bar: loading state is disabled and busy', () => {
  const html = useBarHTML({ card: card(4), submitting: true });
  assert.match(btn(html), / disabled/);
  assert.match(btn(html), /aria-busy="true"/);
  assert.match(html, /Sending…/);
  assert.match(html, /class="spinner" aria-hidden="true"/);
});

test('use bar: Chancellor keep mode', () => {
  const html = useBarHTML({ mode: 'keep', card: card(7) });
  assert.match(btn(html), /data-a="keep"/);
  assert.match(html, /Keep this card/);
});

test('use bar CSS: fixed to the bottom, safe-area aware, focus-visible, content padded clear', () => {
  const css = read('style.css');
  const bar = css.match(/\.use-bar \{[^}]*\}/)[0];
  assert.match(bar, /position: fixed/);
  assert.match(bar, /bottom: 0/);
  assert.match(bar, /env\(safe-area-inset-bottom\)/);
  assert.match(css, /body\.has-bar main \{ padding-bottom: calc\([^)]*env\(safe-area-inset-bottom\)\)/);
  assert.match(css, /\.btn:focus-visible[^{]*\{[^}]*outline: 3px solid/);
  // Popups and the rules sheet stack above the bar.
  const z = (sel) => Number(css.match(new RegExp(`\\${sel} \\{[^}]*z-index: (\\d+)`))[1]);
  assert.ok(z('.fx') > z('.use-bar') && z('.sheet') > z('.use-bar'));
  // No duplicate Play button left in the inline action panel.
  assert.ok(!/data-a="play"/.test(read('js/main.js')), 'only the fixed bar has the play button');
});

// ---------- effect popups ----------

test('Assassin popup names the target and the card', () => {
  const d = describeEvent({ type: 'reveal', target: 'b', name: 'Bea', rank: 7 }, 'a');
  assert.match(d.title, /Assassin/);
  assert.match(d.text, /Bea holds 7 King/);
  assert.match(d.text, /Only you can see this/);
});

test('elimination popup: 🏹, plain text, decorative animated name', () => {
  const ev = { type: 'eliminated', player: 'b', name: 'Bea', why: 'discarded the Princess' };
  const d = describeEvent(ev, 'a');
  assert.equal(d.icon, '🏹');
  assert.match(d.text, /Bea is out of the round/);
  assert.match(describeEvent(ev, 'b').text, /You are out of the round/);
  const html = fxHTML(ev, 'a');
  assert.match(html, /class="fx-icon" aria-hidden="true">🏹/);
  assert.match(html, /class="fx-name dust" aria-hidden="true"/);
  assert.match(html, /role="dialog" aria-modal="true" aria-labelledby="fx-title" aria-describedby="fx-text"/);
  assert.match(read('style.css'), /prefers-reduced-motion: reduce[\s\S]*\.dust span[^{]*\{ animation: none; \}/);
});

test('Mercenary popup names the winner (or a tie) and never a card', () => {
  const base = { type: 'compare', actor: 'a', actorName: 'Ann', target: 'b', targetName: 'Bea' };
  const won = describeEvent({ ...base, winner: 'b' }, 'c');
  assert.match(won.text, /Bea won the comparison against Ann\. Ann is out of the round\./);
  assert.match(describeEvent({ ...base, winner: 'a' }, 'a').text, /You won the comparison against Bea/);
  assert.match(describeEvent({ ...base, winner: 'a' }, 'b').text, /against you\. You are out/);
  assert.match(describeEvent({ ...base, winner: null }, 'c').text, /tie — nobody is out/);
  for (const c of CARDS) assert.ok(!won.text.includes(c.name), `mentions ${c.name}`);
});

test('protection popup and shield indicator label', () => {
  const html = fxHTML({ type: 'protected', player: 'a', name: 'Ann' }, 'b');
  assert.match(html, /🛡️/);
  assert.match(html, /No one can target Ann until their next turn/);
  assert.match(read('js/main.js'), /aria-label="Protected until next turn"/);
});

test('Viscount popup shows the discarded card', () => {
  const d = describeEvent({ type: 'discard', target: 'b', name: 'Bea', rank: 3, out: false }, 'a');
  assert.match(d.title, /Viscount/);
  assert.match(d.text, /Bea discarded 3 Mercenary and drew a new card/);
  assert.match(describeEvent({ type: 'discard', target: 'b', name: 'Bea', rank: 9, out: true }, 'a').text, /discarded 9 Princess\./);
});

test('queued popups say how many are waiting', () => {
  const html = fxHTML({ type: 'left', player: 'b', name: 'Bea' }, 'a', 2);
  assert.match(html, /2 more updates waiting/);
  assert.match(html, />Next</);
  assert.equal(fxHTML({ type: 'mystery' }, 'a'), '');
});

test('names are HTML-escaped in popups', () => {
  const html = fxHTML({ type: 'left', player: 'b', name: '<img src=x>' }, 'a');
  assert.ok(!html.includes('<img'));
});

// ---------- hand markup ----------

test('hand grid: one column per card, shared art slot, same sections on every card', () => {
  const cards = [{ id: 1, rank: 7 }, { id: 2, rank: 6 }];
  const html = handGridHTML(cards, { artFor: (r) => (r === 7 ? 'art/7.jpg' : null) });
  assert.match(html, /data-count="2" style="--cols:2"/);
  assert.equal(html.match(/class="art/g).length, 2, 'card without art still gets an image area');
  for (const cls of ['card-head', 'ctext', 'note']) assert.equal(html.match(new RegExp(`class="${cls}"`, 'g')).length, 2);
  assert.match(handGridHTML([cards[0]]), /data-count="1" style="--cols:2"/);
});
