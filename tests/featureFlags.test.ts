import { describe, it, expect } from 'vitest';
import { resolveFeatureFlags } from '../src/core/FeatureFlags';

/**
 * Flags gate the test bridge, so "off unless explicitly asked for" is a
 * safety property, not a preference: a flag that leaked on by default would
 * install a debug surface into ordinary play.
 */
describe('resolveFeatureFlags', () => {
  it('is entirely off for a plain visit', () => {
    expect(resolveFeatureFlags('')).toEqual({ e2e: false, webgpu: false });
    expect(resolveFeatureFlags('?')).toEqual({ e2e: false, webgpu: false });
  });

  it('accepts the documented on-forms', () => {
    for (const q of ['?e2e=1', '?e2e=true', '?e2e=TRUE', '?e2e', '?e2e=']) {
      expect(resolveFeatureFlags(q).e2e, q).toBe(true);
    }
  });

  it('treats anything else as off', () => {
    for (const q of ['?e2e=0', '?e2e=false', '?e2e=no', '?e2e=yes']) {
      expect(resolveFeatureFlags(q).e2e, q).toBe(false);
    }
  });

  it('does not confuse one flag for another', () => {
    const f = resolveFeatureFlags('?webgpu=1');
    expect(f.webgpu).toBe(true);
    expect(f.e2e).toBe(false);
  });

  it('is unaffected by unrelated query parameters', () => {
    const f = resolveFeatureFlags('?utm_source=x&quality=high&e2e=1');
    expect(f).toEqual({ e2e: true, webgpu: false });
  });

  it('does not match on a substring of another parameter', () => {
    expect(resolveFeatureFlags('?note=e2e').e2e).toBe(false);
    expect(resolveFeatureFlags('?e2e_notes=1').e2e).toBe(false);
  });

  it('survives malformed input rather than throwing', () => {
    expect(() => resolveFeatureFlags('?%')).not.toThrow();
  });
});
