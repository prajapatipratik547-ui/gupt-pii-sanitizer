/**
 * Pure validation functions. Each one turns a pattern match into a real
 * decision, which is how Gupt avoids flagging every 16-digit order ID as a
 * credit card or every 12-digit number as an Aadhaar.
 */

const onlyDigits = (s: string): string => s.replace(/\D/g, '');

/** Luhn (mod 10) checksum used by every major card network. */
export function luhnCheck(digits: string): boolean {
  if (!/^\d{2,}$/.test(digits)) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

export type CardBrand =
  | 'Visa'
  | 'Mastercard'
  | 'American Express'
  | 'RuPay'
  | 'Discover'
  | 'Diners Club'
  | 'JCB'
  | 'UnionPay'
  | 'Maestro';

interface BrandRule {
  brand: CardBrand;
  prefix: RegExp;
  lengths: readonly number[];
}

// Order matters: more specific prefixes first (RuPay's 6521/6522 before Discover's 65).
const BRAND_RULES: readonly BrandRule[] = [
  { brand: 'American Express', prefix: /^3[47]/, lengths: [15] },
  { brand: 'Diners Club', prefix: /^3(?:0[0-5]|[68])/, lengths: [14, 15, 16, 17, 18, 19] },
  { brand: 'JCB', prefix: /^35(?:2[89]|[3-8]\d)/, lengths: [16, 17, 18, 19] },
  { brand: 'RuPay', prefix: /^(?:60(?!11)|652[12]|81|82|508)/, lengths: [16] },
  { brand: 'Discover', prefix: /^(?:6011|64[4-9]|65)/, lengths: [16, 17, 18, 19] },
  { brand: 'UnionPay', prefix: /^62/, lengths: [16, 17, 18, 19] },
  {
    brand: 'Mastercard',
    prefix: /^(?:5[1-5]|222[1-9]|22[3-9]\d|2[3-6]\d\d|27[01]\d|2720)/,
    lengths: [16],
  },
  { brand: 'Maestro', prefix: /^(?:5018|5020|5038|5893|6304|6759|676[1-3])/, lengths: [12, 13, 14, 15, 16, 17, 18, 19] },
  { brand: 'Visa', prefix: /^4/, lengths: [13, 16, 19] },
];

/** Identify the card network from the issuer prefix (IIN) and length. */
export function cardBrand(digits: string): CardBrand | null {
  for (const rule of BRAND_RULES) {
    if (rule.prefix.test(digits) && rule.lengths.includes(digits.length)) return rule.brand;
  }
  return null;
}

export type CheckResult = { ok: true; note: string; meta?: string } | { ok: false; reason: string; soft?: boolean };

/**
 * Card check: Luhn + a known network prefix. `soft` failures are format-valid
 * numbers that failed the checksum — still flagged if strict mode is off.
 */
export function validateCard(raw: string): CheckResult {
  const digits = onlyDigits(raw);
  if (digits.length < 13 || digits.length > 19) return { ok: false, reason: 'Not 13–19 digits long' };
  if (/^(\d)\1+$/.test(digits)) return { ok: false, reason: 'All digits identical (placeholder)' };
  if (!luhnCheck(digits)) return { ok: false, reason: 'Luhn checksum failed', soft: true };
  const brand = cardBrand(digits);
  if (!brand) return { ok: false, reason: 'Passes Luhn but matches no card-network prefix', soft: true };
  return { ok: true, note: 'Luhn checksum passed', meta: brand };
}

// --- Verhoeff (dihedral group D5) — the checksum UIDAI uses for Aadhaar ---
const VERHOEFF_D: readonly (readonly number[])[] = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const VERHOEFF_P: readonly (readonly number[])[] = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];
const VERHOEFF_INV: readonly number[] = [0, 4, 3, 2, 1, 5, 6, 7, 8, 9];

const lookup = (table: readonly (readonly number[])[], row: number, col: number): number =>
  (table[row] as readonly number[])[col] as number;

export function verhoeffCheck(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false;
  let c = 0;
  for (let i = 0; i < digits.length; i++) {
    const d = digits.charCodeAt(digits.length - 1 - i) - 48;
    c = lookup(VERHOEFF_D, c, lookup(VERHOEFF_P, i % 8, d));
  }
  return c === 0;
}

/** Compute the Verhoeff check digit to append to `digits` (used by tests and samples). */
export function verhoeffDigit(digits: string): number {
  let c = 0;
  for (let i = 0; i < digits.length; i++) {
    const d = digits.charCodeAt(digits.length - 1 - i) - 48;
    c = lookup(VERHOEFF_D, c, lookup(VERHOEFF_P, (i + 1) % 8, d));
  }
  return VERHOEFF_INV[c] as number;
}

export function validateAadhaar(raw: string): CheckResult {
  const digits = onlyDigits(raw);
  if (digits.length !== 12) return { ok: false, reason: 'Not 12 digits' };
  if (/^[01]/.test(digits)) return { ok: false, reason: 'Aadhaar numbers never start with 0 or 1' };
  if (/^(\d)\1+$/.test(digits)) return { ok: false, reason: 'All digits identical (placeholder)' };
  if (!verhoeffCheck(digits)) return { ok: false, reason: 'Verhoeff checksum failed', soft: true };
  return { ok: true, note: 'Verhoeff checksum passed' };
}

const PAN_HOLDER_TYPES: Readonly<Record<string, string>> = {
  P: 'Individual',
  C: 'Company',
  H: 'Hindu Undivided Family',
  F: 'Firm / LLP',
  A: 'Association of Persons',
  T: 'Trust',
  B: 'Body of Individuals',
  L: 'Local authority',
  J: 'Artificial juridical person',
  G: 'Government',
};

export function validatePan(raw: string): CheckResult {
  const pan = raw.toUpperCase();
  if (!/^[A-Z]{5}\d{4}[A-Z]$/.test(pan)) return { ok: false, reason: 'Not in AAAAA9999A format' };
  const holder = PAN_HOLDER_TYPES[pan.charAt(3)];
  if (!holder) return { ok: false, reason: `4th character "${pan.charAt(3)}" is not a valid PAN holder type` };
  if (pan.slice(5, 9) === '0000') return { ok: false, reason: 'Sequence 0000 is never issued', soft: true };
  return { ok: true, note: 'Holder-type letter valid', meta: holder };
}

const GST_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** The mod-36 check character defined by GSTN for the 15th position. */
export function gstinCheckChar(first14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const value = GST_CHARS.indexOf(first14.charAt(i));
    const product = value * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return GST_CHARS.charAt((36 - (sum % 36)) % 36);
}

export function validateGstin(raw: string): CheckResult {
  const g = raw.toUpperCase();
  if (!/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(g)) return { ok: false, reason: 'Not in GSTIN format' };
  const state = Number(g.slice(0, 2));
  if (state < 1 || state > 38) return { ok: false, reason: `State code ${g.slice(0, 2)} does not exist` };
  if (gstinCheckChar(g.slice(0, 14)) !== g.charAt(14)) return { ok: false, reason: 'GSTIN check character failed', soft: true };
  return { ok: true, note: 'Mod-36 check character passed', meta: `Embedded PAN ${g.slice(2, 12)}` };
}

export function isValidIPv4(s: string): boolean {
  const parts = s.split('.');
  return (
    parts.length === 4 &&
    parts.every((p) => /^(?:0|[1-9]\d{0,2})$/.test(p) && Number(p) <= 255)
  );
}

export function ipv4Scope(s: string): string {
  const [a = 0, b = 0] = s.split('.').map(Number);
  if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return 'Private network';
  if (a === 127) return 'Loopback';
  if (a === 169 && b === 254) return 'Link-local';
  if (a === 0) return 'Unspecified';
  if (a >= 224) return 'Multicast / reserved';
  return 'Public';
}

export function validateIPv4(raw: string): CheckResult {
  if (!isValidIPv4(raw)) return { ok: false, reason: 'Octet out of range (0–255) or leading zero' };
  return { ok: true, note: 'All octets 0–255', meta: ipv4Scope(raw) };
}

/** Expand an IPv6 address to 8 groups, or return null if it is not valid. */
export function expandIPv6(s: string): string[] | null {
  if (s.length > 45 || s.length < 2) return null;
  let addr = s;
  const lastColon = addr.lastIndexOf(':');
  const tail = addr.slice(lastColon + 1);
  if (tail.includes('.')) {
    if (!isValidIPv4(tail)) return null;
    const [a = 0, b = 0, c = 0, d = 0] = tail.split('.').map(Number);
    addr = `${addr.slice(0, lastColon + 1)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const hex = /^[0-9a-f]{1,4}$/i;
  const halves = addr.split('::');
  if (halves.length > 2) return null;
  const split = (x: string): string[] => (x === '' ? [] : x.split(':'));
  if (halves.length === 2) {
    const head = split(halves[0] as string);
    const rest = split(halves[1] as string);
    if (![...head, ...rest].every((g) => hex.test(g))) return null;
    if (head.length + rest.length > 7) return null;
    const zeros = Array<string>(8 - head.length - rest.length).fill('0');
    return [...head, ...zeros, ...rest].map((g) => g.toLowerCase().padStart(4, '0'));
  }
  const groups = addr.split(':');
  if (groups.length !== 8 || !groups.every((g) => hex.test(g))) return null;
  return groups.map((g) => g.toLowerCase().padStart(4, '0'));
}

export function validateIPv6(raw: string): CheckResult {
  const groups = expandIPv6(raw);
  if (!groups) return { ok: false, reason: 'Not a structurally valid IPv6 address' };
  // Require some real content: "::" alone or "a:b::" fragments in prose are not addresses.
  const explicit = raw.split(/:+/).filter(Boolean).length;
  if (explicit < 2 && raw !== '::1') return { ok: false, reason: 'Too few groups to be an address' };
  const scope = groups[0] === 'fe80' ? 'Link-local' : raw === '::1' ? 'Loopback' : /^f[cd]/.test(groups[0] ?? '') ? 'Private (ULA)' : 'Global';
  return { ok: true, note: 'Valid IPv6 structure', meta: scope };
}

export function validateEmail(raw: string): CheckResult {
  const at = raw.lastIndexOf('@');
  const local = raw.slice(0, at);
  if (local.length === 0 || local.length > 64) return { ok: false, reason: 'Local part length invalid' };
  if (local.startsWith('.') || local.endsWith('.') || local.includes('..')) return { ok: false, reason: 'Misplaced dots in local part' };
  return { ok: true, note: 'Well-formed address' };
}

export function digitCount(s: string): number {
  return onlyDigits(s).length;
}
