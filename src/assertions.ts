import { expect } from '@playwright/test';
import { settings } from '../config/env';
import { ApiResult } from './apiClient';
import { Endpoint } from './endpoints';

export type StatusClass = '2XX' | '3XX' | '4XX' | '5XX';
export const statusClass = (s: number): StatusClass => `${Math.floor(s / 100)}XX` as StatusClass;

const c = () => settings.bodyContract;

/** Patterns that indicate stack traces, DB errors or internal paths leaking in a response. */
export const LEAK_PATTERNS: RegExp[] = [
  /at [\w$.]+\([\w$]+\.java:\d+\)/,
  /Traceback \(most recent call last\)/,
  /Exception in thread/,
  /\b(NullPointerException|SQLException|PSQLException|MySQLSyntaxErrorException|IllegalStateException)\b/,
  /You have an error in your SQL syntax/i,
  /\bORA-\d{5}\b/,
  /SQLSTATE\[/,
  /MongoError|MongoServerError/,
  /<b>(Warning|Fatal error)<\/b>:/,
  /\/(home|var\/www|usr\/local|opt)\/[\w.-]+\//,
  /node_modules\//,
  /root:x:0:0:/,
];

/* ---------------- body contract helpers ---------------- */

export function bodyStatus(json: any): unknown {
  return json && typeof json === 'object' ? json[c().statusField] : undefined;
}

export function isBodySuccess(json: any): boolean {
  if (!json || typeof json !== 'object') return false;
  if (c().statusField in json) return c().successValues.includes(json[c().statusField]);
  if ('success' in json) return json.success === true;
  return !hasError(json);
}

export function isBodyFailure(json: any): boolean {
  if (!json || typeof json !== 'object') return false;
  if (c().statusField in json && c().failureValues.includes(json[c().statusField])) return true;
  if ('success' in json && json.success === false) return true;
  return hasError(json);
}

export function isRegionUnavailable(r: Pick<ApiResult, 'json'>): boolean {
  return Number(r.json?.error?.code) === -16;
}

function hasError(json: any): boolean {
  const err = json[c().errorField];
  return !!err && (typeof err !== 'object' || Object.keys(err).length > 0);
}

export const bodyData = (json: any) => (json && typeof json === 'object' ? json[c().dataField] : undefined);

/* ---------------- generic deep helpers ---------------- */

export function findKeyDeep(obj: any, keys: string[], depth = 0): any {
  if (!obj || typeof obj !== 'object' || depth > 8) return undefined;
  for (const k of keys) if (k in obj && obj[k] !== undefined && obj[k] !== null && obj[k] !== '') return obj[k];
  for (const v of Object.values(obj)) {
    const found = findKeyDeep(v, keys, depth + 1);
    if (found !== undefined) return found;
  }
  return undefined;
}

export function firstArrayDeep(obj: any, depth = 0): any[] | undefined {
  if (Array.isArray(obj)) return obj;
  if (!obj || typeof obj !== 'object' || depth > 6) return undefined;
  for (const v of Object.values(obj)) {
    const found = firstArrayDeep(v, depth + 1);
    if (found) return found;
  }
  return undefined;
}

export function allKeysDeep(obj: any, out = new Set<string>(), depth = 0): Set<string> {
  if (!obj || typeof obj !== 'object' || depth > 10) return out;
  for (const [k, v] of Object.entries(obj)) {
    if (!Array.isArray(obj)) out.add(k);
    allKeysDeep(v, out, depth + 1);
  }
  return out;
}

/* ---------------- assertions ---------------- */

const ctx = (r: ApiResult) => `${r.method} ${r.url} → ${r.status} (${r.durationMs}ms)\n${r.text.slice(0, 500)}`;

export function expectStatusClass(r: ApiResult, cls: StatusClass | StatusClass[]) {
  const allowed = Array.isArray(cls) ? cls : [cls];
  expect(allowed, `Expected HTTP ${allowed.join('/')}: ${ctx(r)}`).toContain(statusClass(r.status));
}

export function expectStatusIn(r: ApiResult, codes: number[]) {
  expect(codes, `Expected one of ${codes.join(',')}: ${ctx(r)}`).toContain(r.status);
}

export function expectNo5xx(r: ApiResult) {
  expect(r.status, `Server error (5XX) for handled input: ${ctx(r)}`).toBeLessThan(500);
}

/** Body must parse as JSON. (Content-Type correctness is a security check - see 10-security.) */
export function expectJson(r: ApiResult) {
  expect(r.isJson, `Body should parse as JSON: ${ctx(r)}`).toBe(true);
}

export function expectJsonContentType(r: ApiResult) {
  expect.soft(r.headers['content-type'] ?? '', `JSON body served with non-JSON Content-Type: ${r.method} ${r.url}`).toMatch(/application\/json/i);
}

export function expectWithinSla(r: ApiResult, ep?: Endpoint) {
  const sla = slaFor(ep);
  expect.soft(r.durationMs, `Response time ${r.durationMs}ms exceeds SLA ${sla}ms: ${r.method} ${r.url}`).toBeLessThanOrEqual(sla);
}

export function slaFor(ep?: Endpoint): number {
  if (!ep) return settings.defaultSlaMs;
  return settings.slaOverrides[ep.id] ?? ep.slaMs ?? settings.defaultSlaMs;
}

export function expectNoLeak(r: ApiResult) {
  for (const p of LEAK_PATTERNS) expect(r.text, `Response leaks internals (${p}): ${ctx(r)}`).not.toMatch(p);
}

/** Positive flow: 2XX, JSON, success envelope, within SLA, no leaks. */
export function expectSuccess(r: ApiResult, ep: Endpoint) {
  expectStatusClass(r, '2XX');
  const contract = ep.contract ?? 'yvs';
  if (contract !== 'any') expectJson(r);
  if (contract === 'yvs') {
    expect(isBodySuccess(r.json), `Body should report success (${c().statusField}=${JSON.stringify(bodyStatus(r.json))}): ${ctx(r)}`).toBe(true);
    expect(isBodyFailure(r.json), `Successful body must not carry an error object: ${ctx(r)}`).toBe(false);
  }
  if (contract === 'next') {
    expect(r.json, `Next.js data should contain pageProps: ${ctx(r)}`).toHaveProperty('pageProps');
  }
  expectWithinSla(r, ep);
  expectNoLeak(r);
}

/**
 * Negative flow: request must be refused.
 * STRICT_HTTP_ERRORS=true → HTTP 4XX required.
 * Otherwise → HTTP 4XX, or HTTP 2XX with a failure envelope (common for YVS APIs). Never 5XX.
 */
export function expectRejected(r: ApiResult, allowedCodes?: number[]) {
  expectNo5xx(r);
  expectNoLeak(r);
  if (allowedCodes && statusClass(r.status) === '4XX') {
    expect.soft(allowedCodes, `Unexpected 4XX code: ${ctx(r)}`).toContain(r.status);
  }
  const expected = settings.strictHttpErrors ? 'HTTP 4XX' : '4XX or failure body';
  expect(isRejection(r), `Expected rejection (${expected}) but got: ${ctx(r)}`).toBe(true);
}

/** The gateway answers unroutable / malformed requests with HTTP 200 and this plain-text body. */
export const isUnmatchedPath = (r: { text?: string }) => /^\s*unmatched path\s*$/i.test(r.text ?? '');

export function isRejection(r: Pick<ApiResult, 'status' | 'json'> & { text?: string }): boolean {
  const cls = statusClass(r.status);
  if (settings.strictHttpErrors) return cls === '4XX';
  return cls === '4XX' || (cls === '2XX' && (isBodyFailure(r.json) || isUnmatchedPath(r)));
}

/** Edge flow: the server may accept or refuse, but must handle it gracefully. */
export function expectHandled(r: ApiResult) {
  expectNo5xx(r);
  expectNoLeak(r);
  if (statusClass(r.status) === '2XX' && /json/i.test(r.headers['content-type'] ?? '')) {
    expect(r.isJson, `Body declared JSON but did not parse: ${ctx(r)}`).toBe(true);
  }
}

/** A list returned for a request must not exceed the requested page size / count. */
export function expectListSizeAtMost(r: ApiResult, max: number) {
  const list = firstArrayDeep(bodyData(r.json) ?? r.json);
  if (list) expect.soft(list.length, `Returned ${list.length} items, requested at most ${max}`).toBeLessThanOrEqual(max);
}
