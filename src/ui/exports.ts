import type { AnalysisResult } from '../core/pipeline';
import { MODE_LABELS, type RedactionMode, reidentify } from '../core/redact';
import { buildAuditReport, buildKeyFile, mimeFor, sanitizedFileName } from '../core/report';
import { plural } from './dom';
import { downloadText } from './files';

/** Everything the export buttons need to know about the current session. */
export interface ExportContext {
  result: () => AnalysisResult | null;
  fileName: () => string | null;
  mode: () => RedactionMode;
  strict: () => boolean;
  toast: (message: string) => void;
  log: (message: string) => void;
}

export interface ExportControls {
  download: HTMLButtonElement;
  copy: HTMLButtonElement;
  report: HTMLButtonElement;
  key: HTMLButtonElement;
  output: HTMLElement;
  restoreInput: HTMLTextAreaElement;
  restoreRun: HTMLButtonElement;
  restoreStatus: HTMLElement;
  restoreOutput: HTMLElement;
}

const KEY_LABEL = 'Re-identification key';
const KEY_CONFIRM_MS = 4000;

const baseName = (fileName: string | null): string => sanitizedFileName(fileName).replace(/\.[^.]+$/, '');
const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

export function bindExports(c: ExportControls, ctx: ExportContext): void {
  c.download.addEventListener('click', () => {
    const r = ctx.result();
    if (!r || r.chars === 0) return;
    const name = sanitizedFileName(ctx.fileName());
    downloadText(name, r.output, mimeFor(name));
    ctx.toast(`Saved ${name}`);
    ctx.log(`Downloaded ${name} — ${plural(r.total, 'value')} redacted (${MODE_LABELS[ctx.mode()]})`);
  });

  c.copy.addEventListener('click', async () => {
    const r = ctx.result();
    if (!r) return;
    try {
      await navigator.clipboard.writeText(r.output);
      ctx.toast('Sanitized text copied');
      ctx.log('Copied sanitized text to clipboard');
    } catch {
      // Clipboard permission denied: select the output so Ctrl+C still works.
      c.output.focus();
      const range = document.createRange();
      range.selectNodeContents(c.output);
      getSelection()?.removeAllRanges();
      getSelection()?.addRange(range);
      ctx.toast('Clipboard blocked — the output is selected, press Ctrl+C');
    }
  });

  c.report.addEventListener('click', () => {
    const r = ctx.result();
    if (!r) return;
    const report = buildAuditReport(r, { fileName: ctx.fileName(), mode: ctx.mode(), strict: ctx.strict(), generatedAt: new Date() });
    const name = `${baseName(ctx.fileName())}.audit.json`;
    downloadText(name, json(report), 'application/json');
    ctx.toast('Audit report saved — it contains no original values');
    ctx.log(`Downloaded audit report ${name}`);
  });

  // Two-step confirmation instead of a blocking dialog: the key file contains real PII.
  let armed: ReturnType<typeof setTimeout> | undefined;
  const disarm = (): void => {
    if (armed !== undefined) clearTimeout(armed);
    armed = undefined;
    c.key.textContent = KEY_LABEL;
  };
  c.key.addEventListener('click', () => {
    const r = ctx.result();
    if (!r) return;
    if (armed === undefined) {
      c.key.textContent = 'Contains real PII — click again to save';
      armed = setTimeout(disarm, KEY_CONFIRM_MS);
      return;
    }
    disarm();
    downloadText(`${baseName(ctx.fileName())}.key.json`, json(buildKeyFile(r.mapping, new Date())), 'application/json');
    ctx.toast('Key saved. Store it separately from the sanitized file.');
    ctx.log(`Downloaded re-identification key (${plural(r.mapping.length, 'token')})`);
  });

  c.restoreRun.addEventListener('click', () => {
    const r = ctx.result();
    if (!r) return;
    const { text, restored } = reidentify(c.restoreInput.value, r.mapping);
    c.restoreOutput.hidden = false;
    c.restoreOutput.textContent = text;
    c.restoreStatus.textContent = `${plural(restored, 'token')} restored`;
    ctx.log(`Re-identified ${plural(restored, 'token')} in a pasted reply`);
  });
}
