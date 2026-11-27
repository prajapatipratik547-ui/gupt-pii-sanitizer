/// <reference lib="webworker" />
import { type AnalyzeRequest, analyze } from './core/pipeline';

/**
 * Detection runs off the main thread so typing and scrolling stay smooth even
 * on multi-megabyte logs. The worker has no network access either: it is
 * covered by the same `connect-src 'none'` policy as the page.
 */
interface WorkerRequest {
  id: number;
  request: AnalyzeRequest;
}

self.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  const { id, request } = event.data;
  try {
    self.postMessage({ id, result: analyze(request) });
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
});
