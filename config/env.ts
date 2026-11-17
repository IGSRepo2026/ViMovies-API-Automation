import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(ROOT, '.env') });

export type Vars = Record<string, string>;

export interface BodyContract {
  statusField: string;
  successValues: unknown[];
  failureValues: unknown[];
  dataField: string;
  errorField: string;
}

/** Every variable in the Postman collection, plus framework-only extras (marked). */
export const VARIABLE_KEYS = [
  'apiBaseUrl', 'searchBaseUrl', 'webBaseUrl', 'packageBaseUrl',
  'boxId', 'sessionId', 'signoutSessionId' /* extra */, 'tenantCode', 'productCode',
  'mobileNumberWithCountryCode', 'otpReferenceId', 'otpCode', 'testPassword', 'signupReferenceKey',
  'loginKey', 'loginId', 'osVersion', 'appVersion', 'manufacturer', 'deviceId', 'deviceSubType',
  'displayLanguageCode', 'timezone', 'timestamp', 'contentPath', 'playbackPath', 'parentalPin',
  'pollKey', 'sectionCode', 'tvShowPath', 'deeplinkPath', 'sectionPath', 'partnerCode',
  'activationPasscode', 'clientType', 'searchQuery', 'liveSearchQuery', 'encryptedSigninData',
  'encryptedSigninMetadata', 'encryptedIdentifier', 'nextBuildId', 'movieSlug', 'deviceToDelinkBoxId',
  'deviceType', 'packageId', 'paymentGateway', 'orderId',
] as const;

export const ENV_NAME = process.env.TEST_ENV || 'prod';

const envFile = path.join(ROOT, 'config', 'environments', `${ENV_NAME}.json`);
if (!fs.existsSync(envFile)) {
  throw new Error(`Unknown TEST_ENV "${ENV_NAME}": ${envFile} does not exist`);
}
const envJson = JSON.parse(fs.readFileSync(envFile, 'utf8'));

/** apiBaseUrl -> API_BASE_URL */
export const toEnvKey = (key: string) => key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase();

function buildVars(): Vars {
  const vars: Vars = { ...(envJson.variables ?? {}) };
  for (const key of VARIABLE_KEYS) {
    const fromEnv = process.env[toEnvKey(key)];
    if (fromEnv !== undefined && fromEnv !== '') vars[key] = fromEnv;
  }
  return vars;
}

const flag = (name: string, fallback = false) => {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : /^(1|true|yes|on)$/i.test(v);
};
const num = (name: string, fallback: number) => {
  const v = Number(process.env[name]);
  return process.env[name] && Number.isFinite(v) ? v : fallback;
};

export const vars: Vars = buildVars();

export const settings = {
  envName: ENV_NAME,
  allowStateChanging: flag('ALLOW_STATE_CHANGING'),
  allowSensitive: flag('ALLOW_SENSITIVE'),
  runRateLimitTests: flag('RUN_RATE_LIMIT_TESTS'),
  autoToken: flag('AUTO_TOKEN', true),
  /** Set by global setup when SESSION_ID came from AUTO_TOKEN (not a signed-in user). */
  anonymousSession: flag('SESSION_IS_ANONYMOUS'),
  strictHttpErrors: flag('STRICT_HTTP_ERRORS', envJson.strictHttpErrors ?? false),
  defaultSlaMs: num('DEFAULT_SLA_MS', envJson.sla?.defaultMs ?? 2000),
  slaOverrides: (envJson.sla?.overrides ?? {}) as Record<string, number>,
  perfSamples: num('PERF_SAMPLES', 5),
  workers: num('WORKERS', 2),
  requestTimeoutMs: num('REQUEST_TIMEOUT_MS', 30_000),
  faultInjectionUrl: process.env.FAULT_INJECTION_URL || '',
  bodyContract: envJson.bodyContract as BodyContract,
};
