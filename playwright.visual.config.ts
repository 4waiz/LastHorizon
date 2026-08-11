import { defineConfig, devices } from '@playwright/test';

/**
 * Deterministic visual regression.
 *
 * A separate project from the functional suite for one reason: **it needs a
 * tolerance the functional suite must not have.** `docs/TEST_STRATEGY.md` has
 * recorded the residual variation since Phase 1 and it is still true —
 * `prepareShot()` pins the clock and hides the dev readout, but clouds drift,
 * birds animate off elapsed time, and wind phase advances with `uTime`. So a
 * pixel-exact comparison is not available here, and pretending otherwise
 * produces a suite that fails on weather.
 *
 * The tolerance below is therefore a *deliberate* number rather than a default:
 *
 * - `maxDiffPixelRatio: 0.02` — 2% of the frame. Cloud drift and bird
 *   positions live in the sky, which is a large fraction of most of these
 *   shots. A real regression — a missing building, a black interior, a
 *   material that lost its banding — moves far more than 2%.
 * - `threshold: 0.2` — per-pixel colour distance, so the day/night ramp does
 *   not register as a difference when it lands a frame either side.
 *
 * **This is weaker than a pixel hash and the report says so.** It catches
 * structural regressions and will not catch a subtle shading change. Pinning
 * `uTime` and the cloud and bird phase in the test bridge is the improvement
 * that would let the tolerance come down, and it is named in
 * docs/KNOWN_LIMITATIONS.md rather than quietly tolerated.
 *
 * Chromium only, on purpose. A screenshot baseline is per-renderer, and three
 * browsers means three sets of baselines with three sets of antialiasing
 * differences — for a suite whose job is "did the scene change", one reference
 * renderer answers the question and three triple the maintenance.
 */
export default defineConfig({
  testDir: './tests/visual',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0, // a visual diff that passes on retry is a diff nobody looked at
  workers: 1,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  timeout: 120_000,
  expect: {
    timeout: 20_000,
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.02,
      threshold: 0.2,
      animations: 'disabled',
      caret: 'hide',
    },
  },
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'off',
    // A fixed viewport, or every baseline is a baseline for one machine.
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
  },
  projects: [{ name: 'visual', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run preview -- --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
