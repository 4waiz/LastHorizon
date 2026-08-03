import { defineConfig, type Plugin } from 'vite';
import { fileURLToPath, URL } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';

/**
 * Dev-only in-engine screenshot harness.
 *
 * `import('/__cap.js')` installs window.__view / __free / __top on the running
 * page; each POSTs a base64 JPEG to /__shot?name=foo, which lands in
 * .shots/foo.jpg. Renders go through an offscreen target rather than the
 * canvas so this works with the browser pane hidden, where the default
 * framebuffer is not complete. Never part of a build — `apply: 'serve'`.
 */
const CAPTURE_JS = `
const g = window.__lh;
if (!g || !g.world) throw new Error('game not ready');
// Borrow the classes off live objects. Importing "three" from a raw string
// module would need the bare specifier rewritten, and this needs no build step.
const RenderTarget = g.post.composer.renderTarget1.constructor;
const PerspectiveCamera = g.camera.camera.constructor;
const R = g.renderer.renderer;
const W = 800, H = 620;
const rt = new RenderTarget(W, H);
const buf = new Uint8Array(W * H * 4);
const src = document.createElement('canvas');
src.width = W; src.height = H;
const sctx = src.getContext('2d');
const free = new PerspectiveCamera(50, W / H, 0.3, 3000);

async function emit(name, cam) {
  g.env?.sky?.anchorDome?.(cam.position);
  R.setRenderTarget(rt); R.clear(); R.render(g.scene, cam); R.setRenderTarget(null);
  R.readRenderTargetPixels(rt, 0, 0, W, H, buf);
  const img = sctx.createImageData(W, H);
  for (let y = 0; y < H; y++) {
    const s = (H - 1 - y) * W * 4;
    img.data.set(buf.subarray(s, s + W * 4), y * W * 4);
  }
  sctx.putImageData(img, 0, 0);
  await fetch('/__shot?name=' + name, {
    method: 'POST',
    body: src.toDataURL('image/jpeg', 0.85).split(',')[1],
  });
}

/** Third-person view: put the player somewhere and shoot the game camera. */
window.__view = async (name, x, z, facing, dist, pitch) => {
  g.player.motor.teleport(x, g.world.terrain.heightAt(x, z) + 0.05, z);
  g.player.controller.facing = facing;
  g.camera.resetBehind(g.player.lookTarget, facing);
  g.camera.setDistance(dist);
  for (let i = 0; i < 40; i++) g.update(1 / 60);
  if (pitch !== undefined) { g.camera.pitch = pitch; g.update(1 / 60); }
  const cam = g.camera.camera;
  cam.aspect = W / H; cam.updateProjectionMatrix();
  await emit(name, cam);
};

/**
 * Free camera. The player is parked *at* the camera, not at the target —
 * anything between camera and player gets dithered away by the occluder fade,
 * which turns the subject of the shot into a black silhouette.
 */
window.__free = async (name, px, py, pz, tx, ty, tz, fov, keepPlayer) => {
  if (!keepPlayer) {
    g.player.motor.teleport(px, py, pz);
    for (let i = 0; i < 8; i++) g.update(1 / 60);
  }
  free.fov = fov || 50; free.updateProjectionMatrix();
  free.position.set(px, py, pz);
  free.lookAt(tx, ty, tz);
  free.updateMatrixWorld(true);
  await emit(name, free);
};

window.__top = async (name, cx, cz, height, fov) => {
  const base = g.world.terrain.heightAt(cx, cz);
  await window.__free(name, cx + 0.01, base + height, cz + height * 0.35, cx, base, cz, fov);
};

export const ready = true;
`;

function shotSink(): Plugin {
  return {
    name: 'lh-shot-sink',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__cap.js', (_req, res) => {
        res.setHeader('Content-Type', 'text/javascript');
        res.setHeader('Cache-Control', 'no-store');
        res.end(CAPTURE_JS);
      });
      server.middlewares.use('/__shot', (req, res) => {
        const name = new URL(req.url ?? '', 'http://x').searchParams.get('name') ?? 'shot';
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
          mkdirSync('.shots', { recursive: true });
          writeFileSync(`.shots/${name}.jpg`, Buffer.from(chunks.join(''), 'base64'));
          res.statusCode = 204;
          res.end();
        });
      });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [shotSink()],
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
