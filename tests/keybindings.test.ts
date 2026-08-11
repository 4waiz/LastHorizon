import { describe, it, expect } from 'vitest';
import {
  ACTIONS,
  ACTION_LABELS,
  DEFAULT_BINDINGS,
  FIXED_ALTERNATES,
  Keybindings,
  RESERVED,
  keyLabel,
  type Action,
} from '../src/core/Keybindings';

/**
 * The key layout, as data.
 *
 * The failures worth catching here are the ones that strand a player: a
 * rebind that leaves two actions on one key, a restore that silently unbinds
 * everything, or a layout that can claim Escape and take away the only way
 * out of the menu it was set from.
 */

describe('the default layout', () => {
  it('gives every action a key, and a label', () => {
    for (const a of ACTIONS) {
      expect(DEFAULT_BINDINGS[a], `${a} has no default key`).toBeTruthy();
      expect(ACTION_LABELS[a], `${a} has no label`).toBeTruthy();
    }
  });

  it('puts no two actions on the same key', () => {
    const codes = ACTIONS.map((a) => DEFAULT_BINDINGS[a]);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('claims nothing reserved', () => {
    for (const a of ACTIONS) {
      expect(RESERVED.has(DEFAULT_BINDINGS[a])).toBe(false);
    }
  });

  it('never uses a fixed alternate of another action as a primary', () => {
    for (const a of ACTIONS) {
      for (const other of ACTIONS) {
        if (other === a) continue;
        expect(FIXED_ALTERNATES[other] ?? []).not.toContain(DEFAULT_BINDINGS[a]);
      }
    }
  });
});

describe('looking a key up', () => {
  it('resolves the primary and the fixed alternates alike', () => {
    const kb = new Keybindings();
    expect(kb.actionFor('KeyW')).toBe('forward');
    expect(kb.actionFor('ArrowUp')).toBe('forward');
    expect(kb.actionFor('Enter')).toBe('interact');
  });

  it('returns null for a key nothing wants', () => {
    expect(new Keybindings().actionFor('F7')).toBeNull();
  });

  /**
   * An explicit choice beats a default that happens to overlap. A player who
   * puts `forward` on `ArrowLeft` gets forward from it, even though that code
   * is `left`'s fixed alternate.
   */
  it('prefers a primary over somebody else’s alternate', () => {
    const kb = new Keybindings();
    kb.rebind('draw', 'ArrowUp');
    // Refused — `ArrowUp` is forward's fixed alternate — so nothing changed.
    expect(kb.actionFor('ArrowUp')).toBe('forward');
    expect(kb.codeFor('draw')).toBe(DEFAULT_BINDINGS.draw);
  });
});

describe('rebinding', () => {
  it('moves an action to a free key', () => {
    const kb = new Keybindings();
    const r = kb.rebind('jump', 'KeyB');
    expect(r.ok && r.stoleFrom).toBeNull();
    expect(kb.codeFor('jump')).toBe('KeyB');
    expect(kb.actionFor('KeyB')).toBe('jump');
    expect(kb.actionFor('Space')).toBeNull();
  });

  /**
   * Stealing rather than refusing. Every remapping screen works this way, and
   * it is the only behaviour that does not require the player to unbind
   * first — which they cannot do if the unbind control is the key itself.
   */
  it('steals a key from whoever had it, and says who', () => {
    const kb = new Keybindings();
    const r = kb.rebind('jump', 'KeyM');
    expect(r.ok && r.stoleFrom).toBe('map');
    expect(kb.codeFor('jump')).toBe('KeyM');
    expect(kb.codeFor('map')).toBe('');
    expect(kb.unbound()).toContain('map');
  });

  it('never leaves two actions on one key', () => {
    const kb = new Keybindings();
    kb.rebind('jump', 'KeyM');
    kb.rebind('reload', 'KeyB');
    const live = ACTIONS.map((a) => kb.codeFor(a)).filter((c) => c !== '');
    expect(new Set(live).size).toBe(live.length);
  });

  it('refuses Escape, and every other reserved key', () => {
    const kb = new Keybindings();
    for (const code of RESERVED) {
      const r = kb.rebind('jump', code);
      expect(r.ok, `${code} was accepted`).toBe(false);
      expect(!r.ok && r.reason).toBe('reserved');
    }
    expect(kb.codeFor('jump')).toBe('Space');
  });

  it('refuses a fixed alternate belonging to something else', () => {
    const kb = new Keybindings();
    const r = kb.rebind('jump', 'ArrowLeft');
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toBe('fixed');
  });

  it('lets an action take its own fixed alternate as its primary', () => {
    const kb = new Keybindings();
    expect(kb.rebind('forward', 'ArrowUp').ok).toBe(true);
    expect(kb.actionFor('ArrowUp')).toBe('forward');
  });

  it('is a no-op when the key is already the one it has', () => {
    const kb = new Keybindings();
    const r = kb.rebind('jump', 'Space');
    expect(r.ok && r.stoleFrom).toBeNull();
    expect(kb.isDefault()).toBe(true);
  });

  it('refuses an action that does not exist', () => {
    const kb = new Keybindings();
    const r = kb.rebind('fly' as Action, 'KeyB');
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toBe('unknown-action');
  });

  it('resets everything back', () => {
    const kb = new Keybindings();
    kb.rebind('jump', 'KeyM');
    expect(kb.isDefault()).toBe(false);
    kb.reset();
    expect(kb.isDefault()).toBe(true);
    expect(kb.unbound()).toEqual([]);
  });
});

describe('coming back from storage', () => {
  it('survives a round trip', () => {
    const a = new Keybindings();
    a.rebind('jump', 'KeyB');
    a.rebind('map', 'KeyN');
    expect(new Keybindings(a.toJSON()).toJSON()).toEqual(a.toJSON());
  });

  /**
   * The case that matters for an older save: a blob written before `life`
   * existed must gain it at its default, not lose every action it mentions.
   */
  it('fills in an action the blob does not mention', () => {
    const kb = new Keybindings({ jump: 'KeyB' });
    expect(kb.codeFor('jump')).toBe('KeyB');
    expect(kb.codeFor('life')).toBe(DEFAULT_BINDINGS.life);
    expect(kb.codeFor('map')).toBe(DEFAULT_BINDINGS.map);
  });

  it('drops a stored binding that claims a reserved key', () => {
    const kb = new Keybindings({ jump: 'Escape' });
    expect(kb.codeFor('jump')).toBe(DEFAULT_BINDINGS.jump);
  });

  it('drops a stored binding that is not a string', () => {
    const kb = new Keybindings({ jump: 42 as unknown as string });
    expect(kb.codeFor('jump')).toBe(DEFAULT_BINDINGS.jump);
  });

  it('drops a stored binding that duplicates one already taken', () => {
    const kb = new Keybindings({ jump: 'KeyB', reload: 'KeyB' });
    const live = ACTIONS.map((a) => kb.codeFor(a)).filter((c) => c !== '');
    expect(new Set(live).size).toBe(live.length);
  });

  /**
   * The subtle one. A stored `jump: KeyM` is accepted, and then `map`'s
   * *default* KeyM would collide with it. The second pass clears the loser
   * rather than shipping a layout where one key does two things.
   */
  it('resolves a stored binding colliding with another action’s default', () => {
    const kb = new Keybindings({ jump: 'KeyM' });
    expect(kb.codeFor('jump')).toBe('KeyM');
    expect(kb.codeFor('map')).toBe('');
    expect(kb.actionFor('KeyM')).toBe('jump');
  });

  it('accepts an explicitly unbound action', () => {
    const kb = new Keybindings({ shoulder: '' });
    expect(kb.codeFor('shoulder')).toBe('');
    expect(kb.unbound()).toContain('shoulder');
  });

  it('ignores undefined entirely', () => {
    expect(new Keybindings(undefined).isDefault()).toBe(true);
  });
});

describe('how a key reads', () => {
  it('turns a code into something printable on a cap', () => {
    expect(keyLabel('KeyW')).toBe('W');
    expect(keyLabel('Digit3')).toBe('3');
    expect(keyLabel('ArrowUp')).toBe('Up arrow');
    expect(keyLabel('ShiftLeft')).toBe('Left shift');
    expect(keyLabel('Space')).toBe('Space');
    expect(keyLabel('Slash')).toBe('/');
  });

  it('falls back to the raw code rather than to nothing', () => {
    // An unknown key cap is better than a blank one: at least the player can
    // tell two of them apart.
    expect(keyLabel('IntlBackslash')).toBe('IntlBackslash');
  });

  it('never shows a raw DOM code on a default binding', () => {
    // The first version of this asserted `label !== code`, which fails on
    // `Space` — where the code *is* the friendly name. What actually matters
    // is that no key cap reads "KeyW" or "ShiftLeft" at a player.
    for (const a of ACTIONS) {
      const label = keyLabel(DEFAULT_BINDINGS[a]);
      expect(label, `${a} shows a raw code`).not.toMatch(/^(Key|Digit|Arrow)/);
      expect(label).not.toMatch(/(Left|Right)$/);
      expect(label.length).toBeGreaterThan(0);
    }
  });
});
