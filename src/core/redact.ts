import { ENTITY_INFO, type EntityType } from './entities';
import type { Entity } from './engine';
import { emailAtIndex, expandIPv6 } from './validators';

export type RedactionMode = 'full' | 'partial' | 'pseudonym';

export const MODE_LABELS: Record<RedactionMode, string> = {
  full: 'Full mask',
  partial: 'Partial mask',
  pseudonym: 'Consistent pseudonymization',
};

export interface RedactOptions {
  mode: RedactionMode;
  /** Full mask only: write [REDACTED:EMAIL] instead of plain [REDACTED]. */
  typeLabels: boolean;
}

export interface PseudonymEntry {
  token: string;
  type: EntityType;
  /** First spelling seen in the document. */
  original: string;
  occurrences: number;
}

export interface Redaction {
  output: string;
  /** Replacement text per entity id; null when the user kept that entity. */
  replacements: (string | null)[];
  /** [start, end) of each entity's replacement inside `output`. */
  outputSpans: [number, number][];
  /** Pseudonym table (pseudonym mode only) — the re-identification key. */
  mapping: PseudonymEntry[];
}

/** Replace every digit except the last `keep` with X, leaving separators where they were. */
export function maskDigitsKeepLast(value: string, keep: number): string {
  const total = value.replace(/\D/g, '').length;
  let seen = 0;
  return value.replace(/\d/g, (d) => (++seen > total - keep ? d : 'X'));
}

const maskAlnum = (s: string): string => s.replace(/[\p{L}\p{N}]/gu, 'X');

function maskLocalPart(value: string): string {
  return `${value.charAt(0)}****${value.slice(emailAtIndex(value))}`;
}

/** Type-aware partial mask: keep just enough to recognise the value, hide the rest. */
export function partialMask(type: EntityType, value: string): string {
  switch (type) {
    case 'CREDIT_CARD':
    case 'AADHAAR':
    case 'BANK_ACCOUNT':
      return maskDigitsKeepLast(value, 4);
    case 'PHONE': {
      const prefix = /^(?:(?:\+|00)91[ -]?|\+\d{1,3}[ .-])/.exec(value)?.[0] ?? '';
      return prefix + maskDigitsKeepLast(value.slice(prefix.length), 4);
    }
    case 'EMAIL':
    case 'UPI':
      return maskLocalPart(value);
    case 'PROFILE_URL': {
      // Keep the site so the reader knows what it was; hide the handle.
      const slash = value.lastIndexOf('/');
      const handle = value.slice(slash + 1);
      const at = handle.startsWith('@') ? '@' : '';
      return `${value.slice(0, slash + 1)}${at}${handle.charAt(at.length)}***`;
    }
    case 'PAN':
      return `XXXXXX${value.slice(6)}`;
    case 'GSTIN':
      return `${value.slice(0, 2)}XXXXXXXXXX${value.slice(12)}`;
    case 'PASSPORT': {
      const compact = value.replace(/\s/g, '');
      return `${compact.charAt(0)}${'X'.repeat(compact.length - 3)}${compact.slice(-2)}`;
    }
    case 'IPV4': {
      const [a, b] = value.split('.');
      return `${a ?? ''}.${b ?? ''}.x.x`;
    }
    case 'IPV6': {
      const groups = expandIPv6(value);
      return groups ? `${groups[0] ?? ''}:${groups[1] ?? ''}:x:x:x:x:x:x` : 'x:x:x:x:x:x:x:x';
    }
    case 'MAC': {
      // Keep the vendor prefix (OUI, first 3 octets), hide the device-specific half.
      let hex = 0;
      return value.replace(/[0-9a-f]/gi, (c) => (++hex > 6 ? 'X' : c));
    }
    case 'SECRET':
      return value.length <= 8 ? '********' : `${value.slice(0, 4)}${'*'.repeat(12)}`;
    case 'PERSON':
      return value
        .split(/(\s+)/)
        .map((w) => (/^\s+$/.test(w) || w === '' ? w : `${w.charAt(0)}***`))
        .join('');
    case 'DOB': {
      const year = /(?:19|20)\d{2}/.exec(value);
      if (!year) return maskAlnum(value);
      return maskAlnum(value.slice(0, year.index)) + year[0] + maskAlnum(value.slice(year.index + 4));
    }
    case 'ADDRESS': {
      // Keep only the last comma-separated part (usually city / PIN), with the PIN's last 3 digits hidden.
      const lastComma = value.lastIndexOf(',');
      const head = lastComma === -1 ? value : value.slice(0, lastComma + 1);
      const tail = lastComma === -1 ? '' : value.slice(lastComma + 1);
      return maskAlnum(head) + tail.replace(/\b(\d{3})\d{3}\b/, '$1XXX');
    }
    case 'CUSTOM':
      return `${value.charAt(0)}***`;
    default:
      return maskAlnum(value);
  }
}

export function fullMask(type: EntityType, typeLabels: boolean): string {
  return typeLabels ? `[REDACTED:${ENTITY_INFO[type].short}]` : '[REDACTED]';
}

/** Placeholder token, e.g. USER_01. Numbering grows past 99 automatically (USER_100). */
export function pseudonymToken(prefix: string, n: number): string {
  return `${prefix}_${String(n).padStart(2, '0')}`;
}

export function redact(text: string, entities: readonly Entity[], options: RedactOptions): Redaction {
  const tokens = new Map<string, PseudonymEntry>();
  const counters = new Map<string, number>();
  const replacements: (string | null)[] = [];
  const outputSpans: [number, number][] = [];
  const parts: string[] = [];
  let cursor = 0;
  let outLength = 0;

  for (const e of entities) {
    const before = text.slice(cursor, e.start);
    parts.push(before);
    outLength += before.length;

    let replacement: string | null;
    if (e.kept) {
      replacement = null;
    } else if (options.mode === 'full') {
      replacement = fullMask(e.type, options.typeLabels);
    } else if (options.mode === 'partial') {
      replacement = partialMask(e.type, e.value);
    } else {
      let entry = tokens.get(e.key);
      if (!entry) {
        const prefix = ENTITY_INFO[e.type].prefix;
        const n = (counters.get(prefix) ?? 0) + 1;
        counters.set(prefix, n);
        entry = { token: pseudonymToken(prefix, n), type: e.type, original: e.value, occurrences: 0 };
        tokens.set(e.key, entry);
      }
      entry.occurrences++;
      replacement = entry.token;
    }

    const written = replacement ?? e.value;
    parts.push(written);
    replacements[e.id] = replacement;
    outputSpans[e.id] = [outLength, outLength + written.length];
    outLength += written.length;
    cursor = e.end;
  }
  parts.push(text.slice(cursor));

  return { output: parts.join(''), replacements, outputSpans, mapping: [...tokens.values()] };
}

/**
 * Reverse consistent pseudonymization: put the original values back into a
 * text that contains tokens (e.g. an LLM's answer about a sanitized log).
 */
export function reidentify(text: string, mapping: readonly PseudonymEntry[]): { text: string; restored: number } {
  if (mapping.length === 0) return { text, restored: 0 };
  const byToken = new Map(mapping.map((m) => [m.token, m.original]));
  const alternatives = [...byToken.keys()].sort((a, b) => b.length - a.length).join('|');
  let restored = 0;
  const out = text.replace(new RegExp(`\\b(?:${alternatives})\\b`, 'g'), (token) => {
    restored++;
    return byToken.get(token) ?? token;
  });
  return { text: out, restored };
}
