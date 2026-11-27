# Security policy

Gupt handles exactly the kind of data people are most careful with, so its security model is deliberately simple:
**the text never leaves the browser tab.**

## Guarantees

- **No backend.** Gupt is a static site. Detection, redaction and export run in the page and a Web Worker.
- **Network access is blocked by the browser.** The production build ships a Content-Security-Policy with
  `connect-src 'none'`, `default-src 'none'`, `form-action 'none'` and `base-uri 'none'`. Even injected or
  compromised script could not `fetch`, `XMLHttpRequest`, `WebSocket` or `sendBeacon` your text anywhere.
- **No third-party runtime code.** There are zero runtime dependencies; everything in `package.json` is build or
  test tooling and is not shipped.
- **No HTML injection, enforced twice.** User text only reaches the DOM through text nodes, and ESLint fails the
  build on `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `fetch`, `XMLHttpRequest` and `WebSocket` in application
  code. On top of that the CSP enables **Trusted Types** (`require-trusted-types-for 'script'`), so the browser itself
  throws if anything tries to write HTML or script into the page. The only Trusted Types policy (`gupt-worker`)
  vouches for exactly one URL: Gupt's own bundled worker.
- **No network code shipped at all.** The production bundle contains no `fetch`, `XMLHttpRequest` or `sendBeacon`
  call (Vite's module-preload polyfill is disabled for this reason). An end-to-end test checks the built files.
- **Clickjacking guard.** GitHub Pages cannot send `X-Frame-Options`/`frame-ancestors` headers, so Gupt refuses to
  start when loaded inside another site's frame and tells the user to open it directly.
- **ReDoS-resistant detection.** Every detector is anchored at token boundaries with bounded repetition. A
  regression test runs all 30 detectors against 22 adversarial 100 KB inputs and fails if any takes over 250 ms
  (in practice each takes a few milliseconds).
- **Nothing persisted.** Only UI preferences are stored in `localStorage`; input text, findings and pseudonym
  tables live in memory and disappear with the tab. Download Blob URLs are revoked immediately.
- **Audit reports contain no original values**, enforced by a unit test and an end-to-end test.
- **The re-identification key** (which does contain originals) is only offered in pseudonym mode and requires a
  second, explicit click.

## Hosting note

GitHub Pages cannot set HTTP response headers, so the live demo delivers its policy through a `<meta>` CSP plus the
frame guard above. The build also emits a `_headers` file with the same CSP as a real header, plus
`frame-ancestors 'none'`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` and
`Cross-Origin-Opener-Policy`. Hosts that read `_headers` (Netlify, Cloudflare Pages) apply it automatically.

## Verifying it yourself

1. Open the live app, open DevTools → Network, and load a sample. Only the app's own static files appear.
2. Turn off your network after the page loads. Everything keeps working.
3. Paste `<img src=x onerror=alert(1)>`. It is shown as text and never executed.
4. In the DevTools console run `document.body.innerHTML = '<b>x</b>'`. Trusted Types blocks it.
5. Put the app in an `<iframe>` on any other site. It refuses to run.

## Reporting a vulnerability

Please open a GitHub issue **without** including any real personal data, or contact the maintainer privately
through GitHub. Fixes are prioritised over features.
