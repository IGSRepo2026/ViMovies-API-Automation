/**
 * Response-time checks. Every request in the suite is already timed against its SLA (soft);
 * this spec samples each safe endpoint several times and asserts on the percentiles.
 * Sequential and low-volume on purpose - this is not a load test.
 */
import { slaFor, expectNo5xx } from '../src/assertions';
import { ALL_ENDPOINTS, isSafe } from '../src/endpoints';
import { expect, settings, test } from '../src/fixtures';

const pct = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];

for (const ep of ALL_ENDPOINTS.filter(isSafe)) {
  test(`Response time: ${ep.id} p95 within SLA @perf`, async ({ api }) => {
    const missingVars = api.missingVars(ep).filter((key) => key !== ep.base);
    const fallbackVars = Object.fromEntries(missingVars.map((key) => [key, `qa-perf-invalid-${key}`]));
    const fallbackReasons: string[] = [];
    if (missingVars.length) fallbackReasons.push(`missing data: ${missingVars.join(', ')}`);
    const anonymousAuthFallback = !!ep.requiresAuth && settings.anonymousSession;
    if (anonymousAuthFallback) fallbackReasons.push('anonymous session: using invalid-session rejection');

    if (fallbackReasons.length) {
      test.info().annotations.push({ type: 'info', description: `Safe performance fallback; ${fallbackReasons.join('; ')}` });
    }

    const sla = slaFor(ep);
    const times: number[] = [];

    for (let i = 0; i < settings.perfSamples; i++) {
      const r = await api.send(ep, {
        vars: fallbackVars,
        headers: anonymousAuthFallback ? { 'session-id': 'qa-invalid-performance-session' } : undefined,
        label: `${ep.id} ${fallbackReasons.length ? 'fallback ' : ''}sample ${i + 1}`,
      });
      expectNo5xx(r);
      times.push(r.durationMs);
    }

    const sorted = [...times].sort((a, b) => a - b);
    const stats = {
      samples: times.length,
      min: sorted[0],
      avg: Math.round(times.reduce((a, b) => a + b, 0) / times.length),
      p50: pct(sorted, 50),
      p95: pct(sorted, 95),
      max: sorted[sorted.length - 1],
      slaMs: sla,
      measurement: fallbackReasons.length ? 'safe-fallback' : 'configured-data',
    };
    test.info().annotations.push({ type: 'perf', description: JSON.stringify(stats) });
    await test.info().attach(`${ep.id} timings`, { contentType: 'application/json', body: JSON.stringify({ ...stats, times }, null, 2) });

    expect(stats.p95, `${ep.id} p95 ${stats.p95}ms > SLA ${sla}ms`).toBeLessThanOrEqual(sla);
    // The first call may include TLS/DNS setup; average must also stay within SLA.
    expect.soft(stats.avg, `${ep.id} average ${stats.avg}ms > SLA ${sla}ms`).toBeLessThanOrEqual(sla);
  });
}
