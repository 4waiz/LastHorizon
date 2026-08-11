import { describe, it, expect, beforeEach } from 'vitest';
import {
  AUDIO_BUSES,
  DEFAULT_VOLUMES,
  Settings,
  type AudioBus,
  type SettingsState,
} from '../src/core/Settings';

/**
 * Per-bus levels.
 *
 * `AudioManager` needs a real `AudioContext` and is not testable here; what
 * *is* testable, and is where the bugs would be, is the model underneath it:
 * clamping, per-key restore, and the promise that a level is a multiplier on
 * the designed mix rather than a replacement for it.
 */

/** Storage that never touches the real localStorage. */
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

describe('the bus table', () => {
  it('has one default per declared bus, and all of them full', () => {
    for (const bus of AUDIO_BUSES) {
      expect(DEFAULT_VOLUMES[bus], `${bus} has no default`).toBe(1);
    }
    expect(Object.keys(DEFAULT_VOLUMES).sort()).toEqual([...AUDIO_BUSES].sort());
  });

  it('keeps the interface on its own bus', () => {
    // Folding UI clicks into world effects would mean silencing footsteps to
    // silence a button, and the button is what people turn off first.
    expect(AUDIO_BUSES).toContain('ui');
    expect(AUDIO_BUSES).toContain('sfx');
  });
});

describe('setting a level', () => {
  it('starts at full on a fresh save', () => {
    expect(make().current.volumes).toEqual(DEFAULT_VOLUMES);
  });

  it('sets one bus without disturbing the others', () => {
    const s = make();
    s.setVolume('music', 0.4);
    expect(s.current.volumes.music).toBe(0.4);
    expect(s.current.volumes.ambience).toBe(1);
    expect(s.current.volumes.sfx).toBe(1);
  });

  it('clamps to 0..1 rather than trusting a slider', () => {
    const s = make();
    s.setVolume('music', 4);
    expect(s.current.volumes.music).toBe(1);
    s.setVolume('music', -3);
    expect(s.current.volumes.music).toBe(0);
  });

  it('ignores a value that is not a finite number', () => {
    const s = make();
    s.setVolume('sfx', Number.NaN);
    s.setVolume('sfx', Infinity);
    expect(s.current.volumes.sfx).toBe(1);
  });

  it('ignores a bus that does not exist', () => {
    const s = make();
    s.setVolume('reverb' as AudioBus, 0.2);
    expect(s.current.volumes).toEqual(DEFAULT_VOLUMES);
  });

  it('notifies once per real change and not at all for a no-op', () => {
    const s = make();
    let n = 0;
    s.onChange(() => n++);
    s.setVolume('music', 0.5);
    expect(n).toBe(1);
    s.setVolume('music', 0.5);
    expect(n, 'a no-op woke the mixer').toBe(1);
  });

  it('replaces the object rather than mutating it, so subscribers see a change', () => {
    const s = make();
    const before = s.current.volumes;
    s.setVolume('ui', 0);
    expect(s.current.volumes).not.toBe(before);
    expect(before.ui, 'the old snapshot was mutated underneath a subscriber').toBe(1);
  });
});

describe('coming back from storage', () => {
  it('survives a round trip', () => {
    const a = make();
    a.setVolume('music', 0.25);
    a.setVolume('ui', 0);
    expect(make().current.volumes).toEqual({ ...DEFAULT_VOLUMES, music: 0.25, ui: 0 });
  });

  /**
   * Per key, for the same reason `needsEnabled` is read per key: a blob
   * written by an older build, or hand-edited, must not be able to silence
   * everything or add a bus that does not exist.
   */
  it('fills in a bus the stored blob does not mention', () => {
    store.setItem('lasthorizon.settings.v1', JSON.stringify({ volumes: { music: 0.5 } }));
    const v = make().current.volumes;
    expect(v.music).toBe(0.5);
    expect(v.master).toBe(1);
    expect(v.ui).toBe(1);
  });

  it('drops a bus that no longer exists', () => {
    store.setItem(
      'lasthorizon.settings.v1',
      JSON.stringify({ volumes: { music: 0.5, reverb: 0.9 } }),
    );
    expect(Object.keys(make().current.volumes).sort()).toEqual([...AUDIO_BUSES].sort());
  });

  it('clamps a stored level that is out of range', () => {
    store.setItem('lasthorizon.settings.v1', JSON.stringify({ volumes: { sfx: 99 } }));
    expect(make().current.volumes.sfx).toBe(1);
  });

  it('ignores a volumes field that is not an object', () => {
    store.setItem('lasthorizon.settings.v1', JSON.stringify({ volumes: 'loud' }));
    expect(make().current.volumes).toEqual(DEFAULT_VOLUMES);
  });

  it('survives a stored blob that is not JSON at all', () => {
    store.setItem('lasthorizon.settings.v1', '{{{');
    expect(make().current.volumes).toEqual(DEFAULT_VOLUMES);
  });
});

describe('mute and levels are separate concerns', () => {
  it('leaves the sliders alone when the player mutes', () => {
    // Mute is one keypress from the HUD and has to work without disturbing
    // whatever the sliders were set to, or unmuting comes back wrong.
    const s = make();
    s.setVolume('music', 0.3);
    s.toggleMuted();
    expect(s.current.muted).toBe(true);
    expect(s.current.volumes.music).toBe(0.3);
    s.toggleMuted();
    expect(s.current.volumes.music).toBe(0.3);
  });

  it('lets a bus be zero without the game being muted', () => {
    const s = make();
    s.setVolume('ui', 0);
    expect(s.current.muted).toBe(false);
    expect(s.current.volumes.ui).toBe(0);
  });
});
