// @ts-check
const { defineConfig } = require('@playwright/test')

module.exports = defineConfig({
  testDir: './tests/e2e',
  timeout: 20_000,
  retries: 1,
  workers: 1,
  fullyParallel: false,

  use: {
    baseURL: 'http://localhost:4000',  // API server (not Vite — headless JS broken on macOS 12.5)
    headless: true,
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },

  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'tests/e2e/report' }],
  ],
})
