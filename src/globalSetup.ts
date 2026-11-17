import { request } from '@playwright/test';
import { randomUUID } from 'crypto';
import { settings, vars } from '../config/env';
import { isUnset, resolveTemplate } from './apiClient';
import { findKeyDeep } from './assertions';
import { EP } from './endpoints';

async function configuredSessionIsRejected(): Promise<boolean | undefined> {
  const missing = new Set<string>();
  const endpoint = EP.SYSTEM_CONFIG;
  const url = resolveTemplate(`{{${endpoint.base}}}${endpoint.path}`, vars, missing);
  if (missing.size) return undefined;

  const ctx = await request.newContext();
  try {
    const res = await ctx.get(url, {
      headers: {
        'tenant-code': vars.tenantCode,
        'box-id': vars.boxId,
        'session-id': vars.sessionId,
      },
      timeout: settings.requestTimeoutMs,
    });
    if (res.status() === 401 || res.status() === 403) return true;
    if (!res.ok()) return undefined;

    const body = await res.json().catch(() => undefined);
    const error = body?.error;
    return body?.status === false && (
      Number(error?.code) === 401 ||
      /session expired|request token/i.test(String(error?.message ?? ''))
    );
  } finally {
    await ctx.dispose();
  }
}

/**
 * AUTO_TOKEN=true (default) and no SESSION_ID: call Get Token once - as the web app does for every
 * visitor - and expose the anonymous session to all workers via process.env (workers start after
 * global setup and inherit it). The YVS APIs reject even public calls without it
 * (error -23 RES_S_ERROR_SIGNIN_REQUEST_TOKEN).
 */
export default async function globalSetup() {
  console.log(`[vimtv] TEST_ENV=${settings.envName} api=${vars.apiBaseUrl} stateChanging=${settings.allowStateChanging} sensitive=${settings.allowSensitive} strict=${settings.strictHttpErrors}`);

  console.log('[vimtv] SESSION DEBUG:', {
  sessionPresent: !isUnset(vars.sessionId),
  sessionLength: vars.sessionId?.length,
  autoToken: settings.autoToken,
  anonymousSession: settings.anonymousSession,
});
  if (!settings.autoToken) return;

  if (isUnset(vars.boxId)) {
    vars.boxId = `qa-${randomUUID()}`;
    process.env.BOX_ID = vars.boxId;
  }

  if (!isUnset(vars.sessionId)) {
    const rejected = await configuredSessionIsRejected();
    if (rejected === undefined) {
      console.warn('[vimtv] Could not validate configured SESSION_ID; keeping it unchanged');
      return;
    }
    if (!rejected) return;
    console.warn('[vimtv] Configured SESSION_ID was rejected; requesting an anonymous session for public tests');
  }

  const missing = new Set<string>();
  const ep = EP.GET_TOKEN;
  const url = resolveTemplate(`{{${ep.base}}}${ep.path}`, vars, missing);
  const params = Object.fromEntries(Object.entries(ep.query!).map(([k, v]) => [k, resolveTemplate(v, vars, missing)]));
  if (missing.size) {
    console.warn(`[vimtv] AUTO_TOKEN skipped - missing ${[...missing].join(', ')}`);
    return;
  }
  const ctx = await request.newContext();
  try {
    const res = await ctx.get(url, { params, headers: { 'tenant-code': vars.tenantCode, 'box-id': params.box_id } });
    const session =
      res.headers()['session-id'] ??
      findKeyDeep(await res.json().catch(() => undefined), ['sessionId', 'session_id', 'session-id', 'sessionid']);
    if (session) {
      process.env.SESSION_ID = String(session);
      process.env.SESSION_IS_ANONYMOUS = 'true';
      console.log('[vimtv] AUTO_TOKEN obtained an anonymous session');
    } else {
      console.warn(`[vimtv] AUTO_TOKEN: no session found in Get Token response (HTTP ${res.status()})`);
    }
  } finally {
    await ctx.dispose();
  }
}
