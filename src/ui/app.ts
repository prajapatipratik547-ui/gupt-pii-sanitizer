import { CORE_TYPES, ENTITY_INFO, EXTENDED_TYPES, type EntityType, isEntityType } from '../core/entities';
import type { AnalysisResult, AnalyzeRequest } from '../core/pipeline';
import { MODE_LABELS, type RedactionMode, reidentify } from '../core/redact';
import { buildAuditReport, buildKeyFile, mimeFor, sanitizedFileName } from '../core/report';
import { DEFAULT_SAMPLE_ID, SAMPLES, getSample } from '../core/samples';
import { Analyzer } from './analyzer';
import { byId, debounce, formatBytes, h, plural } from './dom';
import { downloadText, readTextFile } from './files';
import { renderChips, renderFindings, renderPanes, renderRejected, renderTypeToggles, updateTypeCounts, PREVIEW_LIMIT, TABLE_LIMIT } from './render';
import { type Settings, type Theme, loadSettings, saveSettings } from './settings';

interface State {
  text: string;
  fileName: string | null;
  settings: Settings;
  kept: Set<string>;
  result: AnalysisResult | null;
  requestId: number;
  filter: EntityType | '';
}

export interface AppHandle {
  /** Resolves when the most recent analysis has been rendered (used by tests). */
  idle(): Promise<void>;
  loadText(text: string, fileName: string | null): Promise<void>;
  state: Readonly<State>;
}

const TYPING_DEBOUNCE_MS = 160;

export function startApp(options: { useWorker?: boolean } = {}): AppHandle {
  const el = {
    input: byId<HTMLTextAreaElement>('input'),
    inputMeta: byId('input-meta'),
    dropzone: byId('dropzone'),
    fileInput: byId<HTMLInputElement>('file-input'),
    sampleSelect: byId<HTMLSelectElement>('sample-select'),
    loadSample: byId<HTMLButtonElement>('load-sample'),
    clear: byId<HTMLButtonElement>('clear'),
    typeLabels: byId<HTMLInputElement>('type-labels'),
    strict: byId<HTMLInputElement>('strict'),
    customTerms: byId<HTMLTextAreaElement>('custom-terms'),
    coreList: byId('types-core-list'),
    extendedList: byId('types-extended-list'),
    typesAll: byId<HTMLButtonElement>('types-all'),
    typesCore: byId<HTMLButtonElement>('types-core'),
    typesEnabled: byId('types-enabled'),
    typesDetails: byId<HTMLDetailsElement>('types-details'),
    statTotal: byId('stat-total'),
    statUnique: byId('stat-unique'),
    statRejected: byId('stat-rejected'),
    statKept: byId('stat-kept'),
    timing: byId('timing'),
    chips: byId('chips'),
    diff: byId('diff'),
    paneOriginal: byId('pane-original'),
    paneOutput: byId('pane-output'),
    modeBadge: byId('mode-badge'),
    previewNote: byId('preview-note'),
    syncScroll: byId<HTMLInputElement>('sync-scroll'),
    showTags: byId<HTMLInputElement>('show-tags'),
    download: byId<HTMLButtonElement>('download'),
    downloadLabel: byId('download-label'),
    copy: byId<HTMLButtonElement>('copy'),
    report: byId<HTMLButtonElement>('download-report'),
    key: byId<HTMLButtonElement>('download-key'),
    findingsBody: byId('findings-body'),
    findingsFilter: byId<HTMLSelectElement>('findings-filter'),
    findingsNote: byId('findings-note'),
    rejectedSummary: byId('rejected-summary'),
    rejectedList: byId('rejected-list'),
    restoreInput: byId<HTMLTextAreaElement>('restore-input'),
    restoreRun: byId<HTMLButtonElement>('restore-run'),
    restoreStatus: byId('restore-status'),
    restoreOutput: byId('restore-output'),
    activity: byId('activity'),
    toast: byId('toast'),
    themeToggle: byId<HTMLButtonElement>('theme-toggle'),
    netCount: byId('net-count'),
    privacyPill: byId('privacy-pill'),
  };

  const state: State = {
    text: '',
    fileName: null,
    settings: loadSettings(),
    kept: new Set(),
    result: null,
    requestId: 0,
    filter: '',
  };
  const analyzer = new Analyzer(options.useWorker);
  let lastRun: Promise<void> = Promise.resolve();

  // ---------------------------------------------------------------- helpers
  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  function toast(message: string): void {
    el.toast.textContent = message;
    el.toast.classList.add('is-visible');
    if (toastTimer !== undefined) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.remove('is-visible'), 2800);
  }

  function log(message: string): void {
    const now = new Date();
    el.activity.querySelector('.activity-empty')?.remove();
    el.activity.prepend(
      h('li', {}, h('time', { datetime: now.toISOString(), text: now.toLocaleTimeString('en-GB') }), h('span', { text: message })),
    );
    while (el.activity.children.length > 60) el.activity.lastElementChild?.remove();
  }

  function persist(): void {
    saveSettings(state.settings);
  }

  function formatFor(name: string | null): AnalyzeRequest['settings']['format'] {
    return name && /\.(csv|tsv)$/i.test(name) ? 'csv' : 'auto';
  }

  // --------------------------------------------------------------- analysis
  function analyzeNow(): Promise<void> {
    const id = ++state.requestId;
    const request: AnalyzeRequest = {
      text: state.text,
      settings: {
        mode: state.settings.mode,
        typeLabels: state.settings.typeLabels,
        strict: state.settings.strict,
        enabled: [...state.settings.enabled, ...(state.settings.customTerms.length ? (['CUSTOM'] as const) : [])],
        customTerms: state.settings.customTerms,
        format: formatFor(state.fileName),
      },
      kept: [...state.kept],
    };
    lastRun = analyzer.analyze(request).then(
      (result) => {
        if (id !== state.requestId) return; // a newer request superseded this one
        state.result = result;
        render();
      },
      (error: unknown) => {
        console.error(error);
        toast('Analysis failed — see the browser console for details.');
      },
    );
    return lastRun;
  }
  const analyzeSoon = debounce(() => void analyzeNow(), TYPING_DEBOUNCE_MS);

  // ----------------------------------------------------------------- render
  const coreBadges = renderTypeToggles(el.coreList, CORE_TYPES.filter((t) => t !== 'CUSTOM'), new Set(state.settings.enabled));
  const extBadges = renderTypeToggles(el.extendedList, EXTENDED_TYPES.filter((t) => t !== 'CUSTOM'), new Set(state.settings.enabled));

  function render(): void {
    const r = state.result;
    if (!r) return;
    const hasText = state.text.length > 0;

    el.inputMeta.textContent = hasText
      ? `${plural(r.chars, 'character')} · ${plural(r.lines, 'line')}${state.fileName ? ` · ${state.fileName}` : ''}${r.csv ? ` · CSV detected (${r.csv.columns.length} columns)` : ''}`
      : 'Nothing loaded yet. Try the noisy sample.';

    el.statTotal.textContent = r.total.toLocaleString('en-IN');
    el.statUnique.textContent = r.uniqueValues.toLocaleString('en-IN');
    el.statRejected.textContent = r.rejected.length.toLocaleString('en-IN');
    el.statKept.textContent = r.keptCount.toLocaleString('en-IN');
    el.timing.textContent = hasText ? `Analysed in ${r.ms} ms · ${analyzer.mode === 'worker' ? 'background worker' : 'main thread'}` : '';

    renderChips(el.chips, r.counts);
    updateTypeCounts(coreBadges, r.counts);
    updateTypeCounts(extBadges, r.counts);

    const { truncated } = renderPanes(el.paneOriginal, el.paneOutput, state.text, r);
    el.previewNote.hidden = !truncated;
    el.previewNote.textContent = truncated
      ? `Preview shows the first ${PREVIEW_LIMIT.toLocaleString('en-IN')} characters. The download, copy and audit report cover the whole document.`
      : '';
    el.modeBadge.textContent = MODE_LABELS[state.settings.mode];

    const outName = sanitizedFileName(state.fileName);
    el.downloadLabel.textContent = hasText ? `Download ${outName}` : 'Download sanitized file';
    el.download.disabled = !hasText;
    el.copy.disabled = !hasText;
    el.report.disabled = !hasText;
    el.key.hidden = !(state.settings.mode === 'pseudonym' && r.mapping.length > 0);
    el.restoreRun.disabled = r.mapping.length === 0;
    el.restoreStatus.textContent =
      r.mapping.length > 0 ? `${plural(r.mapping.length, 'token')} available` : 'Switch to Consistent pseudonyms to enable.';

    renderFilterOptions(r);
    const { shown, total } = renderFindings(el.findingsBody, r, state.filter);
    el.findingsNote.hidden = total <= TABLE_LIMIT;
    el.findingsNote.textContent = `Showing the first ${shown.toLocaleString('en-IN')} of ${total.toLocaleString('en-IN')} findings. The audit report lists all of them.`;
    renderRejected(el.rejectedSummary, el.rejectedList, r);
  }

  function renderFilterOptions(r: AnalysisResult): void {
    const present = [...new Set(r.entities.map((e) => e.type))];
    if (state.filter && !present.includes(state.filter)) state.filter = '';
    el.findingsFilter.replaceChildren(
      h('option', { value: '', text: `All types (${r.entities.length})` }),
      ...present.map((t) =>
        h('option', { value: t, selected: t === state.filter, text: `${ENTITY_INFO[t].label} (${r.entities.filter((e) => e.type === t).length})` }),
      ),
    );
  }

  function applySettingsToControls(): void {
    const s = state.settings;
    for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="mode"]')) radio.checked = radio.value === s.mode;
    el.typeLabels.checked = s.typeLabels;
    el.strict.checked = s.strict;
    el.customTerms.value = s.customTerms.join('\n');
    el.syncScroll.checked = s.syncScroll;
    el.showTags.checked = s.showTags;
    el.diff.classList.toggle('show-tags', s.showTags);
    for (const box of document.querySelectorAll<HTMLInputElement>('input[name="entity-type"]')) {
      box.checked = s.enabled.includes(box.value as EntityType);
    }
    updateEnabledSummary();
    applyTheme(s.theme);
  }

  function updateEnabledSummary(): void {
    const total = CORE_TYPES.length + EXTENDED_TYPES.length - 1; // CUSTOM is driven by the term list
    const on = state.settings.enabled.filter((t) => t !== 'CUSTOM').length;
    el.typesEnabled.textContent = `(${on} of ${total})`;
  }

  function applyTheme(theme: Theme): void {
    if (theme === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', theme);
    el.themeToggle.setAttribute('aria-label', `Colour theme: ${theme}. Activate to change.`);
    el.themeToggle.title = `Theme: ${theme}`;
  }

  // ------------------------------------------------------------ input flows
  async function loadText(text: string, fileName: string | null): Promise<void> {
    state.text = text;
    state.fileName = fileName;
    state.kept.clear();
    el.input.value = text;
    el.input.scrollTop = 0;
    el.paneOriginal.scrollTop = 0;
    el.paneOutput.scrollTop = 0;
    await analyzeNow();
  }

  async function loadFile(file: File): Promise<void> {
    const read = await readTextFile(file);
    if (!read.ok) {
      toast(read.error);
      log(`Rejected file: ${read.error}`);
      return;
    }
    await loadText(read.text, read.name);
    const r = state.result;
    toast(`Loaded ${read.name} — ${r ? plural(r.total, 'value') : 'no values'} to redact`);
    log(`Opened file ${read.name} (${formatBytes(read.bytes)}) — read locally, never uploaded`);
  }

  async function loadSample(id: string): Promise<void> {
    const sample = getSample(id);
    await loadText(sample.text, sample.fileName);
    const r = state.result;
    log(`Loaded sample “${sample.title}” — ${r ? `${plural(r.total, 'value')} found, ${plural(r.rejected.length, 'look-alike')} rejected` : ''}`);
  }

  el.sampleSelect.replaceChildren(...SAMPLES.map((s) => h('option', { value: s.id, title: s.description, text: s.title })));
  el.sampleSelect.value = DEFAULT_SAMPLE_ID;
  el.loadSample.addEventListener('click', () => void loadSample(el.sampleSelect.value));
  el.sampleSelect.addEventListener('change', () => void loadSample(el.sampleSelect.value));

  el.input.addEventListener('input', () => {
    state.text = el.input.value;
    analyzeSoon();
  });

  el.fileInput.addEventListener('change', () => {
    const file = el.fileInput.files?.[0];
    if (file) void loadFile(file);
    el.fileInput.value = ''; // allow re-selecting the same file
  });

  let dragDepth = 0;
  el.dropzone.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragDepth++;
    el.dropzone.classList.add('is-dragging');
  });
  el.dropzone.addEventListener('dragover', (e) => e.preventDefault());
  el.dropzone.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) el.dropzone.classList.remove('is-dragging');
  });
  el.dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0;
    el.dropzone.classList.remove('is-dragging');
    const file = e.dataTransfer?.files[0];
    if (file) void loadFile(file);
  });

  el.clear.addEventListener('click', () => {
    void loadText('', null);
    el.input.focus();
    log('Cleared input');
  });

  // ---------------------------------------------------------- settings flows
  for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="mode"]')) {
    radio.addEventListener('change', () => {
      if (!radio.checked) return;
      state.settings.mode = radio.value as RedactionMode;
      persist();
      void analyzeNow();
      log(`Mode → ${MODE_LABELS[state.settings.mode]}`);
    });
  }

  el.typeLabels.addEventListener('change', () => {
    state.settings.typeLabels = el.typeLabels.checked;
    persist();
    void analyzeNow();
  });

  el.strict.addEventListener('change', () => {
    state.settings.strict = el.strict.checked;
    persist();
    void analyzeNow();
    log(`Strict checksum validation ${state.settings.strict ? 'on' : 'off'}`);
  });

  document.querySelector('.sidebar')?.addEventListener('change', (e) => {
    const box = e.target as HTMLInputElement;
    if (box.name !== 'entity-type' || !isEntityType(box.value)) return;
    const enabled = new Set(state.settings.enabled);
    if (box.checked) enabled.add(box.value);
    else enabled.delete(box.value);
    state.settings.enabled = [...enabled];
    persist();
    updateEnabledSummary();
    void analyzeNow();
    log(`${box.checked ? 'Enabled' : 'Disabled'} ${ENTITY_INFO[box.value].label} detection`);
  });

  function setEnabled(types: readonly EntityType[], label: string): void {
    state.settings.enabled = [...types];
    persist();
    applySettingsToControls();
    void analyzeNow();
    log(label);
  }
  el.typesAll.addEventListener('click', () => setEnabled([...CORE_TYPES, ...EXTENDED_TYPES], 'Enabled all entity types'));
  el.typesCore.addEventListener('click', () => setEnabled(CORE_TYPES, 'Core entity types only'));

  const onTermsChange = debounce(() => {
    state.settings.customTerms = el.customTerms.value
      .split('\n')
      .map((t) => t.trim())
      .filter(Boolean);
    persist();
    void analyzeNow();
  }, 300);
  el.customTerms.addEventListener('input', onTermsChange);

  el.syncScroll.addEventListener('change', () => {
    state.settings.syncScroll = el.syncScroll.checked;
    persist();
  });
  el.showTags.addEventListener('change', () => {
    state.settings.showTags = el.showTags.checked;
    el.diff.classList.toggle('show-tags', state.settings.showTags);
    persist();
  });

  el.themeToggle.addEventListener('click', () => {
    const order: Theme[] = ['system', 'light', 'dark'];
    state.settings.theme = order[(order.indexOf(state.settings.theme) + 1) % order.length] as Theme;
    applyTheme(state.settings.theme);
    persist();
  });

  // ------------------------------------------------------------- diff panes
  let syncing = false;
  function syncScroll(from: HTMLElement, to: HTMLElement): void {
    if (!state.settings.syncScroll || syncing) return;
    syncing = true;
    const ratio = from.scrollTop / Math.max(1, from.scrollHeight - from.clientHeight);
    to.scrollTop = ratio * (to.scrollHeight - to.clientHeight);
    requestAnimationFrame(() => {
      syncing = false;
    });
  }
  el.paneOriginal.addEventListener('scroll', () => syncScroll(el.paneOriginal, el.paneOutput), { passive: true });
  el.paneOutput.addEventListener('scroll', () => syncScroll(el.paneOutput, el.paneOriginal), { passive: true });

  let hovered: string | null = null;
  function setHover(id: string | null): void {
    if (hovered === id) return;
    for (const m of el.diff.querySelectorAll('.pii.is-hover')) m.classList.remove('is-hover');
    hovered = id;
    if (id === null) return;
    for (const m of el.diff.querySelectorAll(`.pii[data-eid="${id}"]`)) m.classList.add('is-hover');
  }
  el.diff.addEventListener('mouseover', (e) => {
    const mark = (e.target as Element).closest<HTMLElement>('.pii[data-eid]');
    setHover(mark?.dataset.eid ?? null);
  });
  el.diff.addEventListener('mouseleave', () => setHover(null));

  function toggleKeep(key: string): void {
    const entity = state.result?.entities.find((e) => e.key === key);
    const label = entity ? ENTITY_INFO[entity.type].label : 'value';
    if (state.kept.has(key)) {
      state.kept.delete(key);
      toast(`Will redact this ${label.toLowerCase()} again`);
      log(`Re-enabled redaction for a ${label.toLowerCase()}`);
    } else {
      state.kept.add(key);
      const n = state.result?.entities.filter((e) => e.key === key).length ?? 1;
      toast(`Keeping this ${label.toLowerCase()} — ${plural(n, 'occurrence')} left as is`);
      log(`Kept a ${label.toLowerCase()} un-redacted (${plural(n, 'occurrence')})`);
    }
    void analyzeNow();
  }

  el.paneOriginal.addEventListener('click', (e) => {
    const mark = (e.target as Element).closest<HTMLElement>('.pii[data-eid]');
    const entity = mark ? state.result?.entities[Number(mark.dataset.eid)] : undefined;
    if (entity) toggleKeep(entity.key);
  });

  el.findingsBody.addEventListener('click', (e) => {
    const btn = (e.target as Element).closest<HTMLButtonElement>('button[data-key]');
    if (btn?.dataset.key) toggleKeep(btn.dataset.key);
  });

  el.findingsFilter.addEventListener('change', () => {
    const v = el.findingsFilter.value;
    state.filter = isEntityType(v) ? v : '';
    if (state.result) renderFindings(el.findingsBody, state.result, state.filter);
  });

  // ----------------------------------------------------------------- export
  el.download.addEventListener('click', () => {
    const r = state.result;
    if (!r || !state.text) return;
    const name = sanitizedFileName(state.fileName);
    downloadText(name, r.output, mimeFor(name));
    toast(`Saved ${name}`);
    log(`Downloaded ${name} — ${plural(r.total, 'value')} redacted (${MODE_LABELS[state.settings.mode]})`);
  });

  el.copy.addEventListener('click', async () => {
    const r = state.result;
    if (!r) return;
    try {
      await navigator.clipboard.writeText(r.output);
      toast('Sanitized text copied');
      log('Copied sanitized text to clipboard');
    } catch {
      el.paneOutput.focus();
      const range = document.createRange();
      range.selectNodeContents(el.paneOutput);
      getSelection()?.removeAllRanges();
      getSelection()?.addRange(range);
      toast('Clipboard blocked — the output is selected, press Ctrl+C');
    }
  });

  el.report.addEventListener('click', () => {
    const r = state.result;
    if (!r) return;
    const report = buildAuditReport(r, { fileName: state.fileName, mode: state.settings.mode, strict: state.settings.strict, generatedAt: new Date() });
    const name = `${sanitizedFileName(state.fileName).replace(/\.[^.]+$/, '')}.audit.json`;
    downloadText(name, `${JSON.stringify(report, null, 2)}\n`, 'application/json');
    toast('Audit report saved — it contains no original values');
    log(`Downloaded audit report ${name}`);
  });

  // Two-step confirmation instead of a blocking dialog: the key file contains real PII.
  let keyArmed: ReturnType<typeof setTimeout> | undefined;
  el.key.addEventListener('click', () => {
    const r = state.result;
    if (!r) return;
    if (keyArmed === undefined) {
      el.key.textContent = 'Contains real PII — click again to save';
      keyArmed = setTimeout(() => {
        keyArmed = undefined;
        el.key.textContent = 'Re-identification key';
      }, 4000);
      return;
    }
    clearTimeout(keyArmed);
    keyArmed = undefined;
    el.key.textContent = 'Re-identification key';
    const name = `${sanitizedFileName(state.fileName).replace(/\.[^.]+$/, '')}.key.json`;
    downloadText(name, `${JSON.stringify(buildKeyFile(r.mapping, new Date()), null, 2)}\n`, 'application/json');
    toast('Key saved. Store it separately from the sanitized file.');
    log(`Downloaded re-identification key (${plural(r.mapping.length, 'token')})`);
  });

  el.restoreRun.addEventListener('click', () => {
    const r = state.result;
    if (!r) return;
    const { text, restored } = reidentify(el.restoreInput.value, r.mapping);
    el.restoreOutput.hidden = false;
    el.restoreOutput.textContent = text;
    el.restoreStatus.textContent = `${plural(restored, 'token')} restored`;
    log(`Re-identified ${plural(restored, 'token')} in a pasted reply`);
  });

  // --------------------------------------------------- privacy instrumentation
  // Count any request the page itself makes after start-up. With
  // connect-src 'none' these can't succeed, and the counter proves it.
  let outbound = 0;
  let blocked = 0;
  function updatePill(): void {
    el.netCount.textContent = outbound === 0 ? '0 network requests' : `${plural(outbound, 'request')} attempted`;
    el.privacyPill.classList.toggle('is-alert', outbound > 0 || blocked > 0);
  }
  if (typeof PerformanceObserver !== 'undefined') {
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as PerformanceResourceTiming[]) {
          if (['fetch', 'xmlhttprequest', 'beacon'].includes(entry.initiatorType)) outbound++;
        }
        updatePill();
      }).observe({ type: 'resource', buffered: true });
    } catch {
      /* resource timing unsupported */
    }
  }
  document.addEventListener('securitypolicyviolation', (e) => {
    if (e.effectiveDirective === 'connect-src') {
      blocked++;
      el.privacyPill.title = `${plural(blocked, 'outbound connection')} blocked by the Content-Security-Policy.`;
      updatePill();
    }
  });
  updatePill();

  // ------------------------------------------------------------------- boot
  applySettingsToControls();
  // On phones the 16-item type list would push the input far down the page.
  if (typeof matchMedia === 'function' && matchMedia('(max-width: 760px)').matches) el.typesDetails.open = false;
  el.activity.append(h('li', { class: 'activity-empty', text: 'No activity yet.' }));
  void analyzeNow();

  return {
    idle: () => lastRun,
    loadText,
    state,
  };
}
