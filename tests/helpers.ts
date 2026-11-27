import { type DetectOptions, detect } from '../src/core/engine';
import { ENTITY_TYPES, type EntityType } from '../src/core/entities';
import { type AnalyzeSettings, analyze } from '../src/core/pipeline';

export const ALL_TYPES: EntityType[] = [...ENTITY_TYPES];

export function find(text: string, options: Partial<DetectOptions> = {}) {
  return detect(text, { enabled: ALL_TYPES, strict: true, customTerms: [], kept: new Set(), format: 'auto', ...options });
}

/** Values detected for one type, in document order. */
export function valuesOf(text: string, type: EntityType, options: Partial<DetectOptions> = {}): string[] {
  return find(text, options).entities.filter((e) => e.type === type).map((e) => e.value);
}

export function run(text: string, settings: Partial<AnalyzeSettings> = {}, kept: string[] = []) {
  return analyze({
    text,
    settings: { mode: 'full', typeLabels: false, strict: true, enabled: ALL_TYPES, customTerms: [], format: 'auto', ...settings },
    kept,
  });
}
