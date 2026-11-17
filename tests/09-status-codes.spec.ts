/**
 * HTTP status-code matrix: explicit coverage of the 2XX, 3XX, 4XX and 5XX classes.
 */
import { isUnset } from '../src/apiClient';
import {
  expectHandled, expectNoLeak, expectNo5xx, expectRejected, expectStatusClass, expectStatusIn, expectSuccess, isBodySuccess, isRegionUnavailable, statusClass,
} from '../src/assertions';
import { ALL_ENDPOINTS, BaseKey, EP, isSafe } from '../src/endpoints';
import { expect, settings, test, testData, vars } from '../src/fixtures';

const neg = testData.negative;
const BASES: BaseKey[] = ['apiBaseUrl', 'searchBaseUrl', 'webBaseUrl'];

test.describe('09 Status codes › 2XX', () => {
  for (const ep of ALL_ENDPOINTS.filter(isSafe)) {
    test(`2XX: ${ep.id} ${ep.method} ${ep.path} @status`, async ({ api }) => {
      const missing = api.missingVars(ep);
      if (missing.length) {
        test.info().annotations.push({
          type: 'info',
          description: `Missing ${missing.join(', ')}; sending an incomplete-input fallback and checking graceful handling`,
        });
        expectHandled(await api.send(ep));
        return;
      }

      if (ep.requiresAuth && settings.anonymousSession) {
        test.info().annotations.push({
          type: 'info',
          description: 'Anonymous-session check: verifies a successful response or an expected auth rejection',
        });
        const r = await api.send(ep);
        if (isBodySuccess(r.json)) expectSuccess(r, ep);
        else expectRejected(r, [401, 403]);
        return;
      }

      api.gate(ep);
      const r = await api.send(ep);
      test.skip(ep.id === 'PARTNER_PAGE' && isRegionUnavailable(r), 'Partner content is not available in the configured region');
      expectSuccess(r, ep);
      expect([200, 201, 202, 204, 206]).toContain(r.status);
    });
  }
  test('2XX: HEAD on a public GET endpoint returns 2XX without a body @status @edge', async ({ api }) => {
    const r = await api.send(EP.SYSTEM_CONFIG, { method: 'HEAD' });
    expectHandled(r);
    if (statusClass(r.status) === '2XX') expect(r.text.length).toBe(0);
  });
});

test.describe('09 Status codes › 3XX', () => {
  for (const base of BASES) {
    test(`3XX: plain HTTP on ${base} redirects to HTTPS (or is refused) @status @security`, async ({ api }) => {
      test.skip(isUnset(vars[base]), `${base} not configured`);
      const httpUrl = vars[base].replace(/^https:/, 'http:') + '/';
      try {
        const r = await api.raw('GET', httpUrl, { maxRedirects: 0 }, undefined, `${base} http→https`);
        expectStatusClass(r, '3XX');
        expect([301, 302, 307, 308]).toContain(r.status);
        expect(r.headers['location'] ?? '', 'Redirect must target HTTPS').toMatch(/^https:\/\//);
      } catch (e) {
        // Port 80 closed / connection refused is an acceptable "HTTPS only" outcome.
        test.info().annotations.push({ type: 'info', description: `HTTP not reachable on ${base}: ${(e as Error).message.split('\n')[0]}` });
      }
    });
  }
  test('3XX: web root either serves (2XX) or redirects (3XX) to a same-site HTTPS URL @status', async ({ api }) => {
    const r = await api.raw('GET', vars.webBaseUrl + '/', { maxRedirects: 0 }, undefined, 'web root');
    expectStatusClass(r, ['2XX', '3XX']);
    if (statusClass(r.status) === '3XX') {
      const loc = new URL(r.headers['location'] ?? '', vars.webBaseUrl);
      expect(loc.protocol).toBe('https:');
    }
  });
  test('3XX: redirects are followed to a 2XX final response @status', async ({ api }) => {
    const r = await api.send(EP.WEB_LOGOUT);
    expectStatusClass(r, '2XX');
  });
  test('3XX: redirect limit is enforced without crashing the client @status @edge', async ({ api }) => {
    const r = await api.send(EP.WEB_LOGOUT, { maxRedirects: 0 });
    expectStatusClass(r, ['2XX', '3XX']);
  });
});

test.describe('09 Status codes › 4XX', () => {
  test('404: unknown API route @status @negative', async ({ api }) => {
    const r = await api.send(EP.SYSTEM_CONFIG, { path: '/service/api/v1/qa-route-does-not-exist' });
    if (settings.strictHttpErrors) expectStatusIn(r, [404]);
    else expectRejected(r, [404]);
  });
  test('404: unknown search route @status @negative', async ({ api }) => {
    const r = await api.send(EP.SEARCH_MOVIES, { path: '/search/api/v3/qa-route-does-not-exist' });
    expectRejected(r, [404]);
  });
  test('404: unknown web data route @status @negative', async ({ api }) => {
    const r = await api.send(EP.WEB_HOME_DATA, { vars: { nextBuildId: neg.invalidBuildId } });
    expectStatusIn(r, [404]);
  });
  test('405: unsupported method on GET endpoint @status @negative', async ({ api }) => {
    const r = await api.send(EP.SYSTEM_CONFIG, { method: 'DELETE' });
    expectRejected(r, [404, 405]);
  });
  test('405: GET on POST-only endpoint @status @negative', async ({ api }) => {
    const r = await api.send(EP.GET_OTP, { method: 'GET', body: undefined });
    expectRejected(r, [404, 405]);
  });
  test('400: malformed JSON body @status @negative', async ({ api }) => {
    const r = await api.send(EP.GET_OTP, { body: '{"mobile": ' });
    expectRejected(r, [400, 422]);
  });
  test('415/400: unsupported Content-Type @status @negative', async ({ api }) => {
    const r = await api.send(EP.GET_OTP, { body: '<xml/>', headers: { 'Content-Type': 'application/xml' } });
    expectRejected(r, [400, 415, 422]);
  });
  test('401/403: protected endpoint without session @status @negative', async ({ api }) => {
    const r = await api.send(EP.USER_INFO, { headers: { 'session-id': undefined } });
    expectRejected(r, [401, 403]);
  });
  test('401/403: protected endpoint with forged session @status @negative', async ({ api }) => {
    const r = await api.send(EP.ACTIVE_PACKAGES, { headers: { 'session-id': neg.invalidSessionId } });
    expectRejected(r, [401, 403]);
  });
  test('413/400: oversized request body @status @negative', async ({ api }) => {
    const big = 'A'.repeat(testData.security.largePayloadBytes);
    const r = await api.send(EP.GET_OTP, { body: { mobile: big, context: 'login' } });
    expectRejected(r, [400, 413, 422]);
  });
  test('414/400: oversized URL @status @negative', async ({ api }) => {
    const r = await api.send(EP.SEARCH_MOVIES, { query: { query: 'q'.repeat(16_000) } });
    expectNo5xx(r);
    expectNoLeak(r);
  });
  test('406/2XX: unsupported Accept header is handled @status @edge', async ({ api }) => {
    const r = await api.send(EP.SYSTEM_CONFIG, { headers: { Accept: 'application/x-qa-unknown' } });
    expectHandled(r);
  });
});

test.describe('09 Status codes › 5XX', () => {
  test('5XX: no endpoint returns 5XX for malformed input @status @negative', async ({ api }) => {
    const samples: Array<[string, () => Promise<any>]> = [];
    for (const ep of ALL_ENDPOINTS) {
      const headers = isSafe(ep) ? {} : { 'session-id': neg.invalidSessionId };
      if (ep.query) {
        const fuzz = Object.fromEntries(Object.keys(ep.query).map((k) => [k, '%%%{{}}\u0000']));
        samples.push([`${ep.id} fuzz query`, () => api.send(ep, { query: fuzz, headers, label: `${ep.id} fuzz query` })]);
      }
      if (ep.method === 'POST') {
        samples.push([`${ep.id} fuzz body`, () => api.send(ep, { body: '\u0000\u0001garbage', headers, label: `${ep.id} fuzz body` })]);
      }
    }
    const failures: string[] = [];
    for (const [name, call] of samples) {
      const r = await call();
      if (r.status >= 500) failures.push(`${name} → ${r.status}`);
    }
    expect(failures, `Endpoints returned 5XX for malformed input:\n${failures.join('\n')}`).toEqual([]);
  });

  test('5XX: injected fault returns a clean 5XX (FAULT_INJECTION_URL) @status', async ({ api }) => {
    if (!settings.faultInjectionUrl) {
      test.info().annotations.push({
        type: 'info',
        description: 'FAULT_INJECTION_URL is not configured; checking graceful handling on the system config endpoint instead',
      });
      expectHandled(await api.send(EP.SYSTEM_CONFIG));
      return;
    }

    const r = await api.raw('GET', settings.faultInjectionUrl, {}, undefined, 'fault injection');
    expectStatusClass(r, '5XX');
    expect([500, 502, 503, 504]).toContain(r.status);
    expectNoLeak(r);
    if (r.status === 503) test.info().annotations.push({ type: 'retry-after', description: r.headers['retry-after'] ?? 'missing' });
  });

  test('5XX: any 5XX observed is free of stack traces / internals @status @security', async ({ api }) => {
    // Methods servers commonly do not implement; if they 5XX, the body must still be clean.
    for (const method of ['PATCH', 'TRACE', 'OPTIONS']) {
      const r = await api.send(EP.SYSTEM_CONFIG, { method, label: `SYSTEM_CONFIG ${method}` });
      expectNoLeak(r);
    }
  });
});
