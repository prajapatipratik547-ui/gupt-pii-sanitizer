import { describe, expect, it } from 'vitest';
import {
  cardBrand,
  expandIPv6,
  gstinCheckChar,
  ipv4Scope,
  isValidIPv4,
  luhnCheck,
  validateAadhaar,
  validateCard,
  validateEmail,
  validateGstin,
  validateIPv6,
  validatePan,
  verhoeffCheck,
  verhoeffDigit,
} from '../src/core/validators';

describe('Luhn checksum', () => {
  it.each(['4111111111111111', '5555555555554444', '378282246310005', '6011111111111117', '4012888888881881'])(
    'accepts the published test card %s',
    (n) => expect(luhnCheck(n)).toBe(true),
  );

  it.each(['4111111111111112', '1234567890123456', '9876543210987654'])('rejects %s', (n) => {
    expect(luhnCheck(n)).toBe(false);
  });

  it('rejects non-digit input and single digits', () => {
    expect(luhnCheck('4111-1111')).toBe(false);
    expect(luhnCheck('0')).toBe(false);
    expect(luhnCheck('')).toBe(false);
  });
});

describe('card validation', () => {
  it('identifies card networks from the IIN prefix', () => {
    expect(cardBrand('4111111111111111')).toBe('Visa');
    expect(cardBrand('5555555555554444')).toBe('Mastercard');
    expect(cardBrand('2221000000000009')).toBe('Mastercard');
    expect(cardBrand('378282246310005')).toBe('American Express');
    expect(cardBrand('6073849999999997')).toBe('RuPay');
    expect(cardBrand('6011111111111117')).toBe('Discover');
    expect(cardBrand('3530111333300000')).toBe('JCB');
    expect(cardBrand('1730535253123')).toBeNull();
  });

  it('accepts separators and reports the brand', () => {
    expect(validateCard('4012 8888 8888 1881')).toEqual({ ok: true, note: 'Luhn checksum passed', meta: 'Visa' });
    expect(validateCard('5123-4567-8901-2346')).toMatchObject({ ok: true, meta: 'Mastercard' });
  });

  it('marks checksum failures as soft (flaggable when strict mode is off)', () => {
    expect(validateCard('4111 1111 1111 1112')).toEqual({ ok: false, reason: 'Luhn checksum failed', soft: true });
  });

  it('rejects placeholders, wrong lengths and unknown networks', () => {
    expect(validateCard('0000 0000 0000 0000')).toMatchObject({ ok: false, reason: expect.stringContaining('identical') });
    expect(validateCard('411111111111')).toMatchObject({ ok: false, reason: expect.stringContaining('13–19') });
    // 1730535253123 + Luhn digit: passes Luhn, but no network starts with 1 (it's a timestamp).
    const digits = '173053525312';
    const check = [...Array(10).keys()].find((d) => luhnCheck(`${digits}${d}`));
    expect(validateCard(`${digits}${check}`)).toMatchObject({ ok: false, reason: expect.stringContaining('no card-network') });
  });
});

describe('Verhoeff / Aadhaar', () => {
  it('generates check digits that verify', () => {
    for (const base of ['23456789012', '49183726501', '73859201846', '99999999999']) {
      expect(verhoeffCheck(`${base}${verhoeffDigit(base)}`)).toBe(true);
    }
  });

  it('catches every single-digit typo', () => {
    const valid = '234567890124';
    for (let i = 0; i < valid.length; i++) {
      const d = Number(valid[i]);
      const typo = `${valid.slice(0, i)}${(d + 1) % 10}${valid.slice(i + 1)}`;
      expect(verhoeffCheck(typo)).toBe(false);
    }
  });

  it('catches adjacent transpositions', () => {
    expect(verhoeffCheck('234567890124')).toBe(true);
    expect(verhoeffCheck('324567890124')).toBe(false);
  });

  it('validates Aadhaar structure', () => {
    expect(validateAadhaar('2345 6789 0124')).toEqual({ ok: true, note: 'Verhoeff checksum passed' });
    expect(validateAadhaar('2345 6789 0125')).toMatchObject({ ok: false, soft: true });
    expect(validateAadhaar('1234 5678 9012')).toMatchObject({ ok: false, reason: expect.stringContaining('0 or 1') });
    expect(validateAadhaar('2222 2222 2222')).toMatchObject({ ok: false, reason: expect.stringContaining('identical') });
    expect(validateAadhaar('2345 6789 012')).toMatchObject({ ok: false });
    expect(verhoeffCheck('12a4')).toBe(false);
  });
});

describe('PAN', () => {
  it('accepts valid holder types and names them', () => {
    expect(validatePan('ABCPV1234K')).toMatchObject({ ok: true, meta: 'Individual' });
    expect(validatePan('AAACR5055K')).toMatchObject({ ok: true, meta: 'Company' });
    expect(validatePan('abcpv1234k')).toMatchObject({ ok: true });
  });

  it('rejects an invalid 4th character, bad shape and the never-issued 0000 sequence', () => {
    expect(validatePan('ABCXE1234F')).toMatchObject({ ok: false, reason: expect.stringContaining('holder type') });
    expect(validatePan('ABCP12345K')).toMatchObject({ ok: false });
    expect(validatePan('ABCPV0000K')).toMatchObject({ ok: false, soft: true });
  });
});

describe('GSTIN', () => {
  it('computes the official mod-36 check character', () => {
    expect(gstinCheckChar('27AAPFU0939F1Z')).toBe('V');
    expect(gstinCheckChar('07AAACR5055K1Z')).toBe('9');
  });

  it('validates complete numbers', () => {
    expect(validateGstin('27AAPFU0939F1ZV')).toMatchObject({ ok: true, meta: 'Embedded PAN AAPFU0939F' });
    expect(validateGstin('27AAPFU0939F1ZA')).toMatchObject({ ok: false, soft: true });
    expect(validateGstin('99AAPFU0939F1ZV')).toMatchObject({ ok: false, reason: expect.stringContaining('State code') });
    expect(validateGstin('27AAPFU0939F1XV')).toMatchObject({ ok: false });
  });
});

describe('IP addresses', () => {
  it('checks IPv4 octets', () => {
    expect(isValidIPv4('192.168.1.1')).toBe(true);
    expect(isValidIPv4('255.255.255.255')).toBe(true);
    expect(isValidIPv4('256.1.1.1')).toBe(false);
    expect(isValidIPv4('10.0.0.300')).toBe(false);
    expect(isValidIPv4('01.2.3.4')).toBe(false);
    expect(isValidIPv4('1.2.3')).toBe(false);
  });

  it('classifies IPv4 scope', () => {
    expect(ipv4Scope('10.1.2.3')).toBe('Private network');
    expect(ipv4Scope('172.20.0.1')).toBe('Private network');
    expect(ipv4Scope('192.168.0.1')).toBe('Private network');
    expect(ipv4Scope('127.0.0.1')).toBe('Loopback');
    expect(ipv4Scope('169.254.1.1')).toBe('Link-local');
    expect(ipv4Scope('0.0.0.0')).toBe('Unspecified');
    expect(ipv4Scope('239.1.1.1')).toBe('Multicast / reserved');
    expect(ipv4Scope('203.0.113.42')).toBe('Public');
  });

  it('expands IPv6 forms', () => {
    expect(expandIPv6('2001:db8::1')).toEqual(['2001', '0db8', '0000', '0000', '0000', '0000', '0000', '0001']);
    expect(expandIPv6('::ffff:192.168.1.1')?.slice(-2)).toEqual(['c0a8', '0101']);
    expect(expandIPv6('2001:0db8:85a3:0000:0000:8a2e:0370:7334')).toHaveLength(8);
    expect(expandIPv6('1::2::3')).toBeNull();
    expect(expandIPv6('10:22:33')).toBeNull();
    expect(expandIPv6('gggg::1')).toBeNull();
    expect(expandIPv6('::ffff:999.1.1.1')).toBeNull();
    expect(expandIPv6('1:2:3:4:5:6:7::8')).toBeNull();
  });

  it('validates IPv6 and classifies scope', () => {
    expect(validateIPv6('fe80::1ff:fe23:4567:890a')).toMatchObject({ ok: true, meta: 'Link-local' });
    expect(validateIPv6('::1')).toMatchObject({ ok: true, meta: 'Loopback' });
    expect(validateIPv6('fd12:3456::1')).toMatchObject({ ok: true, meta: 'Private (ULA)' });
    expect(validateIPv6('2001:db8::7')).toMatchObject({ ok: true, meta: 'Global' });
    expect(validateIPv6('a::')).toMatchObject({ ok: false });
    expect(validateIPv6('00:1A:2B:3C:4D:5E')).toMatchObject({ ok: false });
  });
});

describe('email', () => {
  it('rejects misplaced dots', () => {
    expect(validateEmail('a@b.com')).toMatchObject({ ok: true });
    expect(validateEmail('.a@b.com')).toMatchObject({ ok: false });
    expect(validateEmail('a..b@b.com')).toMatchObject({ ok: false });
    expect(validateEmail(`${'a'.repeat(65)}@b.com`)).toMatchObject({ ok: false });
  });
});
