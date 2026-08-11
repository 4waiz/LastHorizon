import { describe, it, expect } from 'vitest';
import {
  MAX_IMPORT_BYTES,
  escapeHtml,
  hardenParsed,
  parseImportedSave,
  sanitiseText,
} from '../src/save/ImportGuard';

/**
 * The import boundary.
 *
 * Every case here is a file a person could actually hand the game — a truncated
 * export, a hand-edited save, something downloaded from a stranger. The point
 * of the guard is that none of them reaches `migrateSave` as anything other
 * than a plain, bounded, prototype-free object.
 */
describe('ImportGuard', () => {
  describe('parseImportedSave', () => {
    it('accepts an ordinary save object', () => {
      const r = parseImportedSave('{"version":4,"mode":"story","money":120}');
      expect(r.ok).toBe(true);
      expect(r.ok && r.value).toEqual({ version: 4, mode: 'story', money: 120 });
    });

    it('refuses a file too large to be a save', () => {
      const huge = `{"a":"${'x'.repeat(MAX_IMPORT_BYTES)}"}`;
      const r = parseImportedSave(huge);
      expect(r.ok).toBe(false);
      // The message is shown to a player, so it has to read as a sentence.
      expect(r.ok === false && r.reason).toBe('that file is too large to be a save');
    });

    it('refuses invalid JSON', () => {
      expect(parseImportedSave('{ not json').ok).toBe(false);
    });

    it('refuses valid JSON that is not an object', () => {
      // All three parse fine and would otherwise fail somewhere less legible.
      for (const s of ['42', '"a string"', '[1,2,3]', 'null']) {
        const r = parseImportedSave(s);
        expect(r.ok, `${s} should be refused`).toBe(false);
      }
    });
  });

  describe('prototype pollution', () => {
    it('drops __proto__ arriving as a real own property', () => {
      // This is the case that matters: JSON.parse gives `__proto__` as an own
      // property rather than setting the prototype, so it survives a naive
      // spread into whatever the app merges the save into.
      const r = parseImportedSave('{"version":4,"__proto__":{"polluted":true}}');

      expect(r.ok).toBe(true);
      const value = r.ok ? (r.value as Record<string, unknown>) : {};
      expect(Object.keys(value)).toEqual(['version']);
      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    });

    it('drops constructor and prototype keys too', () => {
      const r = parseImportedSave('{"constructor":{"x":1},"prototype":{"y":2},"zone":"village_coast"}');
      expect(r.ok).toBe(true);
      expect(Object.keys(r.ok ? (r.value as object) : {})).toEqual(['zone']);
    });

    it('survives the spread the save layer actually performs', () => {
      const r = parseImportedSave('{"__proto__":{"isAdmin":true},"slot":"slot1"}');
      const merged = { ...(r.ok ? (r.value as object) : {}), slot: 'slot2' };
      expect((merged as Record<string, unknown>).isAdmin).toBeUndefined();
    });
  });

  describe('bounds', () => {
    it('refuses a structure deeper than the schema goes', () => {
      let json = '{"a":1}';
      for (let i = 0; i < 40; i++) json = `{"a":${json}}`;
      const r = parseImportedSave(json);
      expect(r.ok).toBe(false);
      expect(r.ok === false && r.reason).toMatch(/deeply nested/);
    });

    it('refuses an array longer than anything the format uses', () => {
      const r = hardenParsed({ reel: new Array(10_000).fill(0) });
      expect(r.ok).toBe(false);
      expect(r.ok === false && r.reason).toMatch(/too long/);
    });

    it('accepts a reel of a plausible length', () => {
      // A long run records a few hundred moments. The ceiling must not be so
      // tight that a real save trips it.
      expect(hardenParsed({ reel: new Array(500).fill({ kind: 'job', age: 20 }) }).ok).toBe(true);
    });
  });

  describe('text', () => {
    it('strips control characters', () => {
      expect(sanitiseText('vill\u0000age\u001B[31m')).toBe('village[31m');
      expect(sanitiseText('one\ntwo\tthree')).toBe('onetwothree');
    });

    it('clamps a very long string', () => {
      expect(sanitiseText('x'.repeat(5000))).toHaveLength(512);
    });

    it('leaves ordinary text alone', () => {
      // Including the non-ASCII the game genuinely uses — resident names and
      // the em dashes the string table is full of.
      expect(sanitiseText('Tomás — the trade')).toBe('Tomás — the trade');
    });

    it('sanitises strings nested inside the save', () => {
      const r = parseImportedSave('{"vehicles":[{"kind":"hatch\\u0000back"}]}');
      expect(r.ok).toBe(true);
      const v = r.ok ? (r.value as { vehicles: { kind: string }[] }) : { vehicles: [] };
      expect(v.vehicles[0].kind).toBe('hatchback');
    });

    it('rejects non-finite numbers rather than passing a NaN position through', () => {
      // JSON cannot carry these, but an already-parsed object can, and a NaN
      // position is the exact failure `validateSave` exists to catch.
      const r = hardenParsed({ player: { position: { x: NaN, y: Infinity, z: 3 } } });
      expect(r.ok).toBe(true);
      const p = r.ok ? (r.value as { player: { position: Record<string, unknown> } }) : null;
      expect(p?.player.position.x).toBeNull();
      expect(p?.player.position.y).toBeNull();
      expect(p?.player.position.z).toBe(3);
    });
  });

  describe('escapeHtml', () => {
    it('escapes everything that could open a tag or close an attribute', () => {
      expect(escapeHtml('<img src=x onerror="alert(1)">')).toBe(
        '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;',
      );
      expect(escapeHtml("it's & that")).toBe('it&#39;s &amp; that');
    });

    it('leaves ordinary text unchanged', () => {
      expect(escapeHtml('parked · village coast')).toBe('parked · village coast');
    });
  });
});
