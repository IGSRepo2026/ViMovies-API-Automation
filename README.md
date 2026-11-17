# VIMTV API – Playwright automation

Data-driven Playwright (TypeScript) API suite generated from **VIMTV Web API Collection – Updated from HAR + YVS APIs v1.2**
(45 requests → 44 unique endpoints in 8 groups; Active Packages appears twice).

| Coverage | Where |
|---|---|
| +ve / -ve / edge flows per endpoint | `tests/01…08-*.spec.ts` |
| HTTP **2XX / 3XX / 4XX / 5XX** matrix | `tests/09-status-codes.spec.ts` |
| Basic security (OWASP API Top 10 oriented) | `tests/10-security.spec.ts` |
| Response time (per request + p95 sampling) | every request + `tests/11-performance.spec.ts` |

608 tests. Tags: `@smoke @positive @negative @edge @status @security @perf`.

## Quick start

```bash
npm install
```
```bash
cp .env.example .env
```
```bash
npm run test:smoke
```
```bash
npm run report
```

All test runs also write Allure results to `reports/allure-results`. Generate and open the Allure HTML report with:

```bash
npm run allure:generate
npm run allure:open
```

The Allure CLI runs on the project's Node.js runtime and does not require Java.

Other scripts: `test`, `test:positive`, `test:negative`, `test:edge`, `test:status`, `test:security`, `test:perf`, `list`, `typecheck`, `allure:generate`, `allure:open`.

## Parameterisation

Every value, including all URLs, is a `{{variable}}`, resolved in this order:

1. `config/environments/<TEST_ENV>.json` – the defaults from the collection (`prod.json`, plus a `staging.json` template).
2. `.env` / process env – any collection variable in UPPER_SNAKE_CASE (`apiBaseUrl` → `API_BASE_URL`, `sessionId` → `SESSION_ID`).
3. Per-test overrides in code (`api.send(ep, { vars, query, headers, body })`).

Test inputs (search terms, boundaries, invalid values, security payloads) live in `test-data/testdata.json`.
`{{name?}}` marks an optional variable. A test whose required data is still a `{{SET_…}}` placeholder is **skipped**, and the skip reason names the variable to set.

## Session handling (observed on the live API)

- Every YVS call without a session token gets **HTTP 200** with `{"status":false,"error":{"code":-23,"message":"RES_S_ERROR_SIGNIN_REQUEST_TOKEN"}}`.
- With `AUTO_TOKEN=true` (the default), global setup calls **Get Token** with a generated `qa-<uuid>` box id and shares the anonymous `sessionId` with all workers.
- If a configured `SESSION_ID` is rejected as expired, global setup obtains an anonymous token for public tests instead; tests requiring signed-in data still need a valid user session.
- Endpoints marked `requiresAuth` (user info, favourites, packages, playback, devices…) need a **signed-in** `SESSION_ID`. With only an anonymous session they skip.
  - Package Catalogue was observed to answer `-1000 "You are not logged in"`, so it is in this group.

## Verification model

- **Positive:** HTTP 2XX, JSON body, success envelope (`status` ∈ successValues, no `error`), endpoint-specific body checks, and response time within SLA.
- **Negative:** must be refused and must never return 5XX.
  - Default (`STRICT_HTTP_ERRORS=false`): HTTP 4XX **or** HTTP 2XX with a failure envelope. The live API returns 200 + `status:false` for errors.
  - `STRICT_HTTP_ERRORS=true` requires a real 4XX.
- **Edge:** boundaries, empty, long, unicode, special characters, wrong types and malformed JSON. These must be handled gracefully: no 5XX, no stack traces or DB errors in the response.
- **Envelope field names:** set in `bodyContract` in the environment JSON.
- **SLA:** `sla.defaultMs` and per-endpoint `sla.overrides`, or the `DEFAULT_SLA_MS` env var. Every response time is annotated in the HTML report.

## Status-code matrix

- **2XX:** sweep of every read-only endpoint, plus HEAD. Missing endpoint data triggers an incomplete-input fallback check instead of skipping; protected endpoints with an anonymous token verify either a successful response or an expected auth rejection.
- **3XX:** HTTP→HTTPS redirect per host, web root and logout redirects, and redirect following and limits.
- **4XX:** 404 unknown route or build, 405 wrong method, 400 malformed JSON, 415 content type, 401/403 missing or forged session, 413 oversized body, oversized URL.
- **5XX:**
  - A fuzz sweep asserting no endpoint 5XXs on malformed input.
  - `FAULT_INJECTION_URL` checks that a forced 5XX is clean. If it is unset, the test performs a graceful-handling check on system config and annotates that fault injection was not exercised.
  - Any 5XX body must be free of internals.

## Performance checks

The performance suite samples read-only endpoints only. When signed-in access or endpoint-specific values are unavailable, it measures a safe invalid-session or invalid-input fallback instead of skipping. Reports label these as `safe-fallback`; they measure graceful fallback latency, not a valid signed-in/content flow.

## Security checks

- **Transport and headers:** HTTPS only, HSTS, nosniff, clickjacking protection, CSP, Server/X-Powered-By disclosure, JSON Content-Type, cookie flags.
- **Access control:**
  - CORS with an untrusted origin, including the preflight.
  - Every protected endpoint must refuse a missing, empty, unknown or tampered session (SQLi, `alg:none` JWT).
  - Session id passed in the query string must not be accepted.
  - IDOR on order status.
- **Injection:**
  - SQL, NoSQL, XSS, command, SSTI and CRLF payloads in query parameters.
  - Injection in sign-in JSON, including NoSQL operator objects.
  - Path traversal in page paths and Next.js routes.
- **Data exposure and abuse:**
  - No secrets or sensitive fields in responses, and no `Cache-Control` caching of private responses.
  - Credentials must not be echoed back in errors.
  - Open redirect via logout.
  - Secrets in URLs (flags `VALIDATE_PASSCODE ?key=`).
  - Passcode brute-force, and OTP rate limiting (opt-in).

## Safety switches (all off by default)

| Flag | Enables |
|---|---|
| `ALLOW_STATE_CHANGING` | favourites add/delete, session preference, TV activation, end stream, sign-out (uses `SIGNOUT_SESSION_ID`), delink |
| `ALLOW_SENSITIVE` | OTP dispatch, sign-up, sign-in, checkout, delink |
| `RUN_RATE_LIMIT_TESTS` | repeated OTP requests (also needs `ALLOW_SENSITIVE`) |

In `01-auth.spec.ts`, positive flows that lack the required safety switch, signed-in session, or test data run a safe invalid-session rejection check instead of being skipped. These fallback checks do not send OTPs or change account state; they are not substitutes for verifying a successful positive flow.

Negative and security requests to state-changing endpoints are always sent with an **invalid** session, so they cannot change data.
Run the full negative, edge and security suites only against environments you are authorised to test, preferably staging (`TEST_ENV=staging`).

## Layout

```
config/env.ts                 env + .env loading, flags
config/environments/*.json    URLs, defaults, body contract, SLAs
test-data/testdata.json       inputs, boundaries, payloads
src/endpoints.ts              endpoint registry (traceable to collection/PDF)
src/apiClient.ts              templating, request, timing, redacted report attachments
src/assertions.ts             status class / body / SLA / leak assertions
src/security.ts               security header, CORS, cookie, exposure checks
src/suites.ts                 reusable +ve / -ve / edge generators
src/globalSetup.ts            AUTO_TOKEN anonymous session bootstrap
tests/*.spec.ts               specs
```

Reports go to `reports/` (Playwright HTML, JSON, JUnit, and Allure results/HTML). Session ids, OTPs, passwords, login keys and passcodes are redacted from attachments.

## Open items from the collection

- **Search bucket:** PDF API 33 (TV show videos) reuses `bucket=grouplist`. Confirm the intended bucket.
- **State-changing GETs:** Favourite add/delete are GET requests that change state. This is flagged by the source document too.
- **Encrypted payloads:** Encrypted sign-in and linked-devices payloads must be generated by the client; the tests use them as opaque values.
- **Next.js routes:** `nextBuildId` changes with every web deployment.

## Requirements Traceability Matrix

`docs/VIMTV_API_RTM.xlsx` is generated from the live test inventory. Regenerate it after changing tests or running them:

```bash
npm run rtm
```

| Sheet | Contents |
|---|---|
| Read Me | Sources, legend, overall counts |
| API Summary | One row per API: test count per requirement category, pass/fail/skip, coverage % |
| Requirements | One row per API × category (`REQ-API-nn-FR/VAL/EDG/HTTP/SEC/PERF`) with linked test case IDs and status |
| RTM Detail | One row per API × test case: expected result, what it verifies (status code / body / response time / security), preconditions, safety gate, file:line, last result |

The Last Result column comes from `reports/results.json`, which every `npm test*` run writes. The generator needs Node ≥ 22.18 because it loads `src/endpoints.ts` directly.
