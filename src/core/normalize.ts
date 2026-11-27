import { ENTITY_INFO, type EntityType } from './entities';
import { expandIPv6 } from './validators';

/**
 * Canonical form of a detected value, so that the same real-world identifier
 * written different ways maps to the same pseudonym:
 *   "4111 1111 1111 1111" and "4111-1111-1111-1111"  -> one CARD_xx
 *   "+91 98765 43210" and "09876543210"              -> one PHONE_xx
 *   "Priya@Example.com" and "priya@example.com"     -> one USER_xx
 */
export function normalizeValue(type: EntityType, value: string): string {
  const v = value.trim();
  switch (type) {
    case 'EMAIL':
    case 'UPI':
      return v.toLowerCase();
    case 'PHONE': {
      const digits = v.replace(/\D/g, '');
      // Indian numbers: drop +91 / 0091 / 0 trunk prefix so every spelling collapses to 10 digits.
      if (digits.length > 10 && /^(?:0091|91|0)/.test(digits) && /^[6-9]/.test(digits.slice(-10))) return digits.slice(-10);
      return digits.replace(/^0+/, '');
    }
    case 'CREDIT_CARD':
    case 'AADHAAR':
    case 'BANK_ACCOUNT':
      return v.replace(/\D/g, '');
    case 'PAN':
    case 'GSTIN':
    case 'PASSPORT':
      return v.replace(/\s/g, '').toUpperCase();
    case 'IPV6':
      return expandIPv6(v)?.join(':') ?? v.toLowerCase();
    case 'MAC':
      return v.replace(/[^0-9a-f]/gi, '').toLowerCase();
    case 'DOB':
      return /\d{1,2}\D\d{1,2}\D\d{2,4}/.test(v) ? v.replace(/\D/g, '') : v.toLowerCase().replace(/\s+/g, ' ');
    case 'PERSON':
    case 'ADDRESS':
    case 'CUSTOM':
      return v.toLowerCase().replace(/\s+/g, ' ').replace(/[.,]+$/, '');
    default:
      return v;
  }
}

/** Key used for consistent pseudonyms and for "keep this value" choices. IPv4 and IPv6 share the IP namespace. */
export function entityKey(type: EntityType, value: string): string {
  return `${ENTITY_INFO[type].prefix}:${normalizeValue(type, value)}`;
}
