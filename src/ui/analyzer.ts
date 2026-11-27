import type { AnalysisResult, AnalyzeRequest } from '../core/pipeline';
import workerUrl from '../worker.ts?worker&url';

type Pending = { resolve: (r: AnalysisResult) => void; reject: (e: Error) => void; request: AnalyzeRequest };
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
 */
export class Analyzer {
  private worker: Worker | null = null;
  private seq = 0;
  private readonly pending = new Map<number, Pending>();

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
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, request });
      this.worker?.postMessage({ id, request });
    });
  }

  private onReply(reply: WorkerReply): void {
    const job = this.pending.get(reply.id);
    if (!job) return;
    this.pending.delete(reply.id);
    if (reply.result) job.resolve(reply.result);
    else job.reject(new Error(reply.error ?? 'Analysis failed'));
  }

  private fallBackToMainThread(): void {
    this.worker?.terminate();
    this.worker = null;
    for (const [id, job] of this.pending) {
      this.pending.delete(id);
      runOnMainThread(job.request).then(job.resolve, job.reject);
    }
  }
}

async function runOnMainThread(request: AnalyzeRequest): Promise<AnalysisResult> {
  const { analyze } = await import('../core/pipeline');
  return analyze(request);
}
