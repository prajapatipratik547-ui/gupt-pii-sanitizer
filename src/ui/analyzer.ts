import type { AnalysisResult, AnalyzeRequest } from '../core/pipeline';

type Pending = { resolve: (r: AnalysisResult) => void; reject: (e: Error) => void; request: AnalyzeRequest };
type WorkerReply = { id: number; result?: AnalysisResult; error?: string };

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
      this.worker = new Worker(new URL('../worker.ts', import.meta.url), { type: 'module' });
      this.worker.addEventListener('message', (e: MessageEvent<WorkerReply>) => this.onReply(e.data));
      this.worker.addEventListener('error', (e) => {
        e.preventDefault();
        this.fallBackToMainThread();
      });
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
