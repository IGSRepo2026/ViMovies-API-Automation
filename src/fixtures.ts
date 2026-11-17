import { test as base } from '@playwright/test';
import { settings, vars } from '../config/env';
import { ApiClient } from './apiClient';
import testData from '../test-data/testdata.json';

export const test = base.extend<{ api: ApiClient }>({
  api: async ({ request }, use, testInfo) => {
    await use(new ApiClient(request, vars, testInfo));
  },
});

export { expect } from '@playwright/test';
export { settings, vars, testData };
