import { headerType, parseCsv, sniffDelimiter } from './csv';
import { type Detector, DETECTORS, contextBefore, validatePersonName } from './detectors';
import { ENTITY_INFO, type EntityType } from './entities';
import { entityKey } from './normalize';

export type InputFormat = 'auto' | 'text' | 'csv';

export interface DetectOptions {
  enabled: readonly EntityType[];
  /** Strict mode rejects format-valid numbers that fail their checksum (Luhn, Verhoeff, GSTIN). */
  strict: boolean;
  customTerms: readonly string[];
  /** Entity keys (see `entityKey`) the user chose to leave un-redacted. */
  kept: ReadonlySet<string>;
  format: InputFormat;
}

export interface Entity {
  id: number;
  type: EntityType;
  start: number;
  end: number;
  value: string;
  confidence: number;
  /** Why it was accepted, e.g. "Luhn checksum passed". */
  note: string;
  /** Extra classification, e.g. card network or IP scope. */
  meta?: string;
  /** Which rule found it. */
  source: string;
  key: string;
  kept: boolean;
  line: number;
  column: number;
}

export interface Rejection {
  type: EntityType;
  start: number;
  end: number;
  value: string;
  reason: string;
  line: number;
}

export interface CsvInfo {
  delimiter: string;
  columns: { header: string; type: EntityType | null }[];
}

export interface Detection {
  entities: Entity[];
  rejected: Rejection[];
  csv: CsvInfo | null;
}

interface Candidate {
  type: EntityType;
  start: number;
  end: number;
  confidence: number;
  note: string;
  meta?: string;
  source: string;
  /** Overrides the normalized key (used to tie "Mehta" to "Anjali Mehta"). */
  key?: string;
}

interface RawRejection {
  type: EntityType;
  start: number;
  end: number;
  reason: string;
}

const MAX_PROPAGATED_NAMES = 400;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function runDetector(det: Detector, text: string, strict: boolean, out: Candidate[], rejected: RawRejection[]): void {
  const re = det.pattern;
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m[0].length === 0) {
      re.lastIndex++;
      continue;
    }
    const span = m.indices?.[det.group ?? 0];
    if (!span) continue;
    const [start, end] = span;
    const value = text.slice(start, end);
    if (det.rejectContext?.test(contextBefore(text, m.index, 24))) continue;
    if (det.requireContext && !det.requireContext.test(contextBefore(text, start))) continue;

    let confidence = det.confidence;
    let note = det.note ?? 'Pattern match';
    let meta: string | undefined;
    if (det.validate) {
      const check = det.validate(value, { text, start, end });
      if (check.ok) {
        note = check.note;
        meta = check.meta;
      } else if (check.soft && !strict) {
        confidence = 0.55;
        note = `${check.reason} — flagged because strict validation is off`;
      } else {
        if (det.reportRejections) rejected.push({ type: det.type, start, end, reason: check.reason });
        continue;
      }
    }
    if (det.boostContext?.test(contextBefore(text, start))) {
      confidence = Math.min(0.99, confidence + 0.05);
      note += ' · context keyword nearby';
    }
    out.push(
      meta
        ? { type: det.type, start, end, confidence, note, meta, source: det.id }
        : { type: det.type, start, end, confidence, note, source: det.id },
    );
  }
}

/** Trim whitespace from a span so highlights hug the value. */
function trimSpan(text: string, start: number, end: number): [number, number] {
  let s = start;
  let e = end;
  while (s < e && /\s/.test(text.charAt(s))) s++;
  while (e > s && /\s/.test(text.charAt(e - 1))) e--;
  return [s, e];
}

function detectCsvColumns(text: string, delimiter: string, enabled: ReadonlySet<EntityType>, out: Candidate[]): CsvInfo {
  const cells = parseCsv(text, delimiter);
  const headers = cells.filter((c) => c.row === 0);
  const columnTypes = new Map<number, { type: EntityType; header: string }>();
  for (const h of headers) {
    const type = headerType(h.value);
    if (type && enabled.has(type)) columnTypes.set(h.col, { type, header: h.value.trim() });
  }
  if (columnTypes.size > 0) {
    for (const cell of cells) {
      if (cell.row === 0) continue;
      const col = columnTypes.get(cell.col);
      if (!col) continue;
      const [start, end] = trimSpan(text, cell.start, cell.end);
      if (end - start < 2) continue;
      if (col.type === 'PERSON' && !validatePersonName(text.slice(start, end)).ok) continue;
      out.push({ type: col.type, start, end, confidence: 0.9, note: `Value in CSV column "${col.header}"`, source: 'csv-column' });
    }
  }
  return { delimiter, columns: headers.map((h) => ({ header: h.value.trim(), type: headerType(h.value) })) };
}

/** A resume usually opens with the candidate's name on its own line, followed by contact details. */
function detectHeaderName(text: string, out: Candidate[]): void {
  const m = /^\s*([A-Z][a-z]+(?:[ \t]+[A-Z][a-z]+){1,2})[ \t]*\r?\n/d.exec(text);
  const span = m?.indices?.[1];
  if (!m || !span || !validatePersonName(m[1] ?? '').ok) return;
  const following = text.slice(span[1], span[1] + 400);
  if (/@|\+?\d[\d -]{8,}\d/.test(following)) {
    out.push({
      type: 'PERSON',
      start: span[0],
      end: span[1],
      confidence: 0.65,
      note: 'Document header followed by contact details',
      source: 'header-name',
    });
  }
}

function detectCustomTerms(text: string, terms: readonly string[], out: Candidate[]): void {
  const cleaned = [...new Set(terms.map((t) => t.trim()).filter((t) => t.length >= 2))].sort((a, b) => b.length - a.length);
  if (cleaned.length === 0) return;
  const re = new RegExp(`(?<![\\p{L}\\p{N}_])(?:${cleaned.map(escapeRegExp).join('|')})(?![\\p{L}\\p{N}_])`, 'giu');
  for (const m of text.matchAll(re)) {
    out.push({
      type: 'CUSTOM',
      start: m.index,
      end: m.index + m[0].length,
      confidence: 1,
      note: 'On your always-redact list',
      source: 'custom',
    });
  }
}

/**
 * Once a name is found in a reliable spot ("Patient: Anjali Mehta"), find
 * every later mention — including the surname alone — and tie them to the
 * same pseudonym. Name parts shared by two different people are skipped.
 */
function propagateNames(text: string, cands: Candidate[]): void {
  const fullNames = new Map<string, string>(); // surface form -> canonical key
  for (const c of cands) {
    if (c.type !== 'PERSON') continue;
    const surface = text.slice(c.start, c.end);
    if (!fullNames.has(surface)) fullNames.set(surface, entityKey('PERSON', surface));
    if (fullNames.size >= MAX_PROPAGATED_NAMES) break;
  }
  if (fullNames.size === 0) return;

  const partOwners = new Map<string, Set<string>>();
  for (const [surface, key] of fullNames) {
    const words = surface.split(/\s+/);
    if (words.length < 2) continue;
    for (const w of words) {
      if (w.length < 3 || !/^[A-Z][a-z]/.test(w) || !validatePersonName(w).ok) continue;
      const owners = partOwners.get(w) ?? new Set<string>();
      owners.add(key);
      partOwners.set(w, owners);
    }
  }
  const lookup = new Map<string, string>(fullNames);
  for (const [part, owners] of partOwners) {
    if (owners.size === 1) lookup.set(part, [...owners][0] as string);
  }
  // "Mrs. Mehta" found by the title rule should share Anjali Mehta's pseudonym.
  for (const c of cands) {
    if (c.type === 'PERSON' && !c.key) {
      const owner = lookup.get(text.slice(c.start, c.end));
      if (owner) c.key = owner;
    }
  }
  const alternatives = [...lookup.keys()].sort((a, b) => b.length - a.length).map(escapeRegExp);
  const re = new RegExp(`(?<![\\w])(?:${alternatives.join('|')})(?![\\w])`, 'g');
  for (const m of text.matchAll(re)) {
    const key = lookup.get(m[0]);
    if (!key) continue;
    cands.push({
      type: 'PERSON',
      start: m.index,
      end: m.index + m[0].length,
      confidence: 0.75,
      note: 'Repeat mention of a detected name',
      source: 'name-propagation',
      key,
    });
  }
}

/**
 * Keep the best non-overlapping set: higher priority first, then longer,
 * then more confident. An occupancy bitmap makes each check proportional to
 * the span length, so the whole pass stays linear in document size.
 */
function resolveOverlaps(text: string, cands: Candidate[]): Candidate[] {
  const ordered = [...cands].sort(
    (a, b) =>
      ENTITY_INFO[b.type].priority - ENTITY_INFO[a.type].priority ||
      b.end - b.start - (a.end - a.start) ||
      b.confidence - a.confidence ||
      a.start - b.start,
  );
  const taken = new Uint8Array(text.length);
  const accepted: Candidate[] = [];
  outer: for (const c of ordered) {
    for (let i = c.start; i < c.end; i++) if (taken[i]) continue outer;
    taken.fill(1, c.start, c.end);
    accepted.push(c);
  }
  return accepted.sort((a, b) => a.start - b.start);
}

function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) starts.push(i + 1);
  return starts;
}

function lineOf(starts: readonly number[], offset: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((starts[mid] as number) <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export function detect(text: string, options: DetectOptions): Detection {
  const enabled = new Set(options.enabled);
  const candidates: Candidate[] = [];
  const rawRejected: RawRejection[] = [];

  for (const det of DETECTORS) {
    if (enabled.has(det.type)) runDetector(det, text, options.strict, candidates, rawRejected);
  }

  let csv: CsvInfo | null = null;
  const delimiter = options.format === 'text' ? null : (sniffDelimiter(text) ?? (options.format === 'csv' ? ',' : null));
  if (delimiter) csv = detectCsvColumns(text, delimiter, enabled, candidates);

  if (enabled.has('PERSON')) {
    detectHeaderName(text, candidates);
    propagateNames(text, candidates);
  }
  if (enabled.has('CUSTOM')) detectCustomTerms(text, options.customTerms, candidates);

  const accepted = resolveOverlaps(text, candidates);
  const starts = lineStarts(text);

  const entities: Entity[] = accepted.map((c, id) => {
    const value = text.slice(c.start, c.end);
    const key = c.key ?? entityKey(c.type, value);
    const line = lineOf(starts, c.start);
    const entity: Entity = {
      id,
      type: c.type,
      start: c.start,
      end: c.end,
      value,
      confidence: Math.round(c.confidence * 100) / 100,
      note: c.note,
      source: c.source,
      key,
      kept: options.kept.has(key),
      line: line + 1,
      column: c.start - (starts[line] as number) + 1,
    };
    if (c.meta) entity.meta = c.meta;
    return entity;
  });

  // A rejected candidate that sits inside an accepted entity is not interesting to the user.
  const covered = new Uint8Array(text.length);
  for (const e of entities) covered.fill(1, e.start, e.end);
  const seen = new Set<string>();
  const rejected: Rejection[] = [];
  for (const r of rawRejected.sort((a, b) => a.start - b.start)) {
    const id = `${r.start}:${r.end}`;
    if (seen.has(id) || covered[r.start] || covered[r.end - 1]) continue;
    seen.add(id);
    rejected.push({ ...r, value: text.slice(r.start, r.end), line: lineOf(starts, r.start) + 1 });
  }

  return { entities, rejected, csv };
}
