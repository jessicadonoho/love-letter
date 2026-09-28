// Real layout checks in headless Chrome (no npm dependencies). Skipped when Chrome isn't found;
// set CHROME_PATH to point at a Chrome/Chromium binary.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const CHROME = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].find((p) => p && existsSync(p));

const root = fileURLToPath(new URL('../', import.meta.url));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.jpg': 'image/jpeg', '.png': 'image/png' };

let server, base;
test.before(async () => {
  if (!CHROME) return;
  server = createServer(async (req, res) => {
    if (req.method === 'POST' && req.url.startsWith('/__result')) {
      let body = '';
      for await (const chunk of req) body += chunk;
      waiting.get(new URL(req.url, 'http://x').searchParams.get('key'))?.(body);
      res.writeHead(204).end();
      return;
    }
    const file = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
    let body;
    try { body = await readFile(file); } catch { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' }).end(body);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { server?.closeAllConnections(); server?.close(); });

const waiting = new Map();   // key -> resolve(measurements JSON)
let nextKey = 0;

async function measure(query, [w]) {
  const key = String(nextKey++);
  const profile = await mkdtemp(path.join(tmpdir(), 'll-chrome-'));
  const result = new Promise((resolve) => waiting.set(key, resolve));
  const child = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars',
    `--user-data-dir=${profile}`, '--window-size=1400,1000',
    `${base}/tests/layout-fixture.html?${query}&frame=${w}&key=${key}`,
  ], { stdio: 'ignore' });
  let timer;
  try {
    const json = await Promise.race([result, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Chrome timed out')), 30000); })]);
    const out = JSON.parse(json);
    assert.equal(out.viewport, w, 'measured at the requested width');
    return out;
  } finally {
    clearTimeout(timer);
    waiting.delete(key);
    child.kill();
    rm(profile, { recursive: true, force: true }).catch(() => {});
  }
}

const near = (a, b, msg) => assert.ok(Math.abs(a - b) <= 1, `${msg}: ${a} vs ${b}`);

function checkAligned(out, label) {
  const [first, ...rest] = out.cards;
  assert.equal(out.pageOverflowX, false, `${label}: no horizontal page scroll`);
  for (const c of out.cards) {
    assert.equal(c.cardClipped, false, `${label}: card content is not clipped`);
    assert.equal(c.headOverflow, false, `${label}: title fits (wraps, no overflow) ${JSON.stringify(c.head)}`);
    assert.equal(c.textOverflow, false, `${label}: rule text fits (wraps, no overflow)`);
    assert.equal(c.textLen, c.expectedLen, `${label}: rule text is not truncated`);
    // Sections stack without overlapping and stay inside the card.
    const stack = [c.art, c.head, c.text, c.note].filter(Boolean);
    for (let i = 1; i < stack.length; i++) assert.ok(stack[i].top >= stack[i - 1].bottom - 0.5, `${label}: sections don't overlap`);
    assert.ok(c.note.bottom <= c.card.bottom + 0.5, `${label}: last section inside the card`);
    if (c.art) {
      near(c.art.width / c.art.height, 4 / 3, `${label}: art box is 4:3`);
      if (c.img) {
        assert.equal(c.img.fit, 'cover', `${label}: image is cropped, not stretched`);
        near(c.img.width, c.art.width, `${label}: image fills art width`);
        near(c.img.height, c.art.height, `${label}: image fills art height`);
      }
    }
  }
  for (const c of rest) {
    for (const k of ['width', 'height', 'top', 'bottom']) near(c.card[k], first.card[k], `${label}: card ${k}`);
    for (const s of ['art', 'head', 'text', 'note']) {
      if (!first[s]) { assert.equal(c[s], null, `${label}: every card has the same sections`); continue; }
      near(c[s].top, first[s].top, `${label}: ${s} starts at the same height`);
      near(c[s].height, first[s].height, `${label}: ${s} has the same height`);
      near(c[s].width, first[s].width, `${label}: ${s} has the same width`);
    }
  }
}

const VIEWPORTS = { mobile: [375, 812], desktop: [1280, 900] };
const CASES = {
  'two cards with art': 'ranks=1,8',
  'two cards, long title and rule text': 'ranks=6,1&long=1',
  'two cards, one without art': 'ranks=4,9&art=some',
  'two cards, no art anywhere': 'ranks=2,6&art=none',
  'two cards, forced-play note on one': 'ranks=7,8&note=1',
  'three cards (Chancellor)': 'ranks=6,3,9&long=1',
};

for (const [vp, size] of Object.entries(VIEWPORTS)) {
  for (const [name, query] of Object.entries(CASES)) {
    test(`layout (${vp}): ${name}`, { skip: !CHROME && 'Chrome not found' }, async () => {
      const out = await measure(query, size);
      assert.equal(out.cards.length, query.match(/ranks=([\d,]+)/)[1].split(',').length);
      checkAligned(out, `${vp} ${name}`);
    });
  }

  test(`layout (${vp}): single card keeps the same size it has in a two-card hand`, { skip: !CHROME && 'Chrome not found' }, async () => {
    const one = await measure('ranks=5', size);
    const two = await measure('ranks=5,6', size);
    checkAligned(one, `${vp} single`);
    near(one.cards[0].card.width, two.cards[0].card.width, 'single card width');
    near(one.cards[0].art.height, two.cards[0].art.height, 'single card art height');
    assert.ok(one.cards[0].card.left > two.cards[0].card.left, 'single card is centered');
  });
}

test('layout: art crops responsively (box scales with width, ratio fixed)', { skip: !CHROME && 'Chrome not found' }, async () => {
  const phone = await measure('ranks=1,8', VIEWPORTS.mobile);
  const desk = await measure('ranks=1,8', VIEWPORTS.desktop);
  assert.ok(desk.cards[0].art.width > phone.cards[0].art.width);
  for (const out of [phone, desk]) near(out.cards[0].art.width / out.cards[0].art.height, 4 / 3, 'ratio');
  // Source images are portrait, the box is landscape: cover crops instead of distorting.
  const [nw, nh] = phone.cards[0].img.natural;
  assert.ok(nw / nh < 4 / 3);
});
