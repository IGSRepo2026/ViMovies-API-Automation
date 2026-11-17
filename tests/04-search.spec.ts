import { bodyData, expectHandled, expectListSizeAtMost, expectRejected, expectSuccess, firstArrayDeep, isBodyFailure } from '../src/assertions';
import { EP, Endpoint } from '../src/endpoints';
import { expect, test, testData } from '../src/fixtures';
import { positiveCase, queryEdgeCases, standardNegativeCases } from '../src/suites';

const s = testData.search;
const SEARCH: Endpoint[] = [EP.SEARCH_MOVIES, EP.SEARCH_TV_SHOWS, EP.SEARCH_TV_SHOW_VIDEOS, EP.SEARCH_LIVE_CHANNELS];

for (const ep of SEARCH) {
  test.describe(`04 Search › ${ep.name}`, () => {
    positiveCase(ep, (r) => {
      expect(bodyData(r.json) ?? r.json, 'Search should return a payload').toBeTruthy();
      expectListSizeAtMost(r, s.pageSizes.default);
    });

    test(`${ep.name}: page_size=${s.pageSizes.min} returns at most 1 item @edge`, async ({ api }) => {
      api.requireVars(ep);
      const r = await api.send(ep, { query: { page_size: s.pageSizes.min } });
      expectHandled(r);
      expectListSizeAtMost(r, s.pageSizes.min);
    });
    test(`${ep.name}: page_size=${s.pageSizes.max} (upper boundary) is honoured or capped @edge`, async ({ api }) => {
      api.requireVars(ep);
      const r = await api.send(ep, { query: { page_size: s.pageSizes.max } });
      expectHandled(r);
      expectListSizeAtMost(r, s.pageSizes.max);
    });
    for (const key of ['zero', 'negative', 'huge'] as const) {
      test(`${ep.name}: page_size=${s.pageSizes[key]} (${key}) is handled @edge`, async ({ api }) => {
        api.requireVars(ep);
        const r = await api.send(ep, { query: { page_size: s.pageSizes[key] } });
        expectHandled(r);
      });
    }
    test(`${ep.name}: no-match term returns empty result, not an error @edge`, async ({ api }) => {
      const r = await api.send(ep, { query: { query: s.noResultTerm } });
      expectHandled(r);
      if (r.status < 300 && !isBodyFailure(r.json)) {
        const list = firstArrayDeep(bodyData(r.json) ?? r.json) ?? [];
        expect.soft(list.length, 'No-match search should return zero results').toBe(0);
      }
    });
    test(`${ep.name}: Unicode (Hindi) term is handled @edge`, async ({ api }) => {
      const r = await api.send(ep, { query: { query: s.unicodeTerm } });
      expectHandled(r);
    });
    test(`${ep.name}: search is case-insensitive @edge`, async ({ api }) => {
      api.requireVars(ep);
      const q = api.vars[ep.query!.query.replace(/[{}]/g, '')];
      const lower = await api.send(ep, { query: { query: q.toLowerCase() }, label: `${ep.id} lower` });
      const upper = await api.send(ep, { query: { query: q.toUpperCase() }, label: `${ep.id} upper` });
      expectHandled(lower);
      expectHandled(upper);
      expect.soft(upper.status).toBe(lower.status);
    });
    test(`${ep.name}: empty query is rejected or returns empty @negative`, async ({ api }) => {
      const r = await api.send(ep, { query: { query: '' } });
      expectHandled(r);
    });

      test(`${ep.name}: missing query param is handled @negative`, async ({ api }) => {
      const r = await api.send(ep, { query: { query: undefined } });
      expectHandled(r);
    });

    standardNegativeCases(ep);
    queryEdgeCases(ep, ['page_size']);
  });
}

test.describe('04 Search › Buckets', () => {
  test('Unknown bucket is rejected @negative', async ({ api }) => {
    const r = await api.send(EP.SEARCH_MOVIES, { query: { bucket: s.invalidBucket } });
    expectRejected(r, [400, 422]);
  });
 
test('Each documented bucket handles every valid term @positive', async ({ api }) => {
  for (const bucket of s.buckets) {
    for (const term of s.validTerms) {
      await test.step(`${bucket} / ${term}`, async () => {
        const r = await api.send(EP.SEARCH_MOVIES, {
          query: { bucket, query: term },
          label: `search ${bucket}/${term}`,
        });

        // HTTP status must be successful.
        expect(r.status, `${bucket} / ${term}: HTTP status`).toBeGreaterThanOrEqual(200);
        expect(r.status, `${bucket} / ${term}: HTTP status`).toBeLessThan(300);

        // The response must be valid JSON.
        expect(r.json, `${bucket} / ${term}: response must be JSON`).toBeTruthy();

        const body = r.json;

        if (body.status === true) {
          // Successful search response.
          expect(body.error, `${bucket} / ${term}: unexpected error`).toBeFalsy();
        } else {
          // Accept only the documented no-results response.
          expect(
            body.error?.message,
            `${bucket} / ${term}: unexpected API failure`,
          ).toBe('No search results found');
        }
      });
    }
  }
});

});
