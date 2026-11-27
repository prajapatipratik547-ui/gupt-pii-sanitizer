import type { EntityType } from './entities';
import {
  type CheckResult,
  digitCount,
  validateAadhaar,
  validateCard,
  validateEmail,
  validateGstin,
  validateIPv4,
  validateIPv6,
  validatePan,
} from './validators';

/**
 * A detector is a pattern plus the rules that turn a raw match into a
 * decision. Every pattern starts with a negative look-behind so it can only
 * begin at a token boundary — that keeps scanning linear even on a single
 * multi-megabyte line with no spaces.
 */
export interface DetectContext {
  text: string;
  start: number;
  end: number;
}

export interface Detector {
  id: string;
  type: EntityType;
  /** Must carry the `g` and `d` flags (`d` gives capture-group offsets). */
  pattern: RegExp;
  /** Capture group holding the sensitive value (labels like "PAN:" stay visible). */
  group?: number;
  confidence: number;
  validate?: (value: string, ctx: DetectContext) => CheckResult;
  /** Only accept the match if this appears shortly before it. */
  requireContext?: RegExp;
  /** Raise confidence when this appears shortly before it. */
  boostContext?: RegExp;
  /** Drop the match when this appears right before it (e.g. "version 1.2.3.4"). */
  rejectContext?: RegExp;
  /** Show failed validations in the audit (useful for checksummed IDs, noisy for loose ones). */
  reportRejections?: boolean;
  note?: string;
}

const CONTEXT_WINDOW = 48;

export function contextBefore(text: string, start: number, size = CONTEXT_WINDOW): string {
  return text.slice(Math.max(0, start - size), start);
}

const ok = (note: string, meta?: string): CheckResult => (meta ? { ok: true, note, meta } : { ok: true, note });

// --- UPI -----------------------------------------------------------------
const UPI_HANDLES: ReadonlySet<string> = new Set([
  'ybl',
  'ibl',
  'axl',
  'okaxis',
  'okhdfcbank',
  'okicici',
  'oksbi',
  'okbizaxis',
  'paytm',
  'ptyes',
  'ptaxis',
  'pthdfc',
  'ptsbi',
  'upi',
  'apl',
  'yapl',
  'rapl',
  'axisbank',
  'axisb',
  'icici',
  'hdfcbank',
  'sbi',
  'kotak',
  'kkbk',
  'idfcbank',
  'idfcfirst',
  'ikwik',
  'freecharge',
  'jupiteraxis',
  'fbl',
  'federal',
  'pockets',
  'airtel',
  'jio',
  'waaxis',
  'wahdfcbank',
  'wasbi',
  'waicici',
  'abfspay',
  'yesbank',
  'yesbankltd',
  'barodampay',
  'aubank',
  'indus',
  'dbs',
  'hsbc',
  'sc',
  'citi',
  'citigold',
  'rbl',
  'pnb',
  'boi',
  'cnrb',
  'unionbank',
  'uboi',
  'mahb',
  'centralbank',
  'cbin',
  'idbi',
  'ezeepay',
  'superyes',
  'naviaxis',
  'slc',
  'sliceaxis',
  'yescred',
  'goaxb',
  'tapicici',
  'amazonpay',
  'postbank',
  'equitas',
  'kvb',
  'karurvysyabank',
  'tjsb',
  'dlb',
  'lvb',
  'ubi',
  'psb',
]);
const UPI_CONTEXT = /\b(?:upi|vpa|gpay|g pay|google pay|phonepe|phone pe|paytm|bhim|pay to|collect request)\b/i;

function validateUpi(value: string, ctx: DetectContext): CheckResult {
  const handle = value.slice(value.lastIndexOf('@') + 1).toLowerCase();
  if (UPI_HANDLES.has(handle)) return ok('Known UPI handle', `@${handle}`);
  if (UPI_CONTEXT.test(contextBefore(ctx.text, ctx.start, 64))) return ok('UPI context nearby', `@${handle}`);
  return { ok: false, reason: 'Unknown UPI handle and no UPI context nearby' };
}

// --- Profile URLs ----------------------------------------------------------
/** Site sections that are not a person's profile (github.com/features, x.com/home…). */
const NON_PROFILE_PATHS: ReadonlySet<string> = new Set([
  'about',
  'features',
  'pricing',
  'login',
  'signup',
  'join',
  'home',
  'explore',
  'settings',
  'orgs',
  'topics',
  'marketplace',
  'sponsors',
  'search',
  'share',
  'help',
  'privacy',
  'terms',
  'jobs',
  'company',
  'pages',
  'groups',
  'events',
  'hashtag',
  'intent',
  'i',
  'notifications',
  'messages',
  'watch',
  'apps',
  'enterprise',
  'security',
]);

function profileHandle(url: string): string {
  return url.slice(url.lastIndexOf('/') + 1).replace(/^@/, '');
}

function validateProfileUrl(value: string): CheckResult {
  const handle = profileHandle(value).toLowerCase();
  if (NON_PROFILE_PATHS.has(handle)) return { ok: false, reason: `"${handle}" is a site page, not a profile` };
  const site = /(linkedin|github|gitlab|twitter|x|instagram|facebook|t|medium)\.(?:com|me)/i.exec(value)?.[1]?.toLowerCase() ?? 'web';
  const names: Record<string, string> = {
    t: 'Telegram',
    x: 'X (Twitter)',
    twitter: 'X (Twitter)',
    linkedin: 'LinkedIn',
    github: 'GitHub',
    gitlab: 'GitLab',
    instagram: 'Instagram',
    facebook: 'Facebook',
    medium: 'Medium',
  };
  return ok('Personal profile link', names[site] ?? site);
}

// --- Phones ----------------------------------------------------------------
function validateIndianMobile(value: string): CheckResult {
  const digits = value.replace(/\D/g, '');
  const national = digits.length > 10 ? digits.slice(-10) : digits;
  if (national.length !== 10 || !/^[6-9]/.test(national)) return { ok: false, reason: 'Not a 10-digit Indian mobile' };
  if (/^(\d)\1+$/.test(national)) return { ok: false, reason: 'All digits identical (placeholder)' };
  return ok('Indian mobile format', 'India (+91)');
}

function validateLandline(value: string): CheckResult {
  const national = value.replace(/^\+91/, '').replace(/\D/g, '').replace(/^0/, '');
  return national.length === 10
    ? ok('STD code + subscriber number', 'India landline')
    : { ok: false, reason: 'Wrong length for an Indian landline' };
}

function validateIntlPhone(value: string): CheckResult {
  const n = digitCount(value);
  return n >= 8 && n <= 15 ? ok('E.164 length (8–15 digits)', 'International') : { ok: false, reason: 'Not 8–15 digits' };
}

// --- Secrets ---------------------------------------------------------------
const PLACEHOLDER_SECRET =
  /^(?:\*+|x+|•+|null|none|nil|undefined|true|false|redacted|\[redacted\]|<redacted>|changeme|example|\$\{[^}]*\}|%[^%]*%)$/i;

function validateSecretValue(value: string): CheckResult {
  if (PLACEHOLDER_SECRET.test(value)) return { ok: false, reason: 'Placeholder, not a real secret' };
  return ok('Credential assignment');
}

// --- Names -----------------------------------------------------------------
/** Capitalised words that follow titles/labels but are not names. */
const NAME_STOPWORDS: ReadonlySet<string> = new Set([
  'the',
  'this',
  'that',
  'team',
  'support',
  'customer',
  'customers',
  'sir',
  'madam',
  'all',
  'everyone',
  'there',
  'friend',
  'friends',
  'unknown',
  'not',
  'none',
  'na',
  'patient',
  'doctor',
  'admin',
  'user',
  'users',
  'hiring',
  'manager',
  'department',
  'hr',
  'it',
  'billing',
  'sales',
  'concerned',
  'whom',
  'applicant',
  'candidate',
  'client',
  'service',
  'services',
  'regards',
  'thanks',
  'thank',
  'hello',
  'hi',
  'dear',
  'valued',
  'member',
  'members',
  'guest',
  'test',
  'sample',
  'demo',
  'same',
  'self',
  'yes',
  'no',
  'today',
  'tomorrow',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
  'india',
  'pvt',
  'ltd',
  'inc',
]);

export function validatePersonName(value: string): CheckResult {
  const words = value.split(/\s+/).filter(Boolean);
  const first = (words[0] ?? '').replace(/\.$/, '').toLowerCase();
  if (NAME_STOPWORDS.has(first)) return { ok: false, reason: `"${words[0] ?? ''}" is not a name` };
  if (words.every((w) => /^[A-Z]\.?$/.test(w))) return { ok: false, reason: 'Initials only' };
  return ok('Name after title or label');
}

const NAME = String.raw`(?:[A-Z][a-z]+(?:[-'][A-Z]?[a-z]+)?|[A-Z]\.)`;
const NAME_SEQ = String.raw`${NAME}(?:[ \t]+${NAME}){0,3}`;
const TITLE = String.raw`(?:Mr|Mrs|Ms|Miss|Mx|Dr|Prof|Shri|Smt|Sri|Kumari|Capt|Adv)`;

/**
 * Detectors in no particular order — the engine resolves overlaps by
 * entity priority, so ordering here does not change results.
 */
export const DETECTORS: readonly Detector[] = [
  {
    id: 'email',
    type: 'EMAIL',
    // `%40` covers URL-encoded addresses in query strings and access logs (?email=a%40b.com).
    pattern: /(?<![\w.+%-])[A-Za-z0-9._%+-]+(?:@|%40)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,24}(?![\w-])/dg,
    confidence: 0.98,
    validate: validateEmail,
  },
  {
    id: 'profile-url',
    type: 'PROFILE_URL',
    pattern:
      /(?<![\w@./-])(?:https?:\/\/)?(?:www\.)?(?:linkedin\.com\/in|github\.com|gitlab\.com|twitter\.com|x\.com|instagram\.com|facebook\.com|t\.me|medium\.com)\/@?[A-Za-z0-9_.-]{0,99}[A-Za-z0-9_-](?![\w-])/dgi,
    confidence: 0.9,
    validate: validateProfileUrl,
  },
  {
    id: 'phone-in-mobile',
    type: 'PHONE',
    pattern: /(?<![\w+]|\d[ -])(?:(?:\+|00)91[ -]?|0)?[6-9](?:[ -]?\d){9}(?![ -]?\d|\w)/dg,
    confidence: 0.9,
    validate: validateIndianMobile,
    boostContext: /\b(?:ph|phone|mob|mobile|cell|tel|contact|call|whatsapp|sms)\b/i,
  },
  {
    id: 'phone-in-landline',
    type: 'PHONE',
    pattern: /(?<![\w+]|\d[ -])(?:\+91[ -]?|0|\(0)[1-9]\d{1,3}\)?[ -]\d{3,4}[ -]?\d{3,4}(?![ -]?\d|\w)/dg,
    confidence: 0.8,
    validate: validateLandline,
  },
  {
    id: 'phone-intl',
    type: 'PHONE',
    // Each repetition consumes exactly one digit (with an optional separator or bracket), so there
    // is only one way to match a given run of digits — no exponential backtracking. 8–15 digits = E.164.
    pattern: /(?<![\w+])\+(?!91)[1-9](?:[ .-]?\(?\d\)?){7,14}(?![\d\w])/dg,
    confidence: 0.85,
    validate: validateIntlPhone,
  },
  {
    id: 'phone-nanp',
    type: 'PHONE',
    pattern: /(?<![\w(])\(\d{3}\)[ ]?\d{3}-\d{4}(?![\d\w])/dg,
    confidence: 0.8,
    validate: () => ok('North-American format', 'NANP'),
  },
  {
    id: 'ipv4',
    type: 'IPV4',
    pattern: /(?<![\w.])(?:\d{1,3}\.){3}\d{1,3}(?![\w]|\.\d)/dg,
    confidence: 0.95,
    validate: validateIPv4,
    rejectContext: /\b(?:version|ver\.?|release|build|firmware|kernel|sdk|os|v)\s*[:=]?\s*$/i,
    reportRejections: true,
  },
  {
    id: 'ipv6',
    type: 'IPV6',
    pattern: /(?<![\w:.])(?:[0-9A-Fa-f]{0,4}:){2,7}(?:[0-9A-Fa-f]{0,4}|\d{1,3}(?:\.\d{1,3}){3})(?![\w:]|\.\d)/dg,
    confidence: 0.92,
    validate: validateIPv6,
  },
  {
    id: 'pan',
    type: 'PAN',
    pattern: /(?<![\w])[A-Za-z]{5}\d{4}[A-Za-z](?!\w)/dg,
    confidence: 0.92,
    validate: (v) => (v !== v.toUpperCase() && v !== v.toLowerCase() ? { ok: false, reason: 'Mixed case — not a PAN' } : validatePan(v)),
    boostContext: /\b(?:pan|permanent account|income tax|itr)\b/i,
    reportRejections: true,
  },
  {
    id: 'aadhaar',
    type: 'AADHAAR',
    pattern: /(?<![\w]|\d[ -])\d{4}([ -]?)\d{4}\1\d{4}(?![ -]?\d|\w)/dg,
    confidence: 0.93,
    validate: validateAadhaar,
    boostContext: /(?:aadhaa?r|uid|uidai|आधार)/i,
    reportRejections: true,
  },
  {
    id: 'credit-card',
    type: 'CREDIT_CARD',
    pattern: /(?<![\w]|\d[ -])\d(?:[ -]?\d){12,18}(?![ -]?\d|\w)/dg,
    confidence: 0.97,
    validate: validateCard,
    boostContext: /\b(?:card|visa|master|amex|rupay|cc|credit|debit|payment)\b/i,
    reportRejections: true,
  },
  {
    id: 'upi',
    type: 'UPI',
    pattern: /(?<![\w.@+%-])[A-Za-z0-9][A-Za-z0-9._-]{1,254}@[A-Za-z][A-Za-z0-9]{1,63}(?![\w@-]|\.[A-Za-z0-9])/dg,
    confidence: 0.85,
    validate: validateUpi,
  },
  {
    id: 'gstin',
    type: 'GSTIN',
    pattern: /(?<!\w)\d{2}[A-Za-z]{5}\d{4}[A-Za-z][1-9A-Za-z][Zz][0-9A-Za-z](?!\w)/dg,
    confidence: 0.96,
    validate: validateGstin,
    reportRejections: true,
  },
  {
    id: 'passport-in',
    type: 'PASSPORT',
    pattern: /(?<!\w)[A-PR-WYa-pr-wy][1-9]\d ?\d{4}[1-9](?!\w)/dg,
    confidence: 0.85,
    requireContext: /passport/i,
    validate: () => ok('Indian passport format + context'),
  },
  {
    id: 'bank-account',
    type: 'BANK_ACCOUNT',
    pattern:
      /\b(?:a\/c|acct|account|bank account|savings account|current account)(?:[ \t]*(?:no\.?|number|num|#))?[ \t]*[:#-]?[ \t]*(\d{9,18})(?!\d)/dgi,
    group: 1,
    confidence: 0.85,
    validate: () => ok('Account label + 9–18 digits'),
  },
  {
    id: 'secret-aws',
    type: 'SECRET',
    pattern: /(?<![A-Z0-9])(?:AKIA|ASIA)[A-Z0-9]{16}(?![A-Z0-9])/dg,
    confidence: 0.99,
    validate: () => ok('AWS access key ID format', 'AWS'),
  },
  {
    id: 'secret-github',
    type: 'SECRET',
    pattern: /(?<!\w)gh[pousr]_[A-Za-z0-9]{36,255}(?!\w)/dg,
    confidence: 0.99,
    validate: () => ok('GitHub token format', 'GitHub'),
  },
  {
    id: 'secret-stripe',
    type: 'SECRET',
    pattern: /(?<!\w)(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}(?!\w)/dg,
    confidence: 0.99,
    validate: () => ok('Stripe secret key format', 'Stripe'),
  },
  {
    id: 'secret-google',
    type: 'SECRET',
    pattern: /(?<![\w-])AIza[0-9A-Za-z_-]{35}(?![\w-])/dg,
    confidence: 0.97,
    validate: () => ok('Google API key format', 'Google'),
  },
  {
    id: 'secret-jwt',
    type: 'SECRET',
    pattern: /(?<![\w-])eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}(?![\w-])/dg,
    confidence: 0.97,
    validate: () => ok('JSON Web Token structure', 'JWT'),
  },
  {
    id: 'secret-bearer',
    type: 'SECRET',
    pattern: /\bBearer[ \t]+([A-Za-z0-9._~+/-]{16,}=*)/dg,
    group: 1,
    confidence: 0.95,
    validate: validateSecretValue,
  },
  {
    id: 'secret-assignment',
    type: 'SECRET',
    pattern:
      // Starts only at the beginning of an identifier and allows a bounded prefix (db_, x-api-),
      // which keeps the scan linear even on a long `a_a_a_a…` chain.
      /(?<![A-Za-z0-9_-])(?:[A-Za-z0-9]{1,32}[_-]){0,6}?(?:password|passwd|pwd|pass|secret|client[_-]?secret|api[_-]?key|apikey|access[_-]?token|auth[_-]?token|refresh[_-]?token|private[_-]?key|session[_-]?id|token)\b["']?[ \t]*[:=][ \t]*["']?([^\s"',;&]{4,})/dgi,
    group: 1,
    confidence: 0.9,
    validate: validateSecretValue,
  },
  {
    id: 'mac',
    type: 'MAC',
    pattern: /(?<![\w:-])[0-9A-Fa-f]{2}([:-])(?:[0-9A-Fa-f]{2}\1){4}[0-9A-Fa-f]{2}(?![\w:-])/dg,
    confidence: 0.93,
    validate: (v) => ok('Six-octet hardware address', `Vendor prefix ${v.slice(0, 8).toUpperCase()}`),
  },
  {
    id: 'mac-cisco',
    type: 'MAC',
    pattern: /(?<![\w.])[0-9A-Fa-f]{4}\.[0-9A-Fa-f]{4}\.[0-9A-Fa-f]{4}(?![\w.])/dg,
    confidence: 0.85,
    validate: () => ok('Cisco dotted MAC format'),
  },
  {
    id: 'person-title',
    type: 'PERSON',
    pattern: new RegExp(String.raw`\b${TITLE}\.?[ \t]+(${NAME_SEQ})`, 'dg'),
    group: 1,
    confidence: 0.85,
    validate: validatePersonName,
  },
  {
    id: 'person-label',
    type: 'PERSON',
    pattern: new RegExp(
      String.raw`\b(?:[Nn]ame|NAME|[Ff]ull [Nn]ame|[Pp]atient(?: [Nn]ame)?|[Cc]ustomer(?: [Nn]ame)?|[Cc]andidate(?: [Nn]ame)?|[Ee]mployee(?: [Nn]ame)?|[Aa]pplicant(?: [Nn]ame)?|[Cc]ontact(?: [Pp]erson)?|[Rr]eported [Bb]y|[Ss]ubmitted [Bb]y|[Aa]ssigned [Tt]o|[Rr]eferred [Bb]y|[Gg]uardian|[Ff]ather'?s? [Nn]ame|[Mm]other'?s? [Nn]ame|[Ss]pouse|[Nn]ext of [Kk]in|[Aa]ccount [Hh]older|[Cc]ardholder)[ \t]*[:\-–][ \t]*(?:${TITLE}\.?[ \t]+)?(${NAME_SEQ})`,
      'dg',
    ),
    group: 1,
    confidence: 0.85,
    validate: validatePersonName,
  },
  {
    id: 'person-greeting',
    type: 'PERSON',
    pattern: /\b(?:Dear|Hi|Hello|Hey)[ \t]+([A-Z][a-z]+(?:[ \t]+[A-Z][a-z]+){0,2})(?=[ \t]*[,!:\n])/dg,
    group: 1,
    confidence: 0.7,
    validate: validatePersonName,
  },
  {
    id: 'person-signoff',
    type: 'PERSON',
    pattern:
      /\b(?:Regards|Best regards|Kind regards|Warm regards|Thanks|Thank you|Sincerely|Cheers|Best)[,!.]?[ \t]*\r?\n[ \t]*([A-Z][a-z]+(?:[ \t]+[A-Z][a-z]+){0,2})(?=[ \t]*(?:\r?\n|$))/dg,
    group: 1,
    confidence: 0.75,
    validate: validatePersonName,
  },
  {
    id: 'dob',
    type: 'DOB',
    pattern:
      /\b(?:DOB|D\.O\.B\.?|date of birth|birth ?date|born(?: on)?|birthday)[ \t]*[:\-–]?[ \t]*(\d{1,2}[/.\- ]\d{1,2}[/.\- ]\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2}(?:st|nd|rd|th)?[ \t]+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?,?[ \t]+\d{4}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?[ \t]+\d{1,2}(?:st|nd|rd|th)?,?[ \t]+\d{4})/dgi,
    group: 1,
    confidence: 0.9,
    validate: () => ok('Date next to a birth-date label'),
  },
  {
    id: 'address',
    type: 'ADDRESS',
    pattern:
      /(?<!\b(?:IP|IPv[46]|[Ee]-?mail|MAC|[Ww]eb|URL|[Ss]erver|[Rr]emote|[Ll]ocal|[Ii]nternet|[Mm]emory|[Rr]eturn|[Ww]allet|[Bb]roadcast|[Gg]ateway)[ \t])\b(?:[Aa]ddress|ADDRESS|[Rr]esides at|[Ll]ives at)[ \t]*[:\-–][ \t]*([^\r\n|;]{6,160}?)(?=[ \t]*(?:\r?\n|$|[|;]|[,.]?[ \t]+(?:Phone|Mobile|Mob|Tel|Email|E-mail|Contact|DOB|PAN|Aadhaar)\b))/dg,
    group: 1,
    confidence: 0.8,
    validate: () => ok('Text after an address label'),
  },
];
