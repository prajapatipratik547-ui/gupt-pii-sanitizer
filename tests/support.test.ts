import { describe, expect, it } from 'vitest';
import { decodeText, hasAcceptedExtension } from '../src/ui/files';
import { DEFAULT_SETTINGS, parseSettings } from '../src/ui/settings';
import { formatBytes, plural } from '../src/ui/dom';

describe('settings parsing', () => {
  it('falls back to defaults for missing or corrupt storage', () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('{not json')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('42')).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps valid fields and drops unknown values', () => {
    const s = parseSettings(
      JSON.stringify({ mode: 'pseudonym', strict: false, enabled: ['EMAIL', 'NOT_A_TYPE', 7], customTerms: ['Falcon', 3], theme: 'neon' }),
    );
    expect(s.mode).toBe('pseudonym');
    expect(s.strict).toBe(false);
    expect(s.enabled).toEqual(['EMAIL']);
    expect(s.customTerms).toEqual(['Falcon']);
    expect(s.theme).toBe('system');
  });

  it('rejects an unknown mode', () => {
    expect(parseSettings(JSON.stringify({ mode: 'yolo' })).mode).toBe('full');
  });
});

describe('file decoding', () => {
  const enc = new TextEncoder();

  it('decodes UTF-8 and strips its BOM', () => {
    expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, ...enc.encode('नमस्ते a@b.co')]))).toBe('नमस्ते a@b.co');
  });

  it('decodes UTF-16 LE and BE with a BOM', () => {
    expect(decodeText(new Uint8Array([0xff, 0xfe, 0x68, 0x00, 0x69, 0x00]))).toBe('hi');
    expect(decodeText(new Uint8Array([0xfe, 0xff, 0x00, 0x68, 0x00, 0x69]))).toBe('hi');
  });

  it('refuses binary content', () => {
    expect(decodeText(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x1a]))).toBeNull();
  });

  it('accepts only text extensions', () => {
    expect(hasAcceptedExtension('Customers.CSV')).toBe(true);
    expect(hasAcceptedExtension('app.log')).toBe(true);
    expect(hasAcceptedExtension('photo.png')).toBe(false);
    expect(hasAcceptedExtension('csv')).toBe(false);
  });
});

describe('formatting helpers', () => {
  it('formats sizes and plurals', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.00 MB');
    expect(plural(1, 'value')).toBe('1 value');
    expect(plural(1200, 'value')).toBe('1,200 values');
    expect(plural(2, 'entry', 'entries')).toBe('2 entries');
  });
});
