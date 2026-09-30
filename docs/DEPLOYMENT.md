# Deployment

*A Kanban Studios game — kanbanstudios.ae. Game Developer: Awaiz Ahmed.*

How to put Last Horizon on the web, and the handful of server settings that
actually matter. The game is a static site: no backend, no database, no API
key, nothing to configure at runtime.

---

## 1. Build

```bash
npm ci
npm run verify
npm run build
```

`dist/` is the whole deployment. It contains no source maps
(`sourcemap: false`), no dev screenshot endpoint — the budget gate asserts
`__shot`, `__cap.js` and `lh-shot-sink` are absent on every build — and no
secrets, because there are none to have.

`__LH_BUILD__` is the git short sha, with `-dirty` appended when the tree is
not clean. **Deploy from a clean checkout**, or the service worker's cache key
and every diagnostic file will say `-dirty` and mean nothing.

## 2. Where it goes

Either shape works, and the difference is only the scope of the service worker:

- `game.kanbanstudios.ae` — the worker's scope is the whole origin.
- `kanbanstudios.ae/game/` — the worker's scope is `/game/`.

Both are supported without a rebuild. `vite.config.ts` sets `base: './'`, the
manifest's `start_url` and `scope` are `'./'`, and registration uses
`new URL('sw.js', document.baseURI)`. Nothing is hard-coded to a root.

**HTTPS is required, not recommended.** Service workers need a secure context,
so over plain HTTP the game runs fine and is simply never offline-capable.
`registerServiceWorker()` checks `window.isSecureContext` and returns quietly
rather than logging an error, because a plain-HTTP staging host is a normal
thing to have.

## 3. Headers

The one part of this document that changes behaviour.

### Caching

```
# Hashed build output. The hash changes when the bytes do, so this is safe
# and it is the single most valuable header here.
/assets/*
  Cache-Control: public, max-age=31536000, immutable

# The shell. Must never be cached hard, or a deploy is invisible until
# somebody clears their browser.
/index.html
  Cache-Control: no-cache

# The worker decides when the app updates, so it must never be stale itself.
/sw.js
  Cache-Control: no-cache
/manifest.webmanifest
  Cache-Control: no-cache
```

`no-cache` does not mean "do not store" — it means revalidate before use,
which is exactly right for these three.

### Compression

Enable Brotli, falling back to gzip. It is worth more here than anywhere else
in the stack:

| | Raw | Gzip |
| --- | --- | --- |
| `three-*.js` | 609.1 kB | ~158 kB |
| app chunk | 385.1 kB | ~122 kB |
| `rapier-*.js` *(lazy)* | 2,184.9 kB | ~830 kB |

Do not compress `.glb`, `.mp3` or `.png` — all three are already compressed and
re-compressing costs CPU to add bytes.

### Security

The CSP is in `index.html` as a `<meta>` tag so it travels with the code and
protects `file://` and `vite preview`. **Send it as a header too**: `meta`
cannot express `frame-ancestors`, which is the one that stops clickjacking.

```
Content-Security-Policy: default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self'; font-src 'self'; connect-src 'self'; worker-src 'self' blob:; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'; upgrade-insecure-requests
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
Permissions-Policy: geolocation=(), microphone=(), camera=(), payment=(), usb=()
```

**`'wasm-unsafe-eval'` is not optional.** Rapier and recast-navigation each
compile WebAssembly. Without it, physics and navigation fail at the moment a
player first gets on a bicycle — a long way from the loading screen, and it
looks like a game bug rather than a policy one. It permits WebAssembly
compilation and nothing else; `eval` and `new Function` stay blocked and appear
nowhere in `src/`.

`Permissions-Policy` denies everything because the game asks for nothing. It
uses no camera, no microphone, no location and no payment API.

### MIME types

Most hosts get these right; two are worth checking:

```
.glb              model/gltf-binary
.webmanifest      application/manifest+json
```

## 4. Deployment checklist

1. `git status` is clean, and you are on the tag you mean to ship.
2. `npm ci` — not `npm install`; the lockfile is the point.
3. `npm run verify` passes.
4. `npm run release:check` passes, or you have written down which long gate you
   skipped and why.
5. `dist/sw.js` exists and its `CACHE` line carries the version, the sha and
   `-s<save schema>`.
6. Upload `dist/` in full. **Do not upload a partial directory** — a missing
   hashed chunk is a 404 the service worker will happily cache.
7. Headers from §3 are in place, `/assets/*` immutable and `/index.html`
   `no-cache`.
8. Load the site in a private window. Check: the game boots, the console is
   clean, and DevTools → Application shows one service worker, activated, with
   the cache name you expect.
9. Reload. Confirm the second load is served from the cache and is faster.
10. Turn off the network and reload. The village should still start, and the
    offline bar should appear.
11. Deploy again with any change and confirm the update bar appears rather than
    the game silently swapping under a running session.

## 5. Rolling back

Static, so a rollback is a re-upload of the previous `dist/`. Two things make
it safe, and one makes it need care:

- Hashed filenames mean an old and a new build never collide.
- The worker deletes every cache that is not its current name, so rolling back
  orphans the newer cache on next activation.
- **A rollback across a save-schema change is the case to think about.** Saves
  migrate forward, never backward: a save written by 0.2.0 at schema 6 is
  *refused* by 0.1.0 at schema 5 — deliberately, because guessing is worse.
  The player is told the save is from a newer version and their older saves
  still load. If you are rolling back across a schema bump, say so in the
  release note.

## 6. Analytics and privacy

**There are none, and that is a design decision rather than an omission.** No
analytics, no telemetry, no cookies, no fingerprinting, no third-party request
of any kind — `connect-src 'self'` makes that checkable rather than a promise,
and `story.spec.ts` asserts nothing but a `GET` ever leaves the page while the
Life Reel is produced.

Saves are IndexedDB on the player's own device. The Life Reel and the crash
diagnostic file are built in memory and downloaded locally.

If analytics are ever added, the brief's rule stands: not without an explicit
policy and a real user choice, and the CSP has to be widened to allow it, which
is a visible change rather than a quiet one.

## 7. What the server does not need

No Node runtime. No environment variables. No secrets. No database. No CORS
configuration — nothing is cross-origin. No WebSocket. No SSR.

Any static host will do.
