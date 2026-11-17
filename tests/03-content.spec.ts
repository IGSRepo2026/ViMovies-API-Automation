import { bodyData, expectHandled, expectListSizeAtMost, expectRejected, expectSuccess, isRegionUnavailable, isRejection } from '../src/assertions';
import { EP, Endpoint } from '../src/endpoints';
import { expect, test, testData } from '../src/fixtures';
import { positiveCase, queryEdgeCases, standardNegativeCases } from '../src/suites';

const neg = testData.negative;
const edge = testData.edge;
const sd = testData.sectionData;

const hasData = (r: { json: any }) => expect(bodyData(r.json), 'Page content should contain a response payload').toBeTruthy();

const PAGE_ENDPOINTS: Endpoint[] = [EP.HOME_PAGE, EP.SEARCH_PAGE, EP.SPORTS_PAGE, EP.ORIGINALS_PAGE, EP.TV_SHOW_PAGE, EP.SECTION_PAGE];

test.describe('03 Content › Page content', () => {
  for (const ep of PAGE_ENDPOINTS) {
    test.describe(ep.name, () => {
      positiveCase(ep, hasData);
      standardNegativeCases(ep);
    });
  }

  test.describe(EP.PARTNER_PAGE.name, () => {
    test('Partner Page Content returns 2XX with a valid body @positive @smoke', async ({ api }) => {
      const r = await api.send(EP.PARTNER_PAGE);
      test.skip(isRegionUnavailable(r), 'Partner content is not available in the configured region');
      expectSuccess(r, EP.PARTNER_PAGE);
      hasData(r);
    });
    standardNegativeCases(EP.PARTNER_PAGE);
  });

  test('Page content for a non-existent path is rejected @negative', async ({ api }) => {
    const r = await api.send(EP.HOME_PAGE, { query: { path: testData.pages.nonExistent } });
    expectRejected(r, [400, 404]);
  });
  test('Page content without path is rejected @negative', async ({ api }) => {
    const r = await api.send(EP.HOME_PAGE, { query: { path: undefined } });
    expectRejected(r, [400, 404, 422]);
  });
  test('Partner page for unknown partner is rejected @negative', async ({ api }) => {
    const r = await api.send(EP.PARTNER_PAGE, { vars: { partnerCode: 'qa-no-such-partner' } });
    expectRejected(r, [400, 404]);
  });
  for (const [label, t] of Object.entries(edge.timestamps)) {
    test(`Page content with ${label} "time" value is handled @edge`, async ({ api }) => {
      const r = await api.send(EP.HOME_PAGE, { query: { time: t } });
      expectHandled(r);
    });
  }
  test('Page content path is case-sensitive or normalised consistently @edge', async ({ api }) => {
    const r = await api.send(EP.HOME_PAGE, { query: { path: 'HOME' } });
    expectHandled(r);
  });
  queryEdgeCases(EP.HOME_PAGE, ['time']);
});

test.describe('03 Content › Section data', () => {
  positiveCase(EP.HOME_SECTION_DATA, (r) => expectListSizeAtMost(r, 15));

  test('Section data honours "count" (boundary: min=1) @edge', async ({ api }) => {
    api.requireVars(EP.HOME_SECTION_DATA);
    const r = await api.send(EP.HOME_SECTION_DATA, { query: { count: sd.counts.min } });
    expectHandled(r);
    expectListSizeAtMost(r, sd.counts.min);
  });
  for (const offset of sd.offsets) {
    test(`Section data with offset ${offset} is handled @edge`, async ({ api }) => {
      api.requireVars(EP.HOME_SECTION_DATA);
      const r = await api.send(EP.HOME_SECTION_DATA, { query: { offset } });
      expectHandled(r);
    });
  }
  for (const [label, count] of Object.entries(sd.counts).filter(([k]) => !['min', 'default'].includes(k))) {
    test(`Section data with ${label} count (${count}) is handled @edge`, async ({ api }) => {
      api.requireVars(EP.HOME_SECTION_DATA);
      const r = await api.send(EP.HOME_SECTION_DATA, { query: { count } });
      expectHandled(r);
      if (label === 'large') expectListSizeAtMost(r, 1000);
    });
  }
  test('Section data with unknown section code is rejected or returns an empty list @negative', async ({ api }) => {
    const r = await api.send(EP.HOME_SECTION_DATA, { vars: { sectionCode: 'qa_no_such_section' } });
    if (isRejection(r)) {
      expectRejected(r, [400, 404]);
      return;
    }
    expectHandled(r);
    expect(r.json).toMatchObject({ status: true, response: [] });
  });
  standardNegativeCases(EP.HOME_SECTION_DATA);
  queryEdgeCases(EP.HOME_SECTION_DATA, ['offset', 'count']);
});

test.describe('03 Content › Deeplink & templates', () => {
  positiveCase(EP.DEEPLINK_TEMPLATE, hasData);
  test('Deeplink for unknown target path is rejected @negative', async ({ api }) => {
    const r = await api.send(EP.DEEPLINK_TEMPLATE, { vars: { deeplinkPath: neg.invalidPath } });
    expectRejected(r, [400, 404]);
  });
  test('Deeplink with unknown template_code is rejected @negative', async ({ api }) => {
    const r = await api.send(EP.DEEPLINK_TEMPLATE, { vars: { deeplinkPath: neg.invalidPath }, query: { template_code: 'qa_no_such_template' } });
    expectRejected(r, [400, 404]);
  });
  standardNegativeCases(EP.DEEPLINK_TEMPLATE);
  queryEdgeCases(EP.DEEPLINK_TEMPLATE, ['time']);

  positiveCase(EP.TEMPLATES, hasData);
  standardNegativeCases(EP.TEMPLATES);
});

test.describe('03 Content › Activate TV / Validate passcode', () => {
  positiveCase(EP.VALIDATE_PASSCODE);
  standardNegativeCases(EP.VALIDATE_PASSCODE);
  for (const key of [neg.invalidPasscode, '', 'ABCDEF', '1', '9'.repeat(64)]) {
    test(`Validate passcode rejects "${key.slice(0, 12)}" @negative`, async ({ api }) => {
      api.requireVars(EP.VALIDATE_PASSCODE, { vars: { activationPasscode: 'x' } });
      const r = await api.send(EP.VALIDATE_PASSCODE, { query: { key } });
      expectRejected(r, [400, 404, 422]);
    });
  }
  test('Validate passcode without key is rejected @negative', async ({ api }) => {
    const r = await api.send(EP.VALIDATE_PASSCODE, { query: { key: undefined } });
    expectRejected(r, [400, 422]);
  });
});
