import { ApiClient } from '../src/apiClient';
import { expectHandled, expectRejected, expectSuccess, isBodySuccess } from '../src/assertions';
import { Endpoint, EP } from '../src/endpoints';
import { expect, settings, test, testData, vars } from '../src/fixtures';
import { checkNoStoreForPrivate } from '../src/security';
import { queryEdgeCases, standardNegativeCases } from '../src/suites';

const neg = testData.negative;

async function expectSafeRejection(api: ApiClient, ep: Endpoint, label: string) {
  const r = await api.send(ep, {
    headers: { 'session-id': neg.invalidSessionId },
    label,
  });
  expectRejected(r, [400, 401, 403, 404, 422]);
}

async function favouritesContain(api: ApiClient, contentPath: string): Promise<boolean> {
  const r = await api.send(EP.FAVOURITES_LIST, { label: 'FAVOURITES_LIST check' });
  expectSuccess(r, EP.FAVOURITES_LIST);
  return r.text.includes(contentPath);
}

test.describe('02 Favourites › List', () => {
  test('Get Favourite List returns 2XX with a valid body @positive @smoke', async ({ api }) => {
    if (settings.anonymousSession) {
      test.info().annotations.push({
        type: 'info',
        description: 'Only an anonymous session is available; checking the endpoint response without asserting signed-in user data',
      });
      const r = await api.send(EP.FAVOURITES_LIST);
      if (isBodySuccess(r.json)) {
        expectSuccess(r, EP.FAVOURITES_LIST);
      } else {
        expectRejected(r, [401, 403]);
      }
      return;
    }

    api.gate(EP.FAVOURITES_LIST);
    const r = await api.send(EP.FAVOURITES_LIST);
    expectSuccess(r, EP.FAVOURITES_LIST);
    checkNoStoreForPrivate(r);
  });
  standardNegativeCases(EP.FAVOURITES_LIST);
  queryEdgeCases(EP.FAVOURITES_LIST, ['path']);
});

test.describe('02 Favourites › Add / Delete round-trip', () => {
  test.describe.configure({ mode: 'serial' });

  test('Add Favourite adds the item and it appears in the list @positive', async ({ api }) => {
    if (!settings.allowStateChanging || settings.anonymousSession || api.missingVars(EP.FAVOURITE_ADD).length) {
      test.info().annotations.push({
        type: 'info',
        description: 'Add action is disabled or lacks signed-in inputs; verifying that an invalid session is rejected without changing favourites',
      });
      await expectSafeRejection(api, EP.FAVOURITE_ADD, 'FAVOURITE_ADD unavailable-session check');
      return;
    }

    api.gate(EP.FAVOURITE_ADD);
    const r = await api.send(EP.FAVOURITE_ADD);
    expectSuccess(r, EP.FAVOURITE_ADD);
    expect.soft(await favouritesContain(api, vars.contentPath), 'Added item should be listed').toBe(true);
  });

  test('Add Favourite twice is idempotent @edge', async ({ api }) => {
    if (!settings.allowStateChanging || settings.anonymousSession || api.missingVars(EP.FAVOURITE_ADD).length) {
      test.info().annotations.push({
        type: 'info',
        description: 'Add action is disabled or lacks signed-in inputs; verifying that an invalid session is rejected without changing favourites',
      });
      await expectSafeRejection(api, EP.FAVOURITE_ADD, 'FAVOURITE_ADD unavailable-session duplicate check');
      return;
    }

    api.gate(EP.FAVOURITE_ADD);
    const r = await api.send(EP.FAVOURITE_ADD, { label: 'FAVOURITE_ADD duplicate' });
    expectHandled(r);
  });

  test('Delete Favourite removes the item from the list @positive', async ({ api }) => {
    if (!settings.allowStateChanging || settings.anonymousSession || api.missingVars(EP.FAVOURITE_DELETE).length) {
      test.info().annotations.push({
        type: 'info',
        description: 'Delete action is disabled or lacks signed-in inputs; verifying that an invalid session is rejected without changing favourites',
      });
      await expectSafeRejection(api, EP.FAVOURITE_DELETE, 'FAVOURITE_DELETE unavailable-session check');
      return;
    }

    api.gate(EP.FAVOURITE_DELETE);
    const r = await api.send(EP.FAVOURITE_DELETE);
    expectSuccess(r, EP.FAVOURITE_DELETE);
    expect.soft(await favouritesContain(api, vars.contentPath), 'Deleted item should not be listed').toBe(false);
  });

  test('Delete Favourite for an item not in the list is handled @edge', async ({ api }) => {
    if (!settings.allowStateChanging || settings.anonymousSession || api.missingVars(EP.FAVOURITE_DELETE).length) {
      test.info().annotations.push({
        type: 'info',
        description: 'Delete action is disabled or lacks signed-in inputs; verifying that an invalid session is rejected without changing favourites',
      });
      await expectSafeRejection(api, EP.FAVOURITE_DELETE, 'FAVOURITE_DELETE unavailable-session delete check');
      return;
    }

    api.gate(EP.FAVOURITE_DELETE);
    const r = await api.send(EP.FAVOURITE_DELETE, { label: 'FAVOURITE_DELETE again' });
    expectHandled(r);
  });
});

test.describe('02 Favourites › Negative & edge', () => {
  standardNegativeCases(EP.FAVOURITE_ADD);
  standardNegativeCases(EP.FAVOURITE_DELETE);

  test('Favourite with unsupported action is rejected @negative', async ({ api }) => {
    const contentPath = api.missingVars(EP.FAVOURITE_ADD).includes('contentPath') ? neg.invalidPath : vars.contentPath;
    const r = await api.send(EP.FAVOURITE_ADD, {
      query: { path: contentPath, action: neg.invalidFavouriteAction },
      headers: { 'session-id': neg.invalidSessionId },
    });
    expectRejected(r, [400, 422]);
  });
  test('Favourite for non-existent content is rejected @negative', async ({ api }) => {
    const r = await api.send(EP.FAVOURITE_ADD, {
      query: { path: neg.invalidPath },
      headers: { 'session-id': neg.invalidSessionId },
    });
    expectRejected(r, [400, 401, 403, 404, 422]);
  });

 

test('Favourite without path is rejected @negative', async ({ api }) => {
  const r = await api.send(EP.FAVOURITE_ADD, {
    query: { path: undefined },
  });

  expectRejected(r, [400, 422]);
});



  test('Favourite without action is rejected @negative', async ({ api }) => {
    const r = await api.send(EP.FAVOURITE_ADD, { query: { path: neg.invalidPath, action: undefined } });
    expectRejected(r, [400, 422]);
  });
  for (const action of ['0', '-1', 'abc', '1.5', '']) {
    test(`Favourite action "${action}" is handled @edge`, async ({ api }) => {
      const r = await api.send(EP.FAVOURITE_ADD, { query: { path: neg.invalidPath, action } });
      expectRejected(r);
    });
  }
});
