import { describe, it, expect, beforeEach } from 'vitest';
import { CollectibleStore } from '../src/world/Collectibles';

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

const IDS = ['paper-plane', 'toy-boat', 'wind-chime', 'old-camera', 'star-ornament'];
const KEY = 'lasthorizon.collected.v1';

describe('CollectibleStore', () => {
  let storage: MemoryStorage;
  beforeEach(() => {
    storage = new MemoryStorage();
  });

  it('starts empty', () => {
    const s = new CollectibleStore(IDS, storage);
    expect(s.count).toBe(0);
    expect(s.total).toBe(5);
    expect(s.complete).toBe(false);
  });

  it('records a find once', () => {
    const s = new CollectibleStore(IDS, storage);
    expect(s.collect('toy-boat')).toBe(true);
    expect(s.collect('toy-boat')).toBe(false);
    expect(s.count).toBe(1);
    expect(s.has('toy-boat')).toBe(true);
  });

  it('survives a reload', () => {
    const a = new CollectibleStore(IDS, storage);
    a.collect('old-camera');
    a.collect('wind-chime');

    const b = new CollectibleStore(IDS, storage);
    expect(b.count).toBe(2);
    expect(b.has('old-camera')).toBe(true);
    expect(b.has('paper-plane')).toBe(false);
  });

  it('reports completion at the full set', () => {
    const s = new CollectibleStore(IDS, storage);
    IDS.forEach((id) => s.collect(id));
    expect(s.complete).toBe(true);
    expect(s.count).toBe(5);
  });

  it('rejects unknown ids so the counter cannot exceed the total', () => {
    const s = new CollectibleStore(IDS, storage);
    expect(s.collect('not-a-thing')).toBe(false);
    expect(s.count).toBe(0);
  });

  it('drops stale ids left by an older layout', () => {
    storage.setItem(KEY, JSON.stringify(['toy-boat', 'retired-item', 'another-old-one']));
    const s = new CollectibleStore(IDS, storage);
    expect(s.count).toBe(1);
    expect(s.has('toy-boat')).toBe(true);
  });

  it('survives corrupt storage', () => {
    storage.setItem(KEY, 'not json at all');
    expect(() => new CollectibleStore(IDS, storage)).not.toThrow();
    expect(new CollectibleStore(IDS, storage).count).toBe(0);

    storage.setItem(KEY, '{"nope":true}');
    expect(new CollectibleStore(IDS, storage).count).toBe(0);
  });

  it('reset clears memory and storage', () => {
    const s = new CollectibleStore(IDS, storage);
    s.collect('star-ornament');
    s.reset();
    expect(s.count).toBe(0);
    expect(new CollectibleStore(IDS, storage).count).toBe(0);
  });

  it('works with storage unavailable', () => {
    const s = new CollectibleStore(IDS, null);
    expect(s.collect('toy-boat')).toBe(true);
    expect(s.count).toBe(1);
  });
});
