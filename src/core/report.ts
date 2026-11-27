import { ENTITY_INFO } from './entities';
import type { AnalysisResult } from './pipeline';
import { MODE_LABELS, type PseudonymEntry, type RedactionMode } from './redact';

export const APP_NAME = 'Gupt';
export const APP_VERSION = '1.0.0';

/** "customers.csv" -> "customers.sanitized.csv"; no name -> "sanitized.txt". */
export function sanitizedFileName(original: string | null): string {
  if (!original) return 'sanitized.txt';
  const base = original.split(/[\\/]/).pop() ?? original;
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return `${base}.sanitized.txt`;
  return `${base.slice(0, dot)}.sanitized${base.slice(dot)}`;
}

export function mimeFor(fileName: string): string {
  if (/\.csv$/i.test(fileName)) return 'text/csv;charset=utf-8';
  if (/\.tsv$/i.test(fileName)) return 'text/tab-separated-values;charset=utf-8';
  return 'text/plain;charset=utf-8';
}

export interface AuditMeta {
  fileName: string | null;
  mode: RedactionMode;
  strict: boolean;
  generatedAt: Date;
}

/**
 * Machine-readable audit trail. Deliberately contains NO original values —
 * only types, positions, confidence and the replacement written — so it can be
 * shared with a compliance reviewer without re-leaking the data.
 */
export function buildAuditReport(result: AnalysisResult, meta: AuditMeta): Record<string, unknown> {
  return {
    tool: `${APP_NAME} ${APP_VERSION}`,
    generatedAt: meta.generatedAt.toISOString(),
    processing: 'Entirely in the browser. No data was transmitted.',
    input: { fileName: meta.fileName, characters: result.chars, lines: result.lines, csv: result.csv !== null },
    settings: { mode: MODE_LABELS[meta.mode], strictValidation: meta.strict },
    summary: {
      redacted: result.total,
      uniqueValues: result.uniqueValues,
      keptByUser: result.keptCount,
      rejectedByValidation: result.rejected.length,
      byType: Object.fromEntries(Object.entries(result.counts).map(([t, n]) => [ENTITY_INFO[t as keyof typeof ENTITY_INFO].label, n])),
      processingMs: result.ms,
    },
    findings: result.entities.map((e) => ({
      type: e.type,
      line: e.line,
      column: e.column,
      length: e.end - e.start,
      confidence: e.confidence,
      check: e.note,
      ...(e.meta && e.type !== 'GSTIN' ? { detail: e.meta } : {}),
      action: e.kept ? 'kept' : 'redacted',
      replacement: e.kept ? null : result.replacements[e.id],
    })),
    rejected: result.rejected.map((r) => ({ type: r.type, line: r.line, length: r.end - r.start, reason: r.reason })),
  };
}

/** The pseudonym table. Unlike the audit report this DOES contain PII — the UI warns before download. */
export function buildKeyFile(mapping: readonly PseudonymEntry[], generatedAt: Date): Record<string, unknown> {
  return {
    warning: 'This file re-identifies the sanitized document. Store it as securely as the original data.',
    tool: `${APP_NAME} ${APP_VERSION}`,
    generatedAt: generatedAt.toISOString(),
    tokens: Object.fromEntries(mapping.map((m) => [m.token, { type: m.type, original: m.original, occurrences: m.occurrences }])),
  };
}
