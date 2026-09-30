import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { currentSaveVersion } from '../scripts/vite-plugin-pwa';
import { CURRENT_SAVE_VERSION } from '../src/save/SaveSchema';

/**
 * The service worker, checked against the failure it exists to prevent.
 *
 * Not "does it cache things" — that is the easy half and a browser test would
 * be the honest way to prove it. These are the properties that decide whether
 * a returning player keeps their save:
 *
 *   1. the cache name carries the save schema version;
 *   2. that version is *read* from the schema rather than restated;
 *   3. the worker never calls `skipWaiting` on its own.
 *
 * Everything about (3) is worth a test rather than a comment, because it is one
 * line to add for a plausible-sounding reason ("updates should be seamless")
 * and the consequence is a run lost to a mid-session takeover.
 *
 * The generated worker only exists after `npm run build`, so the tests that
 * read it skip cleanly when it does not — a unit suite that requires a build
 * to have happened first is a unit suite that fails for the wrong reason.
 */

const SW = 'dist/sw.js';
const MANIFEST = 'dist/manifest.webmanifest';
const built = existsSync(SW);
const sw = built ? readFileSync(SW, 'utf8') : '';

describe('service worker generation', () => {
  it('reads the save schema version from the schema, not from a copy', () => {
    // The one assertion that keeps the cache key honest. A hard-coded number
    // here would drift the moment somebody adds a migration, and the symptom
    // would be a cached old build reading a new save.
    expect(currentSaveVersion('src/save/SaveSchema.ts')).toBe(CURRENT_SAVE_VERSION);
  });

  it.skipIf(!built)('keys the cache on version, build and save schema', () => {
    const m = /const CACHE = "([^"]+)"/.exec(sw);
    expect(m, 'sw.js should declare a CACHE name').not.toBeNull();

    const name = m![1];
    expect(name.startsWith('lh-')).toBe(true);
    // A schema bump must orphan every previous cache by construction.
    expect(name).toContain(`-s${CURRENT_SAVE_VERSION}-`);
  });

  it.skipIf(!built)('never calls skipWaiting except when the page asks', () => {
    // `skipWaiting` may appear exactly once, inside the message handler. Any
    // other occurrence — in `install`, at top level — is a worker that can
    // take over mid-session and pair old code with a new save.
    const occurrences = sw.match(/skipWaiting\(\)/g) ?? [];
    expect(occurrences).toHaveLength(1);
    expect(sw).toMatch(/LH_SKIP_WAITING'\)\s*self\.skipWaiting\(\)|LH_SKIP_WAITING[\s\S]{0,80}skipWaiting\(\)/);
  });

  it.skipIf(!built)('deletes every cache generation but the current one', () => {
    expect(sw).toMatch(/caches\.delete/);
    expect(sw).toMatch(/n !== CACHE/);
  });

  it.skipIf(!built)('precaches the shell and the village, and nothing optional', () => {
    const m = /const PRECACHE = (\[[\s\S]*?\]);/.exec(sw);
    expect(m).not.toBeNull();
    const list: string[] = JSON.parse(m![1]);

    // The shell.
    expect(list).toContain('./index.html');
    expect(list).toContain('./manifest.webmanifest');
    expect(list.some((u) => /assets\/index-.*\.js$/.test(u))).toBe(true);
    expect(list.some((u) => /assets\/three-.*\.js$/.test(u))).toBe(true);

    // The village.
    expect(list.some((u) => u.endsWith('player.glb'))).toBe(true);
    expect(list.some((u) => u.endsWith('buildings.glb'))).toBe(true);

    // And *not* the things a first visit has not asked for. Precaching these
    // would push several megabytes at somebody who has not decided they like
    // the game yet, which is the opposite of what the shell cache is for.
    const forbidden = ['rapier', 'recast', 'StorySubsystem', 'weapons.glb', 'aircraft.glb', 'indoor.mp3'];
    for (const f of forbidden) {
      expect(list.some((u) => u.includes(f)), `${f} must not be precached`).toBe(false);
    }
  });

  it.skipIf(!built)('never touches another origin', () => {
    // Nothing in this game loads a third-party URL, and a worker that caches
    // one is a worker that can serve a stale one.
    expect(sw).toMatch(/url\.origin !== self\.location\.origin/);
  });

  it.skipIf(!existsSync(MANIFEST))('declares an installable manifest', () => {
    const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
    expect(manifest.name).toContain('Last Horizon');
    expect(manifest.display).toBe('fullscreen');
    expect(manifest.orientation).toBe('landscape');
    // Relative, so an install works from a subdirectory as well as a root.
    expect(manifest.start_url).toBe('./');
    expect(manifest.scope).toBe('./');
    expect(manifest.icons.length).toBeGreaterThan(0);
    expect(manifest.icons.some((i: { purpose: string }) => i.purpose === 'maskable')).toBe(true);
  });
});
