// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type AppHandle, startApp } from '../src/ui/app';

const html = readFileSync(resolve(__dirname, '../index.html'), 'utf8');
const body = /<body>([\s\S]*)<\/body>/.exec(html)?.[1] ?? '';

const $ = <T extends HTMLElement = HTMLElement>(sel: string): T => {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`missing ${sel}`);
  return el;
};

let app: AppHandle;
let downloads: { name: string; blob: Blob }[];

/** Wait for debounced work and the analysis promise to settle. */
async function settle(ms = 0): Promise<void> {
  if (ms) await new Promise((r) => setTimeout(r, ms));
  await app.idle();
  await new Promise((r) => setTimeout(r, 0));
}

beforeEach(async () => {
  localStorage.clear();
  document.documentElement.lang = 'en';
  document.body.innerHTML = body;
  downloads = [];
  let lastBlob: Blob | null = null;
  URL.createObjectURL = vi.fn((blob: Blob) => {
    lastBlob = blob;
    return 'blob:mock';
  });
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    if (lastBlob) downloads.push({ name: this.download, blob: lastBlob });
  });
  app = startApp({ useWorker: false });
  await settle();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('loading content', () => {
  it('starts empty with export disabled', () => {
    expect($('#stat-total').textContent).toBe('0');
    expect($<HTMLButtonElement>('#download').disabled).toBe(true);
    expect($('#pane-original').textContent).toContain('appears here');
  });

  it('loads the noisy sample in one click and fills every panel', async () => {
    $('#load-sample').click();
    await settle();
    expect(Number($('#stat-total').textContent)).toBeGreaterThan(25);
    expect(Number($('#stat-rejected').textContent)).toBeGreaterThanOrEqual(5);
    expect(document.querySelectorAll('#pane-original mark.pii').length).toBe(document.querySelectorAll('#pane-output mark.pii').length);
    expect($('#pane-output').textContent).toContain('[REDACTED]');
    expect($('#pane-output').textContent).not.toContain('priya.sharma@example.com');
    expect(document.querySelectorAll('#findings-body tr').length).toBeGreaterThan(25);
    expect($('#chips').textContent).toContain('Credit / debit card');
    expect($('#download-label').textContent).toBe('Download incident-export.sanitized.txt');
    expect($('#activity').textContent).toContain('Loaded sample');
  });

  it('switches samples from the picker', async () => {
    const select = $<HTMLSelectElement>('#sample-select');
    select.value = 'csv';
    select.dispatchEvent(new Event('change'));
    await settle();
    expect($('#input-meta').textContent).toContain('customers.csv');
    expect($('#input-meta').textContent).toContain('CSV detected');
  });

  it('analyses typed text after a short debounce', async () => {
    const input = $<HTMLTextAreaElement>('#input');
    input.value = 'reach me at priya@example.com';
    input.dispatchEvent(new Event('input'));
    await settle(250);
    expect($('#stat-total').textContent).toBe('1');
    expect($('#pane-output').textContent).toBe('reach me at [REDACTED]');
  });

  it('reads an uploaded CSV file locally', async () => {
    const file = new File(['name,email\nPriya Sharma,priya@example.com\n'], 'people.csv', { type: 'text/csv' });
    const input = $<HTMLInputElement>('#file-input');
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change'));
    await settle(30);
    expect($<HTMLTextAreaElement>('#input').value).toContain('Priya Sharma');
    expect($('#stat-total').textContent).toBe('2');
    expect($('#download-label').textContent).toBe('Download people.sanitized.csv');
  });

  it('refuses binary and unsupported files with a message', async () => {
    const input = $<HTMLInputElement>('#file-input');
    Object.defineProperty(input, 'files', { value: [new File([new Uint8Array([137, 80, 78, 71, 0, 0])], 'image.txt')], configurable: true });
    input.dispatchEvent(new Event('change'));
    await settle(30);
    expect($('#toast').textContent).toContain('binary');
    Object.defineProperty(input, 'files', { value: [new File(['x'], 'photo.png')], configurable: true });
    input.dispatchEvent(new Event('change'));
    await settle(30);
    expect($('#toast').textContent).toContain('.txt or .csv');
  });

  it('clears everything', async () => {
    $('#load-sample').click();
    await settle();
    $('#clear').click();
    await settle();
    expect($('#stat-total').textContent).toBe('0');
    expect($<HTMLTextAreaElement>('#input').value).toBe('');
  });
});

describe('redaction controls', () => {
  beforeEach(async () => {
    $('#load-sample').click();
    await settle();
  });

  it('switches to partial masking', async () => {
    $<HTMLInputElement>('input[name="mode"][value="partial"]').click();
    await settle();
    expect($('#pane-output').textContent).toContain('XXXX XXXX XXXX 1881');
    expect($('#mode-badge').textContent).toBe('Partial mask');
  });

  it('switches to pseudonyms, shows the key button and restores a reply', async () => {
    $<HTMLInputElement>('input[name="mode"][value="pseudonym"]').click();
    await settle();
    expect($('#pane-output').textContent).toContain('USER_01');
    expect($<HTMLButtonElement>('#download-key').hidden).toBe(false);

    $<HTMLTextAreaElement>('#restore-input').value = 'USER_01 used CARD_01';
    $('#restore-run').click();
    expect($('#restore-output').textContent).toBe('priya.sharma@example.com used 4012 8888 8888 1881');
    expect($('#restore-status').textContent).toBe('2 tokens restored');
  });

  it('labels full masks with the type when asked', async () => {
    $<HTMLInputElement>('#type-labels').click();
    await settle();
    expect($('#pane-output').textContent).toContain('[REDACTED:EMAIL]');
  });

  it('turns an entity type off and remembers the choice', async () => {
    const box = $<HTMLInputElement>('input[name="entity-type"][value="EMAIL"]');
    box.click();
    await settle();
    expect($('#pane-output').textContent).toContain('priya.sharma@example.com');
    expect(JSON.parse(localStorage.getItem('gupt.settings.v1') ?? '{}').enabled).not.toContain('EMAIL');
    expect($('#types-enabled').textContent).toBe('(15 of 16)');
  });

  it('keeps a value everywhere when its highlight is clicked, and redacts it again on a second click', async () => {
    const mark = $('#pane-original mark.t-EMAIL');
    mark.click();
    await settle();
    expect($('#stat-kept').textContent).toBe('2'); // both spellings of Priya's email
    expect($('#pane-output').textContent).toContain('priya.sharma@example.com');
    $('#pane-original mark.t-EMAIL').click();
    await settle();
    expect($('#stat-kept').textContent).toBe('0');
  });

  it('toggles keep from the findings table', async () => {
    $('#findings-body button[data-key]').click();
    await settle();
    expect(Number($('#stat-kept').textContent)).toBeGreaterThan(0);
    expect($('#findings-body button[data-key]').textContent).toBe('Redact');
  });

  it('filters findings by type', async () => {
    const filter = $<HTMLSelectElement>('#findings-filter');
    filter.value = 'CREDIT_CARD';
    filter.dispatchEvent(new Event('change'));
    expect(document.querySelectorAll('#findings-body tr').length).toBe(2);
  });

  it('applies custom always-redact terms', async () => {
    const terms = $<HTMLTextAreaElement>('#custom-terms');
    terms.value = 'INC-20931';
    terms.dispatchEvent(new Event('input'));
    await settle(400);
    expect($('#pane-output').textContent).not.toContain('INC-20931');
  });

  it('flags checksum failures when strict validation is off', async () => {
    const before = Number($('#stat-total').textContent);
    $<HTMLInputElement>('#strict').click();
    await settle();
    expect(Number($('#stat-total').textContent)).toBeGreaterThan(before);
  });

  it('cycles the colour theme', () => {
    $('#theme-toggle').click();
    expect(document.documentElement.dataset.theme).toBe('light');
    $('#theme-toggle').click();
    expect(document.documentElement.dataset.theme).toBe('dark');
    $('#theme-toggle').click();
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });

  it('pairs highlights on hover', () => {
    const mark = $('#pane-original mark.pii');
    mark.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    expect(document.querySelectorAll('.pii.is-hover').length).toBe(2);
  });
});

describe('export', () => {
  beforeEach(async () => {
    $('#load-sample').click();
    await settle();
  });

  it('downloads the sanitized file with no PII in it', async () => {
    $('#download').click();
    expect(downloads).toHaveLength(1);
    expect(downloads[0]?.name).toBe('incident-export.sanitized.txt');
    const text = await downloads[0]?.blob.text();
    expect(text).toContain('[REDACTED]');
    for (const e of app.state.result?.entities ?? []) expect(text?.includes(e.value)).toBe(false);
  });

  it('downloads an audit report that holds no original values', async () => {
    $('#download-report').click();
    const json = (await downloads[0]?.blob.text()) ?? '';
    expect(downloads[0]?.name).toBe('incident-export.sanitized.audit.json');
    expect(JSON.parse(json).summary.redacted).toBe(app.state.result?.total);
    expect(json).not.toContain('priya.sharma@example.com');
  });

  it('asks for a second click before saving the re-identification key', async () => {
    $<HTMLInputElement>('input[name="mode"][value="pseudonym"]').click();
    await settle();
    const key = $<HTMLButtonElement>('#download-key');
    key.click();
    expect(downloads).toHaveLength(0);
    expect(key.textContent).toContain('click again');
    key.click();
    expect(downloads[0]?.name).toBe('incident-export.sanitized.key.json');
  });

  it('copies the sanitized output, falling back to selection if the clipboard is blocked', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    $('#copy').click();
    await settle();
    expect(writeText).toHaveBeenCalledWith(app.state.result?.output);
    writeText.mockRejectedValueOnce(new Error('denied'));
    $('#copy').click();
    await settle();
    expect($('#toast').textContent).toContain('Clipboard blocked');
  });
});

describe('accessibility', () => {
  async function violations(): Promise<string[]> {
    const results = await axe.run(document.body, {
      // jsdom has no layout engine, so contrast is checked in the browser (Lighthouse) instead.
      rules: { 'color-contrast': { enabled: false } },
    });
    return results.violations.map((v) => `${v.id}: ${v.nodes.length} × ${v.help}`);
  }

  it('has no axe violations when empty', async () => {
    expect(await violations()).toEqual([]);
  });

  it('has no axe violations with a sample loaded', async () => {
    $('#load-sample').click();
    await settle();
    expect(await violations()).toEqual([]);
  });

  it('labels every form control', () => {
    for (const control of document.querySelectorAll('input, select, textarea')) {
      const id = control.id;
      const labelled = control.closest('label') || (id && document.querySelector(`label[for="${id}"]`)) || control.getAttribute('aria-label');
      expect(labelled, `#${id || control.getAttribute('name')}`).toBeTruthy();
    }
  });
});
