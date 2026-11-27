/**
 * End-to-end checks in a real headless Chrome, driven over the DevTools
 * protocol with no extra dependencies (Node 22+ ships fetch and WebSocket).
 *
 *   npm run build && npm run preview -- --port 4317 &
 *   npm run e2e                       # or: node scripts/e2e.mjs <url>
 *
 * Set CHROME_PATH if Chrome is not in the default location.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const url = process.argv[2] ?? 'http://127.0.0.1:4317/';
const work = mkdtempSync(join(tmpdir(), 'gupt-e2e-'));
const dl = join(work, 'downloads');
mkdirSync(dl, { recursive: true });

const CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].filter(Boolean);
const chromePath = CANDIDATES.find((p) => existsSync(p));
if (!chromePath) {
  console.error('Chrome not found. Set CHROME_PATH.');
  process.exit(2);
}
const port = 9800 + Math.floor(Math.random() * 150);
const chrome = spawn(chromePath, [
  '--headless=new', `--remote-debugging-port=${port}`, '--no-first-run', '--no-default-browser-check',
  ...(process.platform === 'linux' ? ['--no-sandbox'] : []),
  `--user-data-dir=${join(work, 'profile')}`, '--window-size=1440,900', 'about:blank',
], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target;
for (let i = 0; i < 50 && !target; i++) {
  await sleep(200);
  try {
    target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page');
  } catch {
    // Chrome is still starting; retry.
  }
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const waiters = new Map(); const errors = []; const requests = [];
ws.addEventListener('message', (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && waiters.has(msg.id)) { waiters.get(msg.id)(msg); waiters.delete(msg.id); }
  if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') errors.push(msg.params.args.map((a) => a.value ?? a.description).join(' '));
  if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') errors.push(msg.params.entry.text);
  if (msg.method === 'Network.requestWillBeSent') requests.push(msg.params.request.url);
});
const send = (method, params = {}) => new Promise((r) => { const i = ++id; waiters.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => {
  const res = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (res.result?.exceptionDetails) throw new Error(res.result.exceptionDetails.exception?.description);
  return res.result?.result?.value;
};
await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable'); await send('Network.enable'); await send('DOM.enable');
await send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: dl });
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url });
await sleep(1500);

let pass = 0; let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) pass++;
  else fail++;
  console.info(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};
if (!target) {
  console.error('Could not connect to Chrome DevTools.');
  process.exit(2);
}
const stat = (sel) => ev(`document.querySelector('${sel}').textContent`);
const settle = (ms = 500) => sleep(ms);
const files = () => readdirSync(dl).filter((f) => !f.endsWith('.crdownload'));

// 1. Boot
check('CSP meta present with connect-src none', await ev(`document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content.includes("connect-src 'none'")`));
check('page title', (await ev('document.title')) === 'Gupt · Private PII Sanitizer');
check('privacy pill shows 0 requests', (await stat('#net-count')) === '0 network requests');
check('starts with downloads disabled', await ev(`document.querySelector('#download').disabled`));

// 2. Sample
await ev(`document.querySelector('#load-sample').click()`); await settle();
check('noisy sample: 32 redacted', (await stat('#stat-total')) === '32', await stat('#stat-total'));
check('noisy sample: 5 false positives blocked', (await stat('#stat-rejected')) === '5');
check('runs in background worker', (await stat('#timing')).includes('background worker'), await stat('#timing'));
check('marks paired across panes', await ev(`document.querySelectorAll('#pane-original mark').length === document.querySelectorAll('#pane-output mark').length`));
check('decoy 4111…1112 left untouched', (await stat('#pane-output')).includes('4111 1111 1111 1112'));

// 3. Modes
await ev(`document.querySelector('input[value=partial]').click()`); await settle();
check('partial mask keeps last 4 + separators', (await stat('#pane-output')).includes('XXXX-XXXX-XXXX-2346'));
await ev(`document.querySelector('input[value=pseudonym]').click()`); await settle();
const out = await stat('#pane-output');
check('pseudonyms: both Priya spellings → USER_01', (out.match(/USER_01/g) || []).length === 2);
check('key button visible in pseudonym mode', await ev(`!document.querySelector('#download-key').hidden && getComputedStyle(document.querySelector('#download-key')).display !== 'none'`));
await ev(`document.querySelector('#restore-input').value = 'Contact USER_01 about CARD_02'; document.querySelector('#restore-run').click()`);
check('re-identify restores originals', (await stat('#restore-output')) === 'Contact priya.sharma@example.com about 5123-4567-8901-2346', await stat('#restore-output'));

// 4. Keep / unkeep
await ev(`document.querySelector('#pane-original mark.t-EMAIL').click()`); await settle();
check('click highlight keeps all occurrences', (await stat('#stat-kept')) === '2');
await ev(`document.querySelector('#pane-original mark.t-EMAIL').click()`); await settle();
check('second click redacts again', (await stat('#stat-kept')) === '0');

// 5. Downloads
await ev(`document.querySelector('#download').click()`); await settle(1200);
const san = files().find((f) => f === 'incident-export.sanitized.txt');
const sanText = san ? readFileSync(join(dl, san), 'utf8') : '';
check('download: sanitized file saved', Boolean(san), files().join(','));
check('download: no original PII inside', san && !/priya\.sharma@example\.com|9876543210\b|ABCPV1234K|2345 6789 0124/i.test(sanText));
await ev(`document.querySelector('#download-report').click()`); await settle(1200);
const rep = files().find((f) => f.endsWith('.audit.json'));
const repText = rep ? readFileSync(join(dl, rep), 'utf8') : '';
check('audit report saved and valid JSON', Boolean(rep) && JSON.parse(repText).summary.redacted === 32);
check('audit report contains no PII', !/priya|9876543210|ABCPV1234K|5123-4567/i.test(repText));
await ev(`document.querySelector('#download-key').click()`); await ev(`document.querySelector('#download-key').click()`); await settle(1200);
check('key file needs 2 clicks and saves', files().some((f) => f.endsWith('.key.json')));

// 6. XSS attempt
await ev(`(() => { const i = document.querySelector('#input'); i.value = '<img src=x onerror="window.__xss=1"><script>window.__xss=2<\\/script> mail a@b.co'; i.dispatchEvent(new Event('input')); })()`);
await settle(900);
check('XSS payload rendered as text, not executed', (await ev('window.__xss')) === undefined && (await ev(`document.querySelectorAll('#pane-original img, #pane-original script').length`)) === 0);
check('…and still redacted the email', (await stat('#pane-output')).includes('USER_01'));

// 7. Upload CSV + binary
const csvPath = join(work, 'people.csv');
writeFileSync(csvPath, 'name,email,phone\nPriya Sharma,priya@example.com,9876543210\n"Verma, Rahul",rahul@example.in,+91 98111 22334\n');
const inputObj = (await send('Runtime.evaluate', { expression: `document.querySelector('#file-input')` })).result.result.objectId;
await send('DOM.setFileInputFiles', { files: [csvPath], objectId: inputObj });
await settle(900);
check('upload CSV: detected as CSV', (await stat('#input-meta')).includes('CSV detected'), await stat('#input-meta'));
check('upload CSV: 6 values (names via column)', (await stat('#stat-total')) === '6', await stat('#stat-total'));
check('upload CSV: download keeps .csv name', (await stat('#download-label')) === 'Download people.sanitized.csv');
const pngPath = join(work, 'fake.txt');
writeFileSync(pngPath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]));
await send('DOM.setFileInputFiles', { files: [pngPath], objectId: inputObj });
await settle(600);
check('binary file refused with message', (await stat('#toast')).includes('binary'), await stat('#toast'));

// 8. Every sample
const ids = await ev(`[...document.querySelectorAll('#sample-select option')].map(o => o.value)`);
for (const sid of ids) {
  await ev(`(() => { const s = document.querySelector('#sample-select'); s.value = '${sid}'; s.dispatchEvent(new Event('change')); })()`);
  await settle(500);
  check(`sample "${sid}" loads`, Number(await stat('#stat-total')) > 0, `${await stat('#stat-total')} redacted, ${await stat('#stat-rejected')} blocked`);
}

// 9. Large input
const t0 = Date.now();
await ev(`(() => { const base = document.querySelector('#input').value; const i = document.querySelector('#input'); i.value = base.repeat(Math.ceil(2_000_000 / base.length)); i.dispatchEvent(new Event('input')); })()`);
let big = 0;
for (let i = 0; i < 60 && big < 1000; i++) { await sleep(250); big = Number((await stat('#stat-total')).replace(/,/g, '')); }
check('2 MB input processed', big > 1000, `${big.toLocaleString()} values, ${await stat('#timing')}, ${Date.now() - t0} ms wall`);
check('preview truncation note shown', !(await ev(`document.querySelector('#preview-note').hidden`)));

// 10. Offline
await send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
await ev(`(() => { const s = document.querySelector('#sample-select'); s.value = 'resume'; s.dispatchEvent(new Event('change')); })()`);
await settle(700);
check('works offline after load', Number(await stat('#stat-total')) > 0);
await send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });

// 11. Keyboard
await ev(`document.activeElement.blur(); window.scrollTo(0,0)`);
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
check('first Tab reaches the skip link', (await ev(`document.activeElement.className`)) === 'skip-link');

// 12. No outbound requests, no errors
const external = requests.filter((u) => !u.startsWith(new URL(url).origin) && !u.startsWith('data:') && !u.startsWith('blob:'));
check('no requests to any other origin', external.length === 0, external.join(', '));
check('privacy pill still 0 requests', (await stat('#net-count')) === '0 network requests');
check('no console errors or exceptions', errors.length === 0, errors.join(' | '));

console.info(`\n${pass} passed, ${fail} failed`);
ws.close(); chrome.kill();
process.exit(fail ? 1 : 0);
