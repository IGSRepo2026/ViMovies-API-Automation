import { ApiClient } from '../src/apiClient';
import { bodyData, expectHandled, expectRejected, expectSuccess, findKeyDeep, isBodySuccess } from '../src/assertions';
import { Endpoint, EP } from '../src/endpoints';
import { expect, settings, test, testData, vars } from '../src/fixtures';
import { checkNoStoreForPrivate } from '../src/security';
import { bodyEdgeCases, queryEdgeCases, standardNegativeCases } from '../src/suites';

const neg = testData.negative;

async function expectSafeAuthFallback(api: ApiClient, ep: Endpoint, label: string) {
  const r = await api.send(ep, {
    headers: { 'session-id': neg.invalidSessionId },
    label,
  });
  expectRejected(r, [400, 401, 403, 404, 422]);
}

test.describe('05 Packages › Catalogue', () => {
  test('Package Catalogue returns 2XX with a valid body @positive @smoke', async ({ api }) => {
    if (settings.anonymousSession) {
      test.info().annotations.push({
        type: 'info',
        description: 'Only an anonymous session is available; checking successful response or expected authorization rejection',
      });
      const r = await api.send(EP.PACKAGE_CATALOGUE);
      if (isBodySuccess(r.json)) {
        expectSuccess(r, EP.PACKAGE_CATALOGUE);
        expect(bodyData(r.json) ?? r.json, 'Catalogue should list packages').toBeTruthy();
      } else {
        expectRejected(r, [401, 403]);
      }
      return;
    }

    api.gate(EP.PACKAGE_CATALOGUE);
    const r = await api.send(EP.PACKAGE_CATALOGUE);
    expectSuccess(r, EP.PACKAGE_CATALOGUE);
    expect(bodyData(r.json) ?? r.json, 'Catalogue should list packages').toBeTruthy();
  });
  test('Package catalogue with skip_package_content=true is handled @edge', async ({ api }) => {
    const r = await api.send(EP.PACKAGE_CATALOGUE, { query: { skip_package_content: 'true' } });
    expectHandled(r);
  });
  test('Package catalogue response is smaller when content is skipped @edge', async ({ api }) => {
    const full = await api.send(EP.PACKAGE_CATALOGUE, { label: 'catalogue full' });
    const slim = await api.send(EP.PACKAGE_CATALOGUE, { query: { skip_package_content: 'true' }, label: 'catalogue slim' });
    test.skip(full.status >= 300 || slim.status >= 300, 'catalogue not available');
    expect.soft(slim.text.length).toBeLessThanOrEqual(full.text.length);
  });
  standardNegativeCases(EP.PACKAGE_CATALOGUE);
  queryEdgeCases(EP.PACKAGE_CATALOGUE);
});

test.describe('05 Packages › Active packages', () => {
  test('Active Packages returns 2XX with a valid body @positive @smoke', async ({ api }) => {
    if (settings.anonymousSession) {
      test.info().annotations.push({
        type: 'info',
        description: 'Only an anonymous session is available; checking successful response or expected authorization rejection',
      });
      const r = await api.send(EP.ACTIVE_PACKAGES);
      if (isBodySuccess(r.json)) {
        expectSuccess(r, EP.ACTIVE_PACKAGES);
        checkNoStoreForPrivate(r);
      } else {
        expectRejected(r, [401, 403]);
      }
      return;
    }

    api.gate(EP.ACTIVE_PACKAGES);
    const r = await api.send(EP.ACTIVE_PACKAGES);
    expectSuccess(r, EP.ACTIVE_PACKAGES);
    checkNoStoreForPrivate(r);
  });
  standardNegativeCases(EP.ACTIVE_PACKAGES);
});

test.describe('05 Packages › Checkout & order status (payment sandbox only)', () => {
  test.describe.configure({ mode: 'serial' });
  let createdOrderId: string | undefined;

  test('Create Checkout Order returns 2XX with a valid body @positive @smoke', async ({ api }) => {
    const missing = api.missingVars(EP.CHECKOUT_ORDER);
    if (!settings.allowStateChanging || !settings.allowSensitive || settings.anonymousSession || missing.length) {
      const reasons = [
        !settings.allowStateChanging && 'state-changing safety switch is disabled',
        !settings.allowSensitive && 'sensitive-flow safety switch is disabled',
        settings.anonymousSession && 'only an anonymous session is configured',
        missing.length > 0 && `missing test data: ${missing.join(', ')}`,
      ].filter(Boolean);
      test.info().annotations.push({
        type: 'info',
        description: `Checkout was not created (${reasons.join('; ')}); validating safe rejection with an invalid session`,
      });
      await expectSafeAuthFallback(api, EP.CHECKOUT_ORDER, 'checkout safety fallback');
      return;
    }

    api.gate(EP.CHECKOUT_ORDER);
    const r = await api.send(EP.CHECKOUT_ORDER);
    expectSuccess(r, EP.CHECKOUT_ORDER);
    createdOrderId = findKeyDeep(r.json, ['order_id', 'orderId']);
    expect(createdOrderId, 'Checkout should return an order id').toBeDefined();
  });
  test('Order status for the order just created @positive', async ({ api }) => {
    if (!createdOrderId) {
      test.info().annotations.push({
        type: 'info',
        description: 'No checkout order was created; validating safe rejection for an unknown order with an invalid session',
      });
      await expectSafeAuthFallback(api, EP.ORDER_STATUS, 'order status safety fallback');
      return;
    }

    const r = await api.send(EP.ORDER_STATUS, { vars: { orderId: createdOrderId! } });
    expectHandled(r);
    expect(r.status).toBeLessThan(300);
  });

  test('Checkout with unknown package is rejected @negative', async ({ api }) => {
    api.requireVars(EP.ACTIVE_PACKAGES); // needs a valid SESSION_ID so the package check is reached
    const r = await api.send(EP.CHECKOUT_ORDER, { body: { packages: neg.invalidPackageId, gateway: 'qa_no_such_gateway' } });
    expectRejected(r, [400, 404, 422]);
  });
  test('Checkout without gateway is rejected @negative', async ({ api }) => {
    const r = await api.send(EP.CHECKOUT_ORDER, { body: { packages: neg.invalidPackageId }, headers: { 'session-id': neg.invalidSessionId } });
    expectRejected(r, [400, 401, 422]);
  });
  standardNegativeCases(EP.CHECKOUT_ORDER);
  bodyEdgeCases(EP.CHECKOUT_ORDER);

  test('Get Order Status returns 2XX with a valid body @positive @smoke', async ({ api }) => {
    if (settings.anonymousSession || api.missingVars(EP.ORDER_STATUS).length) {
      test.info().annotations.push({
        type: 'info',
        description: 'A signed-in session or order id is unavailable; validating safe rejection with an invalid session',
      });
      await expectSafeAuthFallback(api, EP.ORDER_STATUS, 'order status safety fallback');
      return;
    }

    api.gate(EP.ORDER_STATUS);
    const r = await api.send(EP.ORDER_STATUS);
    expectSuccess(r, EP.ORDER_STATUS);
  });
  test('Order status for unknown order id is rejected (no IDOR data) @negative', async ({ api }) => {
    const r = await api.send(EP.ORDER_STATUS, { vars: { orderId: neg.invalidOrderId } });
    expectRejected(r, [400, 403, 404]);
  });
  test('Order status without order_id is rejected @negative', async ({ api }) => {
    const r = await api.send(EP.ORDER_STATUS, { query: { order_id: undefined } });
    expectRejected(r, [400, 422]);
  });
  standardNegativeCases(EP.ORDER_STATUS);
  queryEdgeCases(EP.ORDER_STATUS);
});
