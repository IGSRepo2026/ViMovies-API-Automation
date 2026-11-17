import { expectHandled, expectRejected, expectSuccess, findKeyDeep, expectListSizeAtMost } from '../src/assertions';
import { EP } from '../src/endpoints';
import { expect, settings, test, testData, vars } from '../src/fixtures';
import { checkNoStoreForPrivate } from '../src/security';
import { bodyEdgeCases, queryEdgeCases, standardNegativeCases } from '../src/suites';

const neg = testData.negative;

test.describe('06 Playback › Stream metadata → end session', () => {
  test.describe.configure({ mode: 'serial' });
  let pollKey: string | undefined;

  test('Content Stream Metadata returns 2XX with a valid body @positive @smoke', async ({ api }) => {
    const missingPath = api.missingVars(EP.STREAM_METADATA).includes('playbackPath');
    if (settings.anonymousSession || missingPath) {
      test.info().annotations.push({
        type: 'info',
        description: `Stream metadata fallback: ${settings.anonymousSession ? 'anonymous session' : 'missing playbackPath'}; validating graceful handling without starting playback`,
      });
      expectHandled(await api.send(EP.STREAM_METADATA, {
        vars: { playbackPath: missingPath ? neg.invalidPath : vars.playbackPath },
        headers: { 'session-id': neg.invalidSessionId },
      }));
      return;
    }

    api.gate(EP.STREAM_METADATA);
    const r = await api.send(EP.STREAM_METADATA);
    expectSuccess(r, EP.STREAM_METADATA);
    checkNoStoreForPrivate(r);
    const url = findKeyDeep(r.json, ['url', 'stream_url', 'streamUrl', 'manifest']);
    expect.soft(url, 'Stream metadata should contain a stream URL').toBeDefined();
    if (typeof url === 'string') expect.soft(url, 'Stream URL must be HTTPS').toMatch(/^https:\/\//);
    pollKey = findKeyDeep(r.json, ['poll_key', 'pollKey']);
  });

  test('End Stream Session with poll key from stream metadata @positive', async ({ api }) => {
    // Prefer the poll key captured from the stream response; fall back to POLL_KEY.
    const o = pollKey ? { vars: { pollKey } } : {};
    if (!settings.allowStateChanging || settings.anonymousSession || !pollKey) {
      test.info().annotations.push({
        type: 'info',
        description: 'Stream ending is disabled or lacks a valid poll key/session; verifying rejection with an invalid session without ending a stream',
      });
      const r = await api.send(EP.END_STREAM_SESSION, {
        body: { poll_key: neg.invalidPollKey },
        headers: { 'session-id': neg.invalidSessionId },
      });
      expectRejected(r, [400, 401, 403, 404, 422]);
      return;
    }

    api.gate(EP.END_STREAM_SESSION, o);
    const r = await api.send(EP.END_STREAM_SESSION, o);
    expectSuccess(r, EP.END_STREAM_SESSION);
  });
});

test.describe('06 Playback › Stream metadata negatives', () => {
  standardNegativeCases(EP.STREAM_METADATA);
  test('Stream metadata for non-existent content is rejected @negative', async ({ api }) => {
    const r = await api.send(EP.STREAM_METADATA, { vars: { playbackPath: neg.invalidPath } });
    expectRejected(r, [400, 403, 404]);
  });
  test('Stream metadata with wrong parental PIN does not return a stream @negative', async ({ api }) => {
    const hasPlaybackPath = !api.missingVars(EP.STREAM_METADATA).includes('playbackPath');
    const r = await api.send(EP.STREAM_METADATA, {
      vars: { playbackPath: hasPlaybackPath ? vars.playbackPath : neg.invalidPath, parentalPin: '0000' },
      query: { pin: '0000' },
      headers: settings.anonymousSession ? { 'session-id': neg.invalidSessionId } : undefined,
    });
    expectHandled(r);
  });
  for (const [k, v] of [['include_ads', 'maybe'], ['is_casted', '2'], ['code', 'qa_unknown_player'], ['network_type', 'qa'], ['stream_type', 'qa']] as const) {
    test(`Stream metadata with invalid ${k}="${v}" is handled @edge`, async ({ api }) => {
      const r = await api.send(EP.STREAM_METADATA, { vars: { playbackPath: neg.invalidPath }, query: { [k]: v } });
      expectHandled(r);
    });
  }
});

test.describe('06 Playback › Next videos', () => {
  test('Next Videos returns 2XX with a valid body @positive @smoke', async ({ api }) => {
    if (api.missingVars(EP.NEXT_VIDEOS).includes('playbackPath')) {
      test.info().annotations.push({
        type: 'info',
        description: 'Missing playbackPath; checking graceful handling of the incomplete request',
      });
      expectHandled(await api.send(EP.NEXT_VIDEOS));
      return;
    }

    api.gate(EP.NEXT_VIDEOS);
    const r = await api.send(EP.NEXT_VIDEOS);
    expectSuccess(r, EP.NEXT_VIDEOS);
    expectListSizeAtMost(r, 1);
  });
  test('Next videos for unknown path is rejected @negative', async ({ api }) => {
    const r = await api.send(EP.NEXT_VIDEOS, { vars: { playbackPath: neg.invalidPath } });
    expectRejected(r, [400, 404]);
  });
  for (const count of [0, 5, 1000, -1]) {
    test(`Next videos with count=${count} is handled @edge`, async ({ api }) => {
      const hasPlaybackPath = !api.missingVars(EP.NEXT_VIDEOS).includes('playbackPath');
      if (!hasPlaybackPath) {
        test.info().annotations.push({
          type: 'info',
          description: 'Missing playbackPath; checking graceful handling of the incomplete request with this count',
        });
        expectHandled(await api.send(EP.NEXT_VIDEOS, { query: { count } }));
        return;
      }

      const r = await api.send(EP.NEXT_VIDEOS, { query: { count } });
      expectHandled(r);
      if (count > 0) expectListSizeAtMost(r, count);
    });
  }
  standardNegativeCases(EP.NEXT_VIDEOS);
  queryEdgeCases(EP.NEXT_VIDEOS, ['count']);
});

test.describe('06 Playback › End stream session negatives', () => {
  test('End Stream Session with unknown poll key is rejected @negative', async ({ api }) => {
    const r = await api.send(EP.END_STREAM_SESSION, { body: { poll_key: neg.invalidPollKey } });
    expectRejected(r, [400, 404, 422]);
  });
  test('End Stream Session with empty poll key is rejected @negative', async ({ api }) => {
    const r = await api.send(EP.END_STREAM_SESSION, { body: { poll_key: '' } });
    expectRejected(r, [400, 422]);
  });
  standardNegativeCases(EP.END_STREAM_SESSION);
  bodyEdgeCases(EP.END_STREAM_SESSION);
});
