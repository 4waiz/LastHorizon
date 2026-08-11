import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';
import { readFileSync } from 'node:fs';

const pkg: { version: string } = JSON.parse(readFileSync('./package.json', 'utf8'));

export default defineConfig({
  // The same two constants Vite substitutes, so a module that reports the
  // build identity can be unit-tested without a bundler. The build id is
  // fixed here rather than shelling out to git: a test asserting on the
  // current commit would fail on the next one, which is not a defect.
  define: {
    __LH_VERSION__: JSON.stringify(pkg.version),
    __LH_BUILD__: JSON.stringify('test'),
  },
  resolve: {
    // three-mesh-bvh and the examples modules each import three; without
    // dedupe the bundle can end up with two copies, which breaks instanceof
    // checks and any prototype augmentation.
    dedupe: ['three'],
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['tests/**/*.test.ts'],
    // Inline three so the node transform honours `dedupe` above; otherwise
    // three-mesh-bvh pulls in its own externalised copy.
    server: { deps: { inline: ['three', 'three-mesh-bvh'] } },
  },
});
