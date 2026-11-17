/**
 * Basic API security checks (OWASP API Top 10 oriented). Non-destructive: payloads are sent only to
 * read-only endpoints, or to state-changing ones with an invalid session.
 */
import { isUnset } from '../src/apiClient';
import { expectHandled, expectJsonContentType, expectNo5xx, expectNoLeak, expectRejected, isRejection, statusClass } from '../src/assertions';
import { ALL_ENDPOINTS, BaseKey, EP, Endpoint } from '../src/endpoints';
import { expect, settings, test, testData, vars } from '../src/fixtures';
import {
  checkCookieFlags, checkCors, checkInfoDisclosure, checkNoSecrets, checkNotEvaluated, checkNotReflectedAsHtml, checkSecurityHeaders,
} from '../src/security';

const sec = testData.security;
const neg = testData.negative;

/** One representative, public endpoint per host. */
const HOST_PROBES: Array<[BaseKey, Endpoint]> = [
  ['apiBaseUrl', EP.SYSTEM_CONFIG],
  ['searchBaseUrl', EP.SEARCH_MOVIES],
  ['packageBaseUrl', EP.PACKAGE_CATALOGUE],
];

test.describe('10 Security › Transport & headers', () => {
  test('All configured base URLs use HTTPS @security', () => {
    for (const b of ['apiBaseUrl', 'searchBaseUrl', 'webBaseUrl', 'packageBaseUrl'] as BaseKey[]) {
      if (!isUnset(vars[b])) expect(vars[b], `${b} must be HTTPS`).toMatch(/^https:\/\//);
    }
  });

  for (const [base, ep] of HOST_PROBES) {
    test(`Security headers present on ${base} @security`, async ({ api }) => {
      const r = await api.send(ep);
      checkSecurityHeaders(r);
      checkInfoDisclosure(r);
    });
    test(`JSON responses declare application/json on ${base} @security`, async ({ api }) => {
      const r = await api.send(ep);
      // A JSON body served as text/plain or text/html can be content-sniffed by browsers.
      if (r.isJson) expectJsonContentType(r);
    });
    test(`CORS does not trust arbitrary origins on ${base} @security`, async ({ api }) => {
      const r = await api.send(ep, { headers: { Origin: sec.evilOrigin } });
      checkCors(r, sec.evilOrigin);
      const pre = await api.send(ep, {
        method: 'OPTIONS',
        headers: { Origin: sec.evilOrigin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'session-id' },
        label: `${ep.id} CORS preflight`,
      });
      checkCors(pre, sec.evilOrigin);
    });
  }

  test('Web origin: security headers, clickjacking protection and cookie flags @security', async ({ api }) => {
    const r = await api.raw('GET', vars.webBaseUrl + '/', {}, undefined, 'web root');
    checkSecurityHeaders(r, { html: true });
    checkInfoDisclosure(r);
    checkCookieFlags(r);
    expect.soft(r.headers['content-security-policy'], 'Content-Security-Policy missing on web origin').toBeTruthy();
  });

  test('TRACE method is disabled @security', async ({ api }) => {
    const r = await api.send(EP.SYSTEM_CONFIG, { method: 'TRACE', headers: { 'X-QA-Trace': 'qa-trace-marker' } });
    expect(statusClass(r.status), 'TRACE should not succeed').not.toBe('2XX');
    expect(r.text).not.toContain('qa-trace-marker');
  });
});

test.describe('10 Security › Authentication & authorization (OWASP API2/API1)', () => {
  const protectedEps = ALL_ENDPOINTS.filter((e) => e.requiresAuth);

  test('Every protected endpoint refuses requests without a session @security', async ({ api }) => {
    const leaks: string[] = [];
    for (const ep of protectedEps) {
      const r = await api.send(ep, { headers: { 'session-id': undefined }, label: `${ep.id} no session` });
      expectNo5xx(r);
      if (!isRejection(r)) leaks.push(`${ep.id} → ${r.status}`);
    }
    expect(leaks, `Protected endpoints answered without a session:\n${leaks.join('\n')}`).toEqual([]);
  });

  for (const tampered of sec.tamperedSessions) {
    test(`Tampered session "${tampered.slice(0, 20)}" is refused by protected endpoints @security`, async ({ api }) => {
      for (const ep of protectedEps) {
        await test.step(ep.id, async () => {
          const r = await api.send(ep, { headers: { 'session-id': tampered }, label: `${ep.id} tampered` });
          expectRejected(r);
        });
      }
    });
  }

  test('Session id is not accepted from the query string @security', async ({ api }) => {
    test.skip(isUnset(vars.sessionId), 'needs SESSION_ID');
    const r = await api.send(EP.USER_INFO, { headers: { 'session-id': undefined }, query: { 'session-id': vars.sessionId, session_id: vars.sessionId } });
    expectRejected(r);
  });

  test('IDOR: order status for a foreign/unknown order id returns no order data @security', async ({ api }) => {
    const r = await api.send(EP.ORDER_STATUS, { vars: { orderId: '1' } });
    expectRejected(r);
  });

  test('Brute-force protection: repeated wrong TV passcodes do not all succeed @security', async ({ api }) => {
    for (let i = 0; i < 3; i++) {
      const r = await api.send(EP.VALIDATE_PASSCODE, { query: { key: String(100000 + i) }, headers: { 'session-id': neg.invalidSessionId }, label: `passcode attempt ${i + 1}` });
      expectRejected(r);
    }
  });

  test('OTP endpoint is rate limited @security', async ({ api }) => {
    test.skip(!settings.runRateLimitTests || !settings.allowSensitive, 'Set RUN_RATE_LIMIT_TESTS=true and ALLOW_SENSITIVE=true (sends real OTPs)');
    api.requireVars(EP.GET_OTP);
    let throttled = false;
    for (let i = 0; i < sec.rateLimitAttempts; i++) {
      const r = await api.send(EP.GET_OTP, { label: `OTP attempt ${i + 1}` });
      expectNo5xx(r);
      if (r.status === 429 || isRejection(r)) {
        throttled = true;
        break;
      }
    }
    expect(throttled, `${sec.rateLimitAttempts} OTP requests in a row were all accepted`).toBe(true);
  });
});

test.describe('10 Security › Injection (OWASP API8)', () => {
  const groups: Array<[string, string[]]> = [
    ['SQL injection', sec.sqli],
    ['NoSQL injection', sec.nosqli],
    ['XSS', sec.xss],
    ['Command injection', sec.commandInjection],
    ['Template injection', sec.ssti],
    ['CRLF injection', sec.crlf],
  ];
  const targets: Array<[Endpoint, string]> = [
    [EP.SEARCH_MOVIES, 'query'],
    [EP.HOME_PAGE, 'path'],
    [EP.HOME_SECTION_DATA, 'code'],
    [EP.LOCATION_INFO, 'client'],
    [EP.NEXT_VIDEOS, 'path'],
  ];
  for (const [kind, payloads] of groups) {
    for (const [ep, param] of targets) {
      test(`${kind} in ${ep.id}.${param} is handled safely @security`, async ({ api }) => {
        for (const p of payloads) {
          await test.step(p, async () => {
            const r = await api.send(ep, { query: { [param]: p }, label: `${ep.id} ${kind}` });
            expectHandled(r);
            checkNotReflectedAsHtml(r, p);
            checkNotEvaluated(r);
            expect(Object.keys(r.headers), 'CRLF payload must not create headers').not.toContain('x-injected');
          });
        }
      });
    }
  }

  test('Injection in JSON body fields (sign-in) is handled safely @security', async ({ api }) => {
    for (const p of [...sec.sqli, ...sec.nosqli]) {
      const r = await api.send(EP.SIGN_IN, { body: { login_id: p, login_key: p, login_mode: 2 }, label: 'SIGN_IN injection' });
      expectRejected(r);
    }
    // Operator objects instead of strings (NoSQL auth bypass)
    const r = await api.send(EP.SIGN_IN, { body: { login_id: { $ne: null }, login_key: { $ne: null }, login_mode: 2 }, label: 'SIGN_IN operator' });
    expectRejected(r);
  });

  test('Path traversal in page path is not resolved on disk @security', async ({ api }) => {
    for (const p of sec.pathTraversal) {
      const r = await api.send(EP.HOME_PAGE, { query: { path: p }, label: 'page traversal' });
      expectHandled(r);
      expect(r.text).not.toMatch(/root:x:0:0:/);
    }
  });

  test('Path traversal in Next.js data route is blocked @security', async ({ api }) => {
    for (const p of sec.pathTraversal) {
      const r = await api.raw('GET', `${vars.webBaseUrl}/_next/data/${p}`, {}, undefined, 'next traversal');
      expectNo5xx(r);
      expectNoLeak(r);
    }
  });
});

test.describe('10 Security › Data exposure & redirects (OWASP API3)', () => {
  for (const ep of [EP.SYSTEM_CONFIG, EP.SYSTEM_FEATURE, EP.HOME_PAGE, EP.PACKAGE_CATALOGUE, EP.LOCATION_INFO]) {
    test(`${ep.id} exposes no secrets or internals @security`, async ({ api }) => {
      const r = await api.send(ep);
      checkNoSecrets(r);
      expectNoLeak(r);
    });
  }

  test('Error responses do not echo credentials @security', async ({ api }) => {
    const marker = 'QaSecretMarker!123';
    const r = await api.send(EP.SIGN_IN, { body: { login_id: neg.randomLoginId, login_key: marker, login_mode: 2 } });
    expect(r.text).not.toContain(marker);
  });

  for (const param of sec.openRedirectParams) {
    test(`No open redirect via web logout ?${param}= @security`, async ({ api }) => {
      const r = await api.send(EP.WEB_LOGOUT, { query: { [param]: sec.evilOrigin }, maxRedirects: 0 });
      expectNo5xx(r);
      if (statusClass(r.status) === '3XX') {
        const loc = new URL(r.headers['location'] ?? '/', vars.webBaseUrl);
        expect(loc.host, 'Redirects to attacker-controlled host').not.toBe(new URL(sec.evilOrigin).host);
      }
    });
  }

  test('Sensitive values are not passed in URLs (passcode in query string) @security', () => {
    // Static review of the contract: secrets in URLs end up in logs, proxies and browser history.
    const offenders = ALL_ENDPOINTS.filter((e) => Object.keys(e.query ?? {}).some((k) => /^(key|pin|otp|password|token)$/i.test(k)));
    test.info().annotations.push({ type: 'finding', description: offenders.map((e) => `${e.id}: ${Object.keys(e.query!).join(',')}`).join('; ') });
    expect.soft(offenders.map((e) => e.id), 'Secrets sent as query parameters').toEqual([]);
  });
});
