import { plural } from './dom';

/**
 * Live proof for the privacy badge: counts every fetch / XHR / beacon the page
 * makes after start-up and every connection the Content-Security-Policy blocks.
 * With `connect-src 'none'` both should stay at zero.
 */
export function watchNetwork(counter: HTMLElement, pill: HTMLElement): void {
  let outbound = 0;
  let blocked = 0;

  const update = (): void => {
    counter.textContent = outbound === 0 ? '0 network requests' : `${plural(outbound, 'request')} attempted`;
    pill.classList.toggle('is-alert', outbound > 0 || blocked > 0);
  };

  if (typeof PerformanceObserver !== 'undefined') {
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as PerformanceResourceTiming[]) {
          if (['fetch', 'xmlhttprequest', 'beacon'].includes(entry.initiatorType)) outbound++;
        }
        update();
      }).observe({ type: 'resource', buffered: true });
    } catch {
      // Resource timing unsupported: the CSP still blocks requests, we just can't count them.
    }
  }

  document.addEventListener('securitypolicyviolation', (e) => {
    if (e.effectiveDirective !== 'connect-src') return;
    blocked++;
    pill.title = `${plural(blocked, 'outbound connection')} blocked by the Content-Security-Policy.`;
    update();
  });

  update();
}
