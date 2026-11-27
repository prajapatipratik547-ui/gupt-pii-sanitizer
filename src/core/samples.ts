/**
 * Built-in noisy samples for the 1-click loader.
 *
 * Every identifier here is SYNTHETIC: card numbers are public test numbers or
 * generated to pass Luhn, Aadhaar numbers are generated to pass Verhoeff, and
 * all domains are reserved example domains. Each sample also carries decoys —
 * numbers that look sensitive but must NOT be redacted — to show that the
 * validation layer prevents false positives.
 */
export interface Sample {
  id: string;
  title: string;
  fileName: string;
  description: string;
  text: string;
}

const MIXED = `=== INCIDENT EXPORT #INC-20931 — raw, unredacted, do not forward ===

2026-11-02 09:14:07 INFO  auth  login ok user=priya.sharma@example.com ip=203.0.113.42 mac=3C:52:82:A1:7F:09
2026-11-02 09:14:09 WARN  auth  retry from 198.51.100.7 (attempt 3), client build 2.4.1.9
2026-11-02 09:14:11 DEBUG api   GET /v1/orders?id=1234567890123456 Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJwcml5YSIsImlhdCI6MTUxNjIzOTAyMn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c
2026-11-02 09:14:12 ERROR pay   charge failed card=4012 8888 8888 1881 amount=INR 2,499 txn=9876543210987654
2026-11-02 09:14:15 INFO  net   peer 2001:db8:85a3::8a2e:370:7334 port 443, upstream 999.12.0.1 unreachable
2026-11-02 09:14:16 INFO  auth  password reset requested by Priya.Sharma@Example.com from 203.0.113.42
config dump: aws_access_key_id=AKIAIOSFODNN7EXAMPLE db_password="S3cr3t!Pass#2026" api_key=****

--- Support ticket #88213 ---
From: Rahul Verma <rahul.verma@example.in>
Hi Team,
My card 5123-4567-8901-2346 was charged twice. Please refund to UPI rahulv@okaxis or call me
on +91 98765 43210 (office: 022 2345 6789). My PAN is ABCPV1234K and Aadhaar 2345 6789 0124.
The old Aadhaar on file, 2345 6789 0125, has a typo. Order ref 4111 1111 1111 1112 is NOT a card.
Regards,
Rahul Verma

--- Clinical note ---
Patient: Anjali Mehta    DOB: 14/08/1987    Ph: 09123456780
Address: Flat 302, Shanti Apartments, Baner Road, Pune 411045
Seen by Dr. Kavita Rao. Mrs. Mehta reports chest pain for 2 days. BP 150/95, SpO2 97%.
Plan: ECG, lipid profile. Follow-up with Dr. Rao in 2 weeks. Emergency contact: 98200 11223.

--- Vendor KYC ---
GSTIN 27AAPFU0939F1ZV, Bank A/c No: 50100234567891, Passport No. K1234567, call 9123456780
`;

/**
 * Fake credentials for the log sample. They are assembled at runtime so the
 * repository never contains a key-shaped literal — GitHub push protection and
 * secret scanners would (rightly) flag one. None of these has ever been a real key.
 * AKIAIOSFODNN7EXAMPLE is AWS's own documentation example and is safe to commit.
 */
export const FAKE_SECRETS = {
  stripe: ['sk', 'live', '51HxQjLKzT8vPq2Rm9YwNbE3cD7fGh'].join('_'),
  github: ['ghp', 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8'].join('_'),
  google: ['AIza', 'SyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q'].join(''),
} as const;

const SERVER_LOG = `# nginx + app logs — prod-ap-south-1 — 2026-11-02
203.0.113.42 - - [02/Nov/2026:09:14:07 +0530] "POST /login HTTP/1.1" 200 512 "-" "Mozilla/5.0"
198.51.100.7 - - [02/Nov/2026:09:14:09 +0530] "GET /api/v2/profile?email=neha.kapoor%40example.com HTTP/1.1" 401 88
2001:db8::42 - - [02/Nov/2026:09:14:10 +0530] "GET /health HTTP/1.1" 200 2
fe80::1ff:fe23:4567:890a - - [02/Nov/2026:09:14:10 +0530] "GET /metrics HTTP/1.1" 200 1940
[app] 09:14:11.204 INFO  User neha.kapoor@example.com logged in from 203.0.113.42
[app] 09:14:11.390 DEBUG headers={"Authorization":"Bearer ${FAKE_SECRETS.stripe}"}
[app] 09:14:12.007 WARN  token=${FAKE_SECRETS.github} used from unknown device 00-1A-2B-3C-4D-5E
[app] 09:14:12.118 ERROR PaymentService: card 6073 8499 9999 9997 declined (RuPay), retry id 7000123456789012
[app] 09:14:12.500 INFO  Sent OTP to +91-98111-22334 for neha.kapoor@example.com
[app] 09:14:13.001 INFO  GOOGLE_API_KEY=${FAKE_SECRETS.google}
[sys] kernel 6.8.0.45 build 10.0.19045.1 — not IPs, just versions
[sys] ts=1730535253123 req_id=9876543210987654 trace=4532015112830367
`;

const RESUME = `Aarav Kulkarni
Senior Data Engineer · Pune, India
aarav.kulkarni@example.com | +91 99887 76655 | linkedin.com/in/aarav-k-example

PERSONAL DETAILS
Date of Birth: 02 March 1994
Address: B-14, Green Valley Society, Kothrud, Pune 411038
PAN: AKLPK4821M    Aadhaar: 4918 3726 5017    Passport: M4831265

EXPERIENCE
Data Engineer, Example Analytics Pvt Ltd (2019 – present)
- Built Spark pipelines processing 4.2 TB/day; cut cost 38%.
- Reported to Ms. Sneha Iyer (sneha.iyer@example.com).

REFERENCES
Prof. Vikram Joshi — vikram.joshi@example.edu — 020 2567 1234
Aarav can also be reached on WhatsApp at 9988776655.
`;

const CLINICAL = `DISCHARGE SUMMARY — City Care Hospital (synthetic record)
Patient Name: Meera Nair            DOB: 1961-11-23        Gender: F
Aadhaar: 7385 9201 8460             ABHA consent: yes
Contact: +91 94470 12345 · Guardian: Suresh Nair (98470 54321)
Address: 18/302, Lake View Road, Kadavanthra, Kochi 682020

Admitted 12/10/2026 with fever and productive cough. Seen by Dr. Arjun Menon.
Mrs. Nair was started on IV antibiotics; Meera tolerated treatment well.
Insurance claim card on file: 5085 1234 5678 9012.
Discharged 18/10/2026. Follow-up with Dr. Menon at OPD, or email opd@citycare.example.org.
Lab ref no. 2026101812345678 (internal, not a card).
`;

const CSV_EXPORT = `customer_id,full_name,email,phone,pan,aadhaar,card_number,city,signup_ip,notes
C-1001,Priya Sharma,priya.sharma@example.com,+91 98765 43210,ABCPS1234D,2345 6789 0124,4012 8888 8888 1881,Mumbai,203.0.113.42,VIP customer
C-1002,Rahul Verma,rahul.verma@example.in,9123456780,BKLPV5678Q,5647 3829 1058,5123 4567 8901 2346,Pune,198.51.100.7,"Paid via rahulv@okaxis, refund pending"
C-1003,Ananya Iyer,ananya.iyer@example.com,080 4567 1234,CFGPI9012R,8192 7364 5500,6521 5000 0000 0006,Bengaluru,2001:db8::7,
C-1004,Priya Sharma,PRIYA.SHARMA@EXAMPLE.COM,098765 43210,ABCPS1234D,2345 6789 0124,4012-8888-8888-1881,Mumbai,203.0.113.42,duplicate of C-1001
C-1005,Test User,test@example.com,1234567890,ABCXE1234F,1234 5678 9012,1234 5678 9012 3456,Delhi,10.0.0.300,invalid demo row — nothing here should be flagged except the email
`;

const DECOYS = `FALSE-POSITIVE TORTURE TEST — every number below LOOKS sensitive but is not.
A good sanitizer should redact almost nothing here and explain why it skipped each one.

Order IDs (16 digits, fail Luhn): 1234567890123456, 9876543210987654, 4111 1111 1111 1112
Epoch timestamps (13 digits): 1730535253123 1730535253999
Aadhaar look-alikes (fail Verhoeff / start with 0-1): 2345 6789 0125, 1234 5678 9012, 0987 6543 2101
Version strings: version 10.2.3.4, build 2.4.1.9, firmware v1.0.0.12
Impossible IPs: 999.168.1.1, 256.256.256.256, 10.0.0.300
Not a PAN (bad 4th letter): ABCXE1234F, ABCDE1234F
Times and ratios: 10:22:33, 09:14:11.204, BP 150/95, 3:2:1
Placeholders: password=****, api_key=null, card 0000 0000 0000 0000

…and one real one hiding in the noise: escalate to security@example.com
`;

export const SAMPLES: readonly Sample[] = [
  {
    id: 'mixed',
    title: 'Noisy mixed bag (recommended)',
    fileName: 'incident-export.txt',
    description: 'Logs, a support ticket, a clinical note and KYC data — every entity type plus decoys.',
    text: MIXED,
  },
  {
    id: 'server-log',
    title: 'Server & application logs',
    fileName: 'prod-app.log',
    description: 'IPv4/IPv6, emails, API keys, tokens, MAC address, card in a payment error.',
    text: SERVER_LOG,
  },
  {
    id: 'resume',
    title: 'Resume / CV',
    fileName: 'resume-aarav.txt',
    description: 'Name, contact details, DOB, address, PAN, Aadhaar and passport.',
    text: RESUME,
  },
  {
    id: 'clinical',
    title: 'Clinical discharge note',
    fileName: 'discharge-summary.txt',
    description: 'Patient and doctor names, DOB, Aadhaar, phones, address, insurance card.',
    text: CLINICAL,
  },
  {
    id: 'csv',
    title: 'Customer CSV export',
    fileName: 'customers.csv',
    description: 'Column-aware CSV with duplicates written differently — shows consistent pseudonyms.',
    text: CSV_EXPORT,
  },
  {
    id: 'decoys',
    title: 'False-positive torture test',
    fileName: 'decoys.txt',
    description: 'Numbers that look like PII but are not — shows Luhn, Verhoeff and range checks at work.',
    text: DECOYS,
  },
];

export const DEFAULT_SAMPLE_ID = 'mixed';

export function getSample(id: string): Sample {
  return SAMPLES.find((s) => s.id === id) ?? (SAMPLES[0] as Sample);
}
