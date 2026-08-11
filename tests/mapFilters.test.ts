import { describe, it, expect, beforeEach } from 'vitest';
import { MAP_FILTER_KEYS, MAP_LEGEND } from '../src/ui/MapPanel';
import { Settings, type SettingsState } from '../src/core/Settings';

/**
 * Map layer filters.
 *
 * The legend is the control: it is already where a player looks to find out
 * what a mark means, so it is where they say "not that one". A separate
 * filter menu would be a second list to keep in step with this one.
 *
 * What is checked here is the model and the derivation — that the filterable
 * keys come *from* the legend rather than being a parallel list, and that an
 * absent stored key means on.
 */

class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length(): number { return this.map.size; }
  clear(): void { this.map.clear(); }
  getItem(k: string): string | null { return this.map.get(k) ?? null; }
  key(i: number): string | null { return [...this.map.keys()][i] ?? null; }
  removeItem(k: string): void { this.map.delete(k); }
  setItem(k: string, v: string): void { this.map.set(k, v); }
}

let store: MemoryStorage;
const make = (defaults?: Partial<SettingsState>) => new Settings(store, defaults);

beforeEach(() => {
  store = new MemoryStorage();
});

describe('which rows are filters', () => {
  it('derives the keys from the legend, so the two cannot drift', () => {
    const fromLegend = MAP_LEGEND.map((e) => e.filter).filter((f) => f !== null);
    expect([...MAP_FILTER_KEYS]).toEqual(fromLegend);
  });

  /**
   * Roads, buildings and the player marker are the map. Switching them off
   * would not be a filter, it would be a blank page.
   */
  it('leaves the map itself unfilterable', () => {
    for (const key of ['road', 'building', 'player']) {
      expect(MAP_LEGEND.find((e) => e.key === key)?.filter, `${key} is filterable`).toBeNull();
    }
  });

  it('makes every layer a player might not want filterable', () => {
    for (const key of ['keepsake', 'found', 'vehicle', 'garage']) {
      expect(MAP_LEGEND.find((e) => e.key === key)?.filter, `${key} is not filterable`).toBe(key);
    }
  });

  it('gives every legend row a colour and a label', () => {
    for (const e of MAP_LEGEND) {
      expect(e.colour).toMatch(/^#[0-9a-f]{6}$/i);
      expect(e.label.length).toBeGreaterThan(2);
    }
  });
});

describe('the setting', () => {
  it('defaults every layer on', () => {
    const s = make();
    for (const key of MAP_FILTER_KEYS) expect(s.mapFilter(key)).toBe(true);
  });

  it('switches one off without touching the others', () => {
    const s = make();
    s.setMapFilter('vehicle', false);
    expect(s.mapFilter('vehicle')).toBe(false);
    expect(s.mapFilter('keepsake')).toBe(true);
    expect(s.mapFilter('garage')).toBe(true);
  });

  it('notifies once per real change and not at all for a no-op', () => {
    const s = make();
    let n = 0;
    s.onChange(() => n++);
    s.setMapFilter('vehicle', false);
    expect(n).toBe(1);
    s.setMapFilter('vehicle', false);
    expect(n, 'a no-op redrew the map').toBe(1);
  });

  it('ignores a value that is not a boolean', () => {
    const s = make();
    s.setMapFilter('vehicle', 'no' as unknown as boolean);
    expect(s.mapFilter('vehicle')).toBe(true);
  });

  it('replaces the object rather than mutating it', () => {
    const s = make();
    const before = s.current.mapFilters;
    s.setMapFilter('garage', false);
    expect(s.current.mapFilters).not.toBe(before);
  });
});

describe('coming back from storage', () => {
  it('survives a round trip', () => {
    const a = make();
    a.setMapFilter('found', false);
    a.setMapFilter('vehicle', false);
    const b = make();
    expect(b.mapFilter('found')).toBe(false);
    expect(b.mapFilter('vehicle')).toBe(false);
    expect(b.mapFilter('keepsake')).toBe(true);
  });

  /**
   * Absent means on. A blob written before a layer existed must gain it
   * switched on — a map that hides things until you find the setting is a
   * map that looks broken.
   */
  it('treats a layer the blob never heard of as on', () => {
    store.setItem('lasthorizon.settings.v1', JSON.stringify({ mapFilters: { vehicle: false } }));
    const s = make();
    expect(s.mapFilter('vehicle')).toBe(false);
    expect(s.mapFilter('garage')).toBe(true);
    expect(s.mapFilter('a_layer_from_2027')).toBe(true);
  });

  it('drops a non-boolean entry rather than trusting it', () => {
    store.setItem(
      'lasthorizon.settings.v1',
      JSON.stringify({ mapFilters: { vehicle: 'off', garage: false } }),
    );
    const s = make();
    expect(s.mapFilter('vehicle'), 'a string was treated as false').toBe(true);
    expect(s.mapFilter('garage')).toBe(false);
  });

  it('ignores a mapFilters field that is not an object', () => {
    store.setItem('lasthorizon.settings.v1', JSON.stringify({ mapFilters: 7 }));
    const s = make();
    for (const key of MAP_FILTER_KEYS) expect(s.mapFilter(key)).toBe(true);
  });
});

describe('what a marker filters under', () => {
  /** The mapping `HUD.drawMapNow` applies, isolated. */
  const keyFor = (kind: string, found?: boolean) =>
    kind === 'keepsake' ? (found ? 'found' : 'keepsake') : kind;

  it('splits keepsakes by whether they have been found', () => {
    // Two layers, not one: somebody hunting the last keepsake wants the found
    // ones out of the way, which is the whole reason `found` is in the legend.
    expect(keyFor('keepsake', false)).toBe('keepsake');
    expect(keyFor('keepsake', true)).toBe('found');
  });

  it('passes other kinds through unchanged', () => {
    expect(keyFor('vehicle')).toBe('vehicle');
    expect(keyFor('garage')).toBe('garage');
  });

  it('gives home no filter key that exists, so it is always drawn', () => {
    // The one mark you cannot navigate without.
    expect(MAP_FILTER_KEYS).not.toContain(keyFor('home'));
  });
});
