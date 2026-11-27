import { ENTITY_TYPES, type EntityType, isEntityType } from '../core/entities';
import type { RedactionMode } from '../core/redact';

/**
 * User preferences. Only these settings are remembered between visits —
 * the text being sanitized is never written to any storage.
 */
export type Theme = 'system' | 'light' | 'dark';

export interface Settings {
  mode: RedactionMode;
  typeLabels: boolean;
  strict: boolean;
  enabled: EntityType[];
  customTerms: string[];
  syncScroll: boolean;
  showTags: boolean;
  theme: Theme;
}

const STORAGE_KEY = 'gupt.settings.v1';

export const DEFAULT_SETTINGS: Settings = {
  mode: 'full',
  typeLabels: false,
  strict: true,
  enabled: [...ENTITY_TYPES],
  customTerms: [],
  syncScroll: true,
  showTags: true,
  theme: 'system',
};

/**
 * Types that existed before `knownTypes` was recorded (everything up to the
 * Profile URL type). Lets settings saved by older versions be migrated.
 */
const LEGACY_TYPES: readonly EntityType[] = ENTITY_TYPES.filter((t) => t !== 'PROFILE_URL');

/**
 * Saved `enabled` lists only mention the types that existed at the time. A type
 * added later must start switched ON, not silently stay off for returning users.
 */
function migrateEnabled(stored: readonly EntityType[], known: readonly EntityType[]): EntityType[] {
  const added = ENTITY_TYPES.filter((t) => !known.includes(t));
  return [...new Set([...stored, ...added])];
}

const MODES: readonly RedactionMode[] = ['full', 'partial', 'pseudonym'];
const THEMES: readonly Theme[] = ['system', 'light', 'dark'];

/** Parse stored JSON defensively: unknown or malformed fields fall back to defaults. */
export function parseSettings(raw: string | null): Settings {
  if (!raw) return { ...DEFAULT_SETTINGS, enabled: [...DEFAULT_SETTINGS.enabled] };
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ...DEFAULT_SETTINGS, enabled: [...DEFAULT_SETTINGS.enabled] };
  }
  const d = (typeof data === 'object' && data !== null ? data : {}) as Record<string, unknown>;
  const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);
  return {
    mode: MODES.includes(d.mode as RedactionMode) ? (d.mode as RedactionMode) : DEFAULT_SETTINGS.mode,
    typeLabels: bool(d.typeLabels, DEFAULT_SETTINGS.typeLabels),
    strict: bool(d.strict, DEFAULT_SETTINGS.strict),
    enabled: Array.isArray(d.enabled)
      ? migrateEnabled(d.enabled.filter(isEntityType), Array.isArray(d.knownTypes) ? d.knownTypes.filter(isEntityType) : LEGACY_TYPES)
      : [...DEFAULT_SETTINGS.enabled],
    customTerms: Array.isArray(d.customTerms)
      ? d.customTerms.filter((t): t is string => typeof t === 'string').slice(0, 200)
      : [],
    syncScroll: bool(d.syncScroll, DEFAULT_SETTINGS.syncScroll),
    showTags: bool(d.showTags, DEFAULT_SETTINGS.showTags),
    theme: THEMES.includes(d.theme as Theme) ? (d.theme as Theme) : DEFAULT_SETTINGS.theme,
  };
}

export function loadSettings(): Settings {
  try {
    return parseSettings(localStorage.getItem(STORAGE_KEY));
  } catch {
    return parseSettings(null); // storage blocked (private mode, sandbox) — run with defaults
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...settings, knownTypes: ENTITY_TYPES }));
  } catch {
    // Storage unavailable: preferences simply won't persist.
  }
}
