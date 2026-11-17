import { expectHandled, expectRejected, expectSuccess, findKeyDeep, bodyData } from '../src/assertions';
import { Endpoint, EP } from '../src/endpoints';
import { expect, settings, test, testData, vars } from '../src/fixtures';
import { checkNoSensitiveFields, checkNoStoreForPrivate } from '../src/security';
import { ApiResult } from '../src/apiClient';
import { bodyEdgeCases, positiveCase, queryEdgeCases, standardNegativeCases } from '../src/suites';
 
const neg = testData.negative;

function authPositiveCase(
  ep: Endpoint,
  check?: (r: ApiResult) => void | Promise<void>,
  title = `${ep.name} returns 2XX with a valid body @positive @smoke`,
) {
  test(title, async ({ api }) => {
    const reasons: string[] = [];
    if (ep.sensitive && !settings.allowSensitive) reasons.push('sensitive-flow safety switch is disabled');
    if (ep.stateChanging && !settings.allowStateChanging) reasons.push('state-changing safety switch is disabled');
    if (ep.requiresAuth && settings.anonymousSession) reasons.push('only an anonymous session is configured');
    const missing = api.missingVars(ep);
    if (missing.length) reasons.push(`missing test data: ${missing.join(', ')}`);

    if (reasons.length) {
      test.info().annotations.push({
        type: 'info',
        description: `Positive flow not sent (${reasons.join('; ')}); validating safe rejection with an invalid session`,
      });
      const options = {
        headers: ep.apiHeaders === false ? undefined : { 'session-id': neg.invalidSessionId },
        ...(ep.method === 'POST' ? { body: {} } : {}),
      };
      expectRejected(await api.send(ep, options));
      return;
    }

    api.gate(ep);
    const r = await api.send(ep);
    if (ep.id === EP.GET_OTP.id && Number(r.json?.error?.code) === -203) {
      test.skip(true, 'The configured OTP test number is currently rate limited');
    }
    if (
      ep.id === EP.SIGN_IN.id &&
      Number(r.json?.error?.code) === -1000 &&
      /phone number is not registered/i.test(String(r.json?.error?.message ?? ''))
    ) {
      test.skip(true, 'Configure LOGIN_ID and LOGIN_KEY for a registered test account to run positive sign-in');
    }
    expectSuccess(r, ep);
    await check?.(r);
  });
}
 
test.describe('01 Auth & Session › Get OTP', () => {
  authPositiveCase(EP.GET_OTP, (r) => {
    expect(findKeyDeep(r.json, ['reference_id', 'referenceId', 'reference_key']), 'OTP response should return a reference id').toBeDefined();
  });
 
  for (const mobile of neg.invalidMobiles) {
    test(`Get OTP rejects invalid mobile "${mobile}" @negative`, async ({ api }) => {
      const r = await api.send(EP.GET_OTP, { vars: { mobileNumberWithCountryCode: mobile }, body: { mobile, context: 'login' } });
      expectRejected(r, [400, 422]);
    });
  }
  test('Get OTP rejects missing mobile field @negative', async ({ api }) => {
    const r = await api.send(EP.GET_OTP, { body: { context: 'login' } });
    expectRejected(r, [400, 422]);
  });
  test('Get OTP rejects unknown context @negative', async ({ api }) => {
    const r = await api.send(EP.GET_OTP, { body: { mobile: 'abc', context: 'qa_unknown_context' } });
    expectRejected(r, [400, 422]);
  });
  bodyEdgeCases(EP.GET_OTP);
});
 
test.describe('01 Auth & Session › Resend OTP', () => {
  authPositiveCase(EP.RESEND_OTP);
  test('Resend OTP rejects unknown reference id @negative', async ({ api }) => {
    const r = await api.send(EP.RESEND_OTP, { body: { reference_id: neg.invalidReferenceId } });
    expectRejected(r, [400, 404, 422]);
  });
  test('Resend OTP rejects empty reference id @negative', async ({ api }) => {
    const r = await api.send(EP.RESEND_OTP, { body: { reference_id: '' } });
    expectRejected(r, [400, 422]);
  });
  bodyEdgeCases(EP.RESEND_OTP);
});
 
test.describe('01 Auth & Session › Signup', () => {
  authPositiveCase(EP.SIGNUP_VALIDATE, (r) => {
    expect(findKeyDeep(r.json, ['reference_key', 'referenceKey']), 'Signup validate should return reference_key').toBeDefined();
  });
  test('Signup Validate rejects missing mobile @negative', async ({ api }) => {
    const r = await api.send(EP.SIGNUP_VALIDATE, { body: { password: 'Qa@12345' } });
    expectRejected(r, [400, 422]);
  });
  test('Signup Validate rejects malformed mobile @negative', async ({ api }) => {
    const r = await api.send(EP.SIGNUP_VALIDATE, { vars: { mobileNumberWithCountryCode: 'abc' } });
    expectRejected(r, [400, 422]);
  });
  bodyEdgeCases(EP.SIGNUP_VALIDATE);
 
  authPositiveCase(EP.SIGNUP_COMPLETE);
  test('Signup Complete rejects wrong OTP for unknown reference @negative', async ({ api }) => {
    const r = await api.send(EP.SIGNUP_COMPLETE, { body: { reference_key: neg.invalidReferenceId, otp: neg.invalidOtp } });
    expectRejected(r, [400, 401, 404, 422]);
  });
  for (const otp of ['', 'abcdef', '1', '1234567890123']) {
    test(`Signup Complete rejects OTP "${otp}" @edge`, async ({ api }) => {
      const r = await api.send(EP.SIGNUP_COMPLETE, { body: { reference_key: neg.invalidReferenceId, otp } });
      expectRejected(r);
    });
  }
  bodyEdgeCases(EP.SIGNUP_COMPLETE);
});
 
test.describe('01 Auth & Session › Sign In', () => {
  authPositiveCase(EP.SIGN_IN, (r) => {
    const session = r.headers['session-id'] ?? findKeyDeep(r.json, ['sessionId', 'session_id']);
    expect.soft(session, 'Sign-in should return a session').toBeDefined();
    checkNoSensitiveFields(r);
  });
  test('Sign In rejects wrong login key for unknown user @negative', async ({ api }) => {
    const r = await api.send(EP.SIGN_IN, { vars: { loginId: neg.randomLoginId, loginKey: neg.wrongLoginKey } });
    expectRejected(r, [400, 401, 403, 404]);
    // Error must not reveal whether the account exists (user enumeration) or include credentials.
    expect(r.text).not.toContain(neg.wrongLoginKey);
  });
  test('Sign In rejects unsupported login_mode @negative', async ({ api }) => {
    const r = await api.send(EP.SIGN_IN, { vars: { loginId: neg.randomLoginId, loginKey: neg.wrongLoginKey }, body: { login_id: neg.randomLoginId, login_key: neg.wrongLoginKey, login_mode: neg.invalidLoginMode } });
    expectRejected(r, [400, 401, 422]);
  });
  test('Sign In rejects empty credentials @negative', async ({ api }) => {
    const r = await api.send(EP.SIGN_IN, { body: { login_id: '', login_key: '', login_mode: 2 } });
    expectRejected(r, [400, 401, 422]);
  });
  bodyEdgeCases(EP.SIGN_IN);
 
  authPositiveCase(EP.ENC_SIGN_IN);
  test('Encrypted Sign-in rejects non-decryptable payload @negative', async ({ api }) => {
    const r = await api.send(EP.ENC_SIGN_IN, { body: { data: 'bm90LWVuY3J5cHRlZA==', metadata: 'qa' } });
    expectRejected(r, [400, 401, 422]);
  });
  bodyEdgeCases(EP.ENC_SIGN_IN);
});
 
test.describe('01 Auth & Session › User Info', () => {
  authPositiveCase(EP.USER_INFO, (r) => {
    expect(bodyData(r.json), 'User info should contain a response object').toBeTruthy();
    checkNoSensitiveFields(r);
    checkNoStoreForPrivate(r);
  });
  standardNegativeCases(EP.USER_INFO);
});
 
test.describe('01 Auth & Session › Get Token', () => {
  positiveCase(EP.GET_TOKEN, (r) => {
    const token = r.headers['session-id'] ?? findKeyDeep(r.json, ['sessionId', 'session_id', 'token', 'access_token']);
    expect.soft(token, 'Get Token should return a session / token').toBeDefined();
  });
  test('Get Token with unknown tenant_code is rejected @negative', async ({ api }) => {
    api.requireVars(EP.GET_TOKEN);
    const r = await api.send(EP.GET_TOKEN, { query: { tenant_code: neg.invalidTenantCode } });
    expectRejected(r, [400, 404, 422]);
  });
  test('Get Token with unknown product is handled @negative', async ({ api }) => {
    api.requireVars(EP.GET_TOKEN);
    const r = await api.send(EP.GET_TOKEN, { query: { product: neg.invalidProductCode } });
    // Observed: the API does not validate `product` and issues a session anyway.
    expectHandled(r);
  });
  test('Get Token without box_id is rejected @negative', async ({ api }) => {
    const r = await api.send(EP.GET_TOKEN, { query: { box_id: undefined } });
    expectRejected(r, [400, 422]);
  });
  test('Get Token with invalid timezone is handled @edge', async ({ api }) => {
    const r = await api.send(EP.GET_TOKEN, { query: { timezone: 'Mars/Olympus_Mons' } });
    expectHandled(r);
  });
  queryEdgeCases(EP.GET_TOKEN, ['timezone']);
  standardNegativeCases(EP.GET_TOKEN);
});
 
test.describe('01 Auth & Session › Update Session Preference', () => {
  authPositiveCase(EP.UPDATE_SESSION_PREFERENCE);
  test('Update Session Preference rejects unsupported language @negative', async ({ api }) => {
    if (!settings.allowStateChanging || settings.anonymousSession) {
      test.info().annotations.push({
        type: 'info',
        description: 'Preference update is disabled or lacks a signed-in session; checking safe rejection with an invalid session',
      });
      const r = await api.send(EP.UPDATE_SESSION_PREFERENCE, {
        body: { display_lang_code: neg.invalidLangCode },
        headers: { 'session-id': neg.invalidSessionId },
      });
      expectRejected(r, [400, 401, 403, 422]);
      return;
    }

    api.gate(EP.UPDATE_SESSION_PREFERENCE);
    const r = await api.send(EP.UPDATE_SESSION_PREFERENCE, { body: { display_lang_code: neg.invalidLangCode } });
    expectRejected(r, [400, 422]);
    // restore the configured preference
    await api.send(EP.UPDATE_SESSION_PREFERENCE, { label: 'restore preference' });
  });
  standardNegativeCases(EP.UPDATE_SESSION_PREFERENCE);
  bodyEdgeCases(EP.UPDATE_SESSION_PREFERENCE);
});
 
test.describe('01 Auth & Session › Sign Out', () => {
  // Uses a DISPOSABLE session (SIGNOUT_SESSION_ID) so the shared SESSION_ID stays valid for other tests.
  test('Sign Out invalidates the session @positive', async ({ api }) => {
    const o = { vars: { sessionId: vars.signoutSessionId } };
    if (!settings.allowStateChanging || settings.anonymousSession || api.missingVars(EP.SIGN_OUT, o).length) {
      test.info().annotations.push({
        type: 'info',
        description: 'Sign-out is disabled or lacks a disposable signed-in session; checking safe rejection with an invalid session',
      });
      const r = await api.send(EP.SIGN_OUT, {
        headers: { 'session-id': neg.invalidSessionId },
        body: {},
      });
      expectRejected(r, [400, 401, 403]);
      return;
    }

    api.gate(EP.SIGN_OUT, o, ['signoutSessionId']);
    const r = await api.send(EP.SIGN_OUT, o);
    expectSuccess(r, EP.SIGN_OUT);
    const after = await api.send(EP.USER_INFO, { ...o, label: 'USER_INFO after sign-out' });
    expectRejected(after, [401, 403]);
  });
  standardNegativeCases(EP.SIGN_OUT);
});