import { defineConfig, devices } from '@playwright/test';

/**
 * Same overridable port as `playwright.config.ts` — see the note there. Two
 * concurrent runs on one machine cannot share a fixed port once
 * `reuseExistingServer` is false, and the failure looks like the app being
 * broken rather than the port being taken.
 */
const PORT = Number(process.env.LH_TEST_PORT ?? 4173);
const BASE_URL = `http://localhost:${PORT}`;

/**
 * The long-running layers: soak and performance.
 *
 * Separate from the functional suite because they are minutes rather than
 * seconds, and because their failure modes are different in kind. A functional
 * test asserts a fact; these assert a *trend* — that object counts come back to
 * where they started, that frame time does not drift — and a trend needs a run
 * long enough to have one.
 *
 * Tagged rather than split into two configs: `--grep @soak` and `--grep @perf`
 * select them, and `npm run test:soak` / `npm run test:perf` do that for you.
 *
 * Not part of `npm run verify`. They take about fifteen minutes together, and a
 * gate nobody runs because it is too slow protects nothing — CI runs them on a
 * schedule and before a release, which is where they belong. That trade is
 * recorded in docs/RELEASE_CHECKLIST.md rather than left implicit.
 */
export default defineConfig({
  testDir: './tests/long',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  // No retries. A soak that passes on the second attempt has told you
  // something about the first attempt that you should not discard.
  retries: 0,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  timeout: 15 * 60_000,
  expect: { timeout: 30_000 },
  use: {
    baseURL: BASE_URL,
    trace: 'off',
    video: 'off',
  },
  projects: [{ name: 'long', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npm run preview -- --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
