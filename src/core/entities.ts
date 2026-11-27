/**
 * Registry of every entity type Gupt can detect.
 *
 * `tier: 'core'` marks the types the problem statement makes mandatory
 * (emails, phones, IPs, PAN, Aadhaar, credit cards). `extended` types are
 * extra coverage for real-world logs, resumes, tickets and clinical notes.
 *
 * `priority` settles overlaps: when two detections cover the same characters,
 * the higher-priority one wins (a card number beats a phone number inside it).
 */
export const ENTITY_TYPES = [
  'EMAIL',
  'PHONE',
  'IPV4',
  'IPV6',
  'PAN',
  'AADHAAR',
  'CREDIT_CARD',
  'UPI',
  'GSTIN',
  'PASSPORT',
  'BANK_ACCOUNT',
  'SECRET',
  'MAC',
  'PERSON',
  'DOB',
  'ADDRESS',
  'CUSTOM',
] as const;

export type EntityType = (typeof ENTITY_TYPES)[number];

export interface EntityInfo {
  /** Human-readable name shown in the UI. */
  label: string;
  /** Short tag drawn next to highlights. */
  short: string;
  tier: 'core' | 'extended';
  priority: number;
  /** Placeholder prefix for consistent pseudonymization (USER_01, PHONE_01…). */
  prefix: string;
  description: string;
}

export const ENTITY_INFO: Record<EntityType, EntityInfo> = {
  EMAIL: {
    label: 'Email address',
    short: 'EMAIL',
    tier: 'core',
    priority: 70,
    prefix: 'USER',
    description: 'RFC-style addresses with a real top-level domain.',
  },
  PHONE: {
    label: 'Phone number',
    short: 'PHONE',
    tier: 'core',
    priority: 40,
    prefix: 'PHONE',
    description: 'Indian mobiles (+91, 0-prefixed or bare 10-digit), landlines with STD code, and international E.164 numbers.',
  },
  IPV4: {
    label: 'IPv4 address',
    short: 'IPv4',
    tier: 'core',
    priority: 58,
    prefix: 'IP',
    description: 'Dotted quads with every octet checked to be 0–255; version strings are ignored.',
  },
  IPV6: {
    label: 'IPv6 address',
    short: 'IPv6',
    tier: 'core',
    priority: 60,
    prefix: 'IP',
    description: 'Full, compressed (::) and IPv4-embedded IPv6 addresses, structurally validated.',
  },
  PAN: {
    label: 'PAN (India)',
    short: 'PAN',
    tier: 'core',
    priority: 75,
    prefix: 'PAN',
    description: 'AAAAA9999A format; the 4th letter must be a valid holder type (P, C, H, F, A, T, B, L, J, G).',
  },
  AADHAAR: {
    label: 'Aadhaar (India)',
    short: 'AADHAAR',
    tier: 'core',
    priority: 80,
    prefix: 'AADHAAR',
    description: '12 digits, cannot start with 0 or 1, validated with the Verhoeff checksum UIDAI uses.',
  },
  CREDIT_CARD: {
    label: 'Credit / debit card',
    short: 'CARD',
    tier: 'core',
    priority: 90,
    prefix: 'CARD',
    description: '13–19 digits that pass the Luhn checksum and start with a real card-network prefix (Visa, Mastercard, RuPay, Amex…).',
  },
  UPI: {
    label: 'UPI ID',
    short: 'UPI',
    tier: 'extended',
    priority: 65,
    prefix: 'UPI',
    description: 'name@bank virtual payment addresses with a known UPI handle or nearby UPI context.',
  },
  GSTIN: {
    label: 'GSTIN',
    short: 'GSTIN',
    tier: 'extended',
    priority: 85,
    prefix: 'GSTIN',
    description: '15-character GST numbers with the official mod-36 check character.',
  },
  PASSPORT: {
    label: 'Passport number',
    short: 'PASSPORT',
    tier: 'extended',
    priority: 50,
    prefix: 'PASSPORT',
    description: 'Indian passport format, only when the word "passport" appears nearby.',
  },
  BANK_ACCOUNT: {
    label: 'Bank account',
    short: 'ACCOUNT',
    tier: 'extended',
    priority: 45,
    prefix: 'ACCOUNT',
    description: '9–18 digit account numbers next to "A/c", "account no" and similar labels.',
  },
  SECRET: {
    label: 'Secret / credential',
    short: 'SECRET',
    tier: 'extended',
    priority: 100,
    prefix: 'SECRET',
    description: 'Passwords, API keys, bearer tokens, JWTs, AWS and GitHub keys leaked into logs.',
  },
  MAC: {
    label: 'MAC address',
    short: 'MAC',
    tier: 'extended',
    priority: 55,
    prefix: 'MAC',
    description: 'Hardware addresses such as 00:1A:2B:3C:4D:5E.',
  },
  PERSON: {
    label: 'Person name',
    short: 'NAME',
    tier: 'extended',
    priority: 30,
    prefix: 'PERSON',
    description: 'Names after titles (Dr., Mr., Smt.) or labels (Name:, Patient:), CSV name columns, and later mentions of the same name.',
  },
  DOB: {
    label: 'Date of birth',
    short: 'DOB',
    tier: 'extended',
    priority: 35,
    prefix: 'DOB',
    description: 'Dates next to "DOB", "Date of birth" or "born on".',
  },
  ADDRESS: {
    label: 'Postal address',
    short: 'ADDR',
    tier: 'extended',
    priority: 32,
    prefix: 'ADDRESS',
    description: 'Text after an "Address:" label, or CSV address columns.',
  },
  CUSTOM: {
    label: 'Custom term',
    short: 'CUSTOM',
    tier: 'extended',
    priority: 110,
    prefix: 'TERM',
    description: 'Any word or phrase you add to the always-redact list.',
  },
};

export const CORE_TYPES: readonly EntityType[] = ENTITY_TYPES.filter((t) => ENTITY_INFO[t].tier === 'core');
export const EXTENDED_TYPES: readonly EntityType[] = ENTITY_TYPES.filter((t) => ENTITY_INFO[t].tier === 'extended');

export function isEntityType(value: unknown): value is EntityType {
  return typeof value === 'string' && (ENTITY_TYPES as readonly string[]).includes(value);
}
