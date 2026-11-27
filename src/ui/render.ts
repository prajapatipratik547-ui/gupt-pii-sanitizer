import { ENTITY_INFO, type EntityType } from '../core/entities';
import type { Entity } from '../core/engine';
import type { AnalysisResult } from '../core/pipeline';
import { clear, h, plural } from './dom';

/** Characters rendered in each diff pane. The download always contains the full document. */
export const PREVIEW_LIMIT = 200_000;
/** Rows rendered in the findings table. The audit report always contains every finding. */
export const TABLE_LIMIT = 1_000;

const percent = (n: number): string => `${Math.round(n * 100)}%`;

function entityTitle(e: Entity): string {
  const info = ENTITY_INFO[e.type];
  const parts = [info.label, e.note];
  if (e.meta) parts.push(e.meta);
  parts.push(`confidence ${percent(e.confidence)}`);
  parts.push(e.kept ? 'kept — click to redact' : 'click to keep this value');
  return parts.join(' · ');
}

/**
 * Build both diff panes from the original text, the entity spans and their
 * replacements. Text goes in as text nodes and highlights as <mark>, so the
 * panes are XSS-safe by construction.
 */
export function renderPanes(original: HTMLElement, output: HTMLElement, text: string, result: AnalysisResult): { truncated: boolean } {
  if (text.length === 0) {
    original.replaceChildren(h('span', { class: 'pane-empty', text: 'Your text appears here with every detection highlighted.' }));
    output.replaceChildren(h('span', { class: 'pane-empty', text: 'The sanitized version appears here, live.' }));
    return { truncated: false };
  }
  const left = document.createDocumentFragment();
  const right = document.createDocumentFragment();
  let cursor = 0;
  for (const e of result.entities) {
    if (e.start >= PREVIEW_LIMIT) break;
    if (e.start > cursor) {
      const gap = text.slice(cursor, e.start);
      left.append(gap);
      right.append(gap);
    }
    const cls = `pii t-${e.type}${e.kept ? ' is-kept' : ''}`;
    const id = String(e.id);
    left.append(h('mark', { class: cls, 'data-eid': id, 'data-tag': ENTITY_INFO[e.type].short, title: entityTitle(e) }, e.value));
    const replacement = result.replacements[e.id] ?? e.value;
    right.append(
      h('mark', { class: cls, 'data-eid': id, title: e.kept ? 'Kept as original' : `${ENTITY_INFO[e.type].label} redacted` }, replacement),
    );
    cursor = e.end;
  }
  const tailEnd = Math.min(text.length, Math.max(cursor, PREVIEW_LIMIT));
  const tail = text.slice(cursor, tailEnd);
  left.append(tail);
  right.append(tail);
  original.replaceChildren(left);
  output.replaceChildren(right);
  return { truncated: tailEnd < text.length };
}

export function renderChips(list: HTMLElement, counts: Partial<Record<EntityType, number>>): void {
  const entries = Object.entries(counts) as [EntityType, number][];
  if (entries.length === 0) {
    list.replaceChildren(h('li', { class: 'chips-empty', text: 'No personal data detected yet.' }));
    return;
  }
  list.replaceChildren(
    ...entries.map(([type, n]) =>
      h(
        'li',
        { class: `chip t-${type}` },
        h('span', { class: 'swatch', 'aria-hidden': 'true' }),
        ENTITY_INFO[type].label,
        h('b', { text: n }),
      ),
    ),
  );
}

/** Build the checkbox list for one tier. Returns the count badges for later updates. */
export function renderTypeToggles(
  container: HTMLElement,
  types: readonly EntityType[],
  enabled: ReadonlySet<EntityType>,
): Map<EntityType, HTMLElement> {
  const badges = new Map<EntityType, HTMLElement>();
  clear(container);
  for (const type of types) {
    const info = ENTITY_INFO[type];
    const badge = h('span', { class: 'type-count', text: '0', 'aria-label': `0 found` });
    badges.set(type, badge);
    container.append(
      h(
        'label',
        { class: `type-toggle t-${type}`, title: info.description },
        h('input', { type: 'checkbox', name: 'entity-type', value: type, checked: enabled.has(type) }),
        h('span', { class: 'swatch', 'aria-hidden': 'true' }),
        h('span', { text: info.label }),
        badge,
      ),
    );
  }
  return badges;
}

export function updateTypeCounts(badges: Map<EntityType, HTMLElement>, counts: Partial<Record<EntityType, number>>): void {
  for (const [type, badge] of badges) {
    const n = counts[type] ?? 0;
    badge.textContent = String(n);
    badge.setAttribute('aria-label', plural(n, 'found', 'found'));
    badge.classList.toggle('has', n > 0);
  }
}

export function renderFindings(body: HTMLElement, result: AnalysisResult, filter: EntityType | ''): { shown: number; total: number } {
  const rows = filter ? result.entities.filter((e) => e.type === filter) : result.entities;
  if (rows.length === 0) {
    body.replaceChildren(h('tr', { class: 'empty-row' }, h('td', { colspan: 7, text: 'No findings yet. Paste text or load a sample.' })));
    return { shown: 0, total: 0 };
  }
  const frag = document.createDocumentFragment();
  for (const e of rows.slice(0, TABLE_LIMIT)) {
    const info = ENTITY_INFO[e.type];
    const replacement = result.replacements[e.id];
    frag.append(
      h(
        'tr',
        { class: e.kept ? 'is-kept' : undefined },
        h('td', { text: `${e.line}:${e.column}` }),
        h('td', {}, h('span', { class: `type-tag t-${e.type}` }, h('span', { class: 'swatch', 'aria-hidden': 'true' }), info.label)),
        h('td', {}, h('code', { text: e.value })),
        h(
          'td',
          {},
          replacement === null || replacement === undefined
            ? h('span', { class: 'muted', text: 'kept as is' })
            : h('code', { text: replacement }),
        ),
        h('td', { class: 'why' }, e.note, e.meta ? h('small', { text: e.meta }) : null),
        h(
          'td',
          {},
          h(
            'span',
            { class: 'conf' },
            h('span', { class: 'conf-bar', 'aria-hidden': 'true' }, confFill(e.confidence)),
            percent(e.confidence),
          ),
        ),
        h(
          'td',
          {},
          h('button', {
            type: 'button',
            class: 'row-btn',
            'data-key': e.key,
            text: e.kept ? 'Redact' : 'Keep',
            'aria-label': `${e.kept ? 'Redact' : 'Keep'} ${info.label} on line ${e.line}`,
          }),
        ),
      ),
    );
  }
  body.replaceChildren(frag);
  return { shown: Math.min(rows.length, TABLE_LIMIT), total: rows.length };
}

function confFill(confidence: number): HTMLElement {
  const fill = h('span');
  // CSSOM writes are allowed under style-src 'self' (only inline style attributes in markup are blocked).
  fill.style.width = percent(confidence);
  return fill;
}

export function renderRejected(summary: HTMLElement, list: HTMLElement, result: AnalysisResult): void {
  const n = result.rejected.length;
  summary.textContent =
    n === 0 ? 'No look-alike numbers needed rejecting' : `${plural(n, 'look-alike')} rejected by validation (not redacted)`;
  list.replaceChildren(
    ...result.rejected
      .slice(0, 500)
      .map((r) =>
        h(
          'li',
          {},
          h('span', { class: 'muted', text: `Line ${r.line}` }),
          h('code', { text: r.value }),
          h('span', { text: `looked like ${ENTITY_INFO[r.type].label}` }),
          h('span', { class: 'reason', text: `✓ ${r.reason}` }),
        ),
      ),
  );
}
