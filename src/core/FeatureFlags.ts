/**
 * Typed feature flags, resolved once from the URL query string.
 *
 * Flags are opt-in and default to off, so a normal production visit gets the
 * shipping behaviour with nothing extra installed. Nothing here reads from
 * storage: a flag must be asked for explicitly in the URL every time, which
 * keeps a stale toggle from silently persisting into ordinary play.
 */

export interface FeatureFlags {
  /**
   * Deterministic end-to-end test mode (`?e2e=1`).
   *
   * Installs the narrow `window.__LH_TEST__` bridge and freezes the sources of
   * frame-to-frame variation so screenshots are reproducible. Never on unless
   * the query parameter is present.
   */
  readonly e2e: boolean;

  /**
   * Experimental WebGPU backend (`?webgpu=1`).
   *
   * WebGL2 stays the release default. See docs/adr/0001-renderer-backend.md —
   * the toon system depends on `onBeforeCompile`, which WebGPU does not run,
   * so this is a research switch and must fall back cleanly.
   */
  readonly webgpu: boolean;

  /**
   * The vehicle proving ground (`?testroad=1`).
   *
   * A closed course with known gradients, square kerbs, a barrier and a ramp.
   * Development only: the village is a nice place to drive and a poor place to
   * *measure* driving, because every slope in it is incidental.
   */
  readonly testRoad: boolean;
}

const OFF: FeatureFlags = { e2e: false, webgpu: false, testRoad: false };

/** `?flag=1`, `?flag=true` and bare `?flag` all count as on. */
function isOn(params: URLSearchParams, name: string): boolean {
  if (!params.has(name)) return false;
  const raw = params.get(name);
  return raw === null || raw === '' || raw === '1' || raw.toLowerCase() === 'true';
}

export function resolveFeatureFlags(search: string): FeatureFlags {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search);
  } catch {
    return OFF;
  }
  return {
    e2e: isOn(params, 'e2e'),
    webgpu: isOn(params, 'webgpu'),
    testRoad: isOn(params, 'testroad'),
  };
}

let resolved: FeatureFlags | null = null;

/** Resolved once per page load. */
export function featureFlags(): FeatureFlags {
  if (resolved) return resolved;
  resolved =
    typeof window === 'undefined'
      ? OFF
      : resolveFeatureFlags(window.location.search);
  return resolved;
}

/** Test-only: clear the memoised value so a suite can resolve fresh input. */
export function resetFeatureFlagsForTest(): void {
  resolved = null;
}
