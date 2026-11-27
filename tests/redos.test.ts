import { describe, expect, it } from 'vitest';
import { DETECTORS } from '../src/core/detectors';

/**
 * ReDoS guard. Each input is built to trigger the classic failure modes —
 * long ambiguous runs, repeated separators, near-misses that force backtracking.
 * Linear patterns finish 100 KB of any of these in a few milliseconds; a
 * quadratic or exponential one takes seconds, so a generous budget still
 * catches a regression reliably.
 */
const SIZE = 100_000;
const fill = (unit: string): string => unit.repeat(Math.ceil(SIZE / unit.length));

const ATTACKS: Record<string, string> = {
  'long digit run after +': fill(`+1${'1'.repeat(60)}x `),
  'spaced digits after +': fill(`+1 ${'12 '.repeat(40)}x `),
  'bracketed digits after +': fill(`+1${'(1)'.repeat(40)}x `),
  'digits': fill('1'),
  'spaced digits': fill('1 '),
  'hyphenated digits': fill('1-'),
  'repeated @': fill('a@'),
  'email-like near misses': fill('a@a.'),
  'dotted letters': fill('a.'),
  'dotted digits': fill('1.'),
  'colons': fill('a:'),
  'hex colons': fill('1:'),
  'title + many capitalised words': `Dr. ${fill('Aa ')}`,
  'label + many capitalised words': `Name: ${fill('Aa ')}`,
  'sign-off + many words': `Regards,\n${fill('Aa ')}`,
  'unterminated address labels': fill(`Address: ${'x'.repeat(150)} `),
  'identifier chain before keyword': `${fill('a_')}password=hunter22`,
  'identifier chain, no keyword': fill('a_'),
  'url-encoded @': fill('a%40'),
  'profile-ish paths': fill('github.com/'),
  'birth-date label + digits': `DOB ${fill('1 ')}`,
  'account label + digits': `account ${fill('1')}`,
};

describe('regex performance (ReDoS guard)', () => {
  it.each(DETECTORS.map((d) => [d.id, d] as const))('%s stays linear on adversarial input', (_id, det) => {
    for (const [name, text] of Object.entries(ATTACKS)) {
      const t0 = performance.now();
      det.pattern.lastIndex = 0;
      while (det.pattern.exec(text) !== null) {
        /* drain all matches */
      }
      const ms = performance.now() - t0;
      expect(ms, `${det.id} on "${name}"`).toBeLessThan(250);
    }
  });
});
