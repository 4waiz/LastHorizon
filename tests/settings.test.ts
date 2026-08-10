import { describe, it, expect, beforeEach } from 'vitest';
import {
  Settings,
  QUALITY_PRESETS,
  QUALITY_ORDER,
  detectQuality,
  DeviceInfo,
  NEED_IDS as SETTINGS_NEED_IDS,
} from '../src/core/Settings';
import { NEED_IDS } from '../src/player/Needs';

/** In-memory Storage stand-in so tests never touch the real localStorage. */
class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  clear() {
    this.map.clear();
  }
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
  [name: string]: unknown;
}

const device = (over: Partial<DeviceInfo> = {}): DeviceInfo => ({
  touch: false,
  cores: 8,
  memoryGb: 8,
  maxDimension: 1920,
  ...over,
});

describe('quality presets', () => {
  it('scale monotonically from low to high', () => {
    const [lo, mid, hi] = QUALITY_ORDER.map((q) => QUALITY_PRESETS[q]);
    expect(lo.pixelRatio).toBeLessThan(mid.pixelRatio);
    expect(mid.pixelRatio).toBeLessThan(hi.pixelRatio);
    expect(lo.shadowMapSize).toBeLessThan(hi.shadowMapSize);
    expect(lo.vegetationDensity).toBeLessThan(hi.vegetationDensity);
    expect(lo.cloudCount).toBeLessThan(hi.cloudCount);
    expect(lo.birdCount).toBeLessThan(hi.birdCount);
    expect(lo.fogFar).toBeLessThan(hi.fogFar);
  });

  it('disables grass entirely on low', () => {
    expect(QUALITY_PRESETS.low.grassDensity).toBe(0);
  });
});

describe('detectQuality', () => {
  it('never opens at high on a touch device', () => {
    expect(detectQuality(device({ touch: true, cores: 16, memoryGb: 16 }))).not.toBe('high');
  });

  it('drops to low on a weak phone', () => {
    expect(detectQuality(device({ touch: true, cores: 4, memoryGb: 2 }))).toBe('low');
  });

  it('picks high only for a capable desktop', () => {
    expect(detectQuality(device({ cores: 12, memoryGb: 16, maxDimension: 2560 }))).toBe('high');
    expect(detectQuality(device({ cores: 4, memoryGb: 16 }))).toBe('medium');
    expect(detectQuality(device({ cores: 12, memoryGb: 4 }))).toBe('medium');
  });
});

describe('Settings', () => {
  let storage: MemoryStorage;
  beforeEach(() => {
    storage = new MemoryStorage();
  });

  it('round-trips through storage', () => {
    const a = new Settings(storage);
    a.setQuality('low');
    a.setMuted(true);
    a.setTimeMode('night');

    const b = new Settings(storage);
    expect(b.current.quality).toBe('low');
    expect(b.current.muted).toBe(true);
    expect(b.current.timeMode).toBe('night');
  });

  it('exposes the preset for the active level', () => {
    const s = new Settings(storage);
    s.setQuality('high');
    expect(s.preset).toBe(QUALITY_PRESETS.high);
  });

  it('cycles quality and wraps', () => {
    const s = new Settings(storage);
    s.setQuality('low');
    expect(s.cycleQuality()).toBe('medium');
    expect(s.cycleQuality()).toBe('high');
    expect(s.cycleQuality()).toBe('low');
  });

  it('cycles time mode through all four', () => {
    const s = new Settings(storage);
    s.setTimeMode('cycle');
    expect(s.cycleTimeMode()).toBe('day');
    expect(s.cycleTimeMode()).toBe('dusk');
    expect(s.cycleTimeMode()).toBe('night');
    expect(s.cycleTimeMode()).toBe('cycle');
  });

  it('notifies listeners only on real change', () => {
    const s = new Settings(storage);
    s.setQuality('low');
    let calls = 0;
    s.onChange(() => calls++);
    s.setQuality('low');
    expect(calls).toBe(0);
    s.setQuality('high');
    expect(calls).toBe(1);
  });

  it('unsubscribes cleanly', () => {
    const s = new Settings(storage);
    let calls = 0;
    const off = s.onChange(() => calls++);
    s.toggleMuted();
    off();
    s.toggleMuted();
    expect(calls).toBe(1);
  });

  it('ignores corrupt stored data', () => {
    storage.setItem('lasthorizon.settings.v1', '{ not json');
    expect(() => new Settings(storage)).not.toThrow();
    storage.setItem('lasthorizon.settings.v1', '{"quality":"ultra","muted":"yes"}');
    const s = new Settings(storage);
    expect(QUALITY_ORDER).toContain(s.current.quality);
    expect(typeof s.current.muted).toBe('boolean');
  });

  it('works with no storage at all', () => {
    const s = new Settings(null);
    expect(() => s.setQuality('high')).not.toThrow();
    expect(s.current.quality).toBe('high');
  });
});

describe('needs accessibility options', () => {
  it('tracks every need by default', () => {
    const s = new Settings(new MemoryStorage());
    expect(s.current.needsEnabled).toEqual({
      hunger: true, energy: true, cleanliness: true, mood: true,
    });
    expect(s.current.needsDecay).toBe(1);
  });

  it('toggles one need without disturbing the others', () => {
    const s = new Settings(new MemoryStorage());
    s.setNeedEnabled('hunger', false);
    expect(s.current.needsEnabled.hunger).toBe(false);
    expect(s.current.needsEnabled.mood).toBe(true);
  });

  it('persists and reads back', () => {
    const store = new MemoryStorage();
    const a = new Settings(store);
    a.setNeedEnabled('cleanliness', false);
    a.setNeedsDecay(0.5);

    const b = new Settings(store);
    expect(b.current.needsEnabled.cleanliness).toBe(false);
    expect(b.current.needsEnabled.hunger).toBe(true);
    expect(b.current.needsDecay).toBe(0.5);
  });

  it('clamps the decay scale', () => {
    const s = new Settings(new MemoryStorage());
    s.setNeedsDecay(-5);
    expect(s.current.needsDecay).toBe(0);
    s.setNeedsDecay(99);
    expect(s.current.needsDecay).toBe(2);
    s.setNeedsDecay(Number.NaN);
    expect(s.current.needsDecay).toBe(2);
  });

  it('fills in a stored blob that is missing a need', () => {
    // A save written before a need existed must not switch the rest off.
    const store = new MemoryStorage();
    store.setItem(
      'lasthorizon.settings.v1',
      JSON.stringify({ needsEnabled: { hunger: false }, needsDecay: 1 }),
    );
    const s = new Settings(store);
    expect(s.current.needsEnabled.hunger).toBe(false);
    expect(s.current.needsEnabled.energy).toBe(true);
    expect(s.current.needsEnabled.mood).toBe(true);
  });

  it('ignores a need in storage that no longer exists', () => {
    const store = new MemoryStorage();
    store.setItem(
      'lasthorizon.settings.v1',
      JSON.stringify({ needsEnabled: { hunger: true, warmth: false } }),
    );
    const s = new Settings(store);
    expect(Object.keys(s.current.needsEnabled).sort()).toEqual([
      'cleanliness', 'energy', 'hunger', 'mood',
    ]);
  });

  it('survives a garbage value without losing the rest of the settings', () => {
    const store = new MemoryStorage();
    store.setItem(
      'lasthorizon.settings.v1',
      JSON.stringify({ quality: 'low', needsEnabled: 'yes please', needsDecay: 'fast' }),
    );
    const s = new Settings(store);
    expect(s.current.quality).toBe('low');
    expect(s.current.needsEnabled.hunger).toBe(true);
    expect(s.current.needsDecay).toBe(1);
  });

  it('notifies listeners so the game can re-apply them', () => {
    const s = new Settings(new MemoryStorage());
    let seen = 0;
    s.onChange(() => seen++);
    s.setNeedEnabled('energy', false);
    s.setNeedsDecay(0);
    expect(seen).toBe(2);
    // No-ops must not churn.
    s.setNeedEnabled('energy', false);
    s.setNeedsDecay(0);
    expect(seen).toBe(2);
  });

  it('keeps the NeedId mirror in step with Needs.ts', () => {
    // Settings cannot import gameplay code, so the union is duplicated. This
    // is the only thing stopping the two drifting apart.
    expect([...SETTINGS_NEED_IDS].sort()).toEqual([...NEED_IDS].sort());
  });
});

// ---------------------------------------------------------------------------
// Phase 11 — presentation accessibility
// ---------------------------------------------------------------------------

describe('the presentation options', () => {
  // Injected storage, like the suite above. Without it these share the real
  // localStorage and leak into each other — which is exactly what happened
  // the first time this block was written.
  let storage: MemoryStorage;
  beforeEach(() => {
    storage = new MemoryStorage();
  });

  it('default to the game as designed, not to the least assistance', () => {
    // Deliberately unlike the Phase 9 combat options, which default to the
    // *least* help. None of these five changes how the game plays, so there is
    // nothing to preserve by leaving them off — but equally nothing to gain by
    // turning them on for a player who did not ask.
    const s = new Settings(storage);
    expect(s.current.uiScale).toBe(1);
    expect(s.current.reducedMotion, 'follow the operating system').toBe('auto');
    expect(s.current.highContrast).toBe(false);
    expect(s.current.heatNumerals).toBe(false);
    expect(s.current.flightAssist, 'matches FlightModel').toBe('assisted');
  });

  it('clamps the text scale to something a panel can still hold', () => {
    const s = new Settings(storage);
    s.setAccessOption('uiScale', 99);
    expect(s.current.uiScale).toBeLessThanOrEqual(1.6);
    s.setAccessOption('uiScale', 0.1);
    expect(s.current.uiScale).toBeGreaterThanOrEqual(0.85);
  });

  it('refuses a value of the wrong type rather than storing it', () => {
    // Reached from the settings panel *and* the test bridge, and the bridge is
    // as untrusted as storage — Phase 9 learned this when a clamped number
    // arrived as a string.
    const s = new Settings(storage);
    s.setAccessOption('uiScale', 'huge' as unknown as number);
    expect(s.current.uiScale).toBe(1);
    s.setAccessOption('reducedMotion', 'sometimes');
    expect(s.current.reducedMotion).toBe('auto');
    s.setAccessOption('flightAssist', 'expert');
    expect(s.current.flightAssist).toBe('assisted');
    s.setAccessOption('highContrast', 1 as unknown as boolean);
    expect(s.current.highContrast).toBe(false);
  });

  it('accepts every legitimate value', () => {
    const s = new Settings(storage);
    s.setAccessOption('uiScale', 1.3);
    s.setAccessOption('reducedMotion', 'on');
    s.setAccessOption('highContrast', true);
    s.setAccessOption('heatNumerals', true);
    s.setAccessOption('flightAssist', 'reduced');
    expect(s.current.uiScale).toBe(1.3);
    expect(s.current.reducedMotion).toBe('on');
    expect(s.current.highContrast).toBe(true);
    expect(s.current.heatNumerals).toBe(true);
    expect(s.current.flightAssist).toBe('reduced');
  });

  it('survives a round trip through storage', () => {
    const a = new Settings(storage);
    a.setAccessOption('uiScale', 1.3);
    a.setAccessOption('reducedMotion', 'off');
    a.setAccessOption('heatNumerals', true);

    const b = new Settings(storage);
    expect(b.current.uiScale).toBe(1.3);
    expect(b.current.reducedMotion).toBe('off');
    expect(b.current.heatNumerals).toBe(true);
  });

  it('notifies listeners, so the document can be re-stamped', () => {
    const s = new Settings(storage);
    let calls = 0;
    s.onChange(() => calls++);
    s.setAccessOption('highContrast', true);
    expect(calls).toBe(1);
    // Setting the same value again is not a change and must not re-notify.
    s.setAccessOption('highContrast', true);
    expect(calls).toBe(1);
  });
});
