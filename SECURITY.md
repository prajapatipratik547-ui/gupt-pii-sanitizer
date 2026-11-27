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
- **No HTML injection.** User text only reaches the DOM through text nodes. ESLint fails the build on `innerHTML`,
  `outerHTML`, `insertAdjacentHTML`, `fetch`, `XMLHttpRequest` and `WebSocket` in application code.
- **Nothing persisted.** Only UI preferences are stored in `localStorage`; input text, findings and pseudonym
  tables live in memory and disappear with the tab. Download Blob URLs are revoked immediately.
- **Audit reports contain no original values**, enforced by a unit test and an end-to-end test.
- **The re-identification key** (which does contain originals) is only offered in pseudonym mode and requires a
  second, explicit click.

## Verifying it yourself

1. Open the live app, open DevTools → Network, and load a sample. Only the app's own static files appear.
2. Turn off your network after the page loads. Everything keeps working.
3. Paste `<img src=x onerror=alert(1)>`. It is shown as text and never executed.

## Reporting a vulnerability

Please open a GitHub issue **without** including any real personal data, or contact the maintainer privately
through GitHub. Fixes are prioritised over features.
