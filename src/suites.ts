/**
 * Reusable test generators shared by the per-group specs.
 * Tags in titles (@smoke @positive @negative @edge) drive `--grep` filtering.
 */
import { ApiResult, SendOptions } from './apiClient';
import { expectHandled, expectRejected, expectSuccess } from './assertions';
import { Endpoint, isSafe } from './endpoints';
import { test, testData } from './fixtures';

const neg = testData.negative;
const edge = testData.edge;

/** Positive flow: 2XX + success body + SLA + optional endpoint-specific body checks. */
export function positiveCase(
  ep: Endpoint,
  check?: (r: ApiResult) => void | Promise<void>,
  opts: SendOptions = {},
  title = `${ep.name} returns 2XX with a valid body @positive @smoke`,
) {
  test(title, async ({ api }) => {
    api.gate(ep, opts);
    const r = await api.send(ep, opts);
    expectSuccess(r, ep);
    await check?.(r);
  });
}

/**
 * Standard negative cases every endpoint gets:
 *  - auth: no session / invalid session / tampered session
 *  - unsupported HTTP method
 * Requests that would otherwise change state are sent WITHOUT a valid session.
 */
export function standardNegativeCases(ep: Endpoint) {
  if (ep.apiHeaders !== false && !ep.noSession) {
    test(`${ep.name} without session-id is rejected @negative`, async ({ api }) => {
      const r = await api.send(ep, { headers: { 'session-id': undefined } });
      expectRejected(r, [400, 401, 403]);
    });
    test(`${ep.name} with an unknown session-id is rejected @negative`, async ({ api }) => {
      const r = await api.send(ep, { headers: { 'session-id': neg.invalidSessionId } });
      expectRejected(r, [400, 401, 403]);
    });
    test(`${ep.name} with an empty session-id is rejected @negative`, async ({ api }) => {
      const r = await api.send(ep, { headers: { 'session-id': '' } });
      expectRejected(r, [400, 401, 403]);
    });
  }

 const wrongMethod = ep.method === 'GET' ? 'DELETE' : 'PUT';

test(`${ep.name} with unsupported method ${wrongMethod} is handled gracefully @negative`, async ({ api }) => {
  const headers = isSafe(ep) ? {} : { 'session-id': neg.invalidSessionId };
  const r = await api.send(ep, { method: wrongMethod, headers });
  expectHandled(r);
});

  if (ep.apiHeaders !== false) {
    test(`${ep.name} with an unknown tenant-code is handled @negative`, async ({ api }) => {
      const headers: Record<string, string> = { 'tenant-code': neg.invalidTenantCode };
      if (!isSafe(ep)) headers['session-id'] = neg.invalidSessionId;
      const r = await api.send(ep, { headers });
      // Tenant may be defaulted server-side, so only graceful handling is mandatory.
      expectHandled(r);
    });
  }
}

/** Edge values for every query parameter (one test per parameter, looping the values). */
export function queryEdgeCases(ep: Endpoint, skipParams: string[] = []) {
  if (!ep.query || !isSafe(ep)) return;
  const values: Array<[string, string]> = [
    ['empty', edge.empty],
    ['whitespace', edge.whitespace],
    ['very long', 'a'.repeat(edge.longStringLength)],
    ['unicode', edge.unicode],
    ['special characters', edge.specialChars],
    ['"null"', edge.nullString],
    ['negative number', edge.negative],
    ['int32 overflow', edge.maxInt],
  ];
  for (const param of Object.keys(ep.query).filter((p) => !skipParams.includes(p))) {
    test(`${ep.name} handles edge values for "${param}" @edge`, async ({ api }) => {
      for (const [label, value] of values) {
        await test.step(`${param} = ${label}`, async () => {
          const r = await api.send(ep, { query: { [param]: value }, label: `${ep.id} ${param}=${label}` });
          expectHandled(r);
        });
      }
    });
    test(`${ep.name} handles missing "${param}" @edge`, async ({ api }) => {
      const r = await api.send(ep, { query: { [param]: undefined } });
      expectHandled(r);
    });
  }
}

/** Malformed / unexpected bodies for POST endpoints (always sent with an invalid session). */
export function bodyEdgeCases(ep: Endpoint) {
  if (ep.method !== 'POST') return;
  const headers = { 'session-id': neg.invalidSessionId };
  test(`${ep.name} rejects malformed JSON @negative`, async ({ api }) => {
    const r = await api.send(ep, { body: '{"broken": ', headers });
    expectRejected(r, [400, 401, 403, 415, 422]);
  });
  test(`${ep.name} handles empty JSON object @edge`, async ({ api }) => {
    const r = await api.send(ep, { body: {}, headers });
    expectRejected(r);
  });
  test(`${ep.name} handles JSON array instead of object @edge`, async ({ api }) => {
    const r = await api.send(ep, { body: [], headers });
    expectHandled(r);
  });
  test(`${ep.name} handles wrong Content-Type @edge`, async ({ api }) => {
    const r = await api.send(ep, { body: 'plain text body', headers: { ...headers, 'Content-Type': 'text/plain' } });
    expectHandled(r);
  });
  if (ep.body) {
    test(`${ep.name} handles null and wrongly-typed fields @edge`, async ({ api }) => {
      const nulls = Object.fromEntries(Object.keys(ep.body!).map((k) => [k, null]));
      const r1 = await api.send(ep, { body: nulls, headers, label: `${ep.id} null fields` });
      expectRejected(r1);
      const typed = Object.fromEntries(Object.keys(ep.body!).map((k) => [k, { nested: [1, 2, 3] }]));
      const r2 = await api.send(ep, { body: typed, headers, label: `${ep.id} wrong types` });
      expectRejected(r2);
    });
  }
}
