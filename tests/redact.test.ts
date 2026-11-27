import { describe, expect, it } from 'vitest';
import { normalizeValue, entityKey } from '../src/core/normalize';
import { fullMask, maskDigitsKeepLast, partialMask, pseudonymToken, reidentify } from '../src/core/redact';
import { run } from './helpers';

describe('full mask', () => {
  it('replaces every value with [REDACTED]', () => {
    const r = run('mail priya@example.com, call 9876543210');
    expect(r.output).toBe('mail [REDACTED], call [REDACTED]');
  });

  it('can label the entity type', () => {
    expect(run('mail priya@example.com', { typeLabels: true }).output).toBe('mail [REDACTED:EMAIL]');
    expect(fullMask('CREDIT_CARD', true)).toBe('[REDACTED:CARD]');
    expect(fullMask('CREDIT_CARD', false)).toBe('[REDACTED]');
  });
});

describe('partial mask', () => {
  it.each([
    ['CREDIT_CARD', '4012-8888-8888-1881', 'XXXX-XXXX-XXXX-1881'],
    ['CREDIT_CARD', '4012888888881881', 'XXXXXXXXXXXX1881'],
    ['AADHAAR', '2345 6789 0124', 'XXXX XXXX 0124'],
    ['PHONE', '+91 98765 43210', '+91 XXXXX X3210'],
    ['PHONE', '9876543210', 'XXXXXX3210'],
    ['PHONE', '+44 20 7946 0958', '+44 XX XXXX 0958'],
    ['EMAIL', 'priya.sharma@example.com', 'p****@example.com'],
    ['EMAIL', 'neha%40example.com', 'n****%40example.com'],
    ['UPI', 'rahulv@okaxis', 'r****@okaxis'],
    ['PROFILE_URL', 'linkedin.com/in/aarav-k-example', 'linkedin.com/in/a***'],
    ['PROFILE_URL', 'https://medium.com/@aarav', 'https://medium.com/@a***'],
    ['PAN', 'ABCPV1234K', 'XXXXXX234K'],
    ['GSTIN', '27AAPFU0939F1ZV', '27XXXXXXXXXX1ZV'],
    ['PASSPORT', 'K1234567', 'KXXXXX67'],
    ['IPV4', '203.0.113.42', '203.0.x.x'],
    ['IPV6', '2001:db8::1', '2001:0db8:x:x:x:x:x:x'],
    ['MAC', '3C:52:82:A1:7F:09', '3C:52:82:XX:XX:XX'],
    ['SECRET', 'AKIAIOSFODNN7EXAMPLE', 'AKIA************'],
    ['SECRET', 'short', '********'],
    ['PERSON', 'Anjali Mehta', 'A*** M***'],
    ['DOB', '14/08/1987', 'XX/XX/1987'],
    ['DOB', '1961-11-23', '1961-XX-XX'],
    ['DOB', '2nd March 1994', 'XXX XXXXX 1994'],
    ['ADDRESS', 'Flat 302, Baner Road, Pune 411045', 'XXXX XXX, XXXXX XXXX, Pune 411XXX'],
    ['BANK_ACCOUNT', '50100234567891', 'XXXXXXXXXX7891'],
    ['CUSTOM', 'Falcon', 'F***'],
  ] as const)('%s %s -> %s', (type, value, expected) => {
    expect(partialMask(type, value)).toBe(expected);
  });

  it('masks digits while preserving separators', () => {
    expect(maskDigitsKeepLast('12-34-56', 2)).toBe('XX-XX-56');
  });

  it('keeps unrecognised IPv6 input fully masked', () => {
    expect(partialMask('IPV6', 'not-an-ip')).toBe('x:x:x:x:x:x:x:x');
    expect(partialMask('DOB', 'March 5th')).toBe('XXXXX XXX');
  });
});

describe('consistent pseudonymization', () => {
  it('gives the same value the same token, however it is written', () => {
    const text = [
      'priya@example.com paid with 4012 8888 8888 1881 from +91 98765 43210',
      'PRIYA@EXAMPLE.COM paid with 4012-8888-8888-1881 from 09876543210',
      'rahul@example.in called 98765 43210',
    ].join('\n');
    const r = run(text, { mode: 'pseudonym' });
    expect(r.output).toBe(
      ['USER_01 paid with CARD_01 from PHONE_01', 'USER_01 paid with CARD_01 from PHONE_01', 'USER_02 called PHONE_01'].join('\n'),
    );
    expect(r.mapping.find((m) => m.token === 'USER_01')).toMatchObject({ original: 'priya@example.com', occurrences: 2 });
    expect(r.uniqueValues).toBe(4);
  });

  it('treats a URL-encoded email as the same person', () => {
    expect(run('neha@example.com then ?email=neha%40example.com', { mode: 'pseudonym' }).output).toBe('USER_01 then ?email=USER_01');
  });

  it('treats different spellings of a profile link as one profile', () => {
    expect(run('https://www.linkedin.com/in/Aarav and linkedin.com/in/aarav', { mode: 'pseudonym' }).output).toBe('PROFILE_01 and PROFILE_01');
  });

  it('numbers IPv4 and IPv6 in one IP namespace', () => {
    expect(run('10.0.0.1 and 2001:db8::1', { mode: 'pseudonym' }).output).toBe('IP_01 and IP_02');
  });

  it('pads tokens to two digits and keeps growing past 99', () => {
    expect(pseudonymToken('USER', 1)).toBe('USER_01');
    expect(pseudonymToken('USER', 100)).toBe('USER_100');
  });

  it('round-trips through re-identification', () => {
    const text = 'Patient: Anjali Mehta, phone 9876543210, email anjali@example.com';
    const r = run(text, { mode: 'pseudonym' });
    const reply = 'Please call PERSON_01 at PHONE_01 or USER_01. PHONE_010 is not a token.';
    const back = reidentify(reply, r.mapping);
    expect(back.text).toBe('Please call Anjali Mehta at 9876543210 or anjali@example.com. PHONE_010 is not a token.');
    expect(back.restored).toBe(3);
    expect(reidentify('nothing', [])).toEqual({ text: 'nothing', restored: 0 });
  });
});

describe('kept values', () => {
  it('leaves every occurrence of a kept value untouched', () => {
    const text = 'a@example.com, b@example.com, A@example.com';
    const r = run(text, {}, [entityKey('EMAIL', 'a@example.com')]);
    expect(r.output).toBe('a@example.com, [REDACTED], A@example.com');
    expect(r.keptCount).toBe(2);
    expect(r.total).toBe(1);
    expect(r.replacements).toEqual([null, '[REDACTED]', null]);
  });
});

describe('output spans', () => {
  it('point at each replacement inside the output', () => {
    const r = run('x priya@example.com y 9876543210 z', { mode: 'pseudonym' });
    for (const e of r.entities) {
      const [s, end] = r.outputSpans[e.id] ?? [0, 0];
      expect(r.output.slice(s, end)).toBe(r.replacements[e.id]);
    }
  });
});

describe('normalization', () => {
  it('collapses spellings of the same identifier', () => {
    expect(normalizeValue('PHONE', '+91 98765 43210')).toBe(normalizeValue('PHONE', '09876543210'));
    expect(normalizeValue('PHONE', '+44 20 7946 0958')).toBe('442079460958');
    expect(normalizeValue('IPV6', '2001:db8::1')).toBe(normalizeValue('IPV6', '2001:0DB8:0:0:0:0:0:1'));
    expect(normalizeValue('IPV6', 'zzz')).toBe('zzz');
    expect(normalizeValue('MAC', '00-1A-2B-3C-4D-5E')).toBe(normalizeValue('MAC', '00:1a:2b:3c:4d:5e'));
    expect(normalizeValue('DOB', '14/08/1987')).toBe(normalizeValue('DOB', '14-08-1987'));
    expect(normalizeValue('DOB', '2nd  March 1994')).toBe('2nd march 1994');
    expect(normalizeValue('PERSON', 'Anjali  Mehta.')).toBe('anjali mehta');
    expect(normalizeValue('PAN', 'abcpv1234k')).toBe('ABCPV1234K');
    expect(normalizeValue('SECRET', ' abc ')).toBe('abc');
  });
});
