import { describe, expect, it } from 'vitest';
import { FAKE_SECRETS } from '../src/core/samples';
import { find, valuesOf } from './helpers';

describe('emails', () => {
  it('finds addresses with plus-tags, subdomains and multi-part TLDs', () => {
    const text = 'Mail a.b+tag@mail.example.co.in or ADMIN@Example.COM, not user@localhost.';
    expect(valuesOf(text, 'EMAIL')).toEqual(['a.b+tag@mail.example.co.in', 'ADMIN@Example.COM']);
  });

  it('keeps the trailing full stop out of the match', () => {
    expect(valuesOf('Write to priya@example.com.', 'EMAIL')).toEqual(['priya@example.com']);
  });

  it('catches URL-encoded addresses in query strings and access logs', () => {
    const r = find('GET /profile?email=neha.kapoor%40example.com&x=1 HTTP/1.1');
    expect(r.entities.map((e) => [e.type, e.value, e.meta])).toEqual([['EMAIL', 'neha.kapoor%40example.com', 'URL-encoded (%40)']]);
  });
});

describe('profile URLs', () => {
  it('detects personal profile links on common networks', () => {
    const text = [
      'linkedin.com/in/aarav-k-example',
      'https://www.github.com/aarav-k',
      'https://x.com/aarav_k.',
      'instagram.com/aarav.k',
      'https://medium.com/@aarav',
      't.me/aaravk',
    ].join(' | ');
    expect(valuesOf(text, 'PROFILE_URL')).toEqual([
      'linkedin.com/in/aarav-k-example',
      'https://www.github.com/aarav-k',
      'https://x.com/aarav_k',
      'instagram.com/aarav.k',
      'https://medium.com/@aarav',
      't.me/aaravk',
    ]);
  });

  it('names the network and ignores site pages and look-alike domains', () => {
    expect(find('see linkedin.com/in/aarav').entities[0]?.meta).toBe('LinkedIn');
    expect(valuesOf('github.com/features and x.com/home and dropbox.com/aarav and mybox.com/aarav', 'PROFILE_URL')).toEqual([]);
  });
});

describe('phones', () => {
  it.each([
    ['+91 98765 43210', '+91 98765 43210'],
    ['+91-98765-43210', '+91-98765-43210'],
    ['9876543210', '9876543210'],
    ['098765 43210', '098765 43210'],
    ['0091 9876543210', '0091 9876543210'],
    ['022 2345 6789', '022 2345 6789'],
    ['(022) 2345 6789', '(022) 2345 6789'],
    ['+44 20 7946 0958', '+44 20 7946 0958'],
    ['+1 (415) 555-0132', '+1 (415) 555-0132'],
    ['(415) 555-0132', '(415) 555-0132'],
  ])('detects %s', (text, expected) => {
    expect(valuesOf(`Call ${text} today`, 'PHONE')).toEqual([expected]);
  });

  it.each(['1234567890', '5876543210', 'ts=1730535253', '2026-11-02', '98765432101234', '9999999999'])(
    'ignores %s',
    (text) => {
      expect(valuesOf(`value ${text} end`, 'PHONE')).toEqual([]);
    },
  );

  it('does not cut a phone number out of an Aadhaar-shaped digit group', () => {
    expect(valuesOf('id 9876 5432 1098 x', 'PHONE')).toEqual([]);
  });
});

describe('IP addresses', () => {
  it('detects IPv4 and reports out-of-range look-alikes as rejected', () => {
    const r = find('from 203.0.113.42 and 999.1.1.1');
    expect(r.entities.map((e) => e.value)).toEqual(['203.0.113.42']);
    expect(r.rejected.map((x) => x.value)).toEqual(['999.1.1.1']);
  });

  it('skips version numbers', () => {
    for (const text of ['version 10.2.3.4', 'build 2.4.1.9', 'kernel 6.8.0.45', 'v1.2.3.4', 'v 1.2.3.4', '1.2.3.4.5']) {
      expect(valuesOf(text, 'IPV4')).toEqual([]);
    }
  });

  it('detects IPv6 forms but not clock times or MAC addresses', () => {
    const text = 'peer 2001:db8:85a3::8a2e:370:7334, fe80::1, ::1 and ::ffff:192.168.1.1 at 10:22:33 mac 00:1A:2B:3C:4D:5E';
    expect(valuesOf(text, 'IPV6')).toEqual(['2001:db8:85a3::8a2e:370:7334', 'fe80::1', '::1', '::ffff:192.168.1.1']);
    expect(valuesOf(text, 'MAC')).toEqual(['00:1A:2B:3C:4D:5E']);
  });

  it('handles bracketed IPv6 with ports and trailing punctuation', () => {
    expect(valuesOf('connect [2001:db8::1]:8080.', 'IPV6')).toEqual(['2001:db8::1']);
    expect(valuesOf('peer fe80::1.', 'IPV6')).toEqual(['fe80::1']);
  });
});

describe('PAN', () => {
  it('detects upper and lower case PANs but not mixed case words', () => {
    expect(valuesOf('PAN ABCPV1234K / abcpv1234k / AbcPv1234K', 'PAN')).toEqual(['ABCPV1234K', 'abcpv1234k']);
  });

  it('reports invalid holder types as rejected', () => {
    expect(find('PAN ABCXE1234F').rejected[0]).toMatchObject({ type: 'PAN', reason: expect.stringContaining('holder type') });
  });
});

describe('Aadhaar', () => {
  it('detects spaced, hyphenated and compact numbers with a valid Verhoeff digit', () => {
    expect(valuesOf('2345 6789 0124 | 2345-6789-0124 | 234567890124', 'AADHAAR')).toEqual([
      '2345 6789 0124',
      '2345-6789-0124',
      '234567890124',
    ]);
  });

  it('requires consistent separators', () => {
    expect(valuesOf('2345 6789-0124', 'AADHAAR')).toEqual([]);
  });

  it('rejects Verhoeff failures in strict mode and flags them at low confidence otherwise', () => {
    expect(find('Aadhaar 2345 6789 0125').rejected[0]?.reason).toBe('Verhoeff checksum failed');
    const loose = find('Aadhaar 2345 6789 0125', { strict: false }).entities[0];
    expect(loose?.type).toBe('AADHAAR');
    expect(loose?.confidence).toBeLessThan(0.7);
    expect(loose?.note).toContain('strict validation is off');
  });

  it('raises confidence when the word Aadhaar is nearby', () => {
    const withCtx = find('Aadhaar no: 2345 6789 0124').entities[0];
    const without = find('ref 2345 6789 0124').entities[0];
    expect(withCtx?.confidence).toBeGreaterThan(without?.confidence ?? 1);
  });
});

describe('credit cards', () => {
  it('detects Luhn-valid cards with any grouping and names the network', () => {
    const r = find('cards 4012 8888 8888 1881, 5123-4567-8901-2346, 378282246310005 and 6073849999999997');
    expect(r.entities.map((e) => [e.value, e.meta])).toEqual([
      ['4012 8888 8888 1881', 'Visa'],
      ['5123-4567-8901-2346', 'Mastercard'],
      ['378282246310005', 'American Express'],
      ['6073849999999997', 'RuPay'],
    ]);
  });

  it('rejects random 16-digit strings (the brief’s false-positive case)', () => {
    const r = find('order 1234567890123456 txn 9876543210987654 ref 4111 1111 1111 1112');
    expect(r.entities).toEqual([]);
    expect(r.rejected.map((x) => x.reason)).toEqual(['Luhn checksum failed', 'Luhn checksum failed', 'Luhn checksum failed']);
  });

  it('never matches part of a longer digit run', () => {
    expect(find('id 40128888888818810000').entities).toEqual([]);
  });

  it('beats overlapping Aadhaar/phone candidates', () => {
    expect(find('card 4012 8888 8888 1881').entities.map((e) => e.type)).toEqual(['CREDIT_CARD']);
  });
});

describe('extended types', () => {
  it('detects UPI IDs only with a known handle or UPI context', () => {
    expect(valuesOf('pay rahul@okaxis', 'UPI')).toEqual(['rahul@okaxis']);
    expect(valuesOf('UPI: shop.42@mybank', 'UPI')).toEqual(['shop.42@mybank']);
    expect(valuesOf('ssh root@server01', 'UPI')).toEqual([]);
  });

  it('detects GSTINs with a valid check character', () => {
    expect(valuesOf('GSTIN 27AAPFU0939F1ZV', 'GSTIN')).toEqual(['27AAPFU0939F1ZV']);
    expect(find('GSTIN 27AAPFU0939F1ZA').rejected[0]?.reason).toContain('check character');
  });

  it('does not report the PAN embedded inside a GSTIN', () => {
    expect(find('GSTIN 27AAPFU0939F1ZV').entities.map((e) => e.type)).toEqual(['GSTIN']);
  });

  it('detects passports only near the word passport', () => {
    expect(valuesOf('Passport No. K1234567', 'PASSPORT')).toEqual(['K1234567']);
    expect(valuesOf('Code K1234567', 'PASSPORT')).toEqual([]);
  });

  it('detects bank accounts after an account label, keeping the label visible', () => {
    expect(valuesOf('A/c No: 50100234567891', 'BANK_ACCOUNT')).toEqual(['50100234567891']);
    expect(valuesOf('account number 123456789', 'BANK_ACCOUNT')).toEqual(['123456789']);
  });

  it('detects secrets from common providers and key=value assignments', () => {
    const text = [
      'AKIAIOSFODNN7EXAMPLE',
      FAKE_SECRETS.github,
      FAKE_SECRETS.stripe,
      FAKE_SECRETS.google,
      'Authorization: Bearer abcdefghijklmnop1234',
      'db_password="S3cr3t!Pass#2026"',
      'API_KEY: k-12345678',
    ].join('\n');
    expect(valuesOf(text, 'SECRET')).toEqual([
      'AKIAIOSFODNN7EXAMPLE',
      FAKE_SECRETS.github,
      FAKE_SECRETS.stripe,
      FAKE_SECRETS.google,
      'abcdefghijklmnop1234',
      'S3cr3t!Pass#2026',
      'k-12345678',
    ]);
  });

  it('ignores placeholder secrets', () => {
    expect(valuesOf('password=**** api_key=null token=${TOKEN} secret=changeme', 'SECRET')).toEqual([]);
  });

  it('detects JWTs', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
    expect(valuesOf(`token ${jwt}`, 'SECRET')).toEqual([jwt]);
  });

  it('detects Cisco-style MAC addresses', () => {
    expect(valuesOf('port 001a.2b3c.4d5e up', 'MAC')).toEqual(['001a.2b3c.4d5e']);
  });

  it('detects dates of birth in several formats', () => {
    expect(valuesOf('DOB: 14/08/1987; Date of Birth 1961-11-23; born on 2nd March 1994; birthday Mar 5, 1990', 'DOB')).toEqual([
      '14/08/1987',
      '1961-11-23',
      '2nd March 1994',
      'Mar 5, 1990',
    ]);
  });

  it('detects addresses after a label but not IP/email "addresses"', () => {
    expect(valuesOf('Address: Flat 302, Shanti Apartments, Pune 411045\nnext', 'ADDRESS')).toEqual([
      'Flat 302, Shanti Apartments, Pune 411045',
    ]);
    expect(valuesOf('IP address: 10.0.0.1 and Email address: a@b.co', 'ADDRESS')).toEqual([]);
    expect(valuesOf('Address: 12 MG Road, Pune. Phone: 9876543210', 'ADDRESS')).toEqual(['12 MG Road, Pune']);
  });
});

describe('person names', () => {
  it('detects names after titles, labels, greetings and sign-offs', () => {
    const text = 'Patient: Anjali Mehta\nSeen by Dr. Kavita Rao.\nDear Rohan,\nThanks,\nNeha Gupta\n';
    expect(valuesOf(text, 'PERSON')).toEqual(['Anjali Mehta', 'Kavita Rao', 'Rohan', 'Neha Gupta']);
  });

  it('skips greetings to teams and placeholders', () => {
    expect(valuesOf('Hi Team,\nDear Sir,\nName: Unknown', 'PERSON')).toEqual([]);
  });

  it('keeps a title out of a labelled name', () => {
    expect(valuesOf('Name: Mr. Rahul Verma', 'PERSON')).toEqual(['Rahul Verma']);
  });

  it('propagates a detected name to later mentions and ties surnames to the same person', () => {
    const r = find('Patient: Anjali Mehta. Later Mehta was discharged; Anjali Mehta signed.');
    const people = r.entities.filter((e) => e.type === 'PERSON');
    expect(people.map((e) => e.value)).toEqual(['Anjali Mehta', 'Mehta', 'Anjali Mehta']);
    expect(new Set(people.map((e) => e.key)).size).toBe(1);
  });

  it('does not guess when a surname is shared by two people', () => {
    const r = find('Patient: Meera Nair. Guardian: Suresh Nair. Nair agreed.');
    const lone = r.entities.find((e) => e.value === 'Nair');
    expect(lone).toBeUndefined();
  });

  it('treats a resume header line followed by contact details as a name', () => {
    expect(valuesOf('Aarav Kulkarni\naarav@example.com | +91 99887 76655\n', 'PERSON')).toEqual(['Aarav Kulkarni']);
    expect(valuesOf('Quarterly Report\nRevenue grew 4%\n', 'PERSON')).toEqual([]);
  });
});

describe('custom terms and options', () => {
  it('redacts custom terms case-insensitively as whole words', () => {
    const r = find('Project Falcon ships. project falcon! falconry is fine.', { customTerms: ['Project Falcon', ' ', 'x'] });
    expect(r.entities.map((e) => e.value)).toEqual(['Project Falcon', 'project falcon']);
  });

  it('escapes regex characters in custom terms', () => {
    expect(find('cost (a+b)*2 here', { customTerms: ['(a+b)*2'] }).entities.map((e) => e.value)).toEqual(['(a+b)*2']);
    expect(find('host srv-01.internal down', { customTerms: ['srv-01.internal'] }).entities.map((e) => e.value)).toEqual([
      'srv-01.internal',
    ]);
  });

  it('only runs enabled detectors', () => {
    const text = 'priya@example.com 9876543210';
    expect(find(text, { enabled: ['PHONE'] }).entities.map((e) => e.type)).toEqual(['PHONE']);
  });

  it('marks kept values and still reports them', () => {
    const r = find('a@example.com and A@EXAMPLE.COM', { kept: new Set(['USER:a@example.com']) });
    expect(r.entities.map((e) => e.kept)).toEqual([true, true]);
  });

  it('reports 1-based line and column numbers', () => {
    const e = find('first line\n  call 9876543210').entities[0];
    expect(e).toMatchObject({ line: 2, column: 8 });
  });

  it('handles empty input', () => {
    expect(find('')).toEqual({ entities: [], rejected: [], csv: null });
  });
});
