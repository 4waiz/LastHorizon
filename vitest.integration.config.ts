import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';
import { readFileSync } from 'node:fs';

const pkg: { version: string } = JSON.parse(readFileSync('./package.json', 'utf8'));

/**
 * The integration layer.
 *
 * A separate project rather than a folder inside `tests/`, for one reason: the
 * two layers answer different questions and should be able to fail
 * independently. A unit test says a module is correct in isolation; an
 * integration test says two modules that were each correct still agree when
 * wired together — which is where most of this project's real defects have
 * lived. The Phase 8 cutscene bug (a quest that completed during its own scene
 * left the event in the queue forever) and the Phase 9 surrender bug
 * (`surrender()` cleared Heat and skipped every consequence) were both exactly
 * this shape, and both passed every unit test in the repository.
 *
 * `node` rather than `jsdom`: nothing here touches the DOM, and the systems
 * under test are the clockless ones — `QuestSystem`, `TaskSystem`, `Economy`,
 * `HeatSystem`, `SaveService` — so they can be driven far faster than real
 * time without a browser or a renderer anywhere near them.
 */
export default defineConfig({
  define: {
    __LH_VERSION__: JSON.stringify(pkg.version),
    __LH_BUILD__: JSON.stringify('test'),
  },
  resolve: {
    dedupe: ['three'],
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    // Longer than a unit test: these drive whole systems for simulated hours.
    testTimeout: 30_000,
    server: { deps: { inline: ['three', 'three-mesh-bvh'] } },
  },
});
