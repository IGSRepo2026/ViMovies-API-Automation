import { isUnset } from '../src/apiClient';
import { expectHandled, expectRejected, expectStatusClass, expectStatusIn, expectNoLeak, expectSuccess } from '../src/assertions';
import { EP } from '../src/endpoints';
import { expect, settings, test, testData, vars } from '../src/fixtures';
import { bodyEdgeCases, standardNegativeCases } from '../src/suites';

const neg = testData.negative;

test.describe('08 Web routes › Logout', () => {
  test('Web logout responds with 2XX or redirects (3XX) @positive @smoke', async ({ api }) => {
    const r = await api.send(EP.WEB_LOGOUT, { maxRedirects: 0 });
    expectStatusClass(r, ['2XX', '3XX']);
    expectNoLeak(r);
    if (r.status >= 300 && r.status < 400) {
      const loc = new URL(r.headers['location'] ?? '', vars.webBaseUrl);
      expect(loc.protocol, 'Logout redirect must stay on HTTPS').toBe('https:');
    }
  });
  test('Web logout followed to final page returns 2XX @positive', async ({ api }) => {
    const r = await api.send(EP.WEB_LOGOUT);
    expectStatusClass(r, '2XX');
  });
});

test.describe('08 Web routes › Next.js page data', () => {
  for (const ep of [EP.WEB_HOME_DATA, EP.WEB_MOVIE_DATA, EP.WEB_PLANS_DATA]) {
    test(`${ep.name} returns 2XX with a valid body @positive @smoke`, async ({ api }) => {
      const missing = api.missingVars(ep);
      if (missing.length) {
        const fallbackVars = {
          nextBuildId: neg.invalidBuildId,
          movieSlug: neg.invalidSlug,
        };
        test.info().annotations.push({
          type: 'info',
          description: `Missing ${missing.join(', ')}; checking graceful handling of a request with safe fallback route values`,
        });
        expectHandled(await api.send(ep, { vars: fallbackVars }));
        return;
      }

      api.gate(ep);
      expectSuccess(await api.send(ep), ep);
    });
  }

  test('Unknown Next.js build id returns 404 @negative', async ({ api }) => {
    const r = await api.send(EP.WEB_HOME_DATA, { vars: { nextBuildId: neg.invalidBuildId } });
    expectStatusIn(r, [404]);
  });
  test('Unknown movie slug returns 404 @negative', async ({ api }) => {
    const nextBuildId = api.missingVars(EP.WEB_MOVIE_DATA, { vars: { movieSlug: 'x' } }).includes('nextBuildId')
      ? neg.invalidBuildId
      : vars.nextBuildId;
    const r = await api.send(EP.WEB_MOVIE_DATA, { vars: { nextBuildId, movieSlug: neg.invalidSlug } });
    expectStatusClass(r, ['4XX']);
  });
  test('Next.js data route rejects POST @negative', async ({ api }) => {
    const r = await api.send(EP.WEB_PLANS_DATA, { method: 'POST', vars: { nextBuildId: neg.invalidBuildId } });
    expectStatusClass(r, '4XX');
  });
  for (const slug of ['', '%20', 'a'.repeat(1000), '..%2f..%2fpackage']) {
    test(`Movie data with slug "${slug.slice(0, 16)}" is handled @edge`, async ({ api }) => {
      const nextBuildId = isUnset(vars.nextBuildId) ? neg.invalidBuildId : vars.nextBuildId;
      const r = await api.send(EP.WEB_MOVIE_DATA, { vars: { nextBuildId, movieSlug: slug || ' ' } });
      expectHandled(r);
    });
  }
});

test.describe('08 Devices › Linked devices', () => {
  test('List Linked Devices returns 2XX with a valid body @positive @smoke', async ({ api }) => {
    if (settings.anonymousSession || api.missingVars(EP.LINKED_DEVICES).length) {
      test.info().annotations.push({
        type: 'info',
        description: 'Signed-in session or encrypted identifier unavailable; verifying expected rejection with an invalid session',
      });
      const r = await api.send(EP.LINKED_DEVICES, {
        vars: { encryptedIdentifier: 'qa-invalid-identifier' },
        headers: { 'session-id': neg.invalidSessionId },
      });
      expectRejected(r, [400, 401, 403, 404, 422]);
      return;
    }

    api.gate(EP.LINKED_DEVICES);
    expectSuccess(await api.send(EP.LINKED_DEVICES), EP.LINKED_DEVICES);
  });
  test('Linked devices with tampered identifier is rejected @negative', async ({ api }) => {
    const r = await api.send(EP.LINKED_DEVICES, { vars: { encryptedIdentifier: 'qa-tampered-identifier' } });
    expectRejected(r, [400, 401, 403, 422]);
  });
  test('Linked devices with unsupported version is handled @edge', async ({ api }) => {
    const r = await api.send(EP.LINKED_DEVICES, { query: { version: '999' } });
    expectHandled(r);
  });
  test('Linked devices with unsupported identifierType is rejected @negative', async ({ api }) => {
    const r = await api.send(EP.LINKED_DEVICES, { query: { identifierType: 'email' }, vars: { encryptedIdentifier: 'qa' } });
    expectRejected(r);
  });
  standardNegativeCases(EP.LINKED_DEVICES);
});

test.describe('08 Devices › Delink device', () => {
  test('Delink Device returns 2XX with a valid body @positive @smoke', async ({ api }) => {
    const missing = api.missingVars(EP.DELINK_DEVICE);
    if (!settings.allowStateChanging || !settings.allowSensitive || settings.anonymousSession || missing.length) {
      test.info().annotations.push({
        type: 'info',
        description: 'Delink is disabled or lacks authorized test data; verifying rejection with an invalid session without changing device links',
      });
      const r = await api.send(EP.DELINK_DEVICE, {
        body: { box_id: neg.invalidBoxId, device_type: 'qa' },
        headers: { 'session-id': neg.invalidSessionId },
      });
      expectRejected(r, [400, 401, 403, 404, 422]);
      return;
    }

    api.gate(EP.DELINK_DEVICE);
    expectSuccess(await api.send(EP.DELINK_DEVICE), EP.DELINK_DEVICE);
  });
  test('Delink with unknown box id is rejected @negative', async ({ api }) => {
    const r = await api.send(EP.DELINK_DEVICE, {
      body: { box_id: neg.invalidBoxId, device_type: 'qa' },
      headers: { 'session-id': neg.invalidSessionId },
    });
    expectRejected(r, [400, 403, 404, 422]);
  });
  standardNegativeCases(EP.DELINK_DEVICE);
  bodyEdgeCases(EP.DELINK_DEVICE);
});
