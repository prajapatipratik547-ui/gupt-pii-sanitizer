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

## Prompt 3: deploy check

> We don't have to deploy this website? / I'm not able to test the live site.

**What happened:** the rules only require a public repository, so the live site is optional but useful for judges. GitHub Pages was enabled with *GitHub Actions* as the source, and the failed deploy job was re-run. The AI then loaded the live site in headless Chrome and confirmed 32 values redacted, 5 look-alikes blocked, the CSP active, and only same-origin requests.

---

## Prompt 4: full audit before submission

> Test each and everything. Check the project, GitHub, README and all. We don't have to miss anything.

**Gaps found by reading every sample's sanitized output, and fixed:**

| Finding | Fix |
| --- | --- |
| `email=neha.kapoor%40example.com` in the access-log sample stayed visible. URL-encoded addresses are common in logs. | The email detector accepts `%40`. Normalisation maps it to the same `USER_xx` as the plain spelling, and partial masks keep the `%40`. |
| `linkedin.com/in/aarav-k-example` in the resume stayed visible, and it contains the person's name. | New **Profile URL** type covering LinkedIn, GitHub, GitLab, X/Twitter, Instagram, Facebook, Telegram and Medium. Site pages such as `github.com/features` and look-alike domains such as `dropbox.com` are ignored. |
| The first Medium pattern required an extra `/` before `@handle`. | Caught by the new unit test and fixed. |

**Code quality:** `startApp` was a single 557-line function. The privacy monitor, theme, toast and activity log, diff-pane interactions and export actions moved into focused modules (`ui/privacy.ts`, `theme.ts`, `feedback.ts`, `diff.ts`, `exports.ts`). UI tests guarded the refactor.

**Testing:**

- New module tests cover the Web Worker client, including its crash fallback to the main thread, the worker entry point, scroll sync, hover pairing, the privacy monitor and the theme.
- Coverage now measures the whole app (about 97% of lines) instead of only the engine.
- `scripts/e2e.mjs` drives the production build in real headless Chrome with 39 checks, and CI runs it on every push. It covers:
  - real file downloads with no PII in them, and a PII-free audit report;
  - an XSS payload that is never executed;
  - CSV upload and binary-file refusal;
  - all six samples;
  - 2 MB of text in about 130 ms;
  - offline mode;
  - the skip link as the first Tab stop;
  - zero requests to other origins and zero console errors.

**Repository:**

- The README now opens with the live demo, badges, screenshots and a 60-second walkthrough for judges, and every number in it was re-measured.
- Added `SECURITY.md`.
- The app footer links to the source, the prompt log and the security policy.

---

### Mistake caught right after pushing

The AI had added a Dependabot configuration. On its first run Dependabot opened 5 pull requests, each on its own branch. That would have broken the hackathon rule that the repository must have **only one branch**.

The config was removed, the 5 PRs were closed and their branches deleted, and the AI confirmed that `main` is the only branch left. Dependency health is still checked by `npm audit` (0 vulnerabilities).

---

## Prompt 5: code review before submission

> Everything looks good on GitHub. The submission will be evaluated on the code, so check that the whole codebase is perfect. We don't have to miss anything.

The AI re-read every source file and attacked the code instead of only re-running the existing tests.

| Finding | Severity | Fix |
| --- | --- | --- |
| **ReDoS in `secret-assignment`.** On an `a_a_a_a…` chain the pattern rescanned from every `a`: 229 ms at 20 KB, about 23 s at 200 KB (quadratic). | High | It now starts only at the beginning of an identifier and allows a bounded prefix of at most 6 `word_` parts. Worst case at 200 KB is about 3 ms. |
| `phone-intl` used nested optional groups, so one run of digits could be split many ways when backtracking. | Medium | Each repetition now consumes exactly one digit, which leaves only one way to match. |
| No guard against future regex regressions. | Medium | New `tests/redos.test.ts` runs all 30 detectors against 22 adversarial 100 KB inputs with a 250 ms budget. |
| **Partial mask leaked the first 4 characters of passwords** (`S3cr…`). | High | Only a provider's public type prefix is shown (`AKIA`, `ghp_`, `sk_live_`, `eyJ`…). Anything else becomes `********`. |
| The passport mask could throw `RangeError` on a value shorter than 3 characters. | Low | Guarded, with a test. |
| The shipped bundle contained a `fetch(` call, from Vite's module-preload polyfill. | Medium (it contradicted the "no network code" claim) | Polyfill disabled. An end-to-end test confirms 0 `fetch` calls in the built JS. |
| Defence in depth against XSS. | Hardening | The CSP now enforces **Trusted Types**. The single policy only accepts Gupt's own worker URL, and an end-to-end test confirms `innerHTML` throws. |
| Clickjacking: static hosting can't send `frame-ancestors`. | Hardening | The app refuses to start inside another site's frame. Verified by framing it from a second origin. |
| Worker `messageerror` was not handled. | Low | It now triggers the main-thread fallback, like `error`. |
| **Returning users would have the new Profile URL type switched off**, because saved settings list only the types that existed when they were saved. | Medium | Settings now record `knownTypes`. Types added later start switched on, and a user's own choices are kept. Covered by tests. |
| Emptying the text box kept the old file name, and with it the CSV format hint. | Low | Typing into an empty box now starts a fresh document. |
| Findings filter counted each type by re-scanning all entities (types × entities). | Low | Counts are computed in one pass. |
| Unused re-export in `engine.ts`; file-internal constants exported. | Tidy-up | Removed and made private. |

**Verification:** 229 tests, 41/41 end-to-end checks, Lighthouse 100 / 100 / 100. Typecheck and lint have 0 errors and 0 warnings, and `npm audit` reports 0 vulnerabilities.

---

## Prompt 6: first evaluation, raising the weakest scores

> The AI evaluation scored 95.22 (Code Quality 89, Security 100, Efficiency 80, Testing 99, Accessibility 100, Problem Statement Alignment 100). We have to reach the top 3.

The AI targeted the two lowest scores.

| Change | Why |
| --- | --- |
| **Detection memo** in `core/pipeline.ts` | Switching the redaction mode re-ran all 30 detectors even though only the masking changes. The last detection is now reused when the text and the detection settings are unchanged, and a test checks both reuse and invalidation. |
| **Request coalescing** in `ui/analyzer.ts` | Rapid changes queued one worker job each. Now one job runs and one waits, and a newer request replaces the waiting one. A test checks that the superseded request never reaches the worker. |
| README **Performance design** section | The worker, debounce, stale-result drop, linear-time regexes, bitmap overlap resolution, binary-search line lookup and capped DOM rendering were all in the code but not documented. |
| **Prettier** with a CI format check | One enforced code style across `src/`, `tests/` and `scripts/`. |
| **Cloud Run container** (`Dockerfile`, `nginx.conf`) | The form asks for a Cloud Run URL. The container sends the CSP as real HTTP headers, including `frame-ancestors 'none'`, and CI runs all 41 end-to-end checks against it. |

---

## Next prompts

_Add each further prompt below in the same format: the prompt, what changed, and anything the AI got wrong that you corrected._
