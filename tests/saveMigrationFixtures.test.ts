import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { CURRENT_SAVE_VERSION, migrateSave, validateSave } from '../src/save/SaveSchema';
import { parseImportedSave } from '../src/save/ImportGuard';

/**
 * One committed fixture per schema version this game has ever written, walked
 * up to the current schema.
 *
 * `save.test.ts` already tests the migration *functions*. This tests the
 * migration *chain* against frozen artifacts, which is a different question and
 * the one that matters to a player: a save written by a build from Phase 3 has
 * to still open in the release, and nobody has that build any more.
 *
 * **The fixtures are frozen on purpose.** They are hand-authored from the
 * interfaces in `SaveSchema.ts` at the version each claims, with a fixed
 * `savedAt`, so they are byte-identical on every machine and a diff in one
 * means somebody edited it. Regenerating them from the current code would make
 * this test circular — it would prove the migrations agree with themselves.
 *
 * When `CURRENT_SAVE_VERSION` next goes up, add `v<n>.json` here in the same
 * shape a real build of that version would have written. The count assertion
 * below fails until you do, which is the point.
 */

const DIR = 'tests/fixtures/saves';

const fixtures = readdirSync(DIR)
  .filter((f) => /^v\d+\.json$/.test(f))
  .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));

const load = (f: string): unknown => JSON.parse(readFileSync(join(DIR, f), 'utf8'));

describe('save migration from every committed fixture', () => {
  it('has a fixture for every schema version, including the current one', () => {
    // A missing fixture is a version nobody is testing the upgrade path from.
    expect(fixtures).toHaveLength(CURRENT_SAVE_VERSION);
    expect(fixtures[fixtures.length - 1]).toBe(`v${CURRENT_SAVE_VERSION}.json`);
  });

  for (const file of fixtures) {
    const version = Number(file.slice(1, -5));

    describe(file, () => {
      it('declares the version it claims', () => {
        expect((load(file) as { version: number }).version).toBe(version);
      });

      it(`migrates to v${CURRENT_SAVE_VERSION} and validates`, () => {
        const result = migrateSave(load(file));

        expect(result.ok, `migration failed: ${result.ok ? '' : result.error}`).toBe(true);
        expect(result.data!.version).toBe(CURRENT_SAVE_VERSION);
        expect(result.from).toBe(version);
        expect(validateSave(result.data).ok).toBe(true);
      });

      it('keeps what the player would notice', () => {
        const out = migrateSave(load(file)).data!;

        // Where they are, how old they are, and what they found. A migration
        // that silently moved any of these is a migration that lost a run.
        expect(out.zone).toBe('village_coast');
        expect(out.life.ageYears).toBeCloseTo(16.5, 5);
        expect(out.collectibles).toEqual(['paper_plane', 'toy_boat']);
        expect(out.player.position.x).toBeCloseTo(5.4, 5);
      });

      it('survives the import path as well as the load path', () => {
        // An exported save is the same JSON, and import is the least trusted
        // way in. The guard must not mangle a legitimate old file.
        const json = readFileSync(join(DIR, file), 'utf8');
        const guarded = parseImportedSave(json);
        expect(guarded.ok, guarded.ok ? '' : guarded.reason).toBe(true);

        const migrated = migrateSave(guarded.ok ? guarded.value : null);
        expect(migrated.ok).toBe(true);
        expect(migrated.data!.version).toBe(CURRENT_SAVE_VERSION);
      });
    });
  }

  it('refuses a save from a newer build rather than guessing', () => {
    const future = { ...(load('v5.json') as object), version: CURRENT_SAVE_VERSION + 1 };
    const result = migrateSave(future);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/newer version/);
  });

  it('gives a v1 save the defaults a v1 save should have, not invented history', () => {
    const out = migrateSave(load('v1.json')).data!;

    // v1 predates all of these. The rule from SAVE_FORMAT.md is that an old
    // save loads as a *plausible* run: full needs rather than starving, and
    // no relationships rather than friendships the player never made.
    expect(out.needs).toEqual({ hunger: 1, energy: 1, cleanliness: 1, mood: 1 });
    expect(out.relationships).toEqual([]);
    expect(out.vehicles).toEqual([]);
    expect(out.unlockedZones).toEqual(['village_coast']);
    // Money is the one thing v1 did record, and it has to survive.
    expect(out.money).toBe(45);
  });

  it('carries an economy and a story across v3 and v4', () => {
    const fromV3 = migrateSave(load('v3.json')).data!;
    expect(fromV3.economy?.wallet.cash).toBe(45);
    // A spent award key must survive, or a reload re-pays a finished job.
    expect(fromV3.economy?.awards).toContain('job_grocery_shift#1');
    expect(fromV3.tasks?.completions.job_grocery_shift).toBe(1);

    const fromV4 = migrateSave(load('v4.json')).data!;
    expect(fromV4.story.progress?.choices.ch2_bicycle).toBe('fix');
    expect(fromV4.story.progress?.paidRewards).toContain('quest:q2_first_pay:paid:money');
  });
});
