import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  base: './',
  resolve: {
    // three-mesh-bvh and the examples modules each import three; without
    // dedupe the bundle can end up with two copies, which breaks instanceof
    // checks and any prototype augmentation.
    dedupe: ['three'],
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    open: false,
  },
  build: {
    target: 'es2020',
    sourcemap: false,
    chunkSizeWarningLimit: 1400,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          bvh: ['three-mesh-bvh'],
          gsap: ['gsap'],
        },
      },
    },
  },
});
