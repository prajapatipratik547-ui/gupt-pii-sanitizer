import { describe, expect, it } from 'vitest';
import { headerType, parseCsv, sniffDelimiter } from '../src/core/csv';
import { ENTITY_TYPES, CORE_TYPES, ENTITY_INFO, isEntityType } from '../src/core/entities';
import { APP_NAME, buildAuditReport, buildKeyFile, mimeFor, sanitizedFileName } from '../src/core/report';
import { SAMPLES, getSample } from '../src/core/samples';
import { run } from './helpers';

describe('CSV handling', () => {
  it('parses quoted cells with exact offsets', () => {
    const text = 'name,note\r\n"Verma, Rahul","said ""hi"""\nPriya,\n';
    const cells = parseCsv(text);
    const quoted = cells.find((c) => c.row === 1 && c.col === 0);
    expect(quoted?.value).toBe('Verma, Rahul');
    expect(text.slice(quoted?.start, quoted?.end)).toBe('Verma, Rahul');
    expect(cells.find((c) => c.row === 1 && c.col === 1)?.value).toBe('said ""hi""');
    expect(cells.filter((c) => c.row === 2).map((c) => c.value)).toEqual(['Priya', '']);
  });

  it('handles a trailing delimiter at end of input', () => {
    expect(parseCsv('a,').map((c) => c.value)).toEqual(['a', '']);
  });

  it('sniffs comma, tab and semicolon tables but not prose', () => {
    expect(sniffDelimiter('a,b,c\n1,2,3\n4,5,6')).toBe(',');
    expect(sniffDelimiter('a\tb\n1\t2')).toBe('\t');
    expect(sniffDelimiter('a;b\n1;2')).toBe(';');
    expect(sniffDelimiter('Hello there, friend.\nThis is prose.')).toBeNull();
    expect(sniffDelimiter('single line, only')).toBeNull();
  });

  it('maps PII column headers to entity types', () => {
    expect(headerType('full_name')).toBe('PERSON');
    expect(headerType('"Customer Name"')).toBe('PERSON');
    expect(headerType('DOB')).toBe('DOB');
    expect(headerType('shipping_address')).toBe('ADDRESS');
    expect(headerType('city')).toBeNull();
  });

  it('redacts whole name columns and keeps CSV structure intact', () => {
    const csv = 'id,full_name,city\n1,Priya Sharma,Pune\n2,"Verma, Rahul",Delhi\n3,Test User,Goa\n';
    const r = run(csv, { mode: 'pseudonym', format: 'csv' });
    expect(r.output).toBe('id,full_name,city\n1,PERSON_01,Pune\n2,"PERSON_02",Delhi\n3,Test User,Goa\n');
    expect(r.csv?.columns.map((c) => c.type)).toEqual([null, 'PERSON', null]);
  });

  it('auto-detects pasted CSV', () => {
    expect(run('name,email\nPriya Sharma,p@example.com\n').csv?.delimiter).toBe(',');
  });

  it('can be told the input is plain text', () => {
    expect(run('name,email\nPriya Sharma,p@example.com\n', { format: 'text' }).csv).toBeNull();
  });
});

describe('samples', () => {
  it.each(SAMPLES.map((s) => [s.id, s] as const))('%s analyses without errors and preserves untouched text', (_id, sample) => {
    const r = run(sample.text, { format: sample.fileName.endsWith('.csv') ? 'csv' : 'auto' });
    // Removing every replacement from the output must leave exactly the non-PII text.
    let rebuilt = '';
    let cursor = 0;
    for (const e of r.entities) {
      rebuilt += sample.text.slice(cursor, e.start);
      cursor = e.end;
    }
    rebuilt += sample.text.slice(cursor);
    let outRebuilt = '';
    let outCursor = 0;
    for (const e of r.entities) {
      const [s, end] = r.outputSpans[e.id] ?? [0, 0];
      outRebuilt += r.output.slice(outCursor, s);
      outCursor = end;
    }
    outRebuilt += r.output.slice(outCursor);
    expect(outRebuilt).toBe(rebuilt);
  });

  it('the noisy sample covers every core type and blocks its decoys', () => {
    const r = run(getSample('mixed').text);
    for (const type of CORE_TYPES) expect(r.counts[type], type).toBeGreaterThan(0);
    expect(r.rejected.map((x) => x.value)).toEqual(
      expect.arrayContaining(['1234567890123456', '9876543210987654', '4111 1111 1111 1112', '2345 6789 0125', '999.12.0.1']),
    );
  });

  it('the torture test redacts only the one real email', () => {
    const r = run(getSample('decoys').text);
    expect(r.entities.map((e) => e.value)).toEqual(['security@example.com']);
    expect(r.rejected.length).toBeGreaterThanOrEqual(10);
  });

  it('the CSV sample maps duplicate customers to the same pseudonyms', () => {
    const r = run(getSample('csv').text, { mode: 'pseudonym', format: 'csv' });
    const lines = r.output.split('\n');
    const row1 = lines[1]?.split(',') ?? [];
    const row4 = lines[4]?.split(',') ?? [];
    // name, email, phone, PAN, Aadhaar, card, IP — all identical tokens despite different spellings.
    expect(row4.slice(1, 7)).toEqual(row1.slice(1, 7));
    expect(row1[1]).toBe('PERSON_01');
  });

  it('falls back to the first sample for unknown ids', () => {
    expect(getSample('nope').id).toBe(SAMPLES[0]?.id);
  });
});

describe('audit report', () => {
  const text = getSample('mixed').text;
  const result = run(text);
  const report = buildAuditReport(result, {
    fileName: 'incident.txt',
    mode: 'full',
    strict: true,
    generatedAt: new Date('2026-11-27T10:00:00Z'),
  });
  const json = JSON.stringify(report);

  it('summarises counts, rejections and settings', () => {
    expect(report).toMatchObject({
      tool: expect.stringContaining(APP_NAME),
      generatedAt: '2026-11-27T10:00:00.000Z',
      input: { fileName: 'incident.txt', characters: text.length },
      settings: { mode: 'Full mask', strictValidation: true },
      summary: { redacted: result.total, rejectedByValidation: result.rejected.length },
    });
  });

  it('never contains an original sensitive value', () => {
    for (const e of result.entities) expect(json.includes(e.value), `${e.type} ${e.value}`).toBe(false);
    for (const r of result.rejected) expect(json.includes(r.value)).toBe(false);
  });

  it('builds a key file that does contain the originals, with a warning', () => {
    const pseudo = run(text, { mode: 'pseudonym' });
    const key = buildKeyFile(pseudo.mapping, new Date());
    expect(key.warning).toMatch(/re-identifies/);
    expect(JSON.stringify(key)).toContain('priya.sharma@example.com');
  });
});

describe('file naming', () => {
  it('derives sanitized names and MIME types', () => {
    expect(sanitizedFileName('customers.csv')).toBe('customers.sanitized.csv');
    expect(sanitizedFileName('C:\\logs\\app.log')).toBe('app.sanitized.log');
    expect(sanitizedFileName('README')).toBe('README.sanitized.txt');
    expect(sanitizedFileName('.env')).toBe('.env.sanitized.txt');
    expect(sanitizedFileName(null)).toBe('sanitized.txt');
    expect(mimeFor('a.csv')).toContain('text/csv');
    expect(mimeFor('a.tsv')).toContain('tab-separated');
    expect(mimeFor('a.txt')).toContain('text/plain');
  });
});

describe('entity registry', () => {
  it('gives every type a label, prefix and unique priority', () => {
    const priorities = ENTITY_TYPES.map((t) => ENTITY_INFO[t].priority);
    expect(new Set(priorities).size).toBe(priorities.length);
    for (const t of ENTITY_TYPES) expect(ENTITY_INFO[t].prefix).toMatch(/^[A-Z]+$/);
    expect(isEntityType('EMAIL')).toBe(true);
    expect(isEntityType('NOPE')).toBe(false);
    expect(isEntityType(42)).toBe(false);
  });
});

describe('performance', () => {
  it('processes ~1 MB of noisy logs well within budget', () => {
    const big = getSample('mixed').text.repeat(Math.ceil(1_000_000 / getSample('mixed').text.length));
    const t0 = performance.now();
    const r = run(big, { mode: 'pseudonym' });
    const ms = performance.now() - t0;
    expect(r.total).toBeGreaterThan(10_000);
    expect(ms).toBeLessThan(4000);
  });

  it('stays linear on a pathological single 2 MB token', () => {
    const t0 = performance.now();
    run('a'.repeat(2_000_000));
    run('1'.repeat(2_000_000));
    run('a.'.repeat(1_000_000));
    expect(performance.now() - t0).toBeLessThan(4000);
  });

  it('reuses detection when only the redaction mode changes', () => {
    const text = 'Mail priya.sharma@example.com or call +91 98765 43210.';
    const full = run(text, { mode: 'full' });
    expect(full.detectionCached).toBe(false);
    const pseudo = run(text, { mode: 'pseudonym' });
    expect(pseudo.detectionCached).toBe(true);
    expect(pseudo.entities).toBe(full.entities); // same objects: detection did not run again
    expect(pseudo.output).toContain('USER_01');
    expect(run(text, { mode: 'partial', typeLabels: true }).detectionCached).toBe(true);
    // Anything that changes what is detected invalidates the memo.
    expect(run(text, { mode: 'partial', strict: false }).detectionCached).toBe(false);
    expect(run(text, { mode: 'partial', strict: false }, [full.entities[0]!.key]).detectionCached).toBe(false);
    expect(run(`${text} `, { mode: 'partial', strict: false }).detectionCached).toBe(false);
  });

  it('reports processing time and line counts', () => {
    const r = run('one\ntwo\n');
    expect(r.lines).toBe(3);
    expect(r.ms).toBeGreaterThanOrEqual(0);
    expect(run('').lines).toBe(0);
  });
});
