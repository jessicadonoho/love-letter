// UI helpers (pure HTML builders) and user-facing text checks.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { CARDS } from '../js/engine.js';
import { useBarHTML, describeEvent, fxHTML, handGridHTML, CARD_BACK } from '../js/ui.js';

const root = new URL('../', import.meta.url);
const read = (f) => readFileSync(new URL(f, root), 'utf8');

// ---------- names ----------

test('cards use the new names', () => {
  assert.deepEqual([1, 2, 3, 5].map((r) => CARDS[r].name), ['Maid', 'Assassin', 'Mercenary', 'Viscount']);
  assert.equal(CARDS[8].text, 'If you hold a King, Viscount, Chancellor, or Princess, you must play this card.');
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
  const html = useBarHTML({ card: card(7, { blocked: true, blockedReason: 'If you hold a King, Viscount, Chancellor, or Princess, you must play the Countess.' }) });
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
  const html = fxHTML({ type: 'reveal', target: 'b', name: 'Bea', rank: 7 }, 'a', 0, { artFor: (r) => `art/${r}.jpg` });
  assert.match(html, /<div class="card r7 has-art/, 'shows the card as a picture, not a button');
  assert.ok(html.includes('src="art/7.jpg"'), 'with its art');
  assert.ok(html.includes(CARDS[7].text), 'and its rule');
  assert.ok(!html.includes('class="fx-icon"'));
});

test('Assassin target popup says who saw their card', () => {
  const html = fxHTML({ type: 'seen', actor: 'a', actorName: 'Ann', rank: 7 }, 'b', 0, { artFor: (r) => `art/${r}.jpg` });
  assert.match(html, /Assassin: Ann saw your card/);
  assert.match(html, /Ann used the Assassin and now knows you hold 7 King/);
  assert.match(html, /<div class="card r7 has-art/);
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

test('Chancellor popup: card backs and a count, never card names', () => {
  const ev = { type: 'chancellor', actor: 'a', name: 'Ann', count: 2 };
  const d = describeEvent(ev, 'b');
  assert.match(d.title, /Ann played the Chancellor/);
  assert.match(d.text, /^Ann drew 2 cards, kept 1, and put 2 cards face down on the bottom of the deck\.$/);
  const html = fxHTML(ev, 'b');
  assert.equal(html.split(CARD_BACK).length - 1, 3, 'three cards in hand');
  assert.equal(html.split('class="leave"').length - 1, 2, 'two go to the bottom');
  assert.equal(html.split('class="kept"').length - 1, 1, 'one is kept');
  assert.equal(fxHTML({ ...ev, count: 1 }, 'b').split('class="leave"').length - 1, 1, 'deck had only 1 card');
  assert.ok(!html.includes('class="fx-icon"'));
  for (const c of CARDS.filter((c) => c.rank !== 6)) assert.ok(!html.includes(c.name), `mentions ${c.name}`);
  assert.ok(existsSync(new URL(CARD_BACK, root)), 'card back image exists');
  assert.match(describeEvent({ ...ev, count: 0 }, 'b').text, /deck was empty/);
});

test('King popup: target is alerted with their new card, others see who traded', () => {
  const base = { type: 'trade', actor: 'a', actorName: 'Ann', target: 'b', targetName: 'Bea' };
  const other = describeEvent(base, 'c');
  assert.match(other.text, /Ann used the King and traded hands with Bea/);
  assert.equal(other.card, undefined);
  const mine = fxHTML({ ...base, gave: 8, got: 3 }, 'b', 0, { artFor: (r) => `art/${r}.jpg` });
  assert.match(mine, /Ann traded hands with you/);
  assert.match(mine, /You gave 8 Countess and got 3 Mercenary/);
  assert.ok(mine.indexOf('You gave') < mine.indexOf('class="card r8') && mine.indexOf('class="card r8') < mine.indexOf('You got'), 'gave card first');
  assert.match(mine, /You got<\/span>[\s\S]*<div class="card r3 has-art/);
});

test('Maid guess buttons show how many of each card are in the whole deck', () => {
  assert.match(read('js/main.js'), /data-a="guess"[^`]*\(\$\{CARDS\[r\]\.count\}\)/);
  assert.equal(CARDS[9].count, 1);
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

test('Maid popup: correct and wrong guesses, from each point of view', () => {
  const base = { type: 'guess', actor: 'a', actorName: 'Ann', target: 'b', targetName: 'Bea', guess: 7 };
  const right = describeEvent({ ...base, correct: true }, 'c');
  assert.match(right.title, /Maid: correct guess/);
  assert.match(right.text, /Ann guessed Bea holds 7 King — correct! Bea is out of the round\./);
  const wrong = describeEvent({ ...base, correct: false }, 'c');
  assert.match(wrong.title, /Maid: wrong guess/);
  assert.match(wrong.text, /Ann guessed Bea holds 7 King — wrong\. Bea stays in the round\./);
  assert.match(describeEvent({ ...base, correct: false }, 'a').text, /^You guessed Bea holds/);
  assert.match(describeEvent({ ...base, correct: false }, 'b').text, /Ann guessed you hold 7 King — wrong\. You stay in the round\./);
  assert.match(describeEvent({ ...base, correct: true }, 'b').text, /You are out of the round/);
  assert.notEqual(right.icon, wrong.icon, 'icons differ, but the text says the result too');
});

test('index.html uses one cache-busting version for every file', () => {
  const html = read('index.html');
  const versions = [...html.matchAll(/\?v=([\w-]+)/g)].map((m) => m[1]);
  assert.ok(versions.length >= 2);
  assert.equal(new Set(versions).size, 1, `mixed versions: ${versions}`);
  for (const f of readdirSync(new URL('js/', root))) {
    assert.ok(html.includes(`js/${f}?v=`), `js/${f} has no version in index.html`);
  }
});

// ---------- results ----------

import { resultHeroHTML, confettiHTML, RESULT_ART } from '../js/ui.js';
import { existsSync } from 'node:fs';

test('result hero: you won / you lost with the right image and text', () => {
  const won = resultHeroHTML({ won: true, scope: 'game', winnerNames: ['Ann'] });
  assert.match(won, /You won!/);
  assert.match(won, /You won the game\./);
  assert.ok(won.includes(RESULT_ART.won));
  const lost = resultHeroHTML({ won: false, scope: 'round', winnerNames: ['Bea'] });
  assert.match(lost, /You lost/);
  assert.match(lost, /Bea won this round\./);
  assert.ok(lost.includes(RESULT_ART.lost));
  assert.match(resultHeroHTML({ won: true, scope: 'round', otherWinners: ['Cy'] }), /tied with Cy/);
  assert.match(lost, /role="status"/);
  assert.ok(!resultHeroHTML({ won: false, scope: 'game', winnerNames: ['<b>'] }).includes('<b>'));
  for (const f of Object.values(RESULT_ART)) assert.ok(existsSync(new URL(f, root)), `${f} exists`);
});

test('confetti: pink and red pieces with hearts, decorative only', () => {
  let seed = 1;
  const html = confettiHTML(30, () => ((seed = (seed * 16807) % 2147483647) / 2147483647));
  assert.match(html, /class="confetti" aria-hidden="true"/);
  assert.equal(html.match(/<span class="confetti-/g).length, 30);
  assert.equal(html.match(/confetti-heart[^>]*>♥</g).length, 10);
  const colors = new Set(html.match(/--c:(#[0-9a-f]+)/g).map((m) => m.slice(4)));
  for (const c of colors) {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
    assert.ok(r > g && r > b, `${c} is pink/red`);
  }
  assert.match(read('style.css'), /prefers-reduced-motion: reduce\) \{ \.confetti \{ display: none; \} \}/);
});

// ---------- home screen & version stamping ----------

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('home screen: hosting comes after joining, name, and rules', () => {
  const src = read('js/main.js');
  const home = src.slice(src.indexOf('function homeHTML'), src.indexOf('function roomHTML'));
  const at = (s) => { const i = home.indexOf(s); assert.ok(i >= 0, s); return i; };
  const host = at('data-a="host"');
  for (const before of ['id="name"', 'data-a="resume"', 'id="code"', 'data-a="join"', 'data-a="rules"']) {
    assert.ok(at(before) < host, `${before} comes before Host`);
  }
  assert.ok(!/class="btn primary" data-a="host"/.test(home), 'Host is not the highlighted button');
  assert.ok(at('versionHTML()') < at('id="name"'), 'version shows near the top');
});

test('deploy stamping: commit ID replaces every ?v=dev, message is escaped, version.json written', () => {
  const out = mkdtempSync(path.join(tmpdir(), 'll-site-'));
  try {
    execFileSync(process.execPath, [new URL('../scripts/stamp-version.mjs', import.meta.url).pathname, out], {
      env: { ...process.env, VERSION_SHA: 'abc1234def', VERSION_MESSAGE: 'fix "cards" <b>& more', VERSION_DATE: '2026-09-28T16:00:00Z' },
    });
    const html = readFileSync(path.join(out, 'index.html'), 'utf8');
    assert.ok(!html.includes('?v=dev'));
    assert.equal(html.match(/\?v=abc1234\b/g).length, html.match(/\?v=/g).length);
    assert.match(html, /<meta name="app-version" content="abc1234" data-message="fix &quot;cards&quot; &lt;b&gt;&amp; more" data-date="2026-09-28T16:00:00Z">/);
    assert.deepEqual(JSON.parse(readFileSync(path.join(out, 'version.json'), 'utf8')), { sha: 'abc1234', message: 'fix "cards" <b>& more', date: '2026-09-28T16:00:00Z' });
    for (const f of ['style.css', 'js/main.js', 'js/ui.js', 'art/you-won.jpg', '.nojekyll']) assert.ok(existsSync(path.join(out, f)), f);
    assert.ok(!existsSync(path.join(out, 'tests')) && !existsSync(path.join(out, 'art/error-example')));
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
