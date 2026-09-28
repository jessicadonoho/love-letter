// Builds the site for GitHub Pages into an output folder (default: _site) and stamps it with
// the current git commit: every ?v=dev becomes ?v=<short sha>, <meta name="app-version"> gets
// the sha, commit message and date, and version.json lets open pages detect a newer deploy.
//
// Usage: node scripts/stamp-version.mjs [outDir]
// VERSION_SHA / VERSION_MESSAGE / VERSION_DATE override git (used by the tests).
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const out = path.resolve(process.argv[2] || path.join(root, '_site'));
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();

const sha = (process.env.VERSION_SHA || git('rev-parse', 'HEAD')).slice(0, 7);
const message = process.env.VERSION_MESSAGE ?? git('log', '-1', '--format=%s');
const date = process.env.VERSION_DATE ?? git('log', '-1', '--format=%cI');

const attr = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Only what the site needs (no tests, scripts, or screenshots of bugs).
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const f of ['index.html', 'style.css', 'js', 'art']) {
  cpSync(path.join(root, f), path.join(out, f), { recursive: true, filter: (src) => !src.includes(`${path.sep}error-example`) });
}
writeFileSync(path.join(out, '.nojekyll'), '');   // serve files as-is

const indexPath = path.join(out, 'index.html');
let html = readFileSync(indexPath, 'utf8');
if (!html.includes('?v=dev')) throw new Error('index.html has no ?v=dev placeholders to stamp');
html = html.replaceAll('?v=dev', `?v=${sha}`)
  .replace(/<meta name="app-version"[^>]*>/, `<meta name="app-version" content="${sha}" data-message="${attr(message)}" data-date="${attr(date)}">`);
writeFileSync(indexPath, html);
writeFileSync(path.join(out, 'version.json'), JSON.stringify({ sha, message, date }) + '\n');

console.log(`Stamped ${out} with ${sha} "${message}" (${date})`);
