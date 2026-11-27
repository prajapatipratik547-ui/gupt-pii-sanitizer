// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { analyze, type AnalyzeRequest } from '../src/core/pipeline';
import { Analyzer } from '../src/ui/analyzer';
import { bindDiffInteractions } from '../src/ui/diff';
import { watchNetwork } from '../src/ui/privacy';
import { applyTheme, nextTheme } from '../src/ui/theme';
import { ALL_TYPES } from './helpers';

const request = (text: string): AnalyzeRequest => ({
  text,
  settings: { mode: 'full', typeLabels: false, strict: true, enabled: ALL_TYPES, customTerms: [], format: 'auto' },
  kept: [],
});

type Listener = (event: { data?: unknown; preventDefault?: () => void }) => void;

/** Minimal stand-in for a module Worker that runs the real pipeline. */
class FakeWorker {
  static instances: FakeWorker[] = [];
  static behaviour: 'reply' | 'error-reply' | 'silent' = 'reply';
  listeners: Record<string, Listener[]> = {};
  terminated = false;
  posted: string[] = [];

  constructor() {
    FakeWorker.instances.push(this);
  }

  addEventListener(type: string, fn: Listener): void {
    (this.listeners[type] ??= []).push(fn);
  }

  postMessage(msg: { id: number; request: AnalyzeRequest }): void {
    this.posted.push(msg.request.text);
    if (FakeWorker.behaviour === 'silent') return;
    const data = FakeWorker.behaviour === 'reply' ? { id: msg.id, result: analyze(msg.request) } : { id: msg.id, error: 'boom' };
    queueMicrotask(() => this.emit('message', { data }));
  }

  emit(type: string, event: { data?: unknown; preventDefault?: () => void }): void {
    for (const fn of this.listeners[type] ?? []) fn(event);
  }

  terminate(): void {
    this.terminated = true;
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  FakeWorker.instances = [];
  FakeWorker.behaviour = 'reply';
});

describe('Analyzer (Web Worker client)', () => {
  beforeEach(() => vi.stubGlobal('Worker', FakeWorker));

  it('runs analysis in the worker', async () => {
    const analyzer = new Analyzer(true);
    expect(analyzer.mode).toBe('worker');
    const result = await analyzer.analyze(request('mail priya@example.com'));
    expect(result.output).toBe('mail [REDACTED]');
  });

  it('coalesces requests that arrive while the worker is busy', async () => {
    const analyzer = new Analyzer(true);
    const first = analyzer.analyze(request('a@b.co'));
    const superseded = analyzer.analyze(request('c@d.co'));
    const latest = analyzer.analyze(request('e@f.co and g@h.co'));
    const [r1, r2, r3] = await Promise.all([first, superseded, latest]);
    // The middle request never reached the worker: it was replaced while waiting.
    expect(FakeWorker.instances[0]?.posted).toEqual(['a@b.co', 'e@f.co and g@h.co']);
    expect(r1.total).toBe(1);
    expect(r2).toBe(r3);
    expect(r3.total).toBe(2);
  });

  it('rejects when the worker reports an error', async () => {
    FakeWorker.behaviour = 'error-reply';
    await expect(new Analyzer(true).analyze(request('x'))).rejects.toThrow('boom');
  });

  it('ignores replies for unknown jobs', () => {
    const analyzer = new Analyzer(true);
    expect(() => FakeWorker.instances[0]?.emit('message', { data: { id: 999, result: {} } })).not.toThrow();
    expect(analyzer.mode).toBe('worker');
  });

  it('falls back to the main thread if the worker crashes, finishing pending jobs', async () => {
    FakeWorker.behaviour = 'silent';
    const analyzer = new Analyzer(true);
    const pending = analyzer.analyze(request('call 9876543210'));
    const preventDefault = vi.fn();
    FakeWorker.instances[0]?.emit('error', { preventDefault });
    expect(preventDefault).toHaveBeenCalled();
    expect(FakeWorker.instances[0]?.terminated).toBe(true);
    expect(analyzer.mode).toBe('main-thread');
    expect((await pending).output).toBe('call [REDACTED]');
    expect((await analyzer.analyze(request('a@b.co'))).total).toBe(1);
  });

  it('uses the main thread when a worker cannot be created', async () => {
    vi.stubGlobal(
      'Worker',
      class {
        constructor() {
          throw new Error('blocked');
        }
      },
    );
    const analyzer = new Analyzer(true);
    expect(analyzer.mode).toBe('main-thread');
    expect((await analyzer.analyze(request('a@b.co'))).total).toBe(1);
  });
});

describe('worker entry point', () => {
  it('posts results, and errors instead of throwing', async () => {
    let handler: ((e: MessageEvent) => void) | undefined;
    const postMessage = vi.fn();
    vi.stubGlobal('self', { addEventListener: (_: string, fn: (e: MessageEvent) => void) => (handler = fn), postMessage });
    vi.resetModules();
    await import('../src/worker');
    handler?.({ data: { id: 1, request: request('a@b.co') } } as MessageEvent);
    expect(postMessage).toHaveBeenLastCalledWith({ id: 1, result: expect.objectContaining({ total: 1 }) });
    handler?.({ data: { id: 2, request: { ...request(''), text: undefined } } } as unknown as MessageEvent);
    expect(postMessage).toHaveBeenLastCalledWith({ id: 2, error: expect.any(String) });
  });
});

describe('diff pane interactions', () => {
  function setup(sync: boolean) {
    document.body.innerHTML = `
      <div id="c">
        <pre id="o"><mark class="pii" data-eid="0">a</mark><mark class="pii" data-eid="1">b</mark></pre>
        <pre id="s"><mark class="pii" data-eid="0">X</mark><mark class="pii" data-eid="1">Y</mark></pre>
      </div>`;
    const [container, original, output] = ['c', 'o', 's'].map((id) => document.getElementById(id) as HTMLElement) as [
      HTMLElement,
      HTMLElement,
      HTMLElement,
    ];
    for (const el of [original, output]) {
      Object.defineProperty(el, 'scrollHeight', { value: 1100, configurable: true });
      Object.defineProperty(el, 'clientHeight', { value: 100, configurable: true });
    }
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0));
    bindDiffInteractions({ container, original, output, syncEnabled: () => sync });
    return { container, original, output };
  }

  it('syncs scroll position proportionally', () => {
    const { original, output } = setup(true);
    original.scrollTop = 500;
    original.dispatchEvent(new Event('scroll'));
    expect(output.scrollTop).toBe(500);
  });

  it('leaves the other pane alone when sync is off', () => {
    const { original, output } = setup(false);
    original.scrollTop = 500;
    original.dispatchEvent(new Event('scroll'));
    expect(output.scrollTop).toBe(0);
  });

  it('highlights both halves of a pair on hover and clears on leave', () => {
    const { container } = setup(true);
    container.querySelector('#o [data-eid="1"]')?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    expect([...container.querySelectorAll('.is-hover')].map((m) => m.textContent)).toEqual(['b', 'Y']);
    container.dispatchEvent(new MouseEvent('mouseleave'));
    expect(container.querySelectorAll('.is-hover')).toHaveLength(0);
  });
});

describe('privacy monitor', () => {
  function setup() {
    document.body.innerHTML = '<p id="pill"><span id="count"></span></p>';
    return { pill: document.getElementById('pill') as HTMLElement, count: document.getElementById('count') as HTMLElement };
  }

  it('starts at zero requests', () => {
    const { count, pill } = setup();
    watchNetwork(count, pill);
    expect(count.textContent).toBe('0 network requests');
    expect(pill.classList.contains('is-alert')).toBe(false);
  });

  it('counts outbound requests seen by resource timing', () => {
    let callback: ((list: { getEntries: () => unknown[] }) => void) | undefined;
    vi.stubGlobal(
      'PerformanceObserver',
      class {
        constructor(cb: typeof callback) {
          callback = cb;
        }
        observe(): void {}
      },
    );
    const { count, pill } = setup();
    watchNetwork(count, pill);
    callback?.({ getEntries: () => [{ initiatorType: 'fetch' }, { initiatorType: 'script' }] });
    expect(count.textContent).toBe('1 request attempted');
    expect(pill.classList.contains('is-alert')).toBe(true);
  });

  it('reports connections blocked by the CSP', () => {
    const { count, pill } = setup();
    watchNetwork(count, pill);
    const violation = Object.assign(new Event('securitypolicyviolation'), { effectiveDirective: 'connect-src' });
    document.dispatchEvent(violation);
    expect(pill.title).toContain('1 outbound connection blocked');
    expect(pill.classList.contains('is-alert')).toBe(true);
    document.dispatchEvent(Object.assign(new Event('securitypolicyviolation'), { effectiveDirective: 'img-src' }));
    expect(pill.title).toContain('1 outbound connection blocked');
  });
});

describe('theme', () => {
  it('cycles system → light → dark and labels the toggle', () => {
    const btn = document.createElement('button');
    expect(nextTheme('system')).toBe('light');
    expect(nextTheme('dark')).toBe('system');
    applyTheme('dark', btn);
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(btn.getAttribute('aria-label')).toContain('dark');
    applyTheme('system', btn);
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });
});
