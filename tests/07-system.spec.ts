import { bodyData, expectHandled, expectRejected } from '../src/assertions';
import { EP } from '../src/endpoints';
import { expect, test, testData } from '../src/fixtures';
import { checkNoSecrets, checkNoSensitiveFields } from '../src/security';
import { positiveCase, queryEdgeCases, standardNegativeCases } from '../src/suites';

const neg = testData.negative;

test.describe('07 System › Feature & config', () => {
  for (const ep of [EP.SYSTEM_FEATURE, EP.SYSTEM_CONFIG]) {
    positiveCase(ep, (r) => {
      expect(bodyData(r.json) ?? r.json, `${ep.name} should return configuration`).toBeTruthy();
      // Public config must not ship secrets.
      checkNoSecrets(r);
      checkNoSensitiveFields(r);
    });
    standardNegativeCases(ep);
    test(`${ep.name} is stable across consecutive calls @edge`, async ({ api }) => {
      const a = await api.send(ep, { label: `${ep.id} #1` });
      const b = await api.send(ep, { label: `${ep.id} #2` });
      expect(b.status).toBe(a.status);
      if (a.isJson && b.isJson) expect.soft(Object.keys(b.json).sort()).toEqual(Object.keys(a.json).sort());
    });
  }
});

test.describe('07 System › Location info', () => {
  positiveCase(EP.LOCATION_INFO, (r) => {
    expect(bodyData(r.json) ?? r.json, 'Location info should return a payload').toBeTruthy();
  });
  test('Location info with unknown tenant_code is handled @negative', async ({ api }) => {
    const r = await api.send(EP.LOCATION_INFO, { query: { tenant_code: neg.invalidTenantCode } });
    expectHandled(r);
  });
  test('Location info with unknown product is handled @negative', async ({ api }) => {
    const r = await api.send(EP.LOCATION_INFO, { query: { product: neg.invalidProductCode } });
    expectHandled(r);
  });
  test('Location info with unknown client is handled @negative', async ({ api }) => {
    const r = await api.send(EP.LOCATION_INFO, { query: { client: neg.invalidClientType } });
    expectHandled(r);
  });
  for (const client of ['android', 'ios', 'web']) {
    test(`Location info for client=${client} @edge`, async ({ api }) => {
      const r = await api.send(EP.LOCATION_INFO, { query: { client } });
      expectHandled(r);
    });
  }
  test('Location info ignores spoofed X-Forwarded-For @edge', async ({ api }) => {
    const r = await api.send(EP.LOCATION_INFO, { headers: { 'X-Forwarded-For': '8.8.8.8' } });
    expectHandled(r);
  });
  test('Location info without session-id is handled @negative', async ({ api }) => {
    const r = await api.send(EP.LOCATION_INFO, { headers: { 'session-id': undefined } });
    expectHandled(r);
  });
  test('Location info with an unknown session-id is handled @negative', async ({ api }) => {
    const r = await api.send(EP.LOCATION_INFO, { headers: { 'session-id': neg.invalidSessionId } });
    expectHandled(r);
  });
  test('Location info with an empty session-id is handled @negative', async ({ api }) => {
    const r = await api.send(EP.LOCATION_INFO, { headers: { 'session-id': '' } });
    expectHandled(r);
  });
  test('Location info with unsupported method DELETE is handled gracefully @negative', async ({ api }) => {
    const r = await api.send(EP.LOCATION_INFO, { method: 'DELETE' });
    expectHandled(r);
  });
  test('Location info with an unknown tenant-code header is handled @negative', async ({ api }) => {
    const r = await api.send(EP.LOCATION_INFO, { headers: { 'tenant-code': neg.invalidTenantCode } });
    expectHandled(r);
  });
  queryEdgeCases(EP.LOCATION_INFO);
});
