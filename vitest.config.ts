import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
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
