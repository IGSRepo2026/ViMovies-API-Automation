/**
 * Endpoint registry, mirrored from "VIMTV Web API Collection - Updated from HAR + YVS APIs v1.2".
 * Every value that can vary is a {{variable}} resolved from config/environments/*.json + .env.
 */
export type BaseKey = 'apiBaseUrl' | 'searchBaseUrl' | 'webBaseUrl' | 'packageBaseUrl';
/** yvs = {status, response, error} envelope; next = Next.js page data; any = no body contract */
export type Contract = 'yvs' | 'next' | 'any';
export type Method = 'GET' | 'POST';

export interface Endpoint {
  id: string;
  name: string;
  group: string;
  /** Traceability back to the collection / PDF */
  source: string;
  method: Method;
  base: BaseKey;
  path: string;
  query?: Record<string, string>;
  body?: Record<string, unknown>;
  /** Send box-id / tenant-code / session-id headers (default true) */
  apiHeaders?: boolean;
  /** Needs a signed-in user's session (an anonymous Get Token session is not enough) */
  requiresAuth?: boolean;
  /** Callable without any session-id (only Get Token, which issues the session) */
  noSession?: boolean;
  /** Mutates user/account state: gated by ALLOW_STATE_CHANGING */
  stateChanging?: boolean;
  /** Sends OTP/SMS, creates accounts/orders, uses credentials: gated by ALLOW_SENSITIVE */
  sensitive?: boolean;
  contract?: Contract;
  slaMs?: number;
}

const TS = '{{timestamp}}';

function define<K extends string>(defs: Record<K, Omit<Endpoint, 'id'>>): Record<K, Endpoint> {
  const out = {} as Record<K, Endpoint>;
  for (const id of Object.keys(defs) as K[]) out[id] = { id, ...defs[id] };
  return out;
}

export const EP = define({
  // ---------------- 01 - Authentication & Session ----------------
  GET_OTP: {
    name: 'Get OTP', group: 'auth', source: 'Collection 01/01, PDF API 1',
    method: 'POST', base: 'apiBaseUrl', path: '/service/api/auth/get/otp',
    body: { mobile: '{{mobileNumberWithCountryCode}}', context: 'login' },
    sensitive: true,
  },
  RESEND_OTP: {
    name: 'Resend OTP', group: 'auth', source: 'Collection 01/02, PDF API 2',
    method: 'POST', base: 'apiBaseUrl', path: '/service/api/auth/resend/otp',
    body: { reference_id: '{{otpReferenceId}}' },
    sensitive: true,
  },
  SIGNUP_VALIDATE: {
    name: 'Signup Validate', group: 'auth', source: 'Collection 01/03, PDF API 3',
    method: 'POST', base: 'apiBaseUrl', path: '/service/api/auth/signup/validate',
    body: {
      password: '{{testPassword}}', mobile: '{{mobileNumberWithCountryCode}}', referral_type: '', referral_id: '',
      cookie: '', additional_params: {}, is_header_enrichment: false,
      os_version: '{{osVersion}}', app_version: '{{appVersion}}', manufacturer: '{{manufacturer}}',
    },
    sensitive: true,
  },
  SIGNUP_COMPLETE: {
    name: 'Signup Complete', group: 'auth', source: 'Collection 01/04, PDF API 4',
    method: 'POST', base: 'apiBaseUrl', path: '/service/api/auth/signup/complete',
    body: { reference_key: '{{signupReferenceKey}}', otp: '{{otpCode}}' },
    sensitive: true,
  },
  USER_INFO: {
    name: 'User Info', group: 'auth', source: 'Collection 01/05, PDF API 5',
    method: 'GET', base: 'apiBaseUrl', path: '/service/api/auth/user/info',
    requiresAuth: true,
  },
  SIGN_OUT: {
    name: 'Sign Out', group: 'auth', source: 'Collection 01/06, PDF API 6',
    method: 'POST', base: 'apiBaseUrl', path: '/service/api/auth/signout',
    requiresAuth: true, stateChanging: true,
  },
  GET_TOKEN: {
    name: 'Get Token', group: 'auth', source: 'Collection 01/07, PDF API 7',
    method: 'GET', base: 'apiBaseUrl', path: '/service/api/v1/get/token',
    query: {
      box_id: '{{boxId}}', device_id: '{{deviceId}}', tenant_code: '{{tenantCode}}',
      device_sub_type: '{{deviceSubType?}}', product: '{{productCode}}',
      display_lang_code: '{{displayLanguageCode}}', timezone: '{{timezone}}',
    },
    noSession: true,
  },
  UPDATE_SESSION_PREFERENCE: {
    name: 'Update Session Preference', group: 'auth', source: 'Collection 01/08, PDF API 8',
    method: 'POST', base: 'apiBaseUrl', path: '/service/api/auth/update/session/preference',
    body: { display_lang_code: '{{displayLanguageCode}}' },
    requiresAuth: true, stateChanging: true,
  },
  SIGN_IN: {
    name: 'Sign In', group: 'auth', source: 'Collection 01/01 (Sign In), PDF API 36',
    method: 'POST', base: 'apiBaseUrl', path: '/service/api/auth/v1/signin',
    body: {
      login_key: '{{loginKey}}', login_id: '{{loginId}}', login_mode: 2,
      os_version: '{{osVersion}}', app_version: '{{appVersion}}', manufacturer: '{{manufacturer}}',
    },
    sensitive: true,
  },
  ENC_SIGN_IN: {
    name: 'Encrypted Web Sign-in', group: 'auth', source: 'Collection 08/01 (HAR)',
    method: 'POST', base: 'apiBaseUrl', path: '/service/api/auth/enc/signin/send',
    query: { box_id: '{{boxId}}' },
    body: { data: '{{encryptedSigninData}}', metadata: '{{encryptedSigninMetadata}}' },
    sensitive: true,
  },

  // ---------------- 02 - Favourites ----------------
  FAVOURITES_LIST: {
    name: 'Get Favourite List', group: 'favourites', source: 'Collection 02/01, PDF API 9',
    method: 'GET', base: 'apiBaseUrl', path: '/service/api/v1/page/content',
    query: { path: 'favourites', time: TS },
    requiresAuth: true,
  },
  FAVOURITE_DELETE: {
    name: 'Delete Favourite', group: 'favourites', source: 'Collection 02/02, PDF API 10',
    method: 'GET', base: 'apiBaseUrl', path: '/service/api/auth/user/favourite/item',
    query: { path: '{{contentPath}}', action: '2' },
    requiresAuth: true, stateChanging: true,
  },
  FAVOURITE_ADD: {
    name: 'Add Favourite', group: 'favourites', source: 'Collection 02/03, PDF API 11',
    method: 'GET', base: 'apiBaseUrl', path: '/service/api/auth/user/favourite/item',
    query: { path: '{{contentPath}}', action: '1' },
    requiresAuth: true, stateChanging: true,
  },

  // ---------------- 03 - Home, Content & Discovery ----------------
  HOME_PAGE: {
    name: 'Home Page Content', group: 'content', source: 'Collection 03/01, PDF API 12',
    method: 'GET', base: 'apiBaseUrl', path: '/service/api/v1/page/content',
    query: { path: 'home', time: TS },
  },
  HOME_SECTION_DATA: {
    name: 'Home Section Data', group: 'content', source: 'Collection 03/02, PDF API 13 & 22',
    method: 'GET', base: 'apiBaseUrl', path: '/service/api/v1/section/data',
    query: { path: 'home', code: '{{sectionCode}}', offset: '-1', count: '15', filter: '' },
  },
  TV_SHOW_PAGE: {
    name: 'TV Show Content', group: 'content', source: 'Collection 03/09, PDF API 20',
    method: 'GET', base: 'apiBaseUrl', path: '/service/api/v1/page/content',
    query: { path: '{{tvShowPath}}', time: TS },
  },
  SEARCH_PAGE: {
    name: 'Search Page Content', group: 'content', source: 'Collection 03/10, PDF API 21',
    method: 'GET', base: 'apiBaseUrl', path: '/service/api/v1/page/content',
    query: { path: 'search', time: TS },
  },
  DEEPLINK_TEMPLATE: {
    name: 'Deeplink Template Data', group: 'content', source: 'Collection 03/11, PDF API 23',
    method: 'GET', base: 'apiBaseUrl', path: '/service/api/v1/template/data',
    query: { template_code: 'deeplink_info', path: '{{deeplinkPath}}', time: TS },
  },
  SPORTS_PAGE: {
    name: 'Sports Page Content', group: 'content', source: 'Collection 03/12, PDF API 24',
    method: 'GET', base: 'apiBaseUrl', path: '/service/api/v1/page/content',
    query: { path: 'sports', time: TS },
  },
  ORIGINALS_PAGE: {
    name: 'Originals Page Content', group: 'content', source: 'Collection 03/13, PDF API 25',
    method: 'GET', base: 'apiBaseUrl', path: '/service/api/v1/page/content',
    query: { path: 'originals', time: TS },
  },
  SECTION_PAGE: {
    name: 'View All / Section Page', group: 'content', source: 'Collection 03/14, PDF API 26',
    method: 'GET', base: 'apiBaseUrl', path: '/service/api/v1/page/content',
    query: { path: '{{sectionPath}}', time: TS },
  },
  TEMPLATES: {
    name: 'Templates', group: 'content', source: 'Collection 03/16, PDF API 28',
    method: 'GET', base: 'apiBaseUrl', path: '/service/api/v1/templates',
  },
  VALIDATE_PASSCODE: {
    name: 'Activate TV / Validate Passcode', group: 'content', source: 'Collection 03/17, PDF API 29',
    method: 'GET', base: 'apiBaseUrl', path: '/service/api/auth/validate/passcode',
    query: { key: '{{activationPasscode}}' },
    requiresAuth: true, stateChanging: true,
  },
  PARTNER_PAGE: {
    name: 'Partner Page Content', group: 'content', source: 'Collection 03/18, PDF API 30',
    method: 'GET', base: 'apiBaseUrl', path: '/service/api/v1/page/content',
    query: { path: 'partner/{{partnerCode}}', time: TS },
  },

  // ---------------- 04 - Search ----------------
  SEARCH_MOVIES: {
    name: 'Search Movies', group: 'search', source: 'Collection 04/01, PDF API 31',
    method: 'GET', base: 'searchBaseUrl', path: '/search/api/v3/get/search/query',
    query: { query: '{{searchQuery}}', page_size: '12', bucket: 'movie' },
  },
  SEARCH_TV_SHOWS: {
    name: 'Search TV Shows (Group List)', group: 'search', source: 'Collection 04/02, PDF API 32',
    method: 'GET', base: 'searchBaseUrl', path: '/search/api/v3/get/search/query',
    query: { query: '{{searchQuery}}', page_size: '12', bucket: 'grouplist' },
  },
  SEARCH_TV_SHOW_VIDEOS: {
    name: 'Search TV Show Videos', group: 'search', source: 'Collection 04/03, PDF API 33 (bucket to confirm)',
    method: 'GET', base: 'searchBaseUrl', path: '/search/api/v3/get/search/query',
    query: { query: '{{searchQuery}}', page_size: '12', bucket: 'grouplist' },
  },
  SEARCH_LIVE_CHANNELS: {
    name: 'Search Live Channels', group: 'search', source: 'Collection 04/04, PDF API 34',
    method: 'GET', base: 'searchBaseUrl', path: '/search/api/v3/get/search/query',
    query: { query: '{{liveSearchQuery}}', page_size: '12', bucket: 'channel' },
  },

  // ---------------- 05 - Subscription, Packages & Payments ----------------
  PACKAGE_CATALOGUE: {
    name: 'Package Catalogue', group: 'packages', source: 'Collection 05/01, PDF API 35',
    method: 'GET', base: 'packageBaseUrl', path: '/package/api/v1/packages/info',
    query: { skip_package_content: 'false' },
    requiresAuth: true, // observed: -1000 "You are not logged in" with an anonymous session
  },
  ACTIVE_PACKAGES: {
    name: 'Active Packages', group: 'packages', source: 'Collection 03/15 + 05/02, PDF API 27',
    method: 'GET', base: 'apiBaseUrl', path: '/service/api/auth/user/activepackages',
    requiresAuth: true,
  },
  CHECKOUT_ORDER: {
    name: 'Create Checkout Order', group: 'packages', source: 'Collection 08/08 (HAR) - sandbox only',
    method: 'POST', base: 'apiBaseUrl', path: '/payment/api/v1/order/checkout',
    body: { packages: '{{packageId}}', gateway: '{{paymentGateway}}' },
    requiresAuth: true, stateChanging: true, sensitive: true,
  },
  ORDER_STATUS: {
    name: 'Get Order Status', group: 'packages', source: 'Collection 08/09 (HAR)',
    method: 'GET', base: 'apiBaseUrl', path: '/payment/api/v1/order/status',
    query: { order_id: '{{orderId}}' },
    requiresAuth: true,
  },

  // ---------------- 06 - Playback & Stream Session ----------------
  STREAM_METADATA: {
    name: 'Content Stream Metadata', group: 'playback', source: 'Collection 06/03, PDF API 14',
    method: 'GET', base: 'apiBaseUrl', path: '/service/api/v1/page/stream',
    query: {
      path: '{{playbackPath}}', code: 'video_player', stream_type: '', network_type: '', time: TS,
      include_ads: 'false', is_casted: 'false', pin: '{{parentalPin?}}',
    },
    requiresAuth: true,
  },
  NEXT_VIDEOS: {
    name: 'Next Videos', group: 'playback', source: 'Collection 06/04, PDF API 15',
    method: 'GET', base: 'apiBaseUrl', path: '/service/api/v1/next/videos',
    query: { path: '{{playbackPath}}', count: '1' },
  },
  END_STREAM_SESSION: {
    name: 'End Stream Session', group: 'playback', source: 'Collection 06/05, PDF API 16',
    method: 'POST', base: 'apiBaseUrl', path: '/service/api/v1/stream/session/end',
    body: { poll_key: '{{pollKey}}' },
    requiresAuth: true, stateChanging: true,
  },

  // ---------------- 07 - System & Configuration ----------------
  SYSTEM_FEATURE: {
    name: 'System Feature', group: 'system', source: 'Collection 07/06, PDF API 17',
    method: 'GET', base: 'apiBaseUrl', path: '/service/api/v1/system/feature',
  },
  SYSTEM_CONFIG: {
    name: 'System Config', group: 'system', source: 'Collection 07/07, PDF API 18',
    method: 'GET', base: 'apiBaseUrl', path: '/service/api/v1/system/config',
  },
  LOCATION_INFO: {
    name: 'Location Info', group: 'system', source: 'Collection 07/08, PDF API 19',
    method: 'GET', base: 'apiBaseUrl', path: '/service/location/api/v1/locationinfo',
    query: { tenant_code: '{{tenantCode}}', product: '{{productCode}}', client: '{{clientType}}' },
  },

  // ---------------- 08 - Web capture routes & devices ----------------
  WEB_LOGOUT: {
    name: 'Web Logout Route', group: 'web', source: 'Collection 08/02 (HAR)',
    method: 'GET', base: 'webBaseUrl', path: '/api/logout',
    apiHeaders: false, contract: 'any',
  },
  WEB_HOME_DATA: {
    name: 'Web Home Page Data', group: 'web', source: 'Collection 08/03 (HAR, Next.js)',
    method: 'GET', base: 'webBaseUrl', path: '/_next/data/{{nextBuildId}}/home.json',
    query: { slug: 'home' }, apiHeaders: false, contract: 'next',
  },
  WEB_MOVIE_DATA: {
    name: 'Web Movie Page Data', group: 'web', source: 'Collection 08/04 (HAR, Next.js)',
    method: 'GET', base: 'webBaseUrl', path: '/_next/data/{{nextBuildId}}/movie/{{movieSlug}}.json',
    apiHeaders: false, contract: 'next',
  },
  WEB_PLANS_DATA: {
    name: 'Web Plans Page Data', group: 'web', source: 'Collection 08/05 (HAR, Next.js)',
    method: 'GET', base: 'webBaseUrl', path: '/_next/data/{{nextBuildId}}/plans/list.json',
    apiHeaders: false, contract: 'next',
  },
  LINKED_DEVICES: {
    name: 'List Linked Devices', group: 'devices', source: 'Collection 08/06 (HAR)',
    method: 'GET', base: 'apiBaseUrl', path: '/service/api/auth/linked/devices/list',
    query: { version: '2', identifierType: 'mobile', identifier: '{{encryptedIdentifier}}', box_id: '{{boxId}}' },
    requiresAuth: true,
  },
  DELINK_DEVICE: {
    name: 'Delink Device', group: 'devices', source: 'Collection 08/07 (HAR)',
    method: 'POST', base: 'apiBaseUrl', path: '/service/api/auth/delink/device',
    body: { box_id: '{{deviceToDelinkBoxId}}', device_type: '{{deviceType}}' },
    requiresAuth: true, stateChanging: true, sensitive: true,
  },
});

export type EndpointId = keyof typeof EP;
export const ALL_ENDPOINTS: Endpoint[] = Object.values(EP);
export const byGroup = (group: string) => ALL_ENDPOINTS.filter((e) => e.group === group);
/** Read-only and free of side-effects: safe for sweeps, fuzzing and repeated perf sampling. */
export const isSafe = (e: Endpoint) => !e.stateChanging && !e.sensitive;
