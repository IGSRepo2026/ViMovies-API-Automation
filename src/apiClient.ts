import { APIRequestContext, APIResponse, TestInfo, test } from '@playwright/test';
import { performance } from 'perf_hooks';
import { settings, Vars } from '../config/env';
import { Endpoint } from './endpoints';

const PLACEHOLDER = /^\{\{.*\}\}$/;
export const isUnset = (v: unknown) => v === undefined || v === null || v === '' || (typeof v === 'string' && PLACEHOLDER.test(v));

/** Header/body/query keys whose values never get written into reports. */
const REDACT = /^(session-id|authorization|cookie|password|otp|login_key|key|pin|data|metadata|identifier|reference_key|reference_id)$/i;

/** {{name}} is required; {{n
 * ame?}} is optional and resolves to '' when unset. */
export function resolveTemplate(tpl: string, vars: Vars, missing: Set<string>): string {
  return tpl.replace(/\{\{(\w+)(\?)?\}\}/g, (_, k: string, optional?: string) => {
    if (isUnset(vars[k])) {
      if (!optional) missing.add(k);
      return '';
    }
    return vars[k];
  });
}

export function resolveDeep<T>(value: T, vars: Vars, missing: Set<string>): T {
  if (typeof value === 'string') return resolveTemplate(value, vars, missing) as T;
  if (Array.isArray(value)) return value.map((v) => resolveDeep(v, vars, missing)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveDeep(v, vars, missing)])) as T;
  }
  return value;
}

export interface SendOptions {
  /** Override template variables for this call only */
  vars?: Partial<Vars>;
  /** Merge into resolved query; `undefined` removes a param */
  query?: Record<string, string | number | boolean | undefined>;
  /** Replace the body entirely. Strings are sent raw (e.g. malformed JSON). */
  body?: unknown;
  /** Merge into headers; `undefined` removes a header */
  headers?: Record<string, string | undefined>;
  method?: string;
  /** Override the path (templates allowed) */
  path?: string;
  /** Absolute URL override (skips base + path) */
  url?: string;
  maxRedirects?: number;
  label?: string;
}

export interface ApiResult {
  endpoint?: Endpoint;
  method: string;
  url: string;
  status: number;
  durationMs: number;
  headers: Record<string, string>;
  text: string;
  json: any;
  isJson: boolean;
  raw: APIResponse;
}

interface Prepared {
  method: string;
  url: string;
  params: Record<string, string>;
  headers: Record<string, string>;
  data?: unknown;
  missing: string[];
}

export class ApiClient {
  constructor(
    private readonly ctx: APIRequestContext,
    readonly vars: Vars,
    private readonly testInfo: TestInfo,
  ) {}

  prepare(ep: Endpoint, o: SendOptions = {}): Prepared {
    const v: Vars = { ...this.vars, timestamp: String(Date.now()) };
    for (const [k, val] of Object.entries(o.vars ?? {})) if (val !== undefined) v[k] = val;
    const missing = new Set<string>();

    const url = o.url ?? resolveTemplate(`{{${ep.base}}}`, v, missing) + resolveTemplate(o.path ?? ep.path, v, missing);

    const params: Record<string, string> = {};
    for (const [k, tpl] of Object.entries(ep.query ?? {})) params[k] = resolveTemplate(tpl, v, missing);
    for (const [k, val] of Object.entries(o.query ?? {})) {
      if (val === undefined) delete params[k];
      else params[k] = String(val);
    }

    // API headers are optional for public endpoints: omitted when not configured.
    const headers: Record<string, string> = {};
    if (ep.apiHeaders !== false) {
      headers['Content-Type'] = 'application/json; charset=utf-8';
      const hv: Array<[string, string]> = [['box-id', 'boxId'], ['tenant-code', 'tenantCode'], ['session-id', 'sessionId']];
      for (const [h, key] of hv) if (!isUnset(v[key])) headers[h] = v[key];
      // YVS rejects calls without a session token (error -23), so every API call needs one.
      if (!ep.noSession && isUnset(v.sessionId)) missing.add('sessionId');
    }
    for (const [k, val] of Object.entries(o.headers ?? {})) {
      const existing = Object.keys(headers).find((h) => h.toLowerCase() === k.toLowerCase());
      if (existing) delete headers[existing];
      if (val !== undefined) headers[k] = val;
    }

    let data: unknown;
    if ('body' in o) data = o.body;
    else if (ep.body) data = resolveDeep(ep.body, v, missing);

    // An explicit override satisfies a variable even if the template still references it.
    for (const k of Object.keys(o.vars ?? {})) if (!isUnset(o.vars![k])) missing.delete(k);
    return { method: o.method ?? ep.method, url, params, headers, data, missing: [...missing] };
  }

  /** Variables that must be configured before `ep` can be called with these options. */
  missingVars(ep: Endpoint, o: SendOptions = {}): string[] {
    return this.prepare(ep, o).missing;
  }

  /**
   * Skips the current test when data is missing or the endpoint is gated by a safety switch.
   * Call at the start of a test that sends the "real" (positive) request.
   */
  gate(ep: Endpoint, o: SendOptions = {}, extraVars: string[] = []) {
    test.skip(!!ep.stateChanging && !settings.allowStateChanging, `${ep.id} changes state - set ALLOW_STATE_CHANGING=true`);
    test.skip(!!ep.sensitive && !settings.allowSensitive, `${ep.id} is sensitive (OTP/credentials/payment) - set ALLOW_SENSITIVE=true`);
    test.skip(
      !!ep.requiresAuth && settings.anonymousSession && !o.vars?.sessionId,
      `${ep.id} needs a signed-in user - set SESSION_ID (only an anonymous AUTO_TOKEN session is available)`,
    );
    this.requireVars(ep, o, extraVars);
  }

  /** Skips only on missing data (for negative cases that are safe to send). */
  requireVars(ep: Endpoint, o: SendOptions = {}, extraVars: string[] = []) {
    const missing = [...this.missingVars(ep, o), ...extraVars.filter((k) => isUnset(this.vars[k]))];
    test.skip(missing.length > 0, `Missing test data: ${[...new Set(missing)].join(', ')} (see .env.example)`);
  }

  async send(ep: Endpoint, o: SendOptions = {}): Promise<ApiResult> {
    const p = this.prepare(ep, o);
    // Base URL must always resolve; other missing vars are allowed for negative tests (sent empty).
    if (p.missing.includes(ep.base)) throw new Error(`Base URL variable "${ep.base}" is not configured`);
    return this.raw(p.method, p.url, { params: p.params, headers: p.headers, data: p.data, maxRedirects: o.maxRedirects }, ep, o.label);
  }

  async raw(
    method: string,
    url: string,
    opts: { params?: Record<string, string>; headers?: Record<string, string>; data?: unknown; maxRedirects?: number } = {},
    ep?: Endpoint,
    label?: string,
  ): Promise<ApiResult> {
    const t0 = performance.now();
    const res = await this.ctx.fetch(url, {
      method,
      params: opts.params,
      headers: opts.headers,
      data: opts.data as any,
      maxRedirects: opts.maxRedirects,
      failOnStatusCode: false,
      timeout: settings.requestTimeoutMs,
    });
    const text = await res.text();
    const durationMs = Math.round(performance.now() - t0);
    const headers = res.headers();

    let json: any;
    let isJson = false;
    try {
      json = JSON.parse(text);
      isJson = true;
    } catch {
      /* non-JSON body */
    }

    const result: ApiResult = { endpoint: ep, method, url: res.url(), status: res.status(), durationMs, headers, text, json, isJson, raw: res };
    await this.record(result, opts.headers ?? {}, opts.data, label);
    return result;
  }

  private async record(r: ApiResult, reqHeaders: Record<string, string>, data: unknown, label?: string) {
    const name = label ?? r.endpoint?.id ?? 'request';
    this.testInfo.annotations.push({ type: 'response', description: `${name}: ${r.method} → ${r.status} in ${r.durationMs} ms` });
    if (r.status >= 500) this.testInfo.annotations.push({ type: '5xx', description: `${name} returned ${r.status}` });
    await this.testInfo.attach(`${name} (${r.status}, ${r.durationMs}ms)`, {
      contentType: 'application/json',
      body: JSON.stringify(
        {
          request: { method: r.method, url: redactUrl(r.url), headers: redact(reqHeaders), body: redact(data) },
          response: { status: r.status, durationMs: r.durationMs, headers: r.headers, body: r.text.slice(0, 4000) },
        },
        null,
        2,
      ),
    });
  }
}

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, REDACT.test(k) && v ? '***' : redact(v)]));
  }
  return value;
}

function redactUrl(u: string): string {
  try {
    const url = new URL(u);
    for (const k of [...url.searchParams.keys()]) if (REDACT.test(k)) url.searchParams.set(k, '***');
    return url.toString();
  } catch {
    return u;
  }
}
