import type { AnalysisResult, AnalyzeRequest } from '../core/pipeline';
import workerUrl from '../worker.ts?worker&url';

type Waiter = { resolve: (r: AnalysisResult) => void; reject: (e: Error) => void };
/** One request to the worker and everyone waiting for its result. */
type Batch = { request: AnalyzeRequest; waiters: Waiter[] };
type WorkerReply = { id: number; result?: AnalysisResult; error?: string };

/** The slice of the Trusted Types API we use (not yet in every TypeScript DOM lib). */
interface TrustedTypesLike {
  createPolicy(name: string, rules: { createScriptURL: (url: string) => string }): { createScriptURL(url: string): unknown };
}

let workerPolicy: ReturnType<TrustedTypesLike['createPolicy']> | null | undefined;

/**
 * The CSP enforces Trusted Types, so `new Worker()` only accepts a URL vouched
 * for by the `gupt-worker` policy — and that policy refuses anything except
 * Gupt's own bundled worker file.
 */
function trustedWorkerUrl(): string {
  if (workerPolicy === undefined) {
    const tt = (globalThis as { trustedTypes?: TrustedTypesLike }).trustedTypes;
    workerPolicy = tt
      ? tt.createPolicy('gupt-worker', {
          createScriptURL: (url) => {
            if (url !== workerUrl) throw new TypeError('Refusing to start an unexpected worker script');
            return url;
          },
        })
      : null;
  }
  return (workerPolicy ? workerPolicy.createScriptURL(workerUrl) : workerUrl) as string;
}

/**
 * Runs analysis in a Web Worker, falling back to the main thread when workers
 * are unavailable (old browsers, file:// pages, test environments). The engine
 * is only loaded on the main thread if that fallback is actually needed.
 *
 * At most one job runs in the worker at a time, and at most one waits. A newer
 * request replaces the waiting one, so rapid changes (toggling several types,
 * pasting repeatedly) never queue up work whose result would be thrown away.
 * Superseded callers receive the newer result.
 */
export class Analyzer {
  private worker: Worker | null = null;
  private seq = 0;
  private running: (Batch & { id: number }) | null = null;
  private waiting: Batch | null = null;

  constructor(useWorker = typeof Worker !== 'undefined') {
    if (!useWorker) return;
    try {
      this.worker = new Worker(trustedWorkerUrl(), { type: 'module' });
      this.worker.addEventListener('message', (e: MessageEvent<WorkerReply>) => this.onReply(e.data));
      const fail = (e: Event): void => {
        e.preventDefault();
        this.fallBackToMainThread();
      };
      this.worker.addEventListener('error', fail);
      this.worker.addEventListener('messageerror', fail);
    } catch {
      this.worker = null;
    }
  }

  get mode(): 'worker' | 'main-thread' {
    return this.worker ? 'worker' : 'main-thread';
  }

  analyze(request: AnalyzeRequest): Promise<AnalysisResult> {
    if (!this.worker) return runOnMainThread(request);
    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject };
      if (!this.running) this.send({ request, waiters: [waiter] });
      else if (this.waiting) {
        this.waiting.request = request; // the older waiting request is superseded
        this.waiting.waiters.push(waiter);
      } else this.waiting = { request, waiters: [waiter] };
    });
  }

  private send(batch: Batch): void {
    const id = ++this.seq;
    this.running = { ...batch, id };
    this.worker?.postMessage({ id, request: batch.request });
  }

  private onReply(reply: WorkerReply): void {
    const job = this.running;
    if (!job || job.id !== reply.id) return;
    this.running = null;
    if (reply.result) settle(job, Promise.resolve(reply.result));
    else settle(job, Promise.reject(new Error(reply.error ?? 'Analysis failed')));
    if (this.waiting) {
      const next = this.waiting;
      this.waiting = null;
      this.send(next);
    }
  }

  private fallBackToMainThread(): void {
    this.worker?.terminate();
    this.worker = null;
    for (const batch of [this.running, this.waiting]) if (batch) settle(batch, runOnMainThread(batch.request));
    this.running = null;
    this.waiting = null;
  }
}

function settle(batch: Batch, outcome: Promise<AnalysisResult>): void {
  outcome.then(
    (result) => batch.waiters.forEach((w) => w.resolve(result)),
    (error: unknown) => batch.waiters.forEach((w) => w.reject(error instanceof Error ? error : new Error(String(error)))),
  );
}

async function runOnMainThread(request: AnalyzeRequest): Promise<AnalysisResult> {
  const { analyze } = await import('../core/pipeline');
  return analyze(request);
}
