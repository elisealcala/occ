import { defineConfig } from '@playwright/test';
import base from './playwright.config';

export default defineConfig(base, {
  use: { baseURL: 'http://127.0.0.1:8787' },
  webServer: {
    command: 'pnpm dev:worker',
    url: 'http://127.0.0.1:8787',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
