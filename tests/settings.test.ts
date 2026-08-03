import { describe, it, expect, beforeEach } from 'vitest';
import {
  Settings,
  QUALITY_PRESETS,
  QUALITY_ORDER,
  detectQuality,
  DeviceInfo,
} from '../src/core/Settings';

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
