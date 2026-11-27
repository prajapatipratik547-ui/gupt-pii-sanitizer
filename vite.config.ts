/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';

/**
 * Strict Content-Security-Policy, injected only into the production build
 * (the dev server needs a websocket for hot reload).
 *
 * `connect-src 'none'` is the important line: the browser itself refuses any
 * fetch / XHR / WebSocket / beacon from this page, so pasted text physically
 * cannot be sent anywhere — even by a compromised dependency or extension script.
 */
export const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "worker-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'none'",
  "manifest-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  // Trusted Types: the browser itself rejects HTML/script injection sinks (innerHTML, script.src…).
  // The single allowed policy only ever vouches for Gupt's own worker URL.
  "require-trusted-types-for 'script'",
  'trusted-types gupt-worker',
].join('; ');

function cspPlugin(): Plugin {
  return {
    name: 'gupt-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '<meta charset="utf-8" />',
        `<meta charset="utf-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`,
      );
    },
    // GitHub Pages can only use the <meta> CSP above. Hosts that honour a `_headers` file
    // (Netlify, Cloudflare Pages) get the same policy as real HTTP headers, plus the
    // directives a <meta> tag cannot express.
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: '_headers',
        source: [
          '/*',
          `  Content-Security-Policy: ${CSP}; frame-ancestors 'none'`,
          '  X-Content-Type-Options: nosniff',
          '  Referrer-Policy: no-referrer',
          '  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()',
          '  Cross-Origin-Opener-Policy: same-origin',
          '',
        ].join('\n'),
      });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [cspPlugin()],
  build: {
    target: 'es2022',
    // The preload polyfill contains a fetch() call. Every browser that runs ES2022 supports
    // <link rel="modulepreload"> natively, so ship no network code at all.
    modulePreload: { polyfill: false },
    sourcemap: false,
    // Keep the worker as a separate same-origin file so `worker-src 'self'` covers it.
    assetsInlineLimit: 0,
  },
  worker: { format: 'es' },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/main.ts'],
      thresholds: { lines: 90, functions: 90, branches: 80, statements: 90 },
    },
  },
});
