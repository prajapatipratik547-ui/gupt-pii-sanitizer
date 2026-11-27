import type { EntityType } from './entities';

/** One CSV cell with its exact character offsets in the source (quotes excluded). */
export interface CsvCell {
  row: number;
  col: number;
  start: number;
  end: number;
  value: string;
}

/**
 * Minimal RFC 4180 parser that keeps offsets, so a cell can be redacted in
 * place without re-serialising (and possibly reformatting) the whole file.
 * Quoted cells containing doubled quotes are returned without offsets being
 * shifted — the value is the raw text between the outer quotes.
 */
export function parseCsv(text: string, delimiter = ','): CsvCell[] {
  const cells: CsvCell[] = [];
  let row = 0;
  let col = 0;
  let i = 0;
  const n = text.length;
  while (i <= n) {
    if (text.charAt(i) === '"') {
      const start = i + 1;
      let j = start;
      while (j < n) {
        if (text.charAt(j) === '"') {
          if (text.charAt(j + 1) === '"') {
            j += 2;
            continue;
          }
          break;
        }
        j++;
      }
      cells.push({ row, col, start, end: j, value: text.slice(start, j) });
      i = j + 1;
      // Skip anything between the closing quote and the next delimiter.
      while (i < n && text.charAt(i) !== delimiter && text.charAt(i) !== '\n' && text.charAt(i) !== '\r') i++;
    } else {
      let j = i;
      while (j < n && text.charAt(j) !== delimiter && text.charAt(j) !== '\n' && text.charAt(j) !== '\r') j++;
      cells.push({ row, col, start: i, end: j, value: text.slice(i, j) });
      i = j;
    }
    if (i >= n) break;
    const ch = text.charAt(i);
    if (ch === delimiter) {
      col++;
      i++; // if this was the last character, the loop runs once more and records the empty final cell
    } else {
      if (ch === '\r' && text.charAt(i + 1) === '\n') i++;
      i++;
      row++;
      col = 0;
    }
  }
  return cells;
}

/** Guess whether pasted text is a CSV/TSV table and which delimiter it uses. */
export function sniffDelimiter(text: string): ',' | '\t' | ';' | null {
  const lines = text.split(/\r?\n/, 12).filter((l) => l.trim() !== '');
  if (lines.length < 2) return null;
  for (const d of [',', '\t', ';'] as const) {
    const counts = lines.map((l) => l.split(d).length - 1);
    const first = counts[0] ?? 0;
    if (first < 1) continue;
    const consistent = counts.filter((c) => c === first).length / counts.length;
    if (consistent >= 0.8) return d;
  }
  return null;
}

/** Column headers that mean "every value in this column is PII". */
const HEADER_RULES: readonly { type: EntityType; pattern: RegExp }[] = [
  {
    type: 'PERSON',
    pattern:
      /^(?:(?:full|first|last|middle|given|family|sur|customer|patient|employee|contact|candidate|account[\s_-]?holder|card[\s_-]?holder|father|mother|guardian|spouse)[\s_-]?name|name|surname|fname|lname)$/i,
  },
  { type: 'DOB', pattern: /^(?:dob|d\.o\.b\.?|date[\s_-]?of[\s_-]?birth|birth[\s_-]?date|birthday)$/i },
  {
    type: 'ADDRESS',
    pattern: /^(?:(?:home|residential|permanent|current|postal|mailing|billing|shipping|street)[\s_-]?address|address(?:[\s_-]?line[\s_-]?\d)?|street)$/i,
  },
];

export function headerType(header: string): EntityType | null {
  const h = header.trim().replace(/^"|"$/g, '');
  return HEADER_RULES.find((r) => r.pattern.test(h))?.type ?? null;
}
