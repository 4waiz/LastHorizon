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
   * report has the evidence.
   *
   * **Phase 9 update: the split this comment kept postponing has happened.** At
   * 111 scenarios the retry stopped being enough — the browser *process* died
   * at the tail of a 24-minute run (`Target crashed`, exit 0xC0000409) and a
   * retry cannot survive that, because there is nothing left to retry in. CI
   * now runs `--shard=n/2` across two runners per browser; see the `e2e` job in
   * `.github/workflows/ci.yml`. Locally, run the halves separately if the whole
   * suite dies at the end — every one of those tests passes in isolation.
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

  /**
   * `vite preview`, serving `dist/`. These tests run against a **build**, not
   * against the sources — new markup needs `npm run build` before it exists.
   *
   * `reuseExistingServer` is false everywhere, not just in CI, and that is a
   * deliberate departure from the usual idiom.
   *
   * A `preview` process left listening from an earlier run keeps serving the
   * snapshot it started with — its index.html is transformed once and cached.
   * Reusing it means the suite tests an old build while reporting on the new
   * one, and the failure is silent in the worst direction: five photo-mode
   * tests failed with "element not found" against a `dist/` that had the
   * element, and the served page turned out to be 37 kB against 43 kB on
   * disk, missing a whole panel from two commits earlier.
   *
   * A test that passes against the wrong build is worse than a slow one, so
   * this pays ~3 s of startup per run to be sure.
   */
  webServer: {
    command: 'npm run preview -- --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
