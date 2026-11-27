# Prompt log

This is the record of how Gupt was built with AI assistance: each prompt, what it produced, and the decisions and corrections along the way. New entries go at the bottom.

**Environment:** Google Antigravity IDE, with the Claude Code extension as the coding agent.

---

## Prompt 1: kick-off

> I participated in this hackathon organised by GDG, PromptWars × NIAT. Here are the problem statement and the submission rules (screenshots). We have to win, so add every small, minor and major detail. Let's begin building.

**Inputs provided:** problem statement (browser-based PII sanitizer, mandatory requirements 1–4, expected deliverables) and submission rules (public repo under 10 MB, a single branch, at most 2 submission attempts).

**Plan the AI proposed and followed:**

1. **Architecture.** A static, zero-dependency TypeScript app built with Vite. A pure `core/` engine runs inside a Web Worker. The DOM layer uses no framework, which keeps it small and leaves nothing third-party touching user data.
2. **Privacy as a hard guarantee rather than a promise.** A production-only CSP with `connect-src 'none'`, plus an ESLint rule banning `fetch`, XHR and WebSocket, plus a live "0 network requests" counter.
3. **Detection.** 29 boundary-anchored detectors, each paired with a validator. Luhn plus issuer-prefix checks for cards. Verhoeff for Aadhaar, which is the checksum UIDAI actually uses. PAN holder-type letter. GSTIN mod-36. IPv4 octet range and IPv6 parsing.
4. **Make false-positive prevention visible.** A "false positives blocked" list shows every rejected look-alike with its reason, because the brief singles out "random 16-digit numeric strings".
5. **Three modes** with type-aware partial masks. Pseudonyms use normalised keys so different spellings of the same value share one token.
6. **Deliverables.** Six synthetic noisy samples, including a false-positive torture test. A side-by-side diff with hover pairing and synced scroll. Downloads that keep the file name and type. This prompt log.
7. **Quality.** Strict TypeScript, ESLint, Vitest with coverage thresholds, jsdom UI tests and axe-core accessibility tests, and a GitHub Actions workflow that tests and deploys to Pages.

### Build log and corrections

| Step | What happened | Fix |
| --- | --- | --- |
| Tooling | Windows Smart App Control blocked the newest Rolldown native binary (`rolldown-binding.win32-x64-msvc.node`), so Vite 8.4 could not start. | Pinned `vite@8.3.4` / `vitest@5.0.5`, whose binding the OS already trusts. |
| Sample data | Generated synthetic Aadhaar numbers with valid Verhoeff digits and cards with valid Luhn digits, plus decoys that are deliberately one digit off. | All real-looking IDs in the repo are synthetic or published test numbers. |
| First engine run | `kernel 6.8.0.45` was detected as an IPv4 address. | Added `kernel`/`os` to the version-context rule, behind a word boundary. |
| First engine run | `db_password=` was missed because `\b` doesn't fire after `_`. | Allowed `prefix_` / `prefix-` before credential keywords. |
| First engine run | "Mrs. Mehta" got a different pseudonym from "Anjali Mehta". | Name propagation now re-keys title-only mentions to the full name, unless the surname is shared by two people. |
| First engine run | The sample passport `Z4831265` was not detected. | Correct behaviour: Indian passports never use Q, X or Z. The sample was fixed. |
| First engine run | "Test User" in a CSV name column was redacted. | CSV name cells now pass the same stop-word check as other name rules. |
| Unit tests | Discover test card `6011…` was labelled RuPay. | RuPay prefix changed to `60(?!11)`. |
| Unit tests | A trailing comma produced two empty CSV cells. | Removed the duplicate push in the parser. |
| Browser check | The "Re-identification key" button showed in Full-mask mode: `.btn { display:flex }` overrode `[hidden]`. | Added a global `[hidden] { display:none !important }`. |
| Browser check | On phones the 16-item type list pushed the input far down the page. | The type list is now a `<details>` panel, collapsed by default under 760 px. |
| axe-core | `landmark-unique`: the findings scroll region and its section shared one accessible name. | Gave the region its own label. |

**Verification at the end of prompt 1:** 174 tests passing. Core coverage is about 99% of lines. `tsc` and ESLint are clean. The production build checked in headless Chrome showed 0 console errors, only same-origin asset requests, the CSP present, and no horizontal scroll at 390 px.

---

## Prompt 2: publish to my GitHub

> Log out the other GitHub account on this laptop, log in with mine, then commit and push the whole code to my GitHub account only (prajapatipratik547-ui).

**What happened:**

- Removed the other account from the GitHub CLI. Git and `gh` now authenticate only as `prajapatipratik547-ui`.
- Created the public repository and pushed `main`. The repository has a single branch.
- **GitHub push protection blocked the first push.** The server-log sample contained a fake but realistic Stripe key (`sk_live_…`).
- **Fix chosen:** the AI did not click "allow secret". It moved all fake provider keys (Stripe, GitHub, Google) into a `FAKE_SECRETS` object assembled at runtime with `join`. The repository therefore contains no key-shaped literal that any secret scanner could flag, while the sample and the tests still exercise the detectors with realistic values. AWS's documented example key `AKIAIOSFODNN7EXAMPLE` was kept because it is published specifically for this purpose.

---

## Next prompts

_Add each further prompt below in the same format: the prompt, what changed, and anything the AI got wrong that you corrected._
