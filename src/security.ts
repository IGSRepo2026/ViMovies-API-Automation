import { expect } from '@playwright/test';
import { ApiResult } from './apiClient';
import { allKeysDeep } from './assertions';

/** Field names that must never appear in an API response body. */
export const FORBIDDEN_RESPONSE_KEYS = ['password', 'pwd', 'passwd', 'otp', 'login_key', 'secret', 'private_key', 'client_secret'];

/** Secrets that should never be served to a client. */
export const SECRET_PATTERNS: RegExp[] = [
  /AKIA[0-9A-Z]{16}/, // AWS access key
  /-----BEGIN (RSA |EC |)PRIVATE KEY-----/,
  /\bsk_live_[0-9a-zA-Z]{16,}/, // payment live secret
  /\bxox[baprs]-[0-9A-Za-z-]{10,}/, // Slack token
  /\bAIza[0-9A-Za-z\-_]{35}\b/, // Google API key (often public, flagged for review)
];

/** Transport/browser hardening headers. Soft assertions: every missing header is reported. */
export function checkSecurityHeaders(r: ApiResult, opts: { html?: boolean } = {}) {
  const h = r.headers;
  expect.soft(h['strict-transport-security'], `HSTS header missing on ${r.url}`).toBeTruthy();
  if (h['strict-transport-security']) {
    const maxAge = Number(/max-age=(\d+)/i.exec(h['strict-transport-security'])?.[1] ?? 0);
    expect.soft(maxAge, 'HSTS max-age should be >= 6 months').toBeGreaterThanOrEqual(15_552_000);
  }
  expect.soft(h['x-content-type-options'], `X-Content-Type-Options: nosniff missing on ${r.url}`).toMatch(/nosniff/i);
  if (opts.html) {
    const framing = h['x-frame-options'] || (/frame-ancestors/i.test(h['content-security-policy'] ?? '') ? 'csp' : '');
    expect.soft(framing, `Clickjacking protection (X-Frame-Options / CSP frame-ancestors) missing on ${r.url}`).toBeTruthy();
  }
}

/** Server/framework fingerprinting. */
export function checkInfoDisclosure(r: ApiResult) {
  expect.soft(r.headers['x-powered-by'], `X-Powered-By discloses technology: ${r.headers['x-powered-by']}`).toBeFalsy();
  expect.soft(r.headers['x-aspnet-version'], 'X-AspNet-Version discloses version').toBeFalsy();
  const server = r.headers['server'] ?? '';
  expect.soft(server, `Server header discloses a version: "${server}"`).not.toMatch(/\d+\.\d+/);
}

/** CORS must not reflect an arbitrary origin, especially with credentials. */
export function checkCors(r: ApiResult, evilOrigin: string) {
  const acao = r.headers['access-control-allow-origin'];
  const creds = /true/i.test(r.headers['access-control-allow-credentials'] ?? '');
  expect(acao === evilOrigin && creds, `CORS reflects untrusted origin WITH credentials: ${acao}`).toBe(false);
  expect.soft(acao, `CORS reflects untrusted origin: ${acao}`).not.toBe(evilOrigin);
  expect(acao === '*' && creds, 'CORS wildcard combined with credentials').toBe(false);
}

export function checkNoSensitiveFields(r: ApiResult) {
  if (!r.isJson) return;
  const keys = [...allKeysDeep(r.json)].map((k) => k.toLowerCase());
  for (const f of FORBIDDEN_RESPONSE_KEYS) expect.soft(keys, `Response exposes sensitive field "${f}"`).not.toContain(f);
}

export function checkNoSecrets(r: ApiResult) {
  for (const p of SECRET_PATTERNS) expect.soft(r.text, `Response appears to contain a secret (${p})`).not.toMatch(p);
}

/** An injected payload must not come back verbatim in an HTML (renderable) response. */
export function checkNotReflectedAsHtml(r: ApiResult, payload: string) {
  const ct = r.headers['content-type'] ?? '';
  if (/html/i.test(ct)) expect(r.text, `Payload reflected unescaped in HTML: ${payload}`).not.toContain(payload);
  else expect.soft(ct, `Response with reflected payload should be JSON, not ${ct}`).not.toMatch(/html/i);
}

/** Template-injection payloads are wrapped in "qa" markers (qa{{7*7}}qa); "qa49qa" means they were evaluated. */
export function checkNotEvaluated(r: ApiResult) {
  expect(r.text, 'Server-side template expression was evaluated (SSTI)').not.toContain('qa49qa');
}

/** Session cookies must be hardened. */
export function checkCookieFlags(r: ApiResult) {
  const cookies = r.raw.headersArray().filter((h) => h.name.toLowerCase() === 'set-cookie').map((h) => h.value);
  for (const ck of cookies) {
    const name = ck.split('=')[0];
    expect.soft(ck, `Cookie ${name} missing Secure`).toMatch(/;\s*secure/i);
    if (/sess|token|auth|sid/i.test(name)) expect.soft(ck, `Cookie ${name} missing HttpOnly`).toMatch(/;\s*httponly/i);
    expect.soft(ck, `Cookie ${name} missing SameSite`).toMatch(/;\s*samesite=/i);
  }
}

/** Authenticated responses should not be cached by shared caches. */
export function checkNoStoreForPrivate(r: ApiResult) {
  const cc = r.headers['cache-control'] ?? '';
  expect.soft(cc, `Authenticated response is cacheable (Cache-Control: "${cc}")`).toMatch(/no-store|private|no-cache/i);
}
