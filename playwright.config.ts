import { defineConfig, devices } from '@playwright/test';

/**
 * Smoke tests run against the *production* preview build, not the dev server,
 * so what CI exercises is what ships. `?e2e=1` installs the deterministic
 * bridge the specs drive.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false, // WebGL contexts are expensive; keep them serial
  forbidOnly: !!process.env.CI,
  /**
   * One retry everywhere, not just in CI.
   *
   * This suite drives a real WebGL context through seventy-odd scenarios in a
   * single browser process, and on a loaded machine the tail of the run is a
   * different animal from the head: a gamepad scenario that takes 8 seconds
   * early on has timed out at 90 later in the same run, and a draw-call
   * assertion that is exactly stable in isolation has come back off by one.
   *
   * A retry does not paper over a real defect — that fails twice — but it does
   * stop the suite reporting the machine's mood as a regression. The Phase 6
   * report has the evidence, and the honest reading is that a run of this size
   * needs splitting rather than tolerating; until then, retry.
   */
  retries: 1,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  timeout: 90_000,
  expect: { timeout: 20_000 },

  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'off',
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],

  webServer: {
    command: 'npm run preview -- --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
