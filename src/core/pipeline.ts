import { type CsvInfo, type Detection, type Entity, type InputFormat, type Rejection, detect } from './engine';
import { ENTITY_TYPES, type EntityType } from './entities';
import { type PseudonymEntry, type RedactionMode, redact } from './redact';

export interface AnalyzeSettings {
  mode: RedactionMode;
  typeLabels: boolean;
  strict: boolean;
  enabled: EntityType[];
  customTerms: string[];
  format: InputFormat;
}

export interface AnalyzeRequest {
  text: string;
  settings: AnalyzeSettings;
  /** Entity keys the user chose to keep un-redacted. */
  kept: string[];
}

export interface AnalysisResult {
  entities: Entity[];
  rejected: Rejection[];
  csv: CsvInfo | null;
  output: string;
  replacements: (string | null)[];
  outputSpans: [number, number][];
  mapping: PseudonymEntry[];
  /** Redacted entities per type (kept ones excluded). */
  counts: Partial<Record<EntityType, number>>;
  total: number;
  keptCount: number;
  uniqueValues: number;
  chars: number;
  lines: number;
  ms: number;
}

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export function analyze(req: AnalyzeRequest): AnalysisResult {
  const t0 = now();
  const detection: Detection = detect(req.text, {
    enabled: req.settings.enabled,
    strict: req.settings.strict,
    customTerms: req.settings.customTerms,
    kept: new Set(req.kept),
    format: req.settings.format,
  });
  const redaction = redact(req.text, detection.entities, { mode: req.settings.mode, typeLabels: req.settings.typeLabels });

  const counts: Partial<Record<EntityType, number>> = {};
  let keptCount = 0;
  const unique = new Set<string>();
  for (const e of detection.entities) {
    if (e.kept) {
      keptCount++;
      continue;
    }
    counts[e.type] = (counts[e.type] ?? 0) + 1;
    unique.add(e.key);
  }
  // Stable, registry-ordered counts make the UI and reports deterministic.
  const ordered: Partial<Record<EntityType, number>> = {};
  for (const t of ENTITY_TYPES) if (counts[t]) ordered[t] = counts[t];

  let lines = req.text.length === 0 ? 0 : 1;
  for (let i = req.text.indexOf('\n'); i !== -1; i = req.text.indexOf('\n', i + 1)) lines++;

  return {
    entities: detection.entities,
    rejected: detection.rejected,
    csv: detection.csv,
    output: redaction.output,
    replacements: redaction.replacements,
    outputSpans: redaction.outputSpans,
    mapping: redaction.mapping,
    counts: ordered,
    total: detection.entities.length - keptCount,
    keptCount,
    uniqueValues: unique.size,
    chars: req.text.length,
    lines,
    ms: Math.round((now() - t0) * 10) / 10,
  };
}
